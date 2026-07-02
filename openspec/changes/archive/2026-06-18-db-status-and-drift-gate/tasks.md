# Tasks: db-status-and-drift-gate

## Header

| Field | Value |
|-------|-------|
| Change | `db-status-and-drift-gate` |
| Date | 2026-06-18 |
| Phase | TASK BREAKDOWN |
| Mode | hybrid (Engram + OpenSpec) |
| Status | written |
| Strict TDD | **ENABLED** — apply sub-agent must show RED → GREEN → REFACTOR in `apply-progress` |
| Work-unit format | enabled (10 tasks = 10 commits) |
| 2-commit structure | TDD commit (TASK-001..009) + `chore(release): v0.4.1` (TASK-010) |

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280 (100 status.ts + 120 tests + 30 YAML + 10 docs + 20 misc) |
| 400-line budget risk | **LOW** |
| Chained PRs recommended | **No** |
| Suggested split | N/A — single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

---

## Task Summary

| ID | Title | Type | Depends on | Est. lines | Commit type |
|----|-------|------|-----------|-----------|-------------|
| TASK-001 | Write status.test.ts (RED phase) | TDD-RED | none | ~120 | test(db) |
| TASK-002 | Write status.schema.ts (Zod) | TDD-SUPPORT | TASK-001 | ~20 | feat(db) |
| TASK-003 | Implement status.ts (GREEN phase) | TDD-GREEN | TASK-001, TASK-002 | ~100 | feat(db) |
| TASK-004 | REFACTOR status.ts | TDD-REFACTOR | TASK-003 | varies | refactor(db) |
| TASK-005 | Wire `migrate:status` script in @athlos/db | config | TASK-003 | +1 line | chore(db) |
| TASK-006 | Mirror `db:migrate:status` in root package.json | config | TASK-005 | 0 or +1 | chore(root) |
| TASK-007 | Add `drift-check` job to .github/workflows/test.yml | ci | TASK-005 | ~30 YAML | ci |
| TASK-008 | Reconcile `docs/runbook.md` (drop rollback block + forward-only narrative) | docs | none (independent) | ~10-15 net | docs(runbook) |
| TASK-009 | Pre-closing verification (run all design §8 commands) | verify | TASK-001..008 | 0 | chore(verify) |
| TASK-010 | Closing commit: v0.4.0 → v0.4.1 + CHANGELOG [0.4.1] | release | TASK-009 | ~10 | chore(release) |

---

## Tasks (detailed)

### TASK-001: Write status.test.ts (RED phase)

**Type:** TDD-RED
**Capability:** database-migrations
**Depends on:** none
**Estimated lines:** ~120
**Work unit:** 1 commit

**Description:**
Write the full test suite for `status.ts` BEFORE the implementation exists. All test cases must FAIL at this stage. Cover: empty applied list, partial applied list, full applied list, drift (DB row missing from filesystem), pending (filesystem entry not in DB), `--json` Zod shape validation, and connection error → exit 2. Tests use the public API only (no implementation details).

**Files:**
- `packages/db/src/commands/status.test.ts` — create; contains all RED test cases

**Acceptance criteria:**
- [ ] `packages/db/src/commands/status.test.ts` exists and is committed before `status.ts`
- [ ] `pnpm --filter @athlos/db test -- src/commands/status.test.ts` shows ALL cases FAILING (RED)
- [ ] Test cases cover: empty applied, partial applied, full applied, drift, pending, --json shape, connection error → exit 2
- [ ] No implementation details leaked into test file (tests use public API only)

**Commit message:**
```
test(db): add status.test.ts with RED-phase test cases

Add failing test suite for migrate:status covering:
- Applied list: empty, partial, full
- Drift: DB row missing from filesystem
- Pending: filesystem entry not in DB
- --json: Zod shape validation
- Connection error → exit 2
```

---

### TASK-002: Write status.schema.ts (Zod)

**Type:** TDD-SUPPORT
**Capability:** database-migrations
**Depends on:** TASK-001
**Estimated lines:** ~20
**Work unit:** 1 commit

**Description:**
Create the Zod schema that validates the `--json` output shape for `status.ts`. This schema drives the `--json` shape-validation test case in TASK-001. Must be committed after the test file but before the GREEN implementation.

**Files:**
- `packages/db/src/commands/status.schema.ts` — create; Zod schema for --json output

