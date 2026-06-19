# Design: data-steward-grant-automation

- **Change name:** `data-steward-grant-automation`
- **Date:** 2026-06-19
- **Phase:** design
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** ready-for-tasks
- **File path:** `openspec/changes/data-steward-grant-automation/design.md`
- **Slice:** B0 of deploy automation (B1 = backup/restore/S3, separate future change)
- **Delivery:** single PR, target ~220 changed lines (well under 400-line review budget)
- **Target version bump:** `0.4.1 → 0.4.2` (patch, additive CLI only, bumped at PR close)
- **Strict TDD:** enabled — `grant-data-steward.ts` and `OperatorsRepo.findByUsername()` land via RED → GREEN → REFACTOR

---

## Context

Slice B0 of deploy automation. Closes one operational gap: the manual SQL block at `docs/runbook.md:26-43` that grants `data_steward` to operators. The block is error-prone (no idempotency on retry → composite PK error `23505`), lacks audit logging, and is unfriendly to automation. This change wraps the existing `PermissionsRepo.grant()` at `packages/db/src/repositories/permissions.ts:48-53` — which already handles idempotency via `onConflictDoNothing()` — in a typed CLI with Zod-validated `--json` output and `emitAudit()` logging per grant. No external dependencies. Strict TDD for the code piece; doc-only for the runbook fix.

The sibling change (`db-status-and-drift-gate` / Slice A) shipped at v0.4.1 on 2026-06-18 and established the conventions this change follows: `packages/db/src/scripts/status.ts` template (tsx + Zod + exit codes 0/1/2), runbook HTML deprecation comment for snippet-history readers, and 2-commit structure (TDD commit + `chore(release): vX.Y.Z`).

---

## Goals / Non-Goals

### Goals

- `pnpm ops:grant-data-steward --username <u>` exits 0; grants `data_steward` to the named operator; emits one `permission.granted` audit row.
- Re-running the same command is idempotent: no error, no duplicate `role_permissions` row, audit count does not double within the 10s `emitAudit` bucket (`packages/audit/src/emitter.ts:36`).
- `--json` flag emits a Zod-validated shape: `{ granted: string[], alreadyGranted: string[], auditIds: string[] }`.
- `--from-env` flag reads `DATA_STEWARD_OPERATOR_IDS` (CSV of UUIDs) and grants to all listed operators without username resolution.
- `--username <nonexistent>` exits 1 with `operator not found: <u>` on stderr; no audit emitted.
- `OperatorsRepo.findByUsername()` is introduced and lives in `packages/db/src/repositories/operators.ts` (new file, follows the `permissions.ts` factory pattern).
- `docs/runbook.md` no longer contains the raw SQL block at lines 26-43; the runbook is forward-deprecated with an HTML comment, mirroring the Slice A pattern (line 59).
- Strict TDD traceable in `apply-progress`: RED tests committed before any implementation.

### Non-Goals

- **Slice B1 entirely** — `scripts/backup.sh`, `scripts/restore.sh`, `.env.example` additions, `BACKUP_BUCKET`/S3 wiring. Separate future change.
- **Granting arbitrary permission_keys** — the script is hardcoded to `data_steward` for v1. Future `--key` flag is v2.
- **DB-query-based operator discovery** — `SELECT id FROM operators WHERE role='A'` was considered and **rejected** (privilege escalation footgun — auto-grants to all active admins). The proposal locks this.
- **Bulk CSV import** — repeat `--username` flags (or `--from-env`) cover v1.
- **UI for grant management** — operations script only.
- **Auto-revoke** — no spec demand; out of scope.
- **Modifying `PermissionsRepo.grant()` signature** — it returns `Promise<void>` (no `RETURNING`). Idempotency is detected via pre-check `hasPermission()` instead. No repo signature change.
- **Dry-run mode** — out of scope for v1; can be added in v2 if needed.

---

## Architecture / Approach

### 4.1 `packages/db/src/scripts/grant-data-steward.ts` + tests (strict TDD)

