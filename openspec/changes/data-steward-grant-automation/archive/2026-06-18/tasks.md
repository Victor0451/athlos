# Tasks: data-steward-grant-automation

- **Change:** `data-steward-grant-automation`
- **Date:** 2026-06-19
- **Phase:** tasks
- **Mode:** both (Engram + OpenSpec filesystem)
- **Status:** ready-for-apply
- **File path:** `openspec/changes/data-steward-grant-automation/tasks.md`
- **Slice:** B0 of deploy automation (B1 = backup/restore/S3, separate future change)
- **Delivery:** single PR, ~233 changed lines (well under 400-line review budget)
- **Target version bump:** `0.4.1 → 0.4.2` (patch, additive CLI only, bumped at PR close)
- **Strict TDD:** **ENABLED** — apply sub-agent must show RED → GREEN → REFACTOR in `apply-progress` for BOTH `OperatorsRepo.findByUsername()` AND `grant-data-steward.ts`
- **Work-unit format:** enabled (12 tasks = 12 commits)
- **2-commit structure:** TDD commit (TASK-001..011) + `chore(release): v0.4.2` (TASK-012)

---

## Section 1: Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~233 (80 script + 15 schema + 80 test + 20 repo + 30 repo test + 2 package.json + 5 docs + ~1 misc) |
| 400-line budget risk | **LOW** |
| Chained PRs recommended | **No** |
| Suggested split | N/A |
| Delivery strategy | single-pr |
| Chain strategy | N/A |
| 2-commit structure | TDD (TASK-001..011) + release (TASK-012) in single PR |
| Work-unit count | 12 (1 per task) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: N/A (single PR)
400-line budget risk: LOW

---

## Section 2: Task Summary

| ID | Title | Type | Depends on | Est. lines | Commit type |
|----|-------|------|-----------|-----------|-------------|
| TASK-001 | operators.test.ts RED (findByUsername) | TDD-RED | none | ~30 | test(db) |
| TASK-002 | operators.ts GREEN (findByUsername) | TDD-GREEN | TASK-001 | ~20 | feat(db) |
| TASK-003 | REFACTOR operators.ts | TDD-REFACTOR | TASK-002 | varies | refactor(db) |
| TASK-004 | grant-data-steward.test.ts RED (10 cases) | TDD-RED | TASK-002 | ~80 | test(db) |
| TASK-005 | grant-data-steward.schema.ts (Zod) | TDD-SUPPORT | TASK-004 | ~15 | feat(db) |
| TASK-006 | grant-data-steward.ts GREEN | TDD-GREEN | TASK-004, TASK-005 | ~80 | feat(db) |
| TASK-007 | REFACTOR grant-data-steward.ts | TDD-REFACTOR | TASK-006 | varies | refactor(db) |
| TASK-008 | packages/db/package.json: grant:data-steward script + operators export | config | TASK-006 | +2 | chore(db) |
| TASK-009 | Root package.json mirror ops:grant-data-steward | config | TASK-008 | +1 | chore(root) |
| TASK-010 | docs/runbook.md: replace SQL block + deprecation | docs | none (independent) | ~5 net | docs(runbook) |
| TASK-011 | Pre-closing verification + planning artifacts commit | verify | TASK-001..010 | 0 | chore(verify) |
| TASK-012 | Closing commit: v0.4.1 → v0.4.2 + CHANGELOG [0.4.2] | release | TASK-011 | ~10 | chore(release) |

---

## Section 3: Detailed Tasks

### TASK-001: Write RED tests for OperatorsRepo.findByUsername

**Type:** TDD-RED
**Capability:** auth-login
**Depends on:** none
**Estimated lines:** ~30
**Work unit:** 1 commit

**Description:**
Write `operators.test.ts` with cases for: (1) existing username returns the Operator row, (2) missing username returns `null`, (3) empty string returns `null`. All cases must FAIL at this stage — no `operators.ts` implementation exists yet. Mirror the mock-DB standin pattern from `permissions.test.ts:14-30`.

