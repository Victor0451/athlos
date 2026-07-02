# Tasks: athlos-deploy-slice-b1a-backup-restore

**Change:** `athlos-deploy-slice-b1a-backup-restore`
**Date:** 2026-06-22
**Phase:** Tasks (SDD)
**Mode:** both (Engram + OpenSpec)
**Status:** Written
**Artifact:** `openspec/changes/athlos-deploy-slice-b1a-backup-restore/tasks.md`

---

## Strict TDD

**ENABLED** — the `sdd-apply` sub-agent MUST show RED → GREEN → REFACTOR in `apply-progress` for ALL 3 TDD chains (common, backup, restore). Each RED test file is committed BEFORE its implementation. The orchestrator verifies ordering in `apply-progress` per the Slice A/B0 lesson.

**2-commit structure:**
- Commit 1: TDD chain (`feat(backup): ...`) covering TASK-001 through TASK-013
- Commit 2: `chore(release): v0.4.3` covering TASK-014 only

**Work-unit format:** enabled — 14 tasks = 14 commits (1 work unit per task)

---

## 1. Task Summary

| ID | Title | Type | Depends on | Est. lines | Commit type |
|----|-------|------|-----------|-----------|-------------|
| TASK-001 | common.test.bats (RED) | TDD-RED | none | ~50 | test(backup) |
| TASK-002 | common.sh (GREEN) | TDD-GREEN | TASK-001 | ~40 | feat(backup) |
| TASK-003 | REFACTOR common.sh | TDD-REFACTOR | TASK-002 | varies | refactor(backup) |
| TASK-004 | backup.test.bats (RED) | TDD-RED | TASK-002 | ~80 | test(backup) |
| TASK-005 | backup.sh (GREEN) | TDD-GREEN | TASK-004 | ~80 | feat(backup) |
| TASK-006 | REFACTOR backup.sh | TDD-REFACTOR | TASK-005 | varies | refactor(backup) |
| TASK-007 | restore.test.bats (RED) | TDD-RED | TASK-005 | ~90 | test(backup) |
| TASK-008 | restore.sh (GREEN) | TDD-GREEN | TASK-007 | ~80 | feat(backup) |
| TASK-009 | REFACTOR restore.sh | TDD-REFACTOR | TASK-008 | varies | refactor(backup) |
| TASK-010 | .env.example add 2 vars | config | TASK-005 | +5 | chore(env) |
| TASK-011 | docs/runbook.md add backup + restore refs | docs | none | ~25 gross / ~10 net | docs(runbook) |
| TASK-012 | .github/workflows/test.yml add backup-bats job | ci | TASK-009 | ~45 YAML | ci(backup) |
| TASK-013 | Pre-closing verification + planning artifacts | verify | TASK-001..012 | 0 | chore(verify) |
| TASK-014 | Closing commit: v0.4.2 → v0.4.3 + CHANGELOG | release | TASK-013 | ~10 | chore(release) |

---

## 2. Tasks (detailed)

---

### TASK-001: Write RED common.test.bats

**Type:** TDD-RED
**Capability:** database-migrations
**Depends on:** none
**Estimated lines:** ~50
**Work unit:** 1 commit

**Description:**
Write the full failing test suite for `scripts/lib/common.sh` BEFORE the implementation exists. This is the RED phase of the first TDD chain. All cases must FAIL at this point. Tests cover: `require_env` exits non-zero on missing var, `require_cmd` exits non-zero on missing command, `cleanup_old_backups` deletes files older than N days and keeps recent ones, `get_timestamp` returns ISO-8601 format (`YYYY-MM-DD-HHMM`), `log` writes to stderr not stdout.

**Files:**
- `scripts/tests/test_helper.bash` — create; shared bats load helper for sourcing `lib/common.sh`
- `scripts/tests/common.test.bats` — create; RED test suite, committed BEFORE `common.sh`

