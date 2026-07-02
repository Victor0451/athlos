# Archive Report: athlos-deploy-slice-b1a-backup-restore

**Change**: athlos-deploy-slice-b1a-backup-restore
**Date**: 2026-06-19
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED

## Summary

Slice B1a of deploy automation (first sub-slice of Slice B1). Daily local `pg_dump` backup + assisted `restore.sh` with `--confirm` mandatory + new `backup-bats` CI job. No LUKS, no USB, no cloud — those belong to Slice B1b. Single PR (#9 equivalent — merged via fast-forward without PR) at v0.4.3. Bats tests cover all 7 spec scenarios.

## Capabilities modified (2 MODIFIED, 0 ADDED, 0 REMOVED, 0 RENAMED)

### `database-migrations` (MODIFIED)
5 new scenarios + 1 scenario's `s3://` reference replaced:
- Daily backup via backup.sh produces timestamped gzipped dump
- Backup retention sweep deletes files older than BACKUP_RETENTION_DAYS
- Restore requires --confirm flag
- Restore refuses if active connections > 0
- Restore --dry-run prints banner without modifying DB
- Pre-migration backup scenario: `s3://athlos-backups/pre-deploy-<sha>.sql.gz` → `$BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz`

### `deployment-devops` (MODIFIED)
2 new scenarios + requirement text extended:
- backup.sh runs on host via cron, reads DATABASE_URL
- backup-bats CI job runs on every PR

## Canonical sync status

**Canonical was synced during archive phase** (post-merge drift detected):

The apply phase (TASK-013) had only partially synced the canonical — it replaced `s3://` with `$BACKUP_DIR/` but missed both:
1. The filename pattern update (`pre-deploy-<sha>.sql.gz` → `athlos-<YYYY-MM-DD-HHMM>.sql.gz`)
2. The 5 new scenarios entirely (daily backup, retention sweep, restore --confirm, restore active-conn guard, restore --dry-run)

The orchestrator fixed issue #1 via commit `a7828ba` (post-verify). Archive phase fixed the remaining drift (issue #2 — missing new scenarios in `database-migrations`; missing new scenarios + extended requirement text in `deployment-devops`) via commit `d4b90b2`.

Sync applied:
- `database-migrations/spec.md`: added 5 new scenarios (lines 72-112) after Pre-migration backup scenario
- `deployment-devops/spec.md`: extended requirement text + added 2 new scenarios (lines 197-214)

Verify: diff between canonical and delta is now empty for both specs.

## Commits (16 total — 14 apply + 1 orchestrator fix + 1 archive sync)

| SHA | Subject |
|-----|---------|
| `d4b90b2` | docs(openspec): sync canonical database-migrations + deployment-devops specs (archive phase delta sync) |
| `a7828ba` | docs(openspec): fix canonical database-migrations spec naming drift |
| `7233ea9` | chore(release): v0.4.3 |
| `6ecda0a` | chore(verify): pre-closing verification + planning artifacts |
| `9892150` | ci(backup): add backup-bats job to .github/workflows/test.yml |
| `42c043c` | docs(runbook): add backup.sh + restore.sh references to docs/runbook.md |
| `1d56ac0` | refactor(restore): tighten restore.sh after bats green |
| `88d398b` | feat(restore): implement scripts/restore.sh assisted restore |
| `e8f4f32` | chore(verify): pre-release verification for restore chain |
| `869f411` | test(restore): RED restore.test.bats (restore.sh missing) |
| `451cca1` | refactor(backup): tighten backup.sh after bats green |
| `af9b3c1` | feat(backup): implement scripts/backup.sh daily pg_dump + retention |
| `3b464e8` | test(backup): RED backup.test.bats (backup.sh missing) |
| `aa0a4a1` | refactor(common): tighten common.sh after bats green |
| `868f3ca` | feat(common): implement scripts/lib/common.sh shared helpers |
| `dd94fb5` | test(common): RED common.test.bats (common.sh missing) |

## Strict TDD verification (3 chains — all RED-first)

### Chain 1: common.sh
- RED: `dd94fb5` — bats tests FAIL (common.sh missing)
- GREEN: `868f3ca` — implementation, tests PASS
- REFACTOR: `aa0a4a1` — no behavior change (no-op, GREEN was clean)

### Chain 2: backup.sh
- RED: `3b464e8` — bats tests FAIL (backup.sh missing)
- GREEN: `af9b3c1` — implementation, tests PASS
- REFACTOR: `451cca1` — no behavior change

### Chain 3: restore.sh
- RED: `869f411` — bats tests FAIL (restore.sh missing)
- GREEN: `88d398b` — implementation, tests PASS
- REFACTOR: `1d56ac0` — no behavior change

## 2-commit shape verified

- HEAD~1 (`6ecda0a` verify): no version bump
- HEAD (`7233ea9` release): `0.4.3`
- Post-merge fix (`a7828ba`): does not touch version field
- Archive sync (`d4b90b2`): does not touch version field
- 24 package.json files bumped (all in release commit `7233ea9`)
- `[0.4.3]` entry in CHANGELOG.md

## Out of scope (reaffirmed)

- **Slice B1b entirely** (USB rotation, LUKS keyfile, mount-usb.sh, unmount-usb.sh, backup-to-usb.sh) — separate future change
- **AWS S3 / cloud backups** — rejected by ADR #30
- **`BACKUP_BEFORE_MIGRATE`** env var — Slice C/D handles
- **Compose backup service** — cron runs on host
- **`pg_basebackup` / WAL archiving / PITR** — much larger future slice
- **`restore-drill.sh`** — separate future change per Server Infra §8
- **systemd timers** — defer to v2
- **Cockpit alerting on backup failures** — defer
- **Samba / Nextcloud / AD** — completely separate future changes (ADR #33)
- **Storage volume tar** — defer to v2

## Verification

- TS tests: 464/464 pass (no TS code added in this PR)
- Bats tests: ~19 new (5 common + 6 backup + 7 restore + 1 helper)
- Lint: pass
- Typecheck: pass
- Bash syntax (`bash -n`): pass on all 3 scripts
- `grep -c "s3://" openspec/specs/*`: 0
- `grep -c "BACKUP_DIR" openspec/specs/database-migrations/spec.md`: >= 1
- `grep -c "athlos-<YYYY-MM-DD-HHMM>" openspec/specs/database-migrations/spec.md`: >= 1

## Artifacts

- `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/{proposal,design,tasks,archive-report}.md`
- `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/specs/<database-migrations,deployment-devops>/spec.md`
- `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/exploration.md` (from explore-athlos-deploy-slice-b1-scoping)
- `openspec/specs/database-migrations/spec.md` (canonical, MODIFIED, synced)
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED, synced)
- Engram topic `sdd/athlos-deploy-slice-b1a-backup-restore/archive-report`

## Next steps

The repo is at v0.4.3 with Slice B1a done. Operators now have:
- Daily local `pg_dump` backup via cron (slice complete path)
- `restore.sh --confirm` for assisted restore with active-conn guard + gunzip integrity
- `backup-bats` CI job catches regressions

Next SDD changes (separate cycles):
- **Slice B1b** — USB rotation + LUKS mount + weekly backup (needs S3 decision → already pivoted to local+USB, so just USB + LUKS now)
- **Slice C** — Dockerfile + entrypoint + compose prod
- **Slice D** — CI deploy workflow + `db-destructive` PR label gate
- **`athlos-fileserver`** — Samba (deferred per ADR #33)
- **`athlos-nextcloud`** — deploy Nextcloud (deferred per ADR #33)
- **`athlos-ad`** — Samba AD or Authentik (deferred per ADR #33)