**File split — pure fn vs. CLI wrapper.** Two concerns separated to maximize testability without a Postgres fixture:

1. **Pure function** `bucketizeGrant(operator: Operator | null, hasPermission: boolean, key: string): { granted: string[]; alreadyGranted: string[]; skipped: { username: string }[] }` — classifies one operator into one of three buckets. No I/O. Trivially testable. Lives in the same file (Slice A pattern; the test imports from the script file directly).
2. **CLI wrapper** at the bottom of the file — creates `createDb()` from `./pool.ts`, instantiates `makePermissionsRepo(db)` and `makeOperatorsRepo(db)`, parses argv, calls `bucketizeGrant` per operator, calls `permissionsRepo.grant()` + `emitAudit()` for the `granted` bucket, prints human or JSON output, sets `process.exitCode`.

**Postgres flow per username (or per UUID in `--from-env` mode):**

```
argv → parseArgv → for each target:
  ┌─ if --from-env: target = { id: <uuid>, username: null }
  └─ else:            target = operatorsRepo.findByUsername(username)
                       └─ null → exit 1, "operator not found: <u>"
  permissionsRepo.hasPermission(target.id, 'data_steward')
    ├─ true  → push target.id to alreadyGranted (skip grant + audit)
    └─ false → permissionsRepo.grant(target.id, 'data_steward', null)
                emitAudit(db, { operatorId: null, action: 'permission.granted',
                                entityType: 'role_permission', entityId: target.id,
                                payload: { permissionKey: 'data_steward', grantedBy: null } })
                → push target.id to granted
                → push auditResult.id to auditIds
```

**Transaction shape.** Each (grant + audit) pair runs inside a single `db.transaction(async (tx) => { ... })` call. The audit row MUST be in the same transaction as the grant; otherwise a crash between the two writes leaves an orphan audit (R4 in §7). The transaction is per-operator — partial failure aborts the failing operator's grant but does not roll back the others (the spec scenario "CLI exits 1 on unknown username" requires that the script continue processing other usernames after one fails, not abort all). Justification: the runbook use case is "grant to a batch of operators from a bootstrap env var"; if one operator's row is mid-DDL or the audit insert fails for one operator, the operator's CLI invocation still succeeds for the rest and the operator can re-run the script to fix the failed one.

**Exit codes:**

- `0` — all grants succeeded (or all skipped as idempotent, or `--from-env` was empty).
- `1` — at least one unknown username, OR at least one operator that `--from-env` tried to look up was missing (uuid present in env but row absent in DB). Partial-success mode: if 5 operators were processed and 1 was unknown, exit 1; the other 4 grants still landed.
- `2` — connection error (cannot reach Postgres). Distinct from "operator not found".

**Error handling.** Friendly stderr: `grant-data-steward: operator not found: <u>` (matches `status.ts` prefix style). Connection errors: `grant-data-steward: cannot connect to <redacted>: <message>` → exit 2.

**Inline CLI parser (no commander/yargs).** Mirrors `status.ts:136-138`:

```ts
function parseArgv(argv: string[]): {
  usernames: string[]
  fromEnv: boolean
  json: boolean
} {
  const usernames: string[] = []
  let fromEnv = false
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--from-env') fromEnv = true
    else if (a === '--json') json = true
    else if (a === '--username') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error('--username requires a value')
      usernames.push(v)
    } else if (a.startsWith('--username=')) {
      usernames.push(a.slice('--username='.length))
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return { usernames, fromEnv, json }
}
```

**Validation rules:**

- `--from-env` + at least one `--username` → reject with `error: --from-env cannot be combined with --username` and exit 2. (The script should not silently take the union — operators expect one mode or the other.)
- Neither `--from-env` nor `--username` → reject with `usage:` line and exit 2.
- `DATA_STEWARD_OPERATOR_IDS` not set when `--from-env` → reject with `error: --from-env requires DATA_STEWARD_OPERATOR_IDS env var` and exit 2.