**Files:**
- `packages/db/src/repositories/operators.test.ts` — create; RED tests only

**Acceptance criteria:**
- [ ] File committed BEFORE `operators.ts` implementation
- [ ] `pnpm --filter @athlos/db test` against this file shows ALL cases FAILING (RED)
- [ ] At least 3 cases: existing username, missing username, empty string
- [ ] Mock `db` standin matches `permissions.test.ts:14-30` pattern

**Commit message:**
```
test(db): operators.findByUsername RED phase

Add failing test cases for OperatorsRepo.findByUsername:
- existing username returns Operator row
- missing username returns null
- empty string returns null

Mirror mock-Db standin from permissions.test.ts:14-30.
```

---

### TASK-002: Implement OperatorsRepo.findByUsername GREEN

**Type:** TDD-GREEN
**Capability:** auth-login
**Depends on:** TASK-001
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Implement `findByUsername(username: string): Promise<Operator | null>` in `operators.ts` using the factory pattern (same as `makePermissionsRepo`). Use Drizzle `select().from(operators).where(eq(operators.username, username)).limit(1)`. Returns `row ?? null`. This unlocks `grant-data-steward.ts` which calls this method.

**Files:**
- `packages/db/src/repositories/operators.ts` — create; GREEN implementation

**Acceptance criteria:**
- [ ] File committed AFTER `operators.test.ts`
- [ ] `pnpm --filter @athlos/db test` against `operators.test.ts` shows ALL cases PASSING (GREEN)
- [ ] `findByUsername` returns `Operator | null` (not throw)
- [ ] Uses `eq(operators.username, username).limit(1)` pattern

**Commit message:**
```
feat(db): add OperatorsRepo.findByUsername

New repo method in packages/db/src/repositories/operators.ts following
the makePermissionsRepo factory pattern. Returns Operator | null for
the given username using Drizzle eq() + limit(1).
```

---

### TASK-003: REFACTOR operators.ts

**Type:** TDD-REFACTOR
**Capability:** auth-login
**Depends on:** TASK-002
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Review `operators.ts` for import minimalism (only `eq` from drizzle-orm, `operators` from schema, `Db` from pool), no dead code, clear naming. All tests must still pass. No behavior change.

**Files:**
- `packages/db/src/repositories/operators.ts` — refactor (import cleanup, naming)

**Acceptance criteria:**
- [ ] All tests still pass after refactor
- [ ] `git diff` of this commit shows ONLY refactor changes (no behavior change)
- [ ] Imports are minimal: `eq`, `operators` schema, `Db` type only

**Commit message:**
```
refactor(db): operators.ts import cleanup and naming

Minimal imports (eq, operators schema, Db type only). No behavior change.
All tests pass.
```

---

### TASK-004: Write RED tests for grant-data-steward.ts (10 cases)

**Type:** TDD-RED
**Capability:** auth-login
**Depends on:** TASK-002 (so findByUsername is callable from the script)
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Write `grant-data-steward.test.ts` with 10 cases: 4 `bucketizeGrant` pure-fn cases + 6 CLI cases. Cases: (1) alreadyGranted bucket, (2) granted bucket, (3) null operator skipped, (4) key mismatch returns empty, (5) CLI --username existing operator (exit 0, granted), (6) CLI idempotency (second call alreadyGranted), (7) CLI unknown username (exit 1), (8) CLI multi-username (both granted), (9) CLI --from-env with valid UUIDs, (10) CLI --json Zod shape validation. All cases FAIL at this stage.

**Files:**
- `packages/db/src/scripts/grant-data-steward.test.ts` — create; RED tests only

**Acceptance criteria:**
- [ ] File committed BEFORE `grant-data-steward.ts` implementation
- [ ] `pnpm --filter @athlos/db test` against this file shows ALL 10 cases FAILING (RED)
- [ ] At least 10 distinct test cases (4 pure-fn + 6 CLI)
- [ ] Mock `db` satisfies `Db` interface for `findByUsername`, `hasPermission`, `grant`

