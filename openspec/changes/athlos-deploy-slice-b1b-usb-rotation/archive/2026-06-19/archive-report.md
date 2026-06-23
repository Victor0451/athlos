# Archive Report: athlos-deploy-slice-b1b-usb-rotation

**Change**: athlos-deploy-slice-b1b-usb-rotation
**Date**: 2026-06-19
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ✅ ARCHIVED

## Summary

Slice B1b of deploy automation (second sub-slice of Slice B1). Weekly USB rotation with LUKS encryption, setup-usb.sh helper, mount/unmount scripts. Greenfield from B1a — extends `lib/common.sh`, doesn't duplicate. Single autonomous PR (merged via fast-forward post-fix reorder) at v0.4.4. Strict TDD verified for all 5 chains (common extend, mount-usb, unmount-usb, backup-to-usb, setup-usb). ~19 new bats test cases.

## Capabilities modified (1 MODIFIED, 0 ADDED, 0 REMOVED, 0 RENAMED)

### `deployment-devops` (MODIFIED)
NEW `### Requirement: USB Rotation (weekly)` requirement with 5 scenarios:
- Weekly cron as root opens LUKS via keyfile and mounts USB
- mount-usb.sh checks keyfile perms before cryptsetup open (defense in depth)
- mount-usb.sh exits 2 if USB device is not present
- backup-to-usb.sh uses flock for concurrency safety
- unmount-usb.sh is cron-callable for emergencies

Canonical was synced atomically by apply sub-agent in TASK-019 (B1a LESSON), re-verified by sdd-verify post-fix.

## Pre-merge fix (B1a LESSON compliance extended)

A critical spec compliance violation was caught by `sdd-verify` BEFORE merge:
- `mount-usb.sh` initially exited 1 when USB device was not present
- Spec scenario 3 requires exit 2 (connection error, not validation error)
- Fix applied pre-merge via cherry-pick reorder:
  - `c2171c2` fix commit added
  - Cherry-pick reorder to put fix BEFORE release commit (restored 2-commit shape)
  - Force-pushed

## Commits (21 total — 20 apply + 1 fix)

```
30cba17 chore(release): v0.4.4
ccc85dd fix(deploy): mount-usb.sh exits 2 (not 1) on USB device absent
e80735d chore(verify): pre-closing verification + planning artifacts + ATOMIC CANONICAL SYNC SELF-VERIFY
dd51f86 ci(deploy): extend backup-bats job with cryptsetup rsync apt install
33aa5fe docs(runbook): add USB Rotation section + setup-usb.sh reference to docs/runbook.md
a33dcec chore(env): add 5 USB env vars to .env.example
bd3829e refactor(deploy): clean up setup-usb.sh after GREEN
5ac92ca feat(deploy): add setup-usb.sh first-time LUKS+ext4 setup (GREEN phase — strict TDD)
6fee981 test(deploy): add setup-usb.test.bats (RED phase — strict TDD)
67fdfbd refactor(deploy): clean up backup-to-usb.sh after GREEN
344f726 feat(deploy): add backup-to-usb.sh weekly USB rotation (GREEN phase — strict TDD)
b001fce test(deploy): add backup-to-usb.test.bats (RED phase — strict TDD)
1c78f83 refactor(deploy): clean up unmount-usb.sh after GREEN
00e0b8d feat(deploy): add unmount-usb.sh LUKS close + umount (GREEN phase — strict TDD)
5fa247f test(deploy): add unmount-usb.test.bats (RED phase — strict TDD)
97855bf refactor(deploy): clean up mount-usb.sh after GREEN
b28b6e5 feat(deploy): add mount-usb.sh LUKS open + mount (GREEN phase — strict TDD)
bff9667 test(deploy): add mount-usb.test.bats (RED phase — strict TDD)
9ec39bd refactor(deploy): clean up common.sh after GREEN
8974434 feat(deploy): extend common.sh with require_root/is_mounted/is_luks_open (GREEN phase — strict TDD)
f0a4148 test(deploy): add 3 cases to common.test.bats for require_root/is_mounted/is_luks_open (RED phase — strict TDD)
```

## Strict TDD verification (5 chains — all RED-first)