**Pool / Drizzle wiring.** Use `createDb()` from `packages/db/src/pool.ts` (the same factory `__smoke__.ts:14-19` uses), NOT raw `pg.Pool` like `status.ts`. Justification: this script needs Drizzle's `select` / `insert` (for `OperatorsRepo.findByUsername` and `PermissionsRepo.grant`), and `createDb()` already wires the schema barrel. `status.ts` uses raw `pg.Pool` because it doesn't need Drizzle — it scans the filesystem and queries `__drizzle_migrations` directly.

**TDD order:**

1. **RED** — write `grant-data-steward.test.ts` with cases for: `bucketizeGrant` (4 cases — alreadyGranted, granted, null operator, skipped with reason), CLI happy path (single `--username`), CLI idempotency (call twice, second call all in `alreadyGranted`), CLI unknown username (exit 1, error mentions username), CLI multi-username (two `--username` flags, both processed), CLI `--from-env` with valid UUIDs, CLI `--from-env` with bad UUID, CLI `--json` Zod shape round-trip, CLI human-readable output contains "Granted", "Already had", "Audit IDs" labels. All cases must FAIL initially.
2. **GREEN** — implement `bucketizeGrant` (pure, trivially passes), then the CLI wrapper. The wrapper is small (~50 LoC); it is verified manually via the acceptance CLI steps in §8 rather than with a Postgres fixture (avoids adding `pg-mem` to the dep tree for one script — same posture as Slice A).
3. **REFACTOR** — extract the JSON printer, dedupe human vs JSON output, polish the argv parser, sharpen the Zod error message.

### 4.2 `packages/db/src/scripts/grant-data-steward.schema.ts` (Zod)

**Co-located, separate file** (not embedded in the script). The proposal estimated 30 LoC for the schema file; reality is closer to 15 LoC since the schema is small. Rationale for the separate file: keeps the script's top-level signature readable and matches Slice A's `status.schema.ts` (separate file, co-located). The schema is re-exported from the script for the test import path (`import { grantDataStewardOutputSchema } from './grant-data-steward.schema.js'`).

```ts
import { z } from 'zod'

/**
 * Zod schema for the --json output of grant-data-steward.
 *
 * Shape: { granted: string[], alreadyGranted: string[], auditIds: string[] }
 *
 * All three arrays contain UUIDs as strings (not the structured UUID type —
 * JSON has no native UUID; this matches the project convention of z.string().uuid()).
 */
export const grantDataStewardOutputSchema = z.object({
  granted: z.array(z.string().uuid()),
  alreadyGranted: z.array(z.string().uuid()),
  auditIds: z.array(z.string().uuid()),
})

export type GrantDataStewardOutput = z.infer<typeof grantDataStewardOutputSchema>
```

### 4.3 `packages/db/src/scripts/grant-data-steward.test.ts` (vitest, strict TDD)

**Test count target:** 9 cases (4 `bucketizeGrant` + 5 CLI). The pure-fn cases pass trivially once `bucketizeGrant` is implemented. The CLI cases use a mock `db` that satisfies the `Db` interface (same pattern as `packages/db/src/repositories/permissions.test.ts:14-30`) for `findByUsername` + `hasPermission` + `grant`, and a mock `emitAudit` (or accept the real `emitAudit` and stub its return).

**Required cases:**

| # | Case | Expected |
|---|------|----------|
| 1 | `bucketizeGrant(op, hasPermission=true, key)` | `{ granted: [], alreadyGranted: [op.id], skipped: [] }` |
| 2 | `bucketizeGrant(op, hasPermission=false, key)` | `{ granted: [op.id], alreadyGranted: [], skipped: [] }` |
| 3 | `bucketizeGrant(null, false, key)` | `{ granted: [], alreadyGranted: [], skipped: [{ username: '<input>' }] }` |
| 4 | `bucketizeGrant(op, false, 'other_key')` | `{ granted: [], alreadyGranted: [], skipped: [] }` — key mismatch returns nothing (defensive: script always calls with `'data_steward'`) |
| 5 | CLI `--username <existing>` (mock repo returns operator) | exit 0, `granted: [op.id]`, `alreadyGranted: []` |
| 6 | CLI `--username <existing>` twice (idempotency) | second call: `granted: []`, `alreadyGranted: [op.id]` |
| 7 | CLI `--username <nonexistent>` (mock repo returns null) | exit 1, stderr contains `<u>` |
| 8 | CLI `--username <u1> --username <u2>` (both existing) | exit 0, both ids in `granted` |
| 9 | CLI `--from-env` with `DATA_STEWARD_OPERATOR_IDS=uuid1,uuid2` (both valid) | exit 0, both ids in `granted`, no `findByUsername` call (verified by spy) |
| 10 | CLI `--json` output shape | validates against `grantDataStewardOutputSchema` |

### 4.4 `OperatorsRepo.findByUsername()` repo method (NEW)

**New file:** `packages/db/src/repositories/operators.ts` (does not exist today — verified by `ls packages/db/src/repositories/` returning only `_template.ts`, `permissions.ts`, `permissions.test.ts`). Follows the `permissions.ts` factory pattern (NOT the `_template.ts` functional `RepoContext` pattern — the sibling repo uses a factory and the spec example shows `OperatorsRepo.findByUsername('<username>')` syntax, which is the factory pattern).

**New test file:** `packages/db/src/repositories/operators.test.ts` (does not exist today). Mirrors `permissions.test.ts:14-30` (mock `db` standin pattern).

**Signature:**

```ts
export interface OperatorsRepo {
  findByUsername(username: string): Promise<Operator | null>
}

export function makeOperatorsRepo(db: Db): OperatorsRepo {
  return {
    async findByUsername(username) {
      const [row] = await db
        .select()
        .from(operators)
        .where(eq(operators.username, username))
        .limit(1)
      return row ?? null
    },
  }
}
```

**TDD order:**

1. **RED** — `operators.test.ts` with cases: existing username returns the row, missing username returns `null`, empty string returns `null`, multi-row (unique constraint violation pre-condition) — covered by the `LIMIT 1`.
2. **GREEN** — implement `findByUsername` exactly as shown above.
3. **REFACTOR** — confirm imports are minimal (only `eq` from drizzle-orm, `operators` from schema, `Db` from pool), no dead code.

**Returns `null` (not throw) for missing operator** — matches the proposed CLI error handling and the spec's "CLI exits 1 on unknown username" scenario (lines 49-56 of `specs/auth-login/spec.md`).

**Export map update:** `packages/db/package.json` `exports` block currently has `"./repositories/permissions": "./src/repositories/permissions.ts"`. Add `"./repositories/operators": "./src/repositories/operators.ts"` so the repo is consumable from `@athlos/db/repositories/operators`. This is a one-line change to the `exports` field.

### 4.5 Package.json scripts

**`packages/db/package.json`:** add `"grant:data-steward": "tsx src/scripts/grant-data-steward.ts"` (sibling of `migrate:status`). Same `tsx` runtime (already a devDep).

**Root `package.json`:** add `"ops:grant-data-steward": "pnpm --filter @athlos/db grant:data-steward"` (sibling of `db:migrate:status`). Follows the `ops:*` namespace for deploy automation (vs the `db:*` namespace for the migration tooling — `ops:*` is for the new family of operational CLIs introduced in Slice B).

**Naming rationale:** `ops:grant-data-steward` (not `db:grant:data-steward` or `grant:data-steward` flat) keeps the root-level namespace shallow. Slice B1 will add `ops:backup` and `ops:restore` in the same family.

### 4.6 Runbook fix

**Drop.** `docs/runbook.md:26-43`: the SQL block (find operator + `INSERT INTO role_permissions`).

**Replace.** A clean two-line pointer:

```markdown
To enable drift alerts for an operator:

```bash
pnpm ops:grant-data-steward --username <username>
# or for multiple operators via env var:
DATA_STEWARD_OPERATOR_IDS=uuid1,uuid2 pnpm ops:grant-data-steward --from-env
```
```

The `DELETE FROM role_permissions` revoke block (lines 38-43 of the runbook) is OUT OF SCOPE — the proposal locks "auto-revoke" as non-goal. The revoke block remains as-is for the v1 manual revoke path; a future v2 grant script will add a `--revoke` flag.

**Deprecation note (Slice A pattern).** Above the corrected block, add an HTML comment for snippet-history readers:

```markdown
<!-- DEPRECATED 2026-06-19: the manual SQL block (find operator + INSERT
INTO role_permissions) that lived here was removed. It is replaced by
`pnpm ops:grant-data-steward --username <u>` (idempotent + audited).
If your runbook snippet still contains the old INSERT statement, ignore
it and use the CLI below. -->
```

**Net change:** ~5 lines (replace ~18 lines of SQL block with ~5 lines of bash + add the HTML comment).

---

## File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------|-------|
| `packages/db/src/scripts/grant-data-steward.ts` | create | ~80 | `bucketizeGrant` pure fn (~15 LoC) + CLI wrapper (~50 LoC) + `parseArgv` (~15 LoC) + re-export of schema |
| `packages/db/src/scripts/grant-data-steward.schema.ts` | create | ~15 | Zod schema, co-located (mirrors `status.schema.ts`) |
| `packages/db/src/scripts/grant-data-steward.test.ts` | create | ~80 | vitest, ~10 cases; RED phase first |
| `packages/db/src/repositories/operators.ts` | create | ~20 | new repo (file does not exist today) |
| `packages/db/src/repositories/operators.test.ts` | create | ~30 | vitest for `findByUsername` (file does not exist today) |
| `packages/db/package.json` | modify | +2 | add `grant:data-steward` script + add `./repositories/operators` export |
| `package.json` (root) | modify | +1 | add `ops:grant-data-steward` mirror |
| `docs/runbook.md` | modify | ~5 net | replace SQL block + deprecation comment |

**Total estimated delta:** ~233 lines. Well under the 400-line review budget.

---

## Implementation Order

Recommended sequence for `sdd-apply`:

### TDD chain for `OperatorsRepo.findByUsername()`

1. `packages/db/src/repositories/operators.test.ts` — **RED**. All test cases written, all failing.
2. `packages/db/src/repositories/operators.ts` — **GREEN**. `findByUsername` implemented.
3. **REFACTOR** `operators.ts` — confirm imports minimal, no dead code.

### TDD chain for `grant-data-steward.ts`

4. `packages/db/src/scripts/grant-data-steward.schema.ts` — write Zod schema first (supports the test imports).
5. `packages/db/src/scripts/grant-data-steward.test.ts` — **RED**. All 10 cases written, all failing.
6. `packages/db/src/scripts/grant-data-steward.ts` — **GREEN**. `bucketizeGrant` first (tests pass), then CLI wrapper (verified by acceptance CLI steps).
7. **REFACTOR** `grant-data-steward.ts` — extract JSON printer, dedupe human/JSON output, polish argv parser.

### Wiring + docs

8. `packages/db/package.json` — add `grant:data-steward` script + `./repositories/operators` export.
9. `package.json` (root) — add `ops:grant-data-steward` mirror.
10. `docs/runbook.md` — replace SQL block with bash command + deprecation comment.
11. **Pre-closing verification** (all run in `apply-progress`):
    - `cd packages/db && pnpm grant:data-steward --help` (or no-args → usage) — exit 2 with usage line.
    - `pnpm ops:grant-data-steward --username <existing-operator> --json | jq .` — valid JSON, Zod shape, `granted: [id]`.
    - Re-run same command — `granted: []`, `alreadyGranted: [id]`, no new audit row.
    - `pnpm ops:grant-data-steward --username <nonexistent>` — exit 1, stderr contains `<u>`.
    - `DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env` — both granted, exit 0.
    - `pnpm test:run` — 450 + N passing (N ≈ 10 new script cases + ~3 new repo cases = ~13).
    - `pnpm typecheck` — 0 errors.
    - `pnpm lint` — 0 errors.
    - `grep -c "INSERT INTO role_permissions" docs/runbook.md` — 0.