**Commit message:**
```
test(db): grant-data-steward RED phase — 10 failing cases

Add failing test cases for grant-data-steward.ts:
- 4 bucketizeGrant pure-fn cases (alreadyGranted, granted, null, key mismatch)
- 6 CLI cases (happy, idempotent, unknown user, multi-username, --from-env, --json shape)

Mirror mock-Db + mock-emitAudit pattern from permissions.test.ts.
```

---

### TASK-005: Write grant-data-steward.schema.ts (Zod)

**Type:** TDD-SUPPORT
**Capability:** auth-login
**Depends on:** TASK-004
**Estimated lines:** ~15
**Work unit:** 1 commit

**Description:**
Create `grant-data-steward.schema.ts` co-located with the script. Exports `grantDataStewardOutputSchema` (Zod object with `granted: z.array(z.string().uuid())`, `alreadyGranted: z.array(z.string().uuid())`, `auditIds: z.array(z.string().uuid())`) and the inferred `GrantDataStewardOutput` type. Mirrors `status.schema.ts` pattern.

**Files:**
- `packages/db/src/scripts/grant-data-steward.schema.ts` — create

**Acceptance criteria:**
- [ ] Schema validates `{ granted: string[], alreadyGranted: string[], auditIds: string[] }` where all arrays contain UUID strings
- [ ] File is created and importable before `grant-data-steward.ts` GREEN
- [ ] Re-exported from `grant-data-steward.ts` as `grantDataStewardOutputSchema`

**Commit message:**
```
feat(db): add grant-data-steward Zod output schema

Co-located schema file for --json output validation:
{ granted: string[], alreadyGranted: string[], auditIds: string[] }
All UUIDs validated with z.string().uuid().
```

---

### TASK-006: Implement grant-data-steward.ts GREEN

**Type:** TDD-GREEN
**Capability:** auth-login
**Depends on:** TASK-004, TASK-005
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Implement `grant-data-steward.ts` in two passes: (1) `bucketizeGrant` pure function (trivially passes the 4 pure-fn test cases), (2) CLI wrapper with `parseArgv`, `createDb()`, `makeOperatorsRepo`, `makePermissionsRepo`, per-operator transaction (grant + emitAudit in `db.transaction()`), exit codes 0/1/2, human and JSON output. The `--from-env` path skips `findByUsername` and takes UUIDs directly. Pre-check `hasPermission()` before `grant()` for idempotency.

**Files:**
- `packages/db/src/scripts/grant-data-steward.ts` — create; GREEN implementation

**Acceptance criteria:**
- [ ] File committed AFTER `grant-data-steward.test.ts`
- [ ] All 10 test cases in `grant-data-steward.test.ts` PASS
- [ ] `bucketizeGrant` pure-fn cases pass trivially
- [ ] Per-grant transaction: grant + emitAudit in single `db.transaction` (no orphan audits)
- [ ] Exit codes: 0 (success), 1 (unknown username or bad UUID), 2 (connection error or bad args)
- [ ] `--from-env` rejects combination with `--username` (exit 2, clear error)
- [ ] `--json` outputs Zod-validated shape

**Commit message:**
```
feat(db): grant-data-steward CLI — idempotent data_steward grant with audit

Add packages/db/src/scripts/grant-data-steward.ts:
- bucketizeGrant(operator, hasPermission, key) pure fn
- CLI: --username (repeatable), --from-env, --json flags
- Pre-check hasPermission() before grant() for idempotency
- Per-grant db.transaction(grant + emitAudit)
- Exit codes: 0 (success), 1 (unknown/bad), 2 (connection/args)
```

---

### TASK-007: REFACTOR grant-data-steward.ts

**Type:** TDD-REFACTOR
**Capability:** auth-login
**Depends on:** TASK-006
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
Extract JSON printer, dedupe human vs JSON output paths, polish `parseArgv` error messages, sharpen Zod error messages. No behavior change; all 10 tests still pass.

**Files:**
- `packages/db/src/scripts/grant-data-steward.ts` — refactor (extraction, dedup, polish)