**Acceptance criteria:**
- [ ] `scripts/tests/test_helper.bash` exists and exports a `load` helper that sources `lib/common.sh`
- [ ] `scripts/tests/common.test.bats` has ≥ 5 cases covering `require_env`, `require_cmd`, `cleanup_old_backups`, `get_timestamp`, `log`
- [ ] `bats scripts/tests/common.test.bats` shows ALL cases FAILING (RED) — `common.sh` does not exist yet
- [ ] Test file is committed to branch BEFORE `common.sh` is created

**Commit message:**
```
test(backup): add RED common.test.bats for lib/common.sh

Adds failing bats test suite for the shared bash helpers that will be
sourced by backup.sh and restore.sh. Covers: require_env missing var,
require_cmd missing command, cleanup_old_backups retention sweep,
get_timestamp ISO-8601 format, log writes to stderr.
```

---

### TASK-002: Implement common.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** database-migrations
**Depends on:** TASK-001
**Estimated lines:** ~40
**Work unit:** 1 commit

**Description:**
Implement `scripts/lib/common.sh` to make `common.test.bats` pass. The file sources cleanly under bats (exports `ATHLOS_COMMON_LOADED=1` when `BATS_TEST_DIRNAME` is set). Functions: `log LEVEL MSG...` (writes `[ISO-8601] [LEVEL] MSG` to stderr), `die MSG` (log ERROR + exit 1), `require_env VAR` (dies if unset/empty), `require_cmd CMD` (dies if `command -v` fails), `get_timestamp` (echoes UTC `YYYY-MM-DD-HHMM`), `cleanup_old_backups DIR DAYS` (`find` with `-mtime +DAYS` deletion, idempotent if dir absent).

**Files:**
- `scripts/lib/common.sh` — create; implement all 6 functions + `set -euo pipefail` + exit codes in header comment

**Acceptance criteria:**
- [ ] `scripts/lib/common.sh` is committed AFTER `common.test.bats`
- [ ] `bats scripts/tests/common.test.bats` shows all cases PASSING (GREEN)
- [ ] No implementation details leaked into the test file (tests use public API only)
- [ ] `shellcheck scripts/lib/common.sh` exits 0 with no errors

**Commit message:**
```
feat(backup): implement scripts/lib/common.sh

Adds shared bash helpers sourced by backup.sh and restore.sh:
- log(), die(), require_env(), require_cmd(), get_timestamp(),
  cleanup_old_backups()
- set -euo pipefail; exit codes documented in header
- exports ATHLOS_COMMON_LOADED=1 under bats for test assertions
```

---

### TASK-003: REFACTOR common.sh

**Type:** TDD-REFACTOR
**Capability:** database-migrations
**Depends on:** TASK-002
**Estimated lines:** varies (tightening only)
**Work unit:** 1 commit

**Description:**
Polish `scripts/lib/common.sh`: extract any duplicated validation, tighten error messages, ensure shellcheck SC2154 (referencing unset variables) is resolved, add inline comments clarifying non-obvious decisions (e.g., `[[ -d "$dir" ]] || return 0` for idempotency). No behavior change — all bats tests must remain GREEN.

**Files:**
- `scripts/lib/common.sh` — refactor; no behavior change

**Acceptance criteria:**
- [ ] All bats tests in `scripts/tests/common.test.bats` still PASS after refactor
- [ ] `shellcheck scripts/lib/common.sh` exits 0 with no errors
- [ ] `git diff` of this commit shows ONLY refactor changes (no functional delta)

**Commit message:**
```
refactor(backup): tighten common.sh after bats green

Improves error messages, resolves shellcheck warnings, adds inline
comments on idempotency decisions. No behavior change.
```

---

### TASK-004: Write RED backup.test.bats

**Type:** TDD-RED
**Capability:** database-migrations
**Depends on:** TASK-002 (common.sh must exist before its tests can source it)
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Write the full failing test suite for `scripts/backup.sh` BEFORE the implementation exists. RED phase for the second TDD chain. All cases FAIL. Tests cover: successful backup produces a valid `.sql.gz`; `DATABASE_URL` missing → exit non-zero; `BACKUP_DIR` missing → exit non-zero; `gunzip -t` integrity check passes on output; retention sweep deletes `touch -d "8 days ago"` files; retention sweep keeps recent files. Uses `BACKUP_DIR=/tmp/athlos-backup-test` (no root required).

