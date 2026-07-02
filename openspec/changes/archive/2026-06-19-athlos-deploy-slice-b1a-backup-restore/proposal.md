# Proposal: athlos-deploy-slice-b1a-backup-restore

**Date:** 2026-06-22
**Phase:** Propose (SDD)
**Mode:** hybrid (OpenSpec + Engram)
**Status:** Draft — awaiting user answers to Open Questions before sdd-spec
**Parent roadmap:** `openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md`
**Locked ADRs:** `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` (#29, #30, #32)

---

## Intent

Slice B1a delivers the **foundation** of the deploy automation roadmap's backup and restore story. After this change, operators have a `scripts/backup.sh` that runs daily via `/etc/cron.d/athlos-backup` and produces a `.sql.gz` of the production Postgres database, plus a `scripts/restore.sh` that requires an explicit `--confirm` flag before overwriting live data. Both scripts are pure bash, run on the HOST (not inside a compose container), and use only Ubuntu packages (`postgresql-client`, `bats`, `shellcheck`) — no AWS CLI, no S3, no cloud SDK.

This unblocks the B1b follow-up (USB rotation + LUKS keyfile) by establishing the `.env` contract (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) and the backup file naming convention (`athlos-<YYYY-MM-DD-HHMM>.sql.gz`) that B1b's `rsync` step will read. It also closes the spec drift introduced by the original S3-based Slice B plan: two existing capabilities (`database-migrations`, `deployment-devops`) get MODIFIED deltas replacing `s3://athlos-backups/...` references with `$BACKUP_DIR/pre-deploy-<sha>.sql.gz`.

The architectural payoff is making the backup surface **boring and recoverable**: an admin who has never seen the script can read its 80 lines, run `bash scripts/backup.sh` to verify, and read `--help` to know the restore semantics. The behavioral payoff is killing two long-standing liabilities — the "Manual SQL backup" line in the runbook that nobody follows, and the `s3://` literal in `database-migrations/spec.md:69` that contradicts ADR #30.

---

## Scope (In)

| Deliverable | Path | Approx LoC | Justification |
|---|---|---|---|
| Daily backup script | `scripts/backup.sh` | ~80 (new) | `pg_dump --format=plain --no-owner --no-acl --lock-wait-timeout=30s` → gzip → `$BACKUP_DIR/athlos-<ts>.sql.gz`; inline retention sweep |
| Assisted restore script | `scripts/restore.sh` | ~80 (new) | `--confirm` mandatory + active-conn check + banner + `gunzip -t` integrity + `psql -f` apply |
| Shared bash helpers | `scripts/lib/common.sh` | ~40 (new) | `log()`, `require_env()`, `require_cmd()`, `cleanup_old_backups()`; sourced by both scripts |
| Backup bats tests | `scripts/tests/backup.test.bats` | ~80 (new) | Strict TDD RED first: mocked DATABASE_URL, valid dump creation, retention sweep |
| Restore bats tests | `scripts/tests/restore.test.bats` | ~90 (new) | Strict TDD RED first: missing `--confirm` (exit 1), active conns (exit 2), banner content, `--dry-run` |
| Common bats tests | `scripts/tests/common.test.bats` | ~50 (new) | Strict TDD RED first: env validation, log prefix, retention helper |
| Env contract additions | `.env.example` | +2 lines | `BACKUP_DIR=/var/backups/athlos`, `BACKUP_RETENTION_DAYS=7` (new `─── Backup (PR Slice B1a) ───` block) |
| Runbook updates | `docs/runbook.md` | ~10 net | Replace "Manual SQL backup" with `backup.sh` + add "Restore procedure" subsection |
| Spec delta — DB migrations | `openspec/specs/database-migrations/spec.md` | MODIFIED (+1 scenario) | Pre-migration backup scenario: `s3://athlos-backups/pre-deploy-<sha>.sql.gz` → `$BACKUP_DIR/pre-deploy-<sha>.sql.gz` |
| Spec delta — deployment | `openspec/specs/deployment-devops/spec.md` | MODIFIED (minor) | Backup Strategy requirement: path-shape adjustment for any `s3://...` references |
| CI guard (optional) | `apps/api/scripts/ci-check-backup-files-present.sh` | ~20 (new) | Pattern-check that `scripts/backup.sh`, `restore.sh`, `lib/common.sh` exist and are executable (mirrors `ci-check-audit-fp.sh` pattern) |

**Total estimated LoC: ~440** (slightly above the 400-line review cap; see Review Workload Forecast).

---

## Scope (Out)

The following are **explicitly NOT in B1a**. They belong to B1b, future changes, or are rejected by ADRs.

| Deferred item | Reason | Future owner |
|---|---|---|
| **Slice B1b entirely** — `mount-usb.sh`, `unmount-usb.sh`, `backup-to-usb.sh`, LUKS keyfile, `USB_*` env vars | Separate future change (chained PR after B1a merges) | `athlos-deploy-slice-b1b-usb-rotation` |
| **AWS S3 / cloud backups** (`s3cmd`, `aws-cli`, B2, DO Spaces) | Rejected by ADR #30 — local + USB only | Never (per locked ADR) |
| **`BACKUP_BEFORE_MIGRATE` env var** | Slice C/D handle via entrypoint + `db-destructive` label gate | Slice D |
| **Compose `backup` service** | Cron runs on host per Server Infra §6.L; containerized cron adds ~80 LoC for no benefit | None (deferred forever) |
| **`pg_basebackup` / WAL archiving / PITR** | Much larger future slice; needs separate exploration | Future (post-Slice D) |
| **`restore-drill.sh`** (scheduled restore testing) | Explicitly out-of-scope per `5-Server-Infrastructure.md:589-591` | Separate future change |
| **systemd timers** | Defer to v2; `/etc/cron.d/` is simpler for v1 | Future v2 |
| **Cockpit alerting on backup failures** | Defer; manual `grep CRON /var/log/syslog` is enough for v1 | Future |
| **Samba / Nextcloud / AD** | Completely separate future changes | Rejected per ADR #33 |
| **Storage volume tar** (`file-storage/spec.md:525-529`) | Storage volume itself not implemented; defer to v2 | Future v2 |
| **Logrotate snippet for `/var/log/athlos-backup.log`** | Cron redirects stderr → default Ubuntu crontab behavior emails `admin`; logrotate is a setup-time ops concern, not a code change | None (documented in runbook) |

---

## Approach

### Test-first (strict TDD)

1. **RED phase** — Write `scripts/tests/common.test.bats`, `backup.test.bats`, `restore.test.bats` BEFORE any production bash. Commit RED with explicit `// TODO: implementation` stubs that fail.
2. **GREEN phase** — Implement `scripts/lib/common.sh`, `scripts/backup.sh`, `scripts/restore.sh` to make the bats tests pass.
3. **REFACTOR phase** — Polish: extract duplication, tighten shellcheck warnings, align error messages, document exit codes.

The orchestrator verifies the RED commits precede GREEN commits in `apply-progress`. This is a Slice A/B0 lesson — TDD drift silently degrades quality.

### Tooling decisions

- **Test framework:** bats-core (Ubuntu `apt install bats`). Plays well with `set -euo pipefail`; TAP output; no install-from-source.
- **Linter:** shellcheck (Ubuntu `apt install shellcheck`). Run as part of the new `backup-bats` CI job.
- **Database client:** `postgresql-client` (Ubuntu; already in Server Infra §6.D essential packages). Ships `pg_dump`, `pg_restore`, `psql`, `pg_isready`.

### Script contracts

**`scripts/backup.sh` argv:** none required; reads `DATABASE_URL` + `BACKUP_DIR` + `BACKUP_RETENTION_DAYS` from env.
**Flow:** Source `lib/common.sh` → validate env → `mkdir -p "$BACKUP_DIR"` → `pg_dump --format=plain --no-owner --no-acl --lock-wait-timeout=30s "$DATABASE_URL" | gzip > "$BACKUP_DIR/athlos-<ts>.sql.gz"` → `cleanup_old_backups` (inline `find ... -mtime +N -delete`) → exit 0.

**`scripts/restore.sh` argv:**
- `--source <path>` (REQUIRED)
- `--confirm` (REQUIRED — refused with exit 1 if missing)
- `--target <connstring>` (optional override of `DATABASE_URL`)
- `--dry-run` (print plan, exit 0, no DB writes)
- `--force-allow-active` (skip the active-connections guard)

**Flow:** Parse args → refuse if `--confirm` missing (exit 1) → validate env + source file → if `--dry-run`, print plan + exit 0 → `gunzip -t <source>` (exit 2 on failure) → query `pg_stat_activity` for active connections on target DB → if count > 0 and no `--force-allow-active`, refuse with banner (exit 2) → print restore banner with target DB host → `gunzip -c <source> | psql "$DATABASE_URL"` (exit 3 on failure) → exit 0.

### Backup file naming

`$BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz` — sortable, human-readable, timestamped at minute granularity (one backup per cron slot, collisions are non-issues).

### CI integration

New `backup-bats` job in `.github/workflows/test.yml`:
1. `sudo apt-get install -y bats shellcheck postgresql-client`
2. `shellcheck scripts/*.sh scripts/lib/*.sh` (must be clean)
3. `bats scripts/tests/` (must all pass)

The job uses a service container Postgres for restore tests; backup tests use `BACKUP_DIR=/tmp/athlos-backup-test` (no root needed).

---

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `scripts/backup.sh` | New | Daily `pg_dump` + gzip + retention sweep |
| `scripts/restore.sh` | New | `--confirm` + active-conn guard + banner + restore |
| `scripts/lib/common.sh` | New | Shared bash helpers (log, env, retention) |
| `scripts/tests/common.test.bats` | New | Strict TDD RED for common helpers |
| `scripts/tests/backup.test.bats` | New | Strict TDD RED for backup flow |
| `scripts/tests/restore.test.bats` | New | Strict TDD RED for restore flow |
| `apps/api/scripts/ci-check-backup-files-present.sh` | New (optional) | CI guard verifying scripts exist + executable |
| `.env.example` | Modified (+2 lines) | `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` under new `─── Backup (PR Slice B1a) ───` block |
| `docs/runbook.md` | Modified (~10 net) | Replace "Manual SQL backup" with `backup.sh` ref + add Restore subsection |
| `openspec/specs/database-migrations/spec.md` | MODIFIED delta | Pre-migration backup scenario path: `s3://...` → `$BACKUP_DIR/...` |
| `openspec/specs/deployment-devops/spec.md` | MODIFIED delta | Backup Strategy path-shape adjustment |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/` | New folder | proposal.md (this file) + future specs/design/tasks |
| `.github/workflows/test.yml` | Modified (+ ~40 LoC) | Add `backup-bats` job |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Bats + shellcheck unavailable in CI** | Med | New `backup-bats` job installs via `sudo apt-get install -y bats shellcheck postgresql-client`; documented in runbook |
| **`pg_dump` blocks long-running imports** | Med | Use `--lock-wait-timeout=30s` (NOT `--single-transaction` which blocks writes); script aborts cleanly, operator re-runs |
| **Restore overwrites live data** | Med | `--confirm` mandatory + active-conn check + banner + bats tests for all negative paths (missing confirm, active conns, nonexistent file, corrupt gzip) |
| **`BACKUP_DIR` fills the disk** | Low | Inline retention sweep + bats test for retention behavior; runbook warns to monitor `df -h $BACKUP_DIR`; worst case is 7 × ~50MB = ~350MB |
| **Strict TDD drift during apply** | Med | Orchestrator verifies RED commits precede GREEN commits in `apply-progress` (Slice A/B0 lesson) |

---

## Acceptance Criteria

- [ ] `bash scripts/backup.sh` with mocked `DATABASE_URL` (CI service container) produces a valid `.sql.gz` in `$BACKUP_DIR`.
- [ ] `bash scripts/restore.sh --source <valid>` exits **1** (missing `--confirm`).
- [ ] `bash scripts/restore.sh --source <valid> --confirm --dry-run` prints banner with target DB host, exits **0**, no DB writes.
- [ ] `bash scripts/restore.sh --source <valid> --confirm` with active connections > 0 exits **2**; passes with `--force-allow-active`.
- [ ] `bats scripts/tests/*.test.bats` — all PASS (3 files, ~30 cases).
- [ ] `shellcheck scripts/*.sh scripts/lib/*.sh` — clean (exit 0).
- [ ] Retention sweep deletes files older than `$BACKUP_RETENTION_DAYS` (verified by bats test with `touch -d "8 days ago"`).
- [ ] `pnpm test:run` passes (464 existing + N new bats tests, no regression).
- [ ] `pnpm lint` and `pnpm typecheck` pass (zero errors).
- [ ] `grep -c "s3://athlos-backups" openspec/specs/database-migrations/spec.md` returns **0** after MODIFIED sync.
- [ ] `grep -c "backup.sh" docs/runbook.md` returns **≥ 1**.
- [ ] Strict TDD traceable in `apply-progress` (RED bats commits precede GREEN bash commits).
- [ ] `backup-bats` CI job green on first run.

---

## Review Workload Forecast

| Metric | Value |
|---|---|
| Estimated changed lines | ~440 |
| 400-line budget risk | **MED** (slightly over; acceptable — B1a is autonomous, B1b is a separate future change) |
| Chained PRs recommended | **No** — this IS the smallest autonomous unit |
| Suggested split | N/A — B1b is a separate change |
| Commit structure | 2-commit: TDD (`feat(backup): daily pg_dump + assisted restore + bats tests + spec deltas`) + `chore(release): v0.4.3` |
| Work-unit count | ~12 (1 per file/group + planning artifacts commit + verify commit + release commit) |
| External deps | Ubuntu packages only: `postgresql-client`, `bats`, `shellcheck` (no npm, no Docker, no cloud SDKs) |
| TDD discipline | bats tests RED first; orchestrator verifies in `apply-progress` |

**Why MED and not HIGH:** at ~440 LoC the slice is 10% over the 400-line review budget. The justification is that B1a and B1b are **temporally separable** — B1a ships and delivers 80% of the value (daily backup + assisted restore) without B1b. Reviewing B1a alone is a coherent concern (`pg_dump` semantics + bash testing) without the LUKS/keyfile mental overhead of B1b. Combining them would force a reviewer to hold two unrelated concerns at once, which is the actual reviewer-cost problem the budget is trying to prevent.

---

## Open Questions

1. **Version bump:** patch (`v0.4.2 → v0.4.3`, recommended — operational tooling, no user-facing change) or minor (`v0.5.0`)? Per project convention, bump at PR close, not in commits.
2. **Backup file naming:** `athlos-<YYYY-MM-DD-HHMM>.sql.gz` (recommended — sortable, human-readable), `<unix-timestamp>.sql.gz` (machine-friendly), or include commit SHA for deploy-time backups (`pre-deploy-<sha>.sql.gz`, matches the existing spec wording)?
3. **`--dry-run` for restore:** include as a flag (recommended — enables safe verification in CI) or skip for v1?
4. **CI job:** add new `backup-bats` job in `.github/workflows/test.yml` (recommended), or test bash scripts locally only (no CI coverage)?
5. **CI guard `ci-check-backup-files-present.sh`:** include in B1a (~20 LoC, mirrors `ci-check-audit-fp.sh` pattern) or defer to B1b / never?
6. **logrotate snippet for `/var/log/athlos-backup.log`:** ship in B1a (~10 LoC in `/etc/logrotate.d/athlos-backup`, documented in runbook) or defer to setup-time ops?

---

## Rollback Plan

B1a adds new files and modifies `.env.example` + two spec files. There is no destructive change to existing infrastructure — `backup.sh` writes only to `$BACKUP_DIR` (defaults to `/var/backups/athlos`, which doesn't exist on dev/CI) and `restore.sh` requires explicit `--confirm` to touch a database.

**Revert path:**
1. Revert the merge commit (GitHub "Revert" button or `git revert -m 1 <merge-sha>`).
2. Restore the two spec deltas to their pre-MODIFIED state (the `s3://` literal returns).
3. No DB migration to roll back. No cron job to unregister (cron only registers when the operator installs it from the runbook — B1a does NOT install cron).
4. Verify `pnpm test:run` still passes (464 tests) and OpenSpec validation passes.

**Spec revert nuance:** the two MODIFIED deltas are not additive — they replace specific scenarios. On revert, those scenarios return to their pre-Slice-B1a wording (`s3://athlos-backups/...`). No data loss because no production data is written until an operator opts in by installing the cron.

---

## Capabilities (contract with sdd-spec)

### Modified Capabilities
- `database-migrations`: pre-migration backup scenario path shape — replace `s3://athlos-backups/pre-deploy-<sha>.sql.gz` literal with `$BACKUP_DIR/pre-deploy-<sha>.sql.gz` (parameterize via env var).
- `deployment-devops`: Backup Strategy requirement — path-shape adjustment for any remaining `s3://...` references (likely a minor wording tweak; existing language uses neutral phrasing).

### New Capabilities
- None. The bash scripts are operational tooling, not application behavior — they don't introduce a new spec-level capability. They are exercised through the two MODIFIED capabilities above.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-b1a-backup-restore/proposal.md`*
- *Engram topic `sdd/athlos-deploy-slice-b1a-backup-restore/proposal`*