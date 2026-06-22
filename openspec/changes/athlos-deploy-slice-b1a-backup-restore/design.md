# Design: athlos-deploy-slice-b1a-backup-restore

**Change:** `athlos-deploy-slice-b1a-backup-restore`
**Date:** 2026-06-22
**Phase:** Design (SDD)
**Mode:** both (Engram + OpenSpec)
**Status:** Draft
**File path:** `openspec/changes/athlos-deploy-slice-b1a-backup-restore/design.md`
**Parent:** `openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md` (id 2260)
**Locked ADRs:** `#29 Ubuntu Server 24.04 LTS` · `#30 local + USB backups (no S3)` · `#32 --confirm restore`

---

## 1. Context

Slice B1a is the **foundation** of the deploy automation roadmap's backup and restore story. After this change, operators have a `scripts/backup.sh` that runs daily via `/etc/cron.d/athlos-backup` and produces a `.sql.gz` of the production Postgres database, plus a `scripts/restore.sh` that requires an explicit `--confirm` flag before overwriting live data. Both scripts are **pure bash on the Ubuntu Server 24.04 LTS host** — no Docker, no cloud SDK, no AWS CLI. All dependencies are Ubuntu packages (`postgresql-client`, `bats`, `shellcheck`) already in the operator's Server Infrastructure doc.

B1a **unlocks B1b** (USB rotation + LUKS keyfile, separate future change) by establishing the `.env` contract (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) and the backup file naming (`athlos-<YYYY-MM-DD-HHMM>.sql.gz`) that B1b's `rsync` step will consume. It also closes the spec drift introduced by the original S3-based Slice B plan: two existing capabilities (`database-migrations`, `deployment-devops`) get **MODIFIED deltas** that replace the `s3://athlos-backups/pre-deploy-<sha>.sql.gz` literal at `openspec/specs/database-migrations/spec.md:69` with the local-path equivalent. No new capabilities are added.

---

## 2. Goals / Non-Goals

### Goals

- `scripts/backup.sh` works end-to-end: validates env, runs `pg_dump --format=plain --no-owner --no-acl --lock-wait-timeout=30s`, pipes through `gzip`, writes to `$BACKUP_DIR/athlos-<ts>.sql.gz`, verifies with `gunzip -t`, sweeps old files via inline `find ... -mtime +N -delete`, exits 0.
- `scripts/restore.sh` requires `--confirm` (refuses exit 1), refuses active connections > 0 unless `--force-allow-active` (exit 2), runs `gunzip -t` integrity check (exit 2), prints a banner with target DB host BEFORE any side effect, supports `--dry-run`, exits 3 on `psql` failure.
- `.env.example` extends with `BACKUP_DIR=/var/backups/athlos` and `BACKUP_RETENTION_DAYS=7`.
- `.github/workflows/test.yml` adds a `backup-bats` job: installs `bats` + `shellcheck` + `postgresql-client` via `apt-get`, runs `shellcheck scripts/**/*.sh` and `bats scripts/tests/`, gates merges on green.
- bats tests cover negative paths (missing `--confirm`, active conns, missing/corrupt source, missing env) and positive paths (gzipped dump, integrity check, retention sweep, dry-run).
- Spec deltas: replace `s3://athlos-backups/...` literal in `database-migrations/spec.md:69`; add 2 scenarios to `deployment-devops/spec.md`.

### Non-Goals (deferred or rejected)

| Item | Reason | Future owner |
|------|--------|--------------|
| B1b entirely (USB rotation, LUKS, `mount-usb.sh`, `backup-to-usb.sh`) | Separate future change, ~245 LoC on its own | `athlos-deploy-slice-b1b-usb-rotation` |
| AWS S3 / B2 / DO Spaces / any cloud backup | Rejected by ADR #30 | Never |
| `BACKUP_BEFORE_MIGRATE` env var | Belongs to Slice D (`db-destructive` label gate) | Slice D |
| `restore-drill.sh` (scheduled restore testing) | Explicitly out-of-scope per `5-Server-Infrastructure.md:589-591` | Future change |
| `pg_basebackup` / WAL archiving / PITR | Much larger future slice | Post-Slice D |
| `apps/api/scripts/ci-check-backup-files-present.sh` CI guard | Defensible but deferred per user decision | Possibly B1b |
| `logrotate` snippet for `/var/log/athlos-backup.log` | Deferred — setup-time ops concern; runbook will document | None (deferred forever) |
| Compose `backup` service | Cron runs on host per Server Infra §6.L | None |
| systemd timers / Cockpit alerting / Samba / Nextcloud / AD | Out of scope for v1 | Future v2 or separate changes |
| Storage volume tar (`file-storage/spec.md:525-529`) | Storage volume itself not implemented | Future v2 |

---

## 3. Architecture / Approach

### 3.1 `scripts/lib/common.sh` (~40 bash, written FIRST)

Shared helpers sourced by both scripts. Mirrors `apps/api/scripts/ci-check-audit-fp.sh:18` (`set -euo pipefail` + exit codes in header).

**Contract:**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `log` | `log LEVEL MSG...` | Writes `[ISO-8601] [LEVEL] MSG` to **stderr** (cron captures it) |
| `die` | `die MSG` | Logs ERROR and exits 1 |
| `require_env` | `require_env VAR` | Dies if `$VAR` unset or empty |
| `require_cmd` | `require_cmd CMD` | Dies if `command -v` fails |
| `get_timestamp` | `get_timestamp` | Echoes UTC `YYYY-MM-DD-HHMM` |
| `cleanup_old_backups` | `cleanup_old_backups DIR DAYS` | `find DIR -maxdepth 1 -name 'athlos-*.sql.gz' -mtime +DAYS -delete` (idempotent) |

Exit codes documented in file header (`0/1/2/3`). Sourced via `SCRIPT_DIR/lib/common.sh` (relative to script, mirrors `test-ci-guard-negative.sh:14`). When `BATS_TEST_DIRNAME` is set (under bats), exports `ATHLOS_COMMON_LOADED=1` so tests can assert the source loaded.

**Key snippet** — `cleanup_old_backups`:

```bash
cleanup_old_backups() {
  local dir="$1" days="$2"
  [[ -d "$dir" ]] || return 0
  find "$dir" -maxdepth 1 -name 'athlos-*.sql.gz' -mtime "+$days" -delete
}
```

### 3.2 `scripts/backup.sh` (~80 bash)

**Pipeline** (data flow):

```
DATABASE_URL ──► pg_dump ──► gzip ──► $BACKUP_DIR/athlos-<ts>.sql.gz
                                              │
                                              ├──► gunzip -t (verify)
                                              │
                                              └──► find ... -mtime +N -delete (sweep)
```

**Flags:** none. Reads `DATABASE_URL`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` from env. Validates: `BACKUP_DIR` exists + writable, `pg_dump`/`gzip`/`gunzip` in PATH. Generates `athlos-$(date -u +%Y-%m-%d-%H%M).sql.gz`. On `pg_dump` failure: `rm -f $dest` (avoid partial file) + exit 3. After success: `gunzip -t $dest` (exit 3 on corrupt), then `cleanup_old_backups`.

**Key snippet** — the dump command:

```bash
pg_dump --format=plain --no-owner --no-acl \
        --lock-wait-timeout=30s "$DATABASE_URL" | gzip > "$dest"
```

`--lock-wait-timeout=30s` chosen over `--single-transaction`: the latter would block all writes for the dump's duration, the former aborts cleanly and lets the operator re-run. Bounded by the 5-min Drizzle migration lock timeout (`database-migrations/spec.md:88-98`).

### 3.3 `scripts/restore.sh` (~80 bash)

**Argv:**

| Flag | Required | Behavior |
|------|----------|----------|
| `--source <path>` | yes | Path to `.sql.gz`; must exist, be readable, end in `.sql.gz` |
| `--confirm` | yes | Refuses (exit 1) without it — explicit opt-in to overwrite |
| `--target <connstring>` | no | Defaults to `$DATABASE_URL` |
| `--dry-run` | no | Prints plan + runs `gunzip -t`, exits 0, **no** DB writes |
| `--force-allow-active` | no | Bypasses active-connections guard |

**Safety gates (in order):**

1. `--confirm` mandatory → exit 1.
2. `--source` valid → exit 1.
3. **Banner printed to stderr BEFORE integrity check, BEFORE conn check, BEFORE apply.**
4. `gunzip -t "$SOURCE"` integrity check → exit 2 on corrupt.
5. Active-conn query: `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()` → if > 0 AND no `--force-allow-active`, exit 2.
6. `--dry-run` short-circuits after integrity check.
7. `gunzip -c "$SOURCE" | psql "$TARGET" --set ON_ERROR_STOP=on` → exit 3 on failure.

**Banner format** (printed to stderr):

```
╔════════════════════════════════════════════════════════════╗
║  RESTORE WARNING                                            ║
║  Target DB: <host>                                           
║  Source:    <path>                                           
║  Mode:      <APPLY|dry-run>                                  
║  This will OVERWRITE all data in the target database.       
║  --confirm was passed; proceeding.                          
╚════════════════════════════════════════════════════════════╝
```

Target host parsed via `printf '%s' "$TARGET" | sed -E 's|.*@([^:/]+).*|\1|'`.

### 3.4 bats test suites (RED first)

| File | Cases | Coverage |
|------|-------|----------|
| `scripts/tests/common.test.bats` | 6 | common.sh sources cleanly; `require_env`/`require_cmd` exit 1 on missing; `cleanup_old_backups` deletes old + keeps recent; `get_timestamp` regex; `log` writes to stderr not stdout |
| `scripts/tests/backup.test.bats` | 6 | end-to-end dump; `gunzip -t` passes; missing `DATABASE_URL` → exit 1; missing `BACKUP_DIR` → exit 1; retention deletes `touch -d "8 days ago"`; retention keeps recent |
| `scripts/tests/restore.test.bats` | 7 | missing `--source` → exit 1; missing `--confirm` → exit 1; `--dry-run` → exit 0 + no DB writes; active-conn blocks by default → exit 2; `--force-allow-active` bypasses → exit 0; corrupt `.sql.gz` → exit 2; happy-path apply → exit 0 |

Shared `scripts/tests/test_helper.bash` (`load` helper for sourcing `lib/common.sh` and bats-assert stubs).

### 3.5 `.env.example` (+5 lines with comments)

Append after `AUDIT_RETENTION_DAYS`:

```bash
# ── Backup (PR Slice B1a) ────────────────────────────────────
# Local backup directory for scripts/backup.sh
BACKUP_DIR=/var/backups/athlos
# Retention for daily local backups (days)
BACKUP_RETENTION_DAYS=7
```

### 3.6 `docs/runbook.md` (~10 net lines)

Currently 101 lines, no `backup.sh` or `s3://` mention (verified via grep). Add a new `## Backup & Restore` heading between `## Rollback Procedure` and `## Common Issues` with two subsections:

- **Daily backup** — `scripts/backup.sh` runs on host via `/etc/cron.d/athlos-backup` at 03:00 local; reads `DATABASE_URL`/`BACKUP_DIR`/`BACKUP_RETENTION_DAYS`; verification commands (`ls -lh`, `gunzip -t`).
- **Restore procedure** — three example invocations (`--dry-run`, `--confirm`, `--confirm --force-allow-active`) + exit code table.

### 3.7 Spec deltas

