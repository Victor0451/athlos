# Design: db-status-and-drift-gate

- **Change name:** `db-status-and-drift-gate`
- **Date:** 2026-06-18
- **Phase:** design
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** ready-for-tasks
- **File path:** `openspec/changes/db-status-and-drift-gate/design.md`
- **Slice:** A of 4 (first autonomous slice of future deploy automation series)
- **Delivery:** single PR, target ~280 changed lines (well below 400-line review budget)
- **Target version bump:** `0.4.0 → 0.4.1` (patch, ops-only, bumped at PR close)
- **Strict TDD:** enabled — `status.ts` lands via RED → GREEN → REFACTOR

---

## Context

Slice A of deploy automation. Closes three concrete operational gaps that already exist today: the `pnpm db:migrate:status` command the runbook asks for but `packages/db/package.json` does not provide (`docs/runbook.md:7`); the `drizzle-kit check` CI drift gate that `database-migrations/spec.md:121-124,133` mandates but `.github/workflows/test.yml` does not run; and the runbook's `pnpm db:migrate:rollback --to 0009_domain_freshness` block (`docs/runbook.md:61-67`) that both does not exist in `packages/db/package.json` and contradicts `database-migrations/spec.md:56` (forward-only mandate). No external dependencies are introduced. Strict TDD applies to the TypeScript deliverable (deliverables 1 and 2); the CI YAML and runbook edits are declarative and verified by parsing + grep.

---

## Goals / Non-Goals

### Goals

- `pnpm db:migrate:status` works at root and at `packages/db`, prints applied/pending/divergence, exits 0 when clean.
- `--json` flag emits a Zod-validated JSON shape with four fields (`applied`, `pending`, `divergence`, `exitCode`).
- CI runs `drizzle-kit check` against a Postgres service container and exits non-zero on drift, blocking merges per spec.
- `docs/runbook.md` no longer mentions `db:migrate:rollback`; the corrected procedure is forward-only and points to the spec.
- Strict TDD traceable in `apply-progress`: RED tests committed before implementation.

### Non-Goals

- Slices B/C/D (backup/grants, Dockerfile+compose, deploy workflow) — separate future changes.
- Adding a `db:migrate:rollback` script — would contradict `database-migrations/spec.md:56`.
- Auto-rollback on smoke failure — post-Slice-D follow-up.
- Secrets manager migration — env-var injection is the v1 contract.
- Multi-region / blue-green — Athlos is single-node Postgres.

---

## Architecture / Approach

### 4.1 `packages/db/src/scripts/status.ts` + tests (strict TDD)

**File split.** Two concerns separated:

1. **Pure function** `diffMigrations(applied: string[], local: string[]): { applied: string[]; pending: string[]; divergence: string[] }` — three-set diff. No I/O. Trivially testable.
2. **CLI wrapper** at the bottom of `status.ts` — reads `__drizzle_migrations` via the existing `createDb` pool from `./pool.ts` (the same factory `__smoke__.ts` uses), scans `packages/db/drizzle/*.sql` with `node:fs/promises` (excluding `meta/`), calls `diffMigrations`, prints or emits JSON, sets `process.exitCode`.

**Co-located Zod schema.** `statusSchema = z.object({ applied: z.array(z.string()), pending: z.array(z.string()), divergence: z.array(z.string()), exitCode: z.union([z.literal(0), z.literal(1)]) })` lives in `status.ts` (not a separate file) and is re-exported for tests. One source of truth — test and prod cannot drift.

**Postgres query.** Per spec (`spec.md:9`), use the Drizzle migrator read path OR a direct read-only query. Choose the direct query for transparency and to avoid pulling in the migrator at script-load time: `SELECT hash, created_at FROM __drizzle_migrations ORDER BY id ASC`. Wrap in a transaction with `SET LOCAL statement_timeout = '5s'` to prevent a hung read from masking drift.

**Filesystem scan.** `readdir` on `packages/db/drizzle/`, filter to `*.sql` (regex `/^\d{4}_.+\.sql$/` to match the project's `NNNN_<adjective>_<noun>.sql` pattern; this is what `drizzle-kit generate` produces and what `packages/db/drizzle/` already contains: `0000_quick_wraith.sql` … `0011_audit_idempotency_partial_index.sql`). Strip the `.sql` suffix; the basename (e.g. `0011_audit_idempotency_partial_index`) is the migration identifier used for diffing.

**Idempotency.** Read-only. Never applies migrations. Never writes to the DB. Never modifies the filesystem.

**Exit codes.**

- `0` — applied == local AND divergence is empty.
- `1` — pending non-empty OR divergence non-empty (drift or pending migrations).
- `2` — connection error (distinct from drift; operator and CI both need this distinction).

**Error handling.** Connection errors write a friendly line to stderr (e.g. `db package: cannot connect to <redacted-conn-string>: <error>`) and exit 2. Drift writes to stdout (operator-friendly table) and exits 1. The two paths use different exit codes so CI can distinguish "drift" from "infrastructure broke".

**TDD order.**

1. **RED** — write `status.test.ts` with `describe.each` table-driven cases for: empty applied → all pending, fully applied → empty pending/divergence, DB row missing from filesystem → divergence, filesystem file missing from DB → pending, `--json` shape (Zod parse round-trip), and a pure-function symmetry property (applied ∪ pending ∪ divergence == applied ∪ local).
2. **GREEN** — implement `diffMigrations` first (pure, trivially passes), then the CLI wrapper. The wrapper is small (≤40 LoC); it is verified manually via the acceptance CLI steps below rather than with a Postgres fixture (avoids adding `pg-mem` to the dep tree for one script).
3. **REFACTOR** — extract the JSON printer, dedupe the human vs JSON output paths, sharpen the Zod error message, add a single-line `argv` parser helper (no `commander`/`yargs` — keep deps zero).

### 4.2 `pnpm db:migrate:status` script wiring

**Package script.** Add to `packages/db/package.json` `scripts`:

```json
"migrate:status": "tsx src/scripts/status.ts"
```

Naming uses `migrate:status` (not flat `status`) so that the root-level alias matches the runbook's verbatim reference (`docs/runbook.md:7` and the corrected procedure). Mirrors the convention of `db:migrate` already pointing to the package's `migrate` script.

**Root script.** Add to root `package.json` `scripts` (lines 20-24 already have `db:generate`, `db:migrate`, `db:studio`, `db:smoke`):

```json
"db:migrate:status": "pnpm --filter @athlos/db migrate:status"
```

**Runtime.** `tsx ^4.19.2` is already a `devDependency` of `@athlos/db` and used by `smoke`. No new deps.

### 4.3 `drift-check` job in `.github/workflows/test.yml`

**Job shape.** New job `drift-check` appended to `.github/workflows/test.yml`, with `needs: test` so it only runs after the existing `test` job (vitest + typecheck) passes. Justification for `needs: test` instead of parallel: a red `drift-check` on a red `test` would mask a failing test suite behind a drift signal; running it after `test` guarantees drift-check evidence stands alone.

**Steps.**

```yaml
drift-check:
  runs-on: ubuntu-latest
  needs: test
  services:
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_USER: athlos
        POSTGRES_PASSWORD: athlos
        POSTGRES_DB: athlos
      ports:
        - '5432:5432'
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DATABASE_URL: postgresql://athlos:athlos@localhost:5432/athlos
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Wait for Postgres
      run: |
        for i in {1..30}; do
          pg_isready -h localhost -p 5432 -U athlos && break
          sleep 1
        done
    - name: drizzle-kit check (drift gate)
      run: pnpm --filter @athlos/db exec drizzle-kit check
```

**Posture.** The step exits non-zero on drift → GitHub Actions fails the job → required status check fails → merge blocked. This satisfies `database-migrations/spec.md:133`.

**Service duplication.** The `postgres` service block is duplicated from `test` because GitHub Actions does not share service containers across jobs — each job runs on a fresh runner. This is the canonical pattern; the alternative (composite action or workflow call) is overkill for a single drift gate.

**drizzle-kit version pinning.** `pnpm --filter @athlos/db exec drizzle-kit check` resolves the binary from the workspace's `node_modules/.bin` (currently `drizzle-kit ^0.30.0`). This guarantees CI uses the same version as local dev; a global install would risk drift between local and CI reports.

### 4.4 Runbook reconciliation (`docs/runbook.md`)

**Drop.** Lines 59-67: the `If a migration fails to apply:` lead-in + the bash code block referencing `pnpm db:migrate:rollback` (with and without `--to 0009_domain_freshness`).

**Replace.** A forward-only narrative:

```markdown
If a migration fails to apply:

Migrations are **forward-only** by spec (`openspec/specs/database-migrations/spec.md:56`).
There is no rollback command — `pnpm db:migrate:rollback` does not exist and must
not be used. To revert a bad migration:

1. Author a new forward migration that undoes the bad change's effect (column drop,
   constraint reversal, etc.).
2. Commit it via the normal PR flow (`pnpm db:generate` to scaffold).
3. Re-deploy.
```

**Keep as-is.** Lines 69-73 ("If a deployed version causes issues" — re-deploy previous image/tag) are already correct and reference no rollback command.

**Deprecation note.** Above the corrected block, add an HTML comment for snippet-history readers:

```markdown
<!-- DEPRECATED 2026-06-18: the rollback procedure that lived here was removed.
Migrations are forward-only by spec. If your runbook snippet still says
`pnpm db:migrate:rollback --to 0009_domain_freshness`, ignore it and follow
the procedure below. -->
```

**Verification.** `grep -c "db:migrate:rollback" docs/runbook.md` returns 0 after the change.

---

## File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------|-------|
| `packages/db/src/scripts/status.ts` | create | ~100 | `diffMigrations` (pure, ~15 LoC) + CLI wrapper (~50 LoC) + Zod schema co-located (~15 LoC) + argv parser (~10 LoC) + table printer (~10 LoC) |
| `packages/db/src/scripts/status.test.ts` | create | ~120 | vitest cases via `describe.each`: empty applied, fully applied, divergence, pending, JSON shape, symmetry property; ~6 cases × ~15 LoC each |
| `packages/db/package.json` | modify | +1 line | add `migrate:status` script |
| `package.json` (root) | modify | +1 line | add `db:migrate:status` script mirroring `db:*` namespace |
| `.github/workflows/test.yml` | modify | +30 lines | new `drift-check` job (service block + steps) |
| `docs/runbook.md` | modify | +18 / -10 = net +8 | replace rollback block with forward-only narrative + deprecation comment |

**Total estimated delta:** ~280 lines (matches the proposal's 250-280 forecast).

---

## Implementation Order

Recommended sequence for `sdd-apply`:

1. `packages/db/src/scripts/status.test.ts` — RED. All test cases written, all failing.
2. `packages/db/src/scripts/status.ts` — GREEN. `diffMigrations` first (tests pass), then CLI wrapper (verified by acceptance CLI steps).
3. **REFACTOR** `status.ts` — extract `argv` parser, dedupe human/JSON output, polish Zod error messages. Test suite stays green throughout.
4. `packages/db/package.json` — add `migrate:status` script.
5. `package.json` (root) — add `db:migrate:status` script.
6. `.github/workflows/test.yml` — add `drift-check` job (validate YAML with `actionlint` or `yamllint` if available locally).
7. `docs/runbook.md` — replace rollback block with forward-only narrative + deprecation comment.
8. **Pre-closing verification** (manual, all run in `apply-progress`):
   - `cd packages/db && pnpm migrate:status` — human output, exit 0.
   - `pnpm migrate:status --json | jq .` — valid JSON, Zod shape.
   - `echo "-- stub" > packages/db/drizzle/9999_stub.sql && pnpm migrate:status` — exit 1, stub listed in pending; `rm` the stub after.
   - `pnpm test:run` — 439 + N passing (N = new `status.test.ts` cases, ~6).
   - `pnpm typecheck` — 0 errors.
   - `grep -c "db:migrate:rollback" docs/runbook.md` — `0`.
   - `grep -A 2 "to roll back" docs/runbook.md` (or whatever the new narrative is) — matches.
   - Validate `.github/workflows/test.yml` with `actionlint` if installed; otherwise `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`.
9. **Closing commit** (SEPARATE commit on merge, NOT during the PR per project convention):
   - `package.json` (root): `version: 0.4.0 → 0.4.1`.
   - `packages/db/package.json`: `version: 0.4.0 → 0.4.1`.
   - `CHANGELOG.md`: prepend `[0.4.1]` entry.
   - Commit message: `chore(release): v0.4.1 — db status + drift gate + runbook forward-only fix`.

**2-commit structure.** TDD commit (`TASK-001..009`, conventional `feat(db):` / `chore(db):` / `docs(runbook):`) + release commit (`chore(release): v0.4.1`). Same shape as the docs-refresh cycle.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **TDD discipline drift** — apply sub-agent skips RED and writes `status.ts` first | Med | Orchestrator verifies `apply-progress` shows RED → GREEN → REFACTOR; if RED phase missing, the change is incomplete. The test file is the gate. |
| **drizzle-kit version drift in CI** — global install gives different behavior than workspace | Low | `pnpm --filter @athlos/db exec drizzle-kit check` resolves from `node_modules/.bin`; `pnpm install --frozen-lockfile` pins the lockfile. |
| **drift-check runs even when test is red** — masks test failures behind drift | Low | `needs: test` ensures drift-check runs only after `test` passes. |
| **Runbook fix breaks saved snippets** — operator pastes the old command during an incident | Low | Deprecation HTML comment at the top of the rollback section redirects to the corrected procedure. |
| **Zod schema test/prod drift** — schema lives in a separate file and tests use a stale copy | Low | Schema is co-located in `status.ts` and re-exported; `status.test.ts` imports the same module. |
| **Closing commit slippage** — version bump lands in a code commit instead of a release commit | Med | The 2-commit structure is explicit in the implementation order; orchestrator checks `git log --oneline` at PR close to confirm the release commit exists separately. |
| **Postgres service container timeout in drift-check** — different runner timing than the test job | Low | Same `health-cmd pg_isready` options as `test` job; identical `Wait for Postgres` step. |

---

## Acceptance / Verification

Run after `sdd-apply` completes:

```bash
# 1. Human-readable output
cd /run/media/vlongo/Archivos/Projectos/Athlos
pnpm db:migrate:status
# Expect: table of applied migrations, exit 0

# 2. JSON output (Zod-validated shape)
pnpm db:migrate:status --json | jq .
# Expect: { applied: [...], pending: [...], divergence: [...], exitCode: 0 }

# 3. Drift detection — pending
echo "-- stub" > packages/db/drizzle/9999_stub.sql
pnpm db:migrate:status; echo "exit=$?"
# Expect: 9999_stub in pending, exit 1
rm packages/db/drizzle/9999_stub.sql

# 4. Drift detection — divergence (after applying locally)
rm packages/db/drizzle/0001_funny_eternals.sql  # only after a local `pnpm db:migrate`
pnpm db:migrate:status; echo "exit=$?"
# Expect: 0001_funny_eternals in divergence, exit 1
git checkout -- packages/db/drizzle/0001_funny_eternals.sql

# 5. No test regression
pnpm test:run
# Expect: 439 + N passing (N ≈ 6 new status.test.ts cases)

# 6. Typecheck clean
pnpm typecheck
# Expect: 0 errors

# 7. Runbook reconciled
grep -c "db:migrate:rollback" docs/runbook.md
# Expect: 0
grep -A 2 "Migrations are" docs/runbook.md
# Expect: matches the new forward-only narrative

# 8. Closing commit version bump (verify after PR merge)
git show HEAD~1 -- package.json packages/db/package.json | grep '"version"' | head -2
# Expect: 0.4.0
git show HEAD -- package.json packages/db/package.json | grep '"version"' | head -2
# Expect: 0.4.1

# 9. CI drift-check job — open PR, verify green on main, red on a branch where you:
#    a) delete packages/db/drizzle/0000_quick_wraith.sql (commit the deletion),
#    b) open a PR — expect drift-check to fail and the PR to be blocked.
```

---

## Review Workload Forecast

- **Estimated changed lines:** ~280 (≈100 `status.ts` + ≈120 `status.test.ts` + +2 `package.json` (root + db) + ≈30 YAML + ≈8 docs/runbook.md net + lockfile churn).
- **400-line budget risk:** **LOW** — ~70% of budget used; well under.
- **Chained PRs recommended:** **No** — Slice A is already the smallest autonomous unit of the 4-slice deploy series; no further sub-slicing is needed within it.
- **Suggested split:** N/A.
- **2-commit structure:** TDD commit (`feat(db): migrate:status script + CI drift gate` covering TASK-001..009) + release commit (`chore(release): v0.4.1`, TASK-010).
- **Work-unit count:** 10 (1 per task; tasks to be enumerated by `sdd-tasks`).

---

## Strict TDD Verification Checklist

For `sdd-apply` to be considered complete:

- [ ] `status.test.ts` written and committed BEFORE `status.ts` (apply-progress shows a commit where only `status.test.ts` is added and all tests fail).
- [ ] All `status.test.ts` cases FAIL before implementation (RED phase verifiable by `git stash` of `status.ts` and re-running tests).
- [ ] Implementation passes all tests (GREEN phase — `pnpm test:run` shows the new cases passing).
- [ ] Code reviewed for naming, dedup, clarity (REFACTOR phase — at least one follow-up commit that improves the code without changing behavior).
- [ ] Final test count: 439 + N (where N = number of new `status.test.ts` cases, expected ~6) — `pnpm test:run` summary shows no regression.
- [ ] No AI co-author in any commit; Conventional Commits format throughout.
- [ ] PR title: `chore(db): migrate status script + CI drift gate + runbook forward-only fix`.
- [ ] `apply-progress.md` ends with a GREEN→REFACTOR verification block citing the passing test run.

---

## Open Questions

None. The four locked user decisions (slice A standalone, patch bump, block posture, Zod-validated `--json`) plus the strict-TDD mandate cover every ambiguous point in the proposal.