**Acceptance criteria:**
- [ ] `packages/db/src/commands/status.schema.ts` exports a Zod schema
- [ ] Schema validates the strict shape: `{ applied: string[], pending: string[], divergent: string[], error: string | null }`
- [ ] `pnpm --filter @athlos/db test -- src/commands/status.test.ts` still shows all tests FAILING (TASK-002 does not fix any tests)

**Commit message:**
```
feat(db): add status.schema.ts with Zod schema for --json output

Define strict Zod schema validating migrate:status --json output shape.
Schema is written to support RED test assertions in status.test.ts.
```

---

### TASK-003: Implement status.ts (GREEN phase)

**Type:** TDD-GREEN
**Capability:** database-migrations
**Depends on:** TASK-001, TASK-002
**Estimated lines:** ~100
**Work unit:** 1 commit

**Description:**
Implement `status.ts` to pass all RED test cases from TASK-001. The implementation reads the `pg_migration` table, compares against `drizzle/` filesystem entries, and reports applied, pending, and divergent migrations. Supports `--json` flag with Zod-validated output. Exits 0 on clean, 1 on drift/pending, 2 on connection error.

**Files:**
- `packages/db/src/commands/status.ts` — create; full implementation

**Acceptance criteria:**
- [ ] `packages/db/src/commands/status.ts` is committed AFTER status.test.ts
- [ ] `pnpm --filter @athlos/db test -- src/commands/status.test.ts` shows all cases PASSING (GREEN)
- [ ] `pnpm status` → human-readable output, exit 0 when clean
- [ ] `pnpm status --json | jq .` → valid JSON matching Zod schema
- [ ] Touch a fake migration: `echo "-- stub" > packages/db/drizzle/9999_stub.sql`, then `pnpm status` → reports `9999_stub` in pending, exit 1

**Commit message:**
```
feat(db): implement migrate:status command with drift detection

Reads pg_migration table, compares against drizzle/ filesystem entries,
reports applied/pending/divergent migrations. Supports --json with
Zod-validated output. Exits 0 (clean), 1 (drift/pending), 2 (error).
```

---

### TASK-004: REFACTOR status.ts

**Type:** TDD-REFACTOR
**Capability:** database-migrations
**Depends on:** TASK-003
**Estimated lines:** varies
**Work unit:** 1 commit

**Description:**
After GREEN phase, refactor `status.ts` to extract duplication, improve naming, and clean up structure without changing behavior. All tests must still pass after refactor. `git diff` of this commit shows ONLY refactor changes (no behavior change).

**Files:**
- `packages/db/src/commands/status.ts` — modify; refactor only

**Acceptance criteria:**
- [ ] All tests still pass after refactor: `pnpm --filter @athlos/db test -- src/commands/status.test.ts` → GREEN
- [ ] `git diff` of this commit shows ONLY refactor changes (no behavior change)
- [ ] Code duplication extracted, naming improved, structure clean

**Commit message:**
```
refactor(db): refactor status.ts for clarity and deduplication

Extract duplication, improve naming and structure. No behavior change —
all tests pass after refactor.
```

---

### TASK-005: Wire `migrate:status` script in @athlos/db

**Type:** config
**Capability:** database-migrations
**Depends on:** TASK-003
**Estimated lines:** +1 line
**Work unit:** 1 commit

**Description:**
Add `"migrate:status": "tsx src/commands/status.ts"` to `packages/db/package.json` scripts section. Wires the status command so it can be run via `pnpm migrate:status` inside the db package.

**Files:**
- `packages/db/package.json` — modify; add `migrate:status` script

**Acceptance criteria:**
- [ ] `packages/db/package.json` has `"migrate:status": "tsx src/commands/status.ts"` in scripts
- [ ] `cd packages/db && pnpm migrate:status` → runs the status command

**Commit message:**
```
chore(db): add migrate:status script to @athlos/db package.json

Wire tsx-based migrate:status command for local development.
```

---

### TASK-006: Mirror `db:migrate:status` in root package.json

**Type:** config
**Capability:** database-migrations
**Depends on:** TASK-005
**Estimated lines:** 0 or +1 line
**Work unit:** 1 commit