**Files:**
- `scripts/tests/backup.test.bats` — create; RED test suite committed BEFORE `backup.sh`

**Acceptance criteria:**
- [ ] `scripts/tests/backup.test.bats` has ≥ 6 cases: end-to-end dump, gunzip -t, missing DATABASE_URL, missing BACKUP_DIR, retention delete old, retention keep recent
- [ ] `bats scripts/tests/backup.test.bats` shows ALL cases FAILING (RED)
- [ ] Test file is committed to branch BEFORE `backup.sh` is created

**Commit message:**
```
test(backup): add RED backup.test.bats for scripts/backup.sh

Adds failing bats test suite for the daily backup script. Covers:
successful pg_dump + gzip output, gunzip -t integrity check, missing
DATABASE_URL exits non-zero, missing BACKUP_DIR exits non-zero,
retention sweep deletes 8-day-old files, retention sweep keeps recent files.
```

---

### TASK-005: Implement backup.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** database-migrations
**Depends on:** TASK-004
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Implement `scripts/backup.sh` to make `backup.test.bats` pass. Pipeline: `DATABASE_URL` → `pg_dump --format=plain --no-owner --no-acl --lock-wait-timeout=30s` → gzip → `$BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz` → `gunzip -t` verify → `cleanup_old_backups`. On `pg_dump` failure: `rm -f "$dest"` + exit 3 (no partial files). Validates `BACKUP_DIR` exists + writable and `pg_dump`/`gzip`/`gunzip` in PATH.

**Files:**
- `scripts/backup.sh` — create; implements full backup pipeline

**Acceptance criteria:**
- [ ] `scripts/backup.sh` is committed AFTER `backup.test.bats`
- [ ] `bats scripts/tests/backup.test.bats` shows all cases PASSING (GREEN)
- [ ] `pg_dump` failure → `rm -f "$dest"` (partial cleanup) + exit 3
- [ ] `shellcheck scripts/backup.sh` exits 0 with no errors

**Commit message:**
```
feat(backup): implement scripts/backup.sh daily pg_dump + retention

Adds the daily backup script: validates DATABASE_URL, BACKUP_DIR,
pg_dump + gzip pipeline with --lock-wait-timeout=30s, gunzip -t
integrity check, inline retention sweep via cleanup_old_backups().
Partial pg_dump failure removes the corrupt output file before exit 3.
```

---

### TASK-006: REFACTOR backup.sh

**Type:** TDD-REFACTOR
**Capability:** database-migrations
**Depends on:** TASK-005
**Estimated lines:** varies (tightening only)
**Work unit:** 1 commit

**Description:**
Polish `scripts/backup.sh`: dedupe any repeated validation, tighten error messages, ensure `--lock-wait-timeout=30s` rationale is documented inline, resolve all shellcheck warnings (especially SC2015 for `|| exit`, SC2086 for unquoted vars). No behavior change — all bats tests must remain GREEN.

**Files:**
- `scripts/backup.sh` — refactor; no behavior change

**Acceptance criteria:**
- [ ] All bats tests in `scripts/tests/backup.test.bats` still PASS after refactor
- [ ] `shellcheck scripts/backup.sh` exits 0 with no errors
- [ ] `git diff` of this commit shows ONLY refactor changes

**Commit message:**
```
refactor(backup): tighten backup.sh after bats green

Documents --lock-wait-timeout rationale, resolves shellcheck warnings,
no behavior change.
```

---

### TASK-007: Write RED restore.test.bats

**Type:** TDD-RED
**Capability:** database-migrations
**Depends on:** TASK-005 (backup.sh must be done so common.sh has `cleanup_old_backups` for sourcing)
**Estimated lines:** ~90
**Work unit:** 1 commit

**Description:**
Write the full failing test suite for `scripts/restore.sh` BEFORE the implementation exists. RED phase for the third TDD chain. All cases FAIL. Tests cover: missing `--source` → exit 1; missing `--confirm` → exit 1; `--dry-run` → exit 0 without DB writes; active-conn check blocks by default → exit 2; `--force-allow-active` bypasses guard → exit 0; corrupt `.sql.gz` → `gunzip -t` exit 2; happy-path apply → exit 0. Banner content is verified to appear on stderr BEFORE any side effect.

**Files:**
- `scripts/tests/restore.test.bats` — create; RED test suite committed BEFORE `restore.sh`

**Acceptance criteria:**
- [ ] `scripts/tests/restore.test.bats` has ≥ 7 cases covering all argv flags, dry-run, active-conn guard, gunzip integrity, happy path
- [ ] `bats scripts/tests/restore.test.bats` shows ALL cases FAILING (RED)
- [ ] Banner (restore warning box) is verified to print to stderr BEFORE integrity check or DB writes
- [ ] Test file is committed to branch BEFORE `restore.sh` is created

**Commit message:**
```
test(backup): add RED restore.test.bats for scripts/restore.sh

Adds failing bats test suite for the assisted restore script. Covers:
missing --source exits 1, missing --confirm exits 1, --dry-run exits 0
without DB writes, active-conn guard blocks (exit 2), --force-allow-active
bypasses guard, corrupt .gz fails gunzip -t (exit 2), happy-path exits 0.
Banner verified to appear on stderr before any side effect.
```

---

### TASK-008: Implement restore.sh (GREEN)

**Type:** TDD-GREEN
**Capability:** database-migrations
**Depends on:** TASK-007
**Estimated lines:** ~80
**Work unit:** 1 commit

**Description:**
Implement `scripts/restore.sh` to make `restore.test.bats` pass. Safety gates (in order): (1) `--confirm` mandatory → exit 1; (2) `--source` must exist and end in `.sql.gz` → exit 1; (3) print banner to stderr BEFORE any other operation; (4) `gunzip -t "$SOURCE"` integrity check → exit 2 on corrupt; (5) active-conn query via `pg_stat_activity` → if count > 0 AND no `--force-allow-active`, exit 2; (6) `--dry-run` short-circuits after integrity check; (7) `gunzip -c "$SOURCE" | psql "$TARGET" --set ON_ERROR_STOP=on` → exit 3 on failure. Banner extracts target host via `sed -E 's|.*@([^:/]+).*|\1|'`.

**Files:**
- `scripts/restore.sh` — create; implements full restore with all safety gates

**Acceptance criteria:**
- [ ] `scripts/restore.sh` is committed AFTER `restore.test.bats`
- [ ] `bats scripts/tests/restore.test.bats` shows all cases PASSING (GREEN)
- [ ] Banner printed to stderr BEFORE integrity check, BEFORE conn check, BEFORE apply
- [ ] `shellcheck scripts/restore.sh` exits 0 with no errors

**Commit message:**
```
feat(backup): implement scripts/restore.sh with --confirm + safety gates

Adds the assisted restore script: --confirm mandatory, --source validation,
restore banner printed to stderr before any side effect, gunzip -t integrity
check, pg_stat_activity guard against active connections (bypassable via
--force-allow-active), --dry-run support, psql apply with ON_ERROR_STOP=on.
Exit codes: 0 success, 1 bad argv, 2 safety/refusal, 3 psql failure.
```

---

### TASK-009: REFACTOR restore.sh

**Type:** TDD-REFACTOR
**Capability:** database-migrations
**Depends on:** TASK-008
**Estimated lines:** varies (tightening only)
**Work unit:** 1 commit

**Description:**
Polish `scripts/restore.sh`: extract repeated argument-parsing into a helper, tighten error messages, resolve shellcheck warnings (especially SC2086 unquoted vars, SC2015 ternary logic). Document the banner rationale and the active-conn SQL query inline. No behavior change — all bats tests must remain GREEN.