**Acceptance criteria:**
- [ ] All 10 tests still pass after refactor
- [ ] `git diff` of this commit shows ONLY refactor changes (no behavior change)
- [ ] JSON printer extracted to named helper or deduped output branch

**Commit message:**
```
refactor(db): grant-data-steward extract JSON printer and dedupe output

Extract dedicated JSON printer, dedupe human/JSON output branches,
polish parseArgv and Zod error messages. No behavior change.
```

---

### TASK-008: packages/db/package.json — add grant:data-steward script + operators export

**Type:** config
**Capability:** auth-login
**Depends on:** TASK-006
**Estimated lines:** +2
**Work unit:** 1 commit

**Description:**
Add `"grant:data-steward": "tsx src/scripts/grant-data-steward.ts"` to `packages/db/package.json` scripts. Also add `"./repositories/operators": "./src/repositories/operators.ts"` to the `exports` field so the repo is importable from `@athlos/db/repositories/operators`.

**Files:**
- `packages/db/package.json` — modify (scripts + exports)

**Acceptance criteria:**
- [ ] `"grant:data-steward": "tsx src/scripts/grant-data-steward.ts"` present in scripts
- [ ] `"./repositories/operators": "./src/repositories/operators.ts"` present in exports
- [ ] `pnpm --filter @athlos/db grant:data-steward --help` prints usage or no-args usage line

**Commit message:**
```
chore(db): add grant:data-steward script and operators export

packages/db/package.json:
- scripts: add "grant:data-steward": "tsx src/scripts/grant-data-steward.ts"
- exports: add "./repositories/operators" entry
```

---

### TASK-009: Root package.json — mirror ops:grant-data-steward

**Type:** config
**Capability:** auth-login
**Depends on:** TASK-008
**Estimated lines:** +1
**Work unit:** 1 commit

**Description:**
Add `"ops:grant-data-steward": "pnpm --filter @athlos/db grant:data-steward"` to root `package.json` scripts. Follows the `ops:*` namespace for deploy automation scripts (sibling of `ops:backup` and `ops:restore` coming in Slice B1).

**Files:**
- `package.json` (root) — modify (scripts only)

**Acceptance criteria:**
- [ ] `"ops:grant-data-steward": "pnpm --filter @athlos/db grant:data-steward"` present
- [ ] `pnpm ops:grant-data-steward --help` prints usage or no-args usage line

**Commit message:**
```
chore(root): add ops:grant-data-steward script

pnpm --filter @athlos/db grant:data-steward mirror in root package.json
under the ops:* namespace (deploy automation family).
```

---

### TASK-010: docs/runbook.md — replace SQL block + deprecation comment

**Type:** docs
**Capability:** cross-cutting
**Depends on:** none (independent — can be done at any point after TASK-002)
**Estimated lines:** ~5 net
**Work unit:** 1 commit

**Description:**
Remove the raw SQL block at `docs/runbook.md:26-43` (find operator + `INSERT INTO role_permissions`). Replace with a clean bash block pointing to `pnpm ops:grant-data-steward --username <u>`. Add an HTML deprecation comment above the new block for snippet-history readers (mirrors Slice A pattern). Net: ~18 lines removed, ~5 lines added + HTML comment.

**Files:**
- `docs/runbook.md` — modify (replace SQL block + add deprecation comment)

**Acceptance criteria:**
- [ ] `grep -c "INSERT INTO role_permissions" docs/runbook.md` returns 0
- [ ] `grep -A 3 "DEPRECATED 2026-06-19" docs/runbook.md` matches the new HTML comment
- [ ] New bash block uses `pnpm ops:grant-data-steward --username <username>` and `--from-env` variant
- [ ] DELETE revoke block (lines 38-43) is NOT modified (out of scope per proposal)

**Commit message:**
```
docs(runbook): replace manual SQL grant with pnpm ops:grant-data-steward

Drop the raw SQL block (INSERT INTO role_permissions) at runbook.md:26-43.
Replace with idempotent, audited CLI command. Add HTML deprecation comment
for snippet-history readers. Net ~13 lines removed.
```