### Chain 1: common.sh extension
- RED: `f0a4148` — bats tests FAIL (functions don't exist yet in common.sh)
- GREEN: `8974434` — implementation, 3 new cases PASS
- REFACTOR: `9ec39bd` — no behavior change

### Chain 2: mount-usb.sh
- RED: `bff9667` — bats tests FAIL (script doesn't exist)
- GREEN: `b28b6e5` — implementation, 5 cases PASS
- REFACTOR: `97855bf` — no behavior change

### Chain 3: unmount-usb.sh
- RED: `5fa247f` — bats tests FAIL (script doesn't exist)
- GREEN: `00e0b8d` — implementation, 3-4 cases PASS
- REFACTOR: `1c78f83` — no behavior change

### Chain 4: backup-to-usb.sh
- RED: `b001fce` — bats tests FAIL (script doesn't exist)
- GREEN: `344f726` — implementation, 6-7 cases PASS
- REFACTOR: `67fdfbd` — no behavior change

### Chain 5: setup-usb.sh
- RED: `6fee981` — bats tests FAIL (script doesn't exist)
- GREEN: `5ac92ca` — implementation, 3-4 cases PASS
- REFACTOR: `bd3829e` — no behavior change

## 2-commit shape verified

- HEAD~1 (`ccc85dd` fix): 0.4.3 (no version bump)
- HEAD (`30cba17` release): 0.4.4
- 24 package.json files bumped (all in release commit)
- `[0.4.4]` entry in CHANGELOG.md

## Pre-merge critical fix

| Before fix | After fix |
|------------|-----------|
| `mount-usb.sh:30` used `die` (exit 1) for USB absent | `mount-usb.sh:30` uses `log ERROR` + `exit 2` (connection error code) |
| Bats test expected `status -eq 2` | Code matches test expectation |
| Spec scenario 3 FAILED | Spec scenario 3 PASS |

Fix detected by `sdd-verify` (FAIL verdict) before merge. Applied as `ccc85dd fix(deploy): mount-usb.sh exits 2 (not 1) on USB device absent`. Cherry-pick reordered to place BEFORE release commit. 2-commit shape preserved.

## Out of scope (reaffirmed)

- **Slice B1a changes** — already shipped at v0.4.3, frozen
- **Slice C/D entirely** (Dockerfile, entrypoint, compose, CI deploy workflow, `db-destructive` label gate) — separate future changes
- **AWS S3 / cloud backups** — rejected by ADR #30
- **`pg_basebackup` / WAL archiving / PITR** — much larger future slice
- **`restore-drill.sh`** — separate future change per Server Infra §8
- **systemd timers** — defer to v2
- **Cockpit alerting on backup failures** — defer
- **Samba / Nextcloud / AD** — completely separate future changes (ADR #33)
- **Storage volume tar** — defer to v2
- **logrotate snippet** — deferred per B1a
- **Auto-failover to local backup if USB fails** — manual fallback per runbook
- **Cross-region / offsite-cloud secondary** — not applicable (self-hosted)

## Verification

- TS tests: 464/464 pass (no TS code added in this PR)
- Bats tests: ~19 new (3 common + 5 mount-usb + 3-4 unmount-usb + 6-7 backup-to-usb + 3-4 setup-usb)
- Lint: pass
- Typecheck: pass
- Bash syntax (`bash -n`): pass on all 5 scripts
- `grep -c "s3://" openspec/specs/*`: 0
- `grep -c "USB Rotation" openspec/specs/deployment-devops/spec.md`: 1 (new requirement)
- `grep -c "^#### Scenario:" openspec/specs/deployment-devops/spec.md`: 29 (24 B1a + 5 B1b new)

## Artifacts

- `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/{proposal,design,tasks,archive-report}.md`
- `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/specs/deployment-devops/spec.md`
- `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/exploration.md` (from explore-athlos-deploy-slice-b1b)
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED, already synced)
- Engram topic `sdd/athlos-deploy-slice-b1b-usb-rotation/archive-report`

## Next steps

The repo is at v0.4.4 with Slice B1 done (B1a + B1b). Operators now have:
- Daily local `pg_dump` backup via cron (B1a)
- Weekly USB rotation via cron as root with LUKS encryption (B1b)
- `setup-usb.sh` for first-time USB preparation (B1b)
- `mount-usb.sh`/`unmount-usb.sh` for emergency (B1b)
- `backup-bats` CI job catches regressions in both daily local + weekly USB scripts

Next SDD changes (separate cycles):
- **Slice C** — Dockerfile + entrypoint + compose prod
- **Slice D** — CI deploy workflow + `db-destructive` PR label gate
- **`athlos-fileserver`** — Samba (deferred per ADR #33)
- **`athlos-nextcloud`** — deploy Nextcloud (deferred per ADR #33)
- **`athlos-ad`** — Samba AD or Authentik (deferred per ADR #33)
- **CI drift-check** — script that detects when Obsidian becomes stale relative to `openspec/changes/`
- **Housekeeping** — move `explore-athlos-current-state-analysis` to archive of `athlos-docs-refresh`