**Files:**
- `scripts/restore.sh` — refactor; no behavior change

**Acceptance criteria:**
- [ ] All bats tests in `scripts/tests/restore.test.bats` still PASS after refactor
- [ ] `shellcheck scripts/restore.sh` exits 0 with no errors
- [ ] `git diff` of this commit shows ONLY refactor changes

**Commit message:**
```
refactor(backup): tighten restore.sh after bats green

Extracts arg-parsing helper, documents active-conn SQL query, resolves
shellcheck warnings. No behavior change.
```

---

### TASK-010: .env.example add BACKUP_DIR and BACKUP_RETENTION_DAYS

**Type:** config
**Capability:** deployment-devops
**Depends on:** TASK-005 (so the env vars are wired after backup.sh is proven)
**Estimated lines:** +5
**Work unit:** 1 commit

**Description:**
Append a new `─── Backup (PR Slice B1a) ───` section to `.env.example` after the `AUDIT_RETENTION_DAYS` line. Adds `BACKUP_DIR=/var/backups/athlos` and `BACKUP_RETENTION_DAYS=7` with descriptive inline comments.

**Files:**
- `.env.example` — modify; append backup section after `AUDIT_RETENTION_DAYS`

**Acceptance criteria:**
- [ ] `grep -c "BACKUP_DIR" .env.example` ≥ 1
- [ ] `grep -c "BACKUP_RETENTION_DAYS" .env.example` ≥ 1
- [ ] Section header `─── Backup (PR Slice B1a) ───` present
- [ ] `shellcheck .env.example` not run (env files are not shell scripts); visually verify format matches existing sections

**Commit message:**
```
chore(env): add BACKUP_DIR and BACKUP_RETENTION_DAYS to .env.example

Adds the two env vars required by scripts/backup.sh under a new
─── Backup (PR Slice B1a) ─── section. BACKUP_DIR defaults to
/var/backups/athlos; BACKUP_RETENTION_DAYS defaults to 7.
```

---

### TASK-011: docs/runbook.md add Backup & Restore section

**Type:** docs
**Capability:** deployment-devops
**Depends on:** none (independent — can run in parallel with code chain)
**Estimated lines:** ~25 gross / ~10 net
**Work unit:** 1 commit

**Description:**
Add a new `## Backup & Restore` heading to `docs/runbook.md` between `## Rollback Procedure` (line 60) and `## Common Issues` (line 82). Two subsections: **Daily backup** (cron at 03:00, `scripts/backup.sh`, env vars, verification commands `ls -lh` and `gunzip -t`); **Restore procedure** (three invocation examples: `--dry-run`, `--confirm`, `--confirm --force-allow-active`, plus exit code table 0/1/2/3).

**Files:**
- `docs/runbook.md` — modify; insert `## Backup & Restore` section

**Acceptance criteria:**
- [ ] `grep -c "backup.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "restore.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "s3://" docs/runbook.md` = 0 (no S3 references)
- [ ] New `## Backup & Restore` heading present between Rollback and Common Issues

**Commit message:**
```
docs(runbook): add Backup & Restore section

Adds ## Backup & Restore between ## Rollback Procedure and ## Common Issues.
Documents daily cron invocation of scripts/backup.sh, verification commands,
and three restore invocations with exit code table. No S3 references.
```

---

### TASK-012: .github/workflows/test.yml add backup-bats job

**Type:** ci
**Capability:** deployment-devops
**Depends on:** TASK-009 (after all scripts + tests are done)
**Estimated lines:** ~45 YAML
**Work unit:** 1 commit

**Description:**
Add a new `backup-bats` job to `.github/workflows/test.yml` after the `drift-check` job. Pattern mirrors `drift-check`: `ubuntu-latest`, `needs: drift-check`, Postgres service container with `pg_isready` health check. Installs `bats shellcheck postgresql-client` via `apt-get`. Runs `shellcheck scripts/*.sh scripts/lib/*.sh` (must be clean) and `bats scripts/tests/*.test.bats` (must all pass). Uses `BACKUP_DIR=/tmp/athlos-backup-test`.