---

### TASK-011: Pre-closing verification + planning artifacts commit

**Type:** verify
**Capability:** cross-cutting
**Depends on:** TASK-001..010
**Estimated lines:** 0
**Work unit:** 1 commit

**Description:**
Run full acceptance verification suite. If any check fails, diagnose and fix before committing this task. Commit all remaining planning artifacts (apply-progress.md should be complete at this point, `openspec/changes/data-steward-grant-automation/` canonical files should be in sync).

**Files:**
- `apply-progress.md` (if not already committed)
- Any remaining planning artifacts

**Acceptance criteria:**
- [ ] `cd packages/db && pnpm grant:data-steward --help` prints usage (exit 2)
- [ ] `pnpm ops:grant-data-steward --username <existing-operator> --json | jq .` → valid JSON, Zod shape, `granted: [id]`
- [ ] Re-run same command → `granted: []`, `alreadyGranted: [id]`, no new audit row
- [ ] `pnpm ops:grant-data-steward --username <nonexistent>` → exit 1, error mentions username
- [ ] `DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env` → exit 0
- [ ] `pnpm test:run` → 450+ + N passing (N ≈ 13: ~10 script + ~3 repo)
- [ ] `pnpm lint` → pass
- [ ] `pnpm typecheck` → pass
- [ ] `grep -c "INSERT INTO role_permissions" docs/runbook.md` → 0

**Commit message:**
```
chore(verify): pre-closing verification passed

Full acceptance suite run. All CLI flags functional. Test count: 450+N.
Lint, typecheck clean. Runbook reconciled.
```

---

### TASK-012: Closing commit — version bump 0.4.1 → 0.4.2 + CHANGELOG [0.4.2]

**Type:** release
**Capability:** cross-cutting
**Depends on:** TASK-011
**Estimated lines:** ~10
**Work unit:** 1 commit (SEPARATE from TDD commit)

**Description:**
Bump version in both `package.json` (root) and `packages/db/package.json` from `0.4.1` to `0.4.2`. Prepend `[0.4.2]` entry to `CHANGELOG.md` describing the new `grant-data-steward` CLI, `OperatorsRepo.findByUsername()`, and idempotent audit. This is a SEPARATE commit from the TDD work — not squashed. NO other changes in this commit.

**Files:**
- `package.json` (root) — modify (version only)
- `packages/db/package.json` — modify (version only)
- `CHANGELOG.md` — modify (prepend [0.4.2] entry)

**Acceptance criteria:**
- [ ] `git show HEAD~1 -- package.json packages/db/package.json | grep '"version"' | head -2` → `0.4.1`
- [ ] `git show HEAD -- package.json packages/db/package.json | grep '"version"' | head -2` → `0.4.2`
- [ ] `[0.4.2]` entry present in CHANGELOG.md
- [ ] This is a SEPARATE commit from the TDD commit (not squashed)
- [ ] NO AI co-author in commit message
- [ ] Conventional commit: `chore(release): v0.4.2`

**Commit message:**
```
chore(release): v0.4.2

Version bump 0.4.1 → 0.4.2. Add [0.4.2] entry to CHANGELOG.md:
- New: grant-data-steward CLI (idempotent + audited)
- New: OperatorsRepo.findByUsername()
- Fix: runbook SQL block removed (deprecated)
```

---

## Section 4: Dependencies

```
TASK-001 → TASK-002 → TASK-003
                          ↓
                        TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009
                                                                                        ↓
TASK-010 (independent) ────────────────────────────────────────────────────────────────→ TASK-011 → TASK-012
```

**Notes:**
- TASK-010 (runbook) is independent of the code chain. Apply sub-agent can do TASK-010 at any point after TASK-002 (when the CLI exists conceptually), but recommended order is after TASK-009 so the runbook fix is the last user-visible change before the closing commit.
- TASK-011 (verification) is the gate before the release commit.
- TASK-012 (release) is a SEPARATE commit — never squashed into the TDD commit.