**Description:**
Mirror the `migrate:status` script in the root `package.json` as `"db:migrate:status": "pnpm --filter @athlos/db migrate:status"`. If the root package already has a `db:migrate:*` pattern for other migration scripts, follow it exactly.

**Files:**
- `package.json` (root) — modify; add `db:migrate:status` script

**Acceptance criteria:**
- [ ] Root `package.json` has `"db:migrate:status": "pnpm --filter @athlos/db migrate:status"` (or equivalent)
- [ ] `pnpm db:migrate:status` → runs the status command from root

**Commit message:**
```
chore(root): add db:migrate:status script to root package.json

Mirror migrate:status from @athlos/db into root scripts for
convenient access from workspace root.
```

---

### TASK-007: Add `drift-check` job to .github/workflows/test.yml

**Type:** ci
**Capability:** database-migrations
**Depends on:** TASK-005
**Estimated lines:** ~30 YAML
**Work unit:** 1 commit

**Description:**
Add a `drift-check` job to `.github/workflows/test.yml`. The job runs `pnpm db:migrate:status` in a Postgres service container. The job must exit 0 on clean (no drift), exit 1 on drift/pending. This job runs on every PR and blocks merge on drift.

**Files:**
- `.github/workflows/test.yml` — modify; add `drift-check` job

**Acceptance criteria:**
- [ ] `drift-check` job runs `pnpm db:migrate:status` in `.github/workflows/test.yml`
- [ ] Job uses Postgres service container
- [ ] Job exits 0 on clean, exits 1 on drift/pending
- [ ] Job runs on PR events (not blocking normal CI)

**Commit message:**
```
ci: add drift-check job to test.yml workflow

Add Postgres-backed drift-check job that runs migrate:status
and blocks PR merge on drift or pending migrations.
```

---

### TASK-008: Reconcile docs/runbook.md (drop rollback block + forward-only narrative)

**Type:** docs
**Capability:** database-migrations
**Depends on:** none (independent)
**Estimated lines:** ~10-15 net
**Work unit:** 1 commit

**Description:**
Update `docs/runbook.md` to remove the `db:migrate:rollback` block and replace with a forward-only migration narrative. Add a deprecation note if a rollback section existed. The new narrative should explain how to recover from drift: apply missing migrations forward, never roll back.

**Files:**
- `docs/runbook.md` — modify; reconcile rollback section

**Acceptance criteria:**
- [ ] `grep -c "db:migrate:rollback" docs/runbook.md` → 0
- [ ] `grep -A 2 "to roll back" docs/runbook.md` → matches the new forward-only narrative
- [ ] No `db:migrate:rollback` script reference remains

**Commit message:**
```
docs(runbook): reconcile runbook.md with forward-only migration narrative

Remove db:migrate:rollback block and replace with forward-only recovery
narrative. Add deprecation note if rollback section existed.
```

---

### TASK-009: Pre-closing verification (run all design §8 commands)

**Type:** verify
**Capability:** database-migrations
**Depends on:** TASK-001..008
**Estimated lines:** 0
**Work unit:** 1 commit

**Description:**
Run all verification commands from design section 8 to confirm the implementation is complete and correct. No files modified — this is a pure verification task. Create a verification checklist comment in the commit if helpful.

**Files:**
- None (verification only)

**Acceptance criteria:**
- [ ] `cd packages/db && pnpm status` → human-readable output, exit 0
- [ ] `pnpm status --json | jq .` → valid JSON, Zod shape matches
- [ ] Touch a fake migration: `echo "-- stub" > packages/db/drizzle/9999_stub.sql`, then `pnpm status` → reports `9999_stub` in pending, exit 1; then remove it
- [ ] `pnpm test:run` → 439+/439+ (no regression)
- [ ] `grep -c "db:migrate:rollback" docs/runbook.md` → 0
- [ ] `grep -A 2 "to roll back" docs/runbook.md` → matches new forward-only narrative

**Commit message:**
```
chore(verify): run pre-closing verification for db-status-and-drift-gate

Execute all design §8 verification commands. Confirm:
- pnpm status exits 0 when clean
- --json produces valid Zod-shaped output
- Pending migration detected (fake stub) exits 1
- No rollback references in runbook.md
- All tests pass (439+/439+)
```

---

### TASK-010: Closing commit: v0.4.0 → v0.4.1 + CHANGELOG [0.4.1]