**Files:**
- `.github/workflows/test.yml` — modify; add `backup-bats` job

**Acceptance criteria:**
- [ ] `backup-bats` job present in `.github/workflows/test.yml`
- [ ] Job installs `bats shellcheck postgresql-client` via `apt-get`
- [ ] Job runs `shellcheck scripts/*.sh scripts/lib/*.sh` and `bats scripts/tests/*.test.bats`
- [ ] Job depends on `drift-check` (not on `test`) to parallelize correctly

**Commit message:**
```
ci(backup): add backup-bats job to test.yml

Adds backup-bats CI job mirroring drift-check pattern: ubuntu-latest,
Postgres service container, installs bats + shellcheck + postgresql-client,
runs shellcheck and bats tests. Gates on drift-check to parallelize.
```

---

### TASK-013: Pre-closing verification + planning artifacts

**Type:** verify
**Capability:** cross-cutting
**Depends on:** TASK-001..012
**Estimated lines:** 0 (no production code)
**Work unit:** 1 commit

**Description:**
Run all acceptance commands from design §7 and verify all pass before committing the release (TASK-014). Verifies: bats all pass, shellcheck clean, `.env.example` has BACKUP_DIR, runbook has backup.sh reference, `grep -c "s3://" openspec/specs/database-migrations/spec.md` = 0, `git show HEAD~1:package.json | grep '"version"'` = `0.4.2` (pre-release). Commit is a no-op placeholder confirming all checks green; if any check fails, surface and fix before proceeding.

**Files:**
- (none — this is a verification-only commit; any artifacts produced by verification are commit artifacts)

**Acceptance criteria:**
- [ ] `bats scripts/tests/*.test.bats` all PASS
- [ ] `shellcheck scripts/*.sh scripts/lib/*.sh` exits 0
- [ ] `grep -c "BACKUP_DIR" .env.example` ≥ 1
- [ ] `grep -c "backup.sh" docs/runbook.md` ≥ 1
- [ ] `grep -c "s3://" openspec/specs/database-migrations/spec.md` = 0
- [ ] `git show HEAD~1:package.json | grep '"version"'` shows `0.4.2` (TASK-014 not yet applied)
- [ ] `pnpm test:run` passes (464 + N new bats tests, no regression)
- [ ] `pnpm lint && pnpm typecheck` pass

**Commit message:**
```
chore(verify): pre-closing verification — all checks green

Runs full acceptance suite from design §7: bats, shellcheck, env vars,
runbook, spec sync (no s3://), version pre-check (0.4.2). All pass.
```

---

### TASK-014: Closing commit: v0.4.2 → v0.4.3 + CHANGELOG

**Type:** release
**Capability:** cross-cutting
**Depends on:** TASK-013
**Estimated lines:** ~10
**Work unit:** 1 commit

**Description:**
Second and final commit of the PR: bump `package.json` version from `0.4.2` to `0.4.3` and add a `[0.4.3]` entry to `CHANGELOG.md` documenting the slice. This is a SEPARATE commit from the TDD commit (per Slice A precedent). `CHANGELOG.md` entry is in the `[Unreleased] → [0.4.3]` format. No other files changed.

**Files:**
- `package.json` — modify; `"version": "0.4.2"` → `"version": "0.4.3"`
- `CHANGELOG.md` — modify; add `[0.4.3]` entry with slice description

**Acceptance criteria:**
- [ ] `git show HEAD~1:package.json | grep '"version"'` = `0.4.2` (first commit = TDD commit)
- [ ] `git show HEAD:package.json | grep '"version"'` = `0.4.3` (second commit = release commit)
- [ ] CHANGELOG.md has a `[0.4.3]` entry describing the slice
- [ ] Only `package.json` and `CHANGELOG.md` changed in this commit
- [ ] `pnpm test:run` still passes after version bump