| Capability | Delta | What changes |
|------------|-------|--------------|
| `database-migrations` | MODIFIED | Replace `s3://athlos-backups/pre-deploy-<sha>.sql.gz` literal at line 69 with `$BACKUP_DIR/pre-deploy-<sha>.sql.gz`; add 5 new scenarios on `Production Migration Discipline` (backup produces dump, retention sweep, restore requires `--confirm`, restore refuses active conns, `--dry-run` prints banner) |
| `deployment-devops` | MODIFIED | Extend `Backup Strategy` requirement text from "volume or object storage" to "host cron via `/etc/cron.d/athlos-backup`"; add 2 new scenarios (`backup.sh runs on host via cron, reads DATABASE_URL`, `backup-bats CI job runs on every PR`) |

Both deltas already written by sdd-spec (id 2277); `sdd-apply` commits them as-is.

### 3.8 CI: new `backup-bats` job (~45 YAML lines)

Mirrors the `drift-check` job pattern: `ubuntu-latest`, `needs: drift-check`, Postgres service container with `pg_isready` health check, `apt-get install -y bats shellcheck postgresql-client`, then:

```yaml
- run: shellcheck scripts/*.sh scripts/lib/*.sh
- run: bats scripts/tests/*.test.bats
```

Uses `BACKUP_DIR=/tmp/athlos-backup-test` (no root needed). Restore tests use the service Postgres; backup tests dump the same DB.

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------|-------|
| `scripts/lib/common.sh` | create | ~40 | sourced by `backup.sh` + `restore.sh`; bats-loadable |
| `scripts/backup.sh` | create | ~80 | `pg_dump` + `gzip` + retention sweep |
| `scripts/restore.sh` | create | ~80 | `--confirm` + active-conn + `gunzip -t` + `psql` |
| `scripts/tests/test_helper.bash` | create | ~10 | shared bats `load` helper |
| `scripts/tests/common.test.bats` | create | ~50 | 6 cases, RED first |
| `scripts/tests/backup.test.bats` | create | ~80 | 6 cases, RED first |
| `scripts/tests/restore.test.bats` | create | ~90 | 7 cases, RED first |
| `.env.example` | modify | +5 | `─── Backup (PR Slice B1a) ───` section appended |
| `docs/runbook.md` | modify | +~25 (net ~10) | new `## Backup & Restore` + 2 subsections |
| `openspec/specs/database-migrations/spec.md` | modify | already written by sdd-spec | 5 new scenarios + `s3://` literal removed |
| `openspec/specs/deployment-devops/spec.md` | modify | already written by sdd-spec | 2 new scenarios + requirement text tweak |
| `.github/workflows/test.yml` | modify | +~45 YAML | new `backup-bats` job |

**Total estimated LoC: ~440** (consistent with proposal).

---

## 5. Implementation Order

Recommended sequence for `sdd-apply`:

**TDD chain 1 — `common.sh`:**
1. `scripts/tests/test_helper.bash` (skeleton)
2. `scripts/tests/common.test.bats` — **RED** (committed; tests fail because `common.sh` doesn't exist)
3. `scripts/lib/common.sh` — **GREEN** (committed; bats tests pass)
4. REFACTOR `common.sh` — tighten error messages

**TDD chain 2 — `backup.sh`:**
5. `scripts/tests/backup.test.bats` — **RED**
6. `scripts/backup.sh` — **GREEN**
7. REFACTOR `backup.sh`

**TDD chain 3 — `restore.sh`:**
8. `scripts/tests/restore.test.bats` — **RED**
9. `scripts/restore.sh` — **GREEN**
10. REFACTOR `restore.sh`

**Wiring + docs:**
11. `.env.example` — append section
12. `docs/runbook.md` — add `## Backup & Restore`
13. `.github/workflows/test.yml` — add `backup-bats` job

**Closing:**
14. Pre-closing verification (run all §7 commands; `git show HEAD~1:package.json | grep version` = `0.4.2`)
15. **Commit 2: `chore(release): v0.4.3`** — bump `package.json` to `0.4.3` + add `[0.4.3]` CHANGELOG entry (separate commit, Slice A precedent)

**Commit structure:**
- Commit 1: `feat(backup): daily pg_dump + assisted restore + bats tests + spec deltas` (RED + GREEN + REFACTOR + wiring)
- Commit 2: `chore(release): v0.4.3` (version + CHANGELOG only)

---

## 6. Risks & Mitigations

| # | Risk | Lik | Mitigation |
|---|------|-----|------------|
| 1 | **Strict TDD drift** — RED commits silently move to after GREEN | Med | Orchestrator verifies RED precede GREEN in `apply-progress` per Slice A/B0 lesson. Verifiable via `git log --diff-filter=A` ordering. |
| 2 | **`pg_dump` blocks long-running writes** during a migration | Med | Use `--lock-wait-timeout=30s` (NOT `--single-transaction`, which blocks all writes). Script aborts cleanly; bounded by 5-min Drizzle migration lock. |
| 3 | **Restore overwrites live data** | Med | `--confirm` mandatory + `pg_stat_activity` guard + banner-before-side-effect + 4 negative bats tests. |
| 4 | **`BACKUP_DIR` fills the disk** | Low | Inline retention sweep + bats test for retention behavior; runbook warns to monitor `df -h $BACKUP_DIR`. Worst case 7 × ~50MB ≈ 350MB. |
| 5 | **`bats` + `shellcheck` not pre-installed on CI** | Med | New `backup-bats` job installs via `sudo apt-get install -y bats shellcheck postgresql-client`. `ubuntu-latest` has sudo out of the box. |
| 6 | **pg_dump fails mid-write → partial file** | Low | `pipefail` + `rm -f` on failure + `[[ -s $dest ]]` empty-check before `gunzip -t`. |
| 7 | **Cron runs without TTY** | Low | All commands (`pg_dump`, `gzip`, `gunzip`, `psql`, `find`) handle non-TTY cleanly. No `read -p` prompts anywhere — all interaction via argv. |
| 8 | **Closing commit slippage** (version + CHANGELOG forgotten) | Med | Orchestrator pre-closing check: `git show HEAD:package.json | grep version` = `0.4.3`; `git show HEAD~1:...` = `0.4.2`. Slice A/B0 lesson. |
| 9 | **`s3://` literal lingers in `database-migrations/spec.md:69`** | Med | sdd-spec already wrote the MODIFIED delta. Verification grep in §7 (`grep -c "s3://"` = 0). |

---

## 7. Acceptance / Verification

```bash
cd /run/media/vlongo/Archivos/Projectos/Athlos

# === Functional smoke ===
DATABASE_URL=postgresql://athlos:athlos@localhost:5432/athlos \
BACKUP_DIR=/tmp/athlos-backup-test BACKUP_RETENTION_DAYS=7 \
bash scripts/backup.sh                                      # exit 0
gunzip -t /tmp/athlos-backup-test/athlos-*.sql.gz           # exit 0

bash scripts/restore.sh --source <file>                     # exit 1 (no --confirm)
bash scripts/restore.sh --source <file> --confirm --dry-run # exit 0
bash scripts/restore.sh --source <file> --confirm           # exit 2 if active conns
bash scripts/restore.sh --source <file> --confirm --force-allow-active  # exit 0

# === bats + shellcheck ===
bats scripts/tests/*.test.bats                              # all PASS
shellcheck scripts/*.sh scripts/lib/*.sh                    # clean (exit 0)

# === File presence + spec sync ===
grep -c "BACKUP_DIR" .env.example                           # ≥ 1
grep -c "backup.sh" docs/runbook.md                         # ≥ 1
grep -c "s3://" openspec/specs/database-migrations/spec.md  # 0

# === No regression ===
pnpm test:run                                               # 464 + ~18 new tests pass
pnpm lint && pnpm typecheck                                 # 0 errors

# === Closing commit ===
git show HEAD~1:package.json | grep '"version"'             # "0.4.2"
git show HEAD:package.json | grep '"version"'               # "0.4.3"
```

---

## 8. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines (PR) | ~440 |
| 400-line budget risk | **MED** (slightly over; acceptable — B1b is a separate future change with its own PR review) |
| Chained PRs recommended | **No** (this IS the smallest autonomous unit for B1) |
| Suggested split | N/A — B1b is a separate change (`athlos-deploy-slice-b1b-usb-rotation`) |
| Commit structure | 2-commit: TDD (`feat(backup): ...`) + `chore(release): v0.4.3` |
| Work-unit count | 15 (per §5: 10 code + 1 helper + 1 env + 1 runbook + 1 workflow + 1 verify + 1 release) |
| External deps | Ubuntu packages only — no npm, no Docker, no cloud SDKs |
| TDD discipline | bats RED first; orchestrator verifies ordering in `apply-progress` |

**Why MED and not HIGH:** B1a is 10% over the 400-line budget but ships autonomously — daily backup + assisted restore without the LUKS/cryptsetup surface. Reviewers don't need to hold LUKS semantics in their head while reviewing `pg_dump` + bash testing.

---

## 9. Strict TDD Verification Checklist

The orchestrator verifies these per the Slice A/B0 lesson — TDD drift silently degrades quality.

- [ ] `scripts/tests/common.test.bats` committed **BEFORE** `scripts/lib/common.sh`
- [ ] `scripts/tests/backup.test.bats` committed **BEFORE** `scripts/backup.sh`
- [ ] `scripts/tests/restore.test.bats` committed **BEFORE** `scripts/restore.sh`
- [ ] All RED-phase cases FAIL before implementation (verifiable: revert the bash file, rerun bats → all red)
- [ ] Implementation passes all bats tests (GREEN)
- [ ] REFACTOR pass with no behavior change (bats tests stay green)
- [ ] Final test count: 464 existing + ~19 new (6 common + 6 backup + 7 restore) = ~483, no regression
- [ ] No AI co-author on any commit
- [ ] Conventional Commits throughout (`feat(backup):`, `chore(release):`, `docs(runbook):`, `ci(backup):`)
- [ ] PR title: `feat(backup): daily pg_dump + assisted restore + bats tests + spec deltas (v0.4.3)`
- [ ] `apply-progress.md` ends with **GREEN → REFACTOR verification block** showing final bats pass + shellcheck clean
- [ ] CI: new `backup-bats` job runs on every PR, gates merges on green

---

## 10. References

| Path | What it provides |
|------|------------------|
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/proposal.md` | Intent, scope, 10 deliverables, 2-commit structure (id 2274) |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/specs/database-migrations/spec.md` | MODIFIED delta — 5 new scenarios on `Production Migration Discipline` |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/specs/deployment-devops/spec.md` | MODIFIED delta — 2 new scenarios on `Backup Strategy` |
| `openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md` | Slice B1 scoping exploration (id 2260) — script list, USB approach, cron style, retention logic |
| `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` | Locked ADRs #29-#33 (OS, storage, encryption, restore, apps-out-of-scope) |
| `apps/api/scripts/ci-check-audit-fp.sh` | Bash CI guard pattern: `set -euo pipefail`, exit codes in header |
| `apps/api/scripts/test-ci-guard-negative.sh` | Negative-test pattern: `SCRIPT_DIR` resolution, `trap cleanup EXIT` |
| `openspec/specs/database-migrations/spec.md:69` | Pre-existing `s3://athlos-backups/pre-deploy-<sha>.sql.gz` literal being replaced |
| `.env.example:1-42` | Current shape (42 lines, sectioned with `───`); append new section |

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-b1a-backup-restore/design.md`*
- *Engram topic `sdd/athlos-deploy-slice-b1a-backup-restore/design`*