---

## Section 5: Strict TDD Verification Checklist (CRITICAL)

For `sdd-apply` to be considered complete, ALL of the following must be verified:

### TASK-001 (operators RED):
- [ ] `operators.test.ts` committed BEFORE `operators.ts` `findByUsername` impl
- [ ] `operators.test.ts` has at least 3 cases: existing username returns Operator, missing username returns null, empty string returns null
- [ ] Mock-DB standin pattern matches `permissions.test.ts:14-30`
- [ ] `pnpm --filter @athlos/db test` against `operators.test.ts` shows ALL cases FAILING (RED)

### TASK-002 (operators GREEN):
- [ ] `operators.ts` committed AFTER `operators.test.ts`
- [ ] `pnpm --filter @athlos/db test` shows all cases PASSING (GREEN)
- [ ] No implementation details leaked into the test file

### TASK-003 (REFACTOR operators.ts):
- [ ] `git diff` of this commit shows ONLY refactor changes (no behavior change)
- [ ] All tests still pass after refactor
- [ ] Imports minimal: `eq`, `operators` schema, `Db` type only

### TASK-004 (grant-data-steward RED):
- [ ] `grant-data-steward.test.ts` committed BEFORE `grant-data-steward.ts`
- [ ] At least 10 cases: 4 pure-fn (bucketizeGrant) + 6 CLI
- [ ] All cases FAIL at this point

### TASK-005 (grant-data-steward.schema.ts):
- [ ] Schema file created before GREEN implementation
- [ ] Re-exported from `grant-data-steward.ts`

### TASK-006 (grant-data-steward GREEN):
- [ ] `grant-data-steward.ts` committed AFTER `grant-data-steward.test.ts`
- [ ] All 10 cases PASS
- [ ] Per-grant transaction: grant + emitAudit in single `db.transaction` (no orphan audits)
- [ ] Pre-check `hasPermission()` before `grant()` for idempotency

### TASK-007 (REFACTOR grant-data-steward.ts):
- [ ] Code dedup, JSON printer extraction applied
- [ ] All tests still pass after refactor
- [ ] `git diff` shows ONLY refactor changes (no behavior change)

---

## Section 6: Out of Scope (re-affirmed)

- **Slice B1** — `scripts/backup.sh`, `scripts/restore.sh`, `.env.example` additions, `BACKUP_BUCKET`/S3 wiring. Separate future change.
- **Granting arbitrary permission_keys** — script is hardcoded to `data_steward` for v1.
- **DB-query-based operator discovery** — `SELECT id FROM operators WHERE role='A'` rejected (privilege escalation footgun).
- **Bulk CSV import** — repeat `--username` flags (or `--from-env`) cover v1.
- **UI for grant management** — operations script only.
- **Auto-revoke** — no spec demand; out of scope.
- **Modifying `PermissionsRepo.grant()` signature** — returns `Promise<void>`, pre-check `hasPermission()` workaround used.
- **Dry-run mode** — out of scope for v1.
- **MinIO / AWS S3 / IAM roles / deploy host** — Slice B1 scope.

---

## Section 7: Pre-Apply Checklist for Orchestrator

- [ ] Branch `feat/data-steward-grant-automation` created from `origin/main`
- [ ] All 12 tasks in `tasks.md` present and consistent with design.md §6
- [ ] `sdd-apply` sub-agent receives this file + proposal/spec/design paths
- [ ] Strict TDD ENABLED flag forwarded in apply prompt
- [ ] Orchestrator will verify RED → GREEN → REFACTOR in `apply-progress` for BOTH chains
- [ ] Closing commit verification plan: orchestrator runs `git show HEAD~1 -- package.json | grep version` vs `git show HEAD -- package.json | grep version` after apply
- [ ] Lesson from Slice A: orchestrator MUST plan for apply gaps (planning artifacts, lockfile, MODIFIED canonical sync) and instruct apply to commit them; verify must catch them; archive must sync the canonical MODIFIED spec