**Commit message:**
```
chore(release): v0.4.3

Bumps package.json: 0.4.2 → 0.4.3.
Adds [0.4.3] CHANGELOG entry for athlos-deploy-slice-b1a-backup-restore:
daily backup script (pg_dump + gzip + retention), assisted restore script
(--confirm + safety gates), shared lib/common.sh, bats test suites,
backup-bats CI job, spec deltas for database-migrations and deployment-devops.
```

---

## 3. Dependency Diagram

```
TASK-001 → TASK-002 → TASK-003
                          ↓
TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-009
                                                              ↓
TASK-010 (config) ──────────────────────────────────────→ TASK-013
TASK-011 (docs, independent) ────────────────────────────→ TASK-013
TASK-012 (CI, after TASK-009) ──────────────────────────→ TASK-013
                                                       ↓
                                                     TASK-014 (release)
```

**Note:** TASK-011 (runbook docs) is independent of the code chain and can be executed at any point. Recommended order is after TASK-009 so the runbook references the final scripts.

---

## 4. Strict TDD Verification Checklist (CRITICAL)

For TASK-001 (common RED):
- [ ] `scripts/tests/common.test.bats` is committed BEFORE `scripts/lib/common.sh`
- [ ] `scripts/tests/common.test.bats` has at least 5 cases: `require_env` exits non-zero on missing var, `require_cmd` exits non-zero on missing command, `cleanup_old_backups` deletes files older than N days, `get_timestamp` returns ISO-8601 format, `log` writes to stderr
- [ ] Running `bats scripts/tests/common.test.bats` shows ALL cases FAILING (RED)

For TASK-002 (common GREEN):
- [ ] `scripts/lib/common.sh` is committed AFTER `scripts/tests/common.test.bats`
- [ ] Running `bats scripts/tests/common.test.bats` shows all cases PASSING (GREEN)
- [ ] No implementation details leaked into the test file (tests use the public API only)

For TASK-004 (backup RED):
- [ ] `scripts/tests/backup.test.bats` is committed BEFORE `scripts/backup.sh`
- [ ] At least 6 cases: successful backup, file is gzipped + `gunzip -t` passes, missing `DATABASE_URL` → exit non-zero, missing `BACKUP_DIR` → exit non-zero, retention sweep deletes old files, retention sweep keeps recent files
- [ ] All cases FAIL at this point

For TASK-005 (backup GREEN):
- [ ] `scripts/backup.sh` is committed AFTER `scripts/tests/backup.test.bats`
- [ ] All cases PASS
- [ ] `pg_dump` failure → `rm -f` the partial file + exit 3 (no corrupt backups)

For TASK-007 (restore RED):
- [ ] `scripts/tests/restore.test.bats` is committed BEFORE `scripts/restore.sh`
- [ ] At least 7 cases: missing `--source` → exit 1, missing `--confirm` → exit 1, `--dry-run` → exit 0 without modifying DB, active-conn check blocks by default, `--force-allow-active` bypasses, `gunzip` integrity check fails on corrupt `.gz`, successful restore exits 0
- [ ] All cases FAIL at this point

For TASK-008 (restore GREEN):
- [ ] `scripts/restore.sh` is committed AFTER `scripts/tests/restore.test.bats`
- [ ] All cases PASS
- [ ] Banner to stderr BEFORE any side effect (verified with bats test that captures stderr)

For TASK-003 / TASK-006 / TASK-009 (REFACTOR):
- [ ] Code dedup, naming improvements applied
- [ ] All tests still pass after refactor
- [ ] `git diff` of the refactor commit shows ONLY refactor changes (no behavior change)

---

## 5. Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~440 (40 lib + 80 backup + 80 restore + ~50+80+90 bats + 5 .env + ~25 docs + ~45 YAML + spec deltas already written) |
| 400-line budget risk | **MED** (slightly over; B1b is a separate future change with its own PR review) |
| Chained PRs recommended | **No** (B1a IS the smallest autonomous unit; B1b is separate) |
| Suggested split | N/A |
| 2-commit structure | TDD commit (TASK-001..013) + `chore(release): v0.4.3` (TASK-014) in single PR |
| Work-unit count | 14 (1 commit per task) |