**Type:** release
**Capability:** database-migrations
**Depends on:** TASK-009
**Estimated lines:** ~10
**Work unit:** 1 commit (final closing commit)

**Description:**
Apply version bump `0.4.0 → 0.4.1` in `packages/db/package.json` and add `[0.4.1]` entry to `CHANGELOG.md`. This is the ONLY commit that touches version/CHANGELOG. NO other commits in the PR modify these files.

**Files:**
- `packages/db/package.json` — modify; bump version to `0.4.1`
- `CHANGELOG.md` — modify; add `[0.4.1]` entry with change description

**Acceptance criteria:**
- [ ] `git show HEAD~1 -- packages/db/package.json | grep '"version"' | head -1` → `0.4.0`
- [ ] `git show HEAD -- packages/db/package.json | grep '"version"' | head -1` → `0.4.1`
- [ ] `CHANGELOG.md` has a `[0.4.1]` entry with meaningful change description
- [ ] No other commits in the PR modify `package.json` or `CHANGELOG.md`

**Commit message:**
```
chore(release): v0.4.1

Version bump and CHANGELOG entry for db-status-and-drift-gate:
- migrate:status with drift detection
- drift-check CI job blocking merge on drift
- Forward-only recovery narrative in runbook
```

---

## Dependencies (visual)

```
TASK-001 → TASK-002 → TASK-003 → TASK-004
                                    ↓
                                  TASK-005 → TASK-006
                                                  ↓
                                                TASK-007
TASK-008 (independent, can run any time after TASK-001)
                ↓
              TASK-009 (after all docs+code tasks)
                ↓
              TASK-010 (release, after verify)
```

**Note:** TASK-008 is independent of the code chain (runbook fix is doc-only). The apply sub-agent can do TASK-008 at any point after TASK-001, but the recommended order is to do it AFTER the code (TASK-007) so the runbook fix is the last "user-visible" change before the closing commit.

---

## Strict TDD Verification Checklist (CRITICAL)

For TASK-001 (RED):
- [ ] `status.test.ts` is committed BEFORE `status.ts` exists
- [ ] `status.test.ts` has at least these cases: empty applied, partial applied, full applied, drift (DB row missing from filesystem), pending (filesystem entry not in DB), --json shape validation, connection error → exit 2
- [ ] Running `pnpm --filter @athlos/db test` against the test file shows ALL cases FAILING (RED)

For TASK-003 (GREEN):
- [ ] `status.ts` is committed AFTER `status.test.ts`
- [ ] Running `pnpm --filter @athlos/db test` shows all cases PASSING (GREEN)
- [ ] No implementation details leaked into the test file (tests use the public API only)

For TASK-004 (REFACTOR):
- [ ] Code dedup, naming improvements applied
- [ ] All tests still pass after refactor
- [ ] `git diff` of the refactor commit shows ONLY refactor changes (no behavior change)

---

## Review Workload Forecast (re-affirm)

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280 (100 status.ts + 120 tests + 30 YAML + 10 docs + 20 misc) |
| 400-line budget risk | **LOW** |
| Chained PRs recommended | **No** |
| Suggested split | N/A |
| 2-commit structure | TDD (TASK-001..009) + release (TASK-010) in single PR |
| Work-unit count | 10 (1 per task) |

---

## Out of Scope (re-affirm)

- Slices B / C / D (backup+restore+grants, Dockerfile+compose, CI deploy workflow) — separate future changes
- `db:migrate:rollback` script — NEVER add (contradicts spec)
- Auto-rollback on smoke failure
- Secrets manager migration
- Multi-region / blue-green
- `.env.example` updates with `RUN_MIGRATIONS` / `BACKUP_*` — Slice B
- Replacing `Dockerfile` / `docker-compose.yml` placeholders — Slice C
- `db-destructive` PR label + CI guard — Slice D

---

## Pre-Apply Checklist for Orchestrator

- [ ] Branch `feat/db-status-and-drift-gate` created from `origin/main`
- [ ] All 10 tasks in `tasks.md` present
- [ ] `sdd-apply` sub-agent receives this file + the proposal/spec/design paths
- [ ] Strict TDD enabled is forwarded in the apply prompt
- [ ] Closing commit verification: orchestrator runs `git show HEAD~1 -- package.json | grep version` vs `git show HEAD -- package.json | grep version` after apply