12. **Closing commit** (SEPARATE commit on merge, NOT during the PR per project convention):
    - `package.json` (root): `version: 0.4.1 → 0.4.2`.
    - `packages/db/package.json`: `version: 0.4.1 → 0.4.2`.
    - `CHANGELOG.md`: prepend `[0.4.2]` entry.

**2-commit structure.** TDD commit (`feat(db): grant-data-steward CLI + audit + OperatorsRepo.findByUsername`) + release commit (`chore(release): v0.4.2`). Same shape as Slice A.

---

## Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | **TDD discipline drift** — apply sub-agent skips RED and writes `grant-data-steward.ts` first | Med | Orchestrator verifies `apply-progress` shows RED → GREEN → REFACTOR per task; if RED phase missing, the change is incomplete. The test file is the gate (Slice A lesson: apply may miss artifacts). |
| R2 | **`OperatorsRepo.findByUsername()` test isolation** — the repo test needs a mock `db`; if the test imports the real `Db` type, it may fail to compile | Low | Mirror the `permissions.test.ts:14-30` mock-DB pattern. The mock returns prepared rows; no Postgres needed. |
| R3 | **`PermissionsRepo.grant()` throws mid-loop** — if grant fails for operator N in a batch, the script should not abort operators N+1..M | Low | Wrap each (grant + audit) pair in its own `db.transaction(async (tx) => ...)`. Partial success is the runbook use case (operator reruns the script for the failed subset). The unknown-username path is checked BEFORE the transaction starts, so it does not affect the loop. |
| R4 | **Orphan audit rows** — audit emitted but grant failed, or grant succeeded but audit failed | Med | The (grant + audit) pair is a single `db.transaction(async (tx) => { ... })`. Both succeed or both roll back. The transaction does not span operators (see R3 rationale). |
| R5 | **Runbook deprecation note may be missed** — operator pastes the old SQL block during an incident | Low | HTML deprecation comment at the top of the grant section redirects to the CLI (Slice A pattern, line 59-61). |
| R6 | **Closing commit slippage** — version bump lands in a code commit instead of a release commit | Med | The 2-commit structure is explicit in §6; orchestrator checks `git log --oneline` at PR close to confirm the release commit exists separately (Slice A precedent). |
| R7 | **`--from-env` + `--username` ambiguity** — operator runs both | Low | `parseArgv` rejects the combination with a clear error: `--from-env cannot be combined with --username`. Tested in case 9 (one of the `--from-env` cases asserts no `findByUsername` call). |
| R8 | **`OperatorsRepo` is new and has no test fixture pattern in this repo** | Low | The new `operators.test.ts` mirrors `permissions.test.ts` exactly (mock-DB standin). The test pattern is established and consistent. |

---

## Acceptance / Verification

Run after `sdd-apply` completes:

```bash
# 1. Usage line on no-args
cd /run/media/vlongo/Archivos/Projectos/Athlos
pnpm ops:grant-data-steward
# Expect: exit 2, usage line on stderr

# 2. Happy path — single existing operator
pnpm ops:grant-data-steward --username alice --json | jq .
# Expect: { "granted": ["<uuid>"], "alreadyGranted": [], "auditIds": ["<uuid>"] }, exit 0

# 3. Idempotency — re-run same command
pnpm ops:grant-data-steward --username alice --json | jq .
# Expect: { "granted": [], "alreadyGranted": ["<uuid>"], "auditIds": [] }, exit 0
# (auditIds is empty because the 10s SHA-256 dedup bucket in emitAudit absorbs the second call)

# 4. Unknown username
pnpm ops:grant-data-steward --username ghost
# Expect: exit 1, stderr: "grant-data-steward: operator not found: ghost"

# 5. Multi-username
pnpm ops:grant-data-steward --username alice --username bob --json | jq .
# Expect: both uuids in `granted`, exit 0

# 6. --from-env mode
DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env --json | jq .
# Expect: both uuids in `granted`, exit 0

# 7. --from-env with bad UUID
DATA_STEWARD_OPERATOR_IDS=<bad-uuid> pnpm ops:grant-data-steward --from-env
# Expect: exit 1, error mentions the bad UUID

# 8. --from-env + --username combination (rejected)
pnpm ops:grant-data-steward --from-env --username alice
# Expect: exit 2, error: "--from-env cannot be combined with --username"

# 9. No test regression
pnpm test:run
# Expect: 450 + N passing (N ≈ 13: 10 script cases + 3 repo cases), 0 failing

# 10. Typecheck clean
pnpm typecheck
# Expect: 0 errors

# 11. Lint clean
pnpm lint
# Expect: 0 errors

# 12. Runbook reconciled
grep -c "INSERT INTO role_permissions" docs/runbook.md
# Expect: 0
grep -A 3 "DEPRECATED 2026-06-19" docs/runbook.md
# Expect: matches the new HTML comment

# 13. Closing commit version bump (verify after PR merge)
git show HEAD~1 -- package.json packages/db/package.json | grep '"version"' | head -2
# Expect: 0.4.1
git show HEAD -- package.json packages/db/package.json | grep '"version"' | head -2
# Expect: 0.4.2
```

---

## Review Workload Forecast

- **Estimated changed lines:** ~233 (80 script + 15 schema + 80 test + 20 repo + 30 repo test + 2 `package.json` (root + db) + 5 docs/runbook.md net).
- **400-line budget risk:** **LOW** — ~58% of budget used; well under.
- **Chained PRs recommended:** **No** — Slice B0 is already the smallest autonomous unit of Slice B; Slice B1 is a separate change (different scope: backup/restore/S3).
- **Suggested split:** N/A.
- **2-commit structure:** TDD commit (`feat(db): grant-data-steward CLI + audit + OperatorsRepo.findByUsername`, covering tasks 1-10) + release commit (`chore(release): v0.4.2`, task 12).
- **Work-unit count:** 12 (1 per task in §6).

---

## Strict TDD Verification Checklist

For `sdd-apply` to be considered complete:

- [ ] `packages/db/src/repositories/operators.test.ts` written and committed BEFORE `packages/db/src/repositories/operators.ts` (apply-progress shows a commit where only `operators.test.ts` is added and all tests fail).
- [ ] `packages/db/src/scripts/grant-data-steward.test.ts` written and committed BEFORE `packages/db/src/scripts/grant-data-steward.ts` (apply-progress shows a commit where only `grant-data-steward.test.ts` is added and all tests fail).
- [ ] All RED-phase cases FAIL before implementation (verifiable by `git stash` of the impl files and re-running tests).
- [ ] Implementation passes all tests (GREEN — `pnpm test:run` shows the new cases passing).
- [ ] REFACTOR pass with no behavior change (test suite stays green; at least one follow-up commit improves the code).
- [ ] Final test count: 450 + N (where N ≈ 13 new cases: 10 script + 3 repo) — `pnpm test:run` summary shows no regression.
- [ ] No AI co-author in any commit; Conventional Commits format throughout.
- [ ] PR title: `feat(db): grant-data-steward CLI + audit + OperatorsRepo.findByUsername (v0.4.2)`.
- [ ] `apply-progress.md` ends with a GREEN→REFACTOR verification block citing the passing test run.
- [ ] `package.json` exports field updated: `"./repositories/operators": "./src/repositories/operators.ts"` present.

---

## Open Questions

None. The seven locked user decisions (Slice B0 standalone, patch bump 0.4.1→0.4.2, `--username` primary + `--from-env` mandatory, pre-check `hasPermission()` for idempotency, `--json` Zod-validated shape, per-grant `emitAudit` with `operatorId: null`, `OperatorsRepo.findByUsername()` introduced in this change) cover every ambiguous point in the proposal. Strict TDD and the 2-commit structure are inherited from Slice A.