**Why MED:** ~440 LoC is 10% over the 400-line budget but ships autonomously. B1a delivers 80% of the value (daily backup + assisted restore) without B1b's LUKS/keyfile overhead. Reviewers hold a single coherent concern (`pg_dump` semantics + bash testing) without context switching.

---

## 6. Out of Scope (re-affirm)

- **Slice B1b entirely** (USB rotation, LUKS keyfile, `mount-usb.sh`, `unmount-usb.sh`, `backup-to-usb.sh`) — separate future change `athlos-deploy-slice-b1b-usb-rotation`
- **AWS S3 / cloud backups** — rejected by ADR #30
- **`BACKUP_BEFORE_MIGRATE` env var** — Slice D handles
- **Compose `backup` service** — cron runs on host per Server Infra §6.L
- **`pg_basebackup` / WAL archiving / PITR** — future slice
- **`restore-drill.sh`** — separate future change
- **systemd timers / Cockpit alerting** — defer to v2
- **Samba / Nextcloud / AD** — rejected per ADR #33
- **Storage volume tar** — defer to v2
- **`ci-check-backup-files-present.sh`** — deferred per user decision

---

## 7. Pre-apply Checklist for Orchestrator

- [ ] Branch `feat/athlos-deploy-slice-b1a-backup-restore` created from `origin/main`
- [ ] All 14 tasks in `tasks.md` present and in dependency order
- [ ] `sdd-apply` sub-agent receives: this file + proposal/spec/design paths + Strict TDD enabled flag
- [ ] Strict TDD RED-before-GREEN ordering is verified in `apply-progress` for all 3 chains
- [ ] TASK-011 (runbook) can be scheduled independently from code chain
- [ ] TASK-012 (CI job) scheduled after TASK-009 (restore REFACTOR)
- [ ] TASK-013 (verify) scheduled after all TASK-001..012 complete
- [ ] TASK-014 (release) is separate commit; orchestrator runs `git show HEAD~1:package.json | grep '"version"'` = `0.4.2` vs `git show HEAD:package.json | grep '"version"'` = `0.4.3` post-apply
- [ ] Spec deltas (already written by sdd-spec) are committed as part of the TDD commit
- [ ] Orchestrator plans for apply gaps (planning artifacts, lockfile, MODIFIED canonical sync) and instructs apply to commit them

---

## 8. Verification Commands (from design §7)

Apply sub-agent and orchestrator use these to verify each task:

```bash
cd /run/media/vlongo/Archivos/Projectos/Athlos

# === bats + shellcheck ===
bats scripts/tests/*.test.bats                              # all PASS
shellcheck scripts/*.sh scripts/lib/*.sh                    # clean (exit 0)

# === Functional smoke (TASK-005 verify) ===
DATABASE_URL=postgresql://athlos:athlos@localhost:5432/athlos \
BACKUP_DIR=/tmp/athlos-backup-test BACKUP_RETENTION_DAYS=7 \
  bash scripts/backup.sh                                    # exit 0
gunzip -t /tmp/athlos-backup-test/athlos-*.sql.gz          # exit 0

# === Restore smoke (TASK-008 verify) ===
bash scripts/restore.sh --source /tmp/athlos-backup-test/athlos-*.sql.gz  # exit 1 (no --confirm)
bash scripts/restore.sh --source /tmp/athlos-backup-test/athlos-*.sql.gz \
  --confirm --dry-run                                      # exit 0

# === File presence ===
grep -c "BACKUP_DIR" .env.example                          # ≥ 1
grep -c "backup.sh" docs/runbook.md                        # ≥ 1
grep -c "s3://" openspec/specs/database-migrations/spec.md # 0

# === No regression ===
pnpm test:run                                              # 464 + N new tests pass
pnpm lint && pnpm typecheck                                # pass

# === Closing commit check ===
git show HEAD~1:package.json | grep '"version"'            # "0.4.2"
git show HEAD:package.json | grep '"version"'              # "0.4.3"
```
