# Proposal: athlos-deploy-slice-b1b-usb-rotation

| Field | Value |
|-------|-------|
| **Change** | `athlos-deploy-slice-b1b-usb-rotation` |
| **Date** | 2026-06-23 |
| **Phase** | propose |
| **Mode** | hybrid (OpenSpec file + Engram `sdd/.../proposal`) |
| **Status** | draft — awaiting user answers on open questions |
| **Parent exploration** | `openspec/changes/explore-athlos-deploy-slice-b1b/exploration.md` (Engram id 2309, 538 lines) |
| **Sister change (DONE)** | `athlos-deploy-slice-b1a-backup-restore` (v0.4.3, archived 2026-06-19) |
| **Target release** | v0.4.4 (patch bump) |
| **Delivery** | single PR, strict TDD RED-first, ~305-355 LoC |

---

## 1. Intent

Slice **B1b** completes the backup story that Slice **B1a** started. B1a shipped daily `pg_dump` to a local 7-day rotating directory (`/var/backups/athlos/`), giving the project an in-server safety net but **zero offsite copy**. B1b adds **weekly LUKS-encrypted USB rotation** — every Sunday at 04:00 a LUKS-locked external disk is mounted via a keyfile, mirrored from the local backup directory with `rsync --delete`, swept for retention, and unmounted. This is the state that `5-Server-Infrastructure.md` ADRs #28-#33 lock in as the contract: local disk for daily fast recovery, encrypted USB for weekly offsite rotation, no S3, no cloud, no PITR.

The change is **greenfield** from a spec perspective (verified via grep on `openspec/specs/**` — zero existing capability mentions USB, LUKS, `cryptsetup`, or `by-label` paths) and **greenfield** from a script perspective (zero existing scripts mention USB/LUKS). The only contract surface with B1a is **read-side**: B1b consumes the `athlos-<YYYY-MM-DD-HHMM>.sql.gz` files B1a's `backup.sh` writes, and the `BACKUP_DIR` / `BACKUP_RETENTION_DAYS` env vars already shipped in `.env.example`.

Operators gain four new scripts in `scripts/`: `setup-usb.sh` for one-time USB preparation (manual, NOT in CI), `mount-usb.sh` for the workhorse LUKS-open+mount, `unmount-usb.sh` for the inverse (cron-callable for emergencies), and `backup-to-usb.sh` for the cron entry point that orchestrates mount → rsync → retention sweep → unmount. The shared library `scripts/lib/common.sh` gains three small helpers (`require_root`, `is_mounted`, `is_luks_open`) that follow the same shape as B1a's `require_env` / `require_cmd`.

The LUKS keyfile at `/root/athlos-usb.key` is the highest-stakes config item in the project. Defense-in-depth: `mount-usb.sh` checks keyfile perms (0600) and owner (root:root) **before** calling `cryptsetup open`, refusing to mount if anything drifts. The runbook documents that the operator should back the keyfile up to a password manager (out-of-script responsibility, per B1a's deferral pattern).

---

## 2. Scope

### 2.1 In Scope

| File | LoC | Type | Justification |
|------|-----|------|---------------|
| `scripts/mount-usb.sh` | ~40 | NEW (bash) | Workhorse: perms check → `cryptsetup open` → `mount`. Idempotent. |
| `scripts/unmount-usb.sh` | ~20 | NEW (bash) | Inverse: `umount` → `cryptsetup close`. Idempotent. Cron-callable for emergencies. |
| `scripts/backup-to-usb.sh` | ~55 | NEW (bash) | Cron entry: `flock -n` → mount → `rsync --delete` → retention sweep → unmount. |
| `scripts/setup-usb.sh` | ~30 | NEW (bash) | One-shot manual helper: LUKS keyfile check → `cryptsetup luksFormat` (with confirm) → `mkfs.ext4 -L` → `--help` + dry-run guards. NOT in CI. |
| `scripts/lib/common.sh` | +20 | EXTEND (bash) | Adds `require_root`, `is_mounted`, `is_luks_open`. Same shape as B1a's helpers. |
| `scripts/tests/mount-usb.test.bats` | ~40 | NEW (bats, RED-first) | Perms/owner check, LUKS open mock, mount mock, idempotency. |
| `scripts/tests/unmount-usb.test.bats` | ~25 | NEW (bats, RED-first) | umount then close order, idempotency. |
| `scripts/tests/backup-to-usb.test.bats` | ~55 | NEW (bats, RED-first) | flock + mount + rsync + retention + unmount composition. |
| `scripts/tests/setup-usb.test.bats` | ~20 | NEW (bats, RED-first) | `--help` prints usage; refuses without `--confirm`; idempotency. |
| `.env.example` | +5 | EXTEND (env) | `USB_DEVICE`, `USB_MAPPER`, `USB_MOUNT_POINT`, `USB_KEYFILE`, `USB_RETENTION_DAYS`. |
| `docs/runbook.md` | +15 | EXTEND (md) | `### USB Rotation (weekly)` subsection inside existing `## Backup & Restore`. |
| `openspec/specs/deployment-devops/spec.md` | +25 | MODIFIED (delta) | New `### Requirement: USB Rotation (weekly)` + 4-5 scenarios. |
| `.github/workflows/test.yml` | +3 | MODIFY (yaml) | Extend `backup-bats` job: add `cryptsetup rsync` to apt install + 3 new bats files to the bats command (setup-usb excluded from CI per scope). |
| `package.json` + 18 `packages/*/package.json` | +19 | MODIFY (json) | Version bump `0.4.3 → 0.4.4` in the closing release commit. |
| **PR LoC total (B1b)** | **~353** | — | **Under 400-line review budget. Single PR, no chained PRs.** |

### 2.2 Out of Scope

Explicit non-goals for this change:

- **B1a changes** — `scripts/backup.sh`, `scripts/restore.sh`, `.env.example:46-48`, `database-migrations/spec.md` are **frozen** at v0.4.3. B1b only extends, never duplicates.
- **Slice C** (Dockerfile + entrypoint + prod compose) — separate change.
- **Slice D** (CI deploy workflow + `db-destructive` label gate) — separate change.
- **Restore drill (`restore-drill.sh`)** — explicitly out per `5-Server-Infrastructure.md:589-591`. Future change.
- **AWS S3 / cloud backups** — rejected by ADR #30.
- **`pg_basebackup` / WAL archiving / PITR** — much larger slice.
- **systemd timers instead of cron** — defer to v2; cron is sufficient per ADR #29.
- **Cockpit alerting on backup failures** — manual `grep CRON /var/log/syslog` is enough for v1.
- **Samba / Nextcloud / AD** — separate future changes per ADR #33.
- **Storage volume tar** (`file-storage/spec.md:525-529`) — volume not implemented.
- **`logrotate` snippet** for `/var/log/athlos-backup.log` — deferred per B1a decision.
- **Auto-failover to local backup if USB fails** — manual fallback per runbook; no script-level fallback in v1.
- **`ci-check-backup-files-present.sh` CI guard** — defensible but deferred per B1a.
- **Multi-DB or per-tenant backup partitioning** — Athlos is single-DB today.

### 2.3 Capabilities (contract with sdd-spec)

> Per `sdd-propose` skill: research `openspec/specs/` and use correct existing capability names.

#### New Capabilities

None. USB rotation is part of the existing `deployment-devops` capability (it covers cron, mount, host-level operations) — it does not warrant its own capability folder.

#### Modified Capabilities

- **`deployment-devops`**: add a new `### Requirement: USB Rotation (weekly)` between the existing `### Requirement: Backup Strategy` and `### Requirement: Import Data Volume`. Add 4-5 scenarios covering: cron entry runs as root; `mount-usb.sh` opens LUKS via keyfile and mounts; `unmount-usb.sh` closes LUKS after unmount; keyfile must be 0600/root:root; USB retention sweep deletes files older than `USB_RETENTION_DAYS`.

> The sdd-spec phase will produce `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md` as the delta. Apply phase MUST reconcile it to `openspec/specs/deployment-devops/spec.md` atomically (B1a lesson — see §6).

---

## 3. Approach

### 3.1 TDD order (strict, RED-first)

1. **RED** — Write 4 bats files FIRST. They import the new helpers from `lib/common.sh` and mock `cryptsetup`, `mount`, `rsync`, `flock`. Run `bats scripts/tests/*.test.bats` — they FAIL because the scripts/helpers don't exist yet.
2. **GREEN** — Implement the 4 scripts and the 3 helpers in `lib/common.sh` minimally to make the bats pass.
3. **REFACTOR** — Extract duplication, tighten error messages, add `--help` to `setup-usb.sh`, run `shellcheck` clean, run `bats` again — all green.

### 3.2 Script responsibilities

| Script | Trigger | Does | Does NOT do |
|--------|---------|------|-------------|
| `setup-usb.sh` | Manual, one-shot | Confirms operator preconditions (keyfile present + 0600) → `cryptsetup luksFormat` (requires `--confirm`) → `mkfs.ext4 -L athlos-backup-usb` → reports next-step. | Run from cron. Run in CI. Auto-mount. |
| `mount-usb.sh` | Manual / called by `backup-to-usb.sh` | Refuses if EUID != 0 → checks keyfile perms/owner → if LUKS already open skip → if mounted skip → else `cryptsetup open --key-file` → `mount` | Format disk. Generate keyfile. |
| `unmount-usb.sh` | Manual / called by `backup-to-usb.sh` / cron emergency | If not mounted exit 0 → `umount` → `cryptsetup close` | Format disk. Force-close LUKS if mount busy. |
| `backup-to-usb.sh` | Cron Sunday 4 AM (root) | `flock -n /var/lock/athlos-backup.lock` → `mount-usb.sh` → `rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"` → `cleanup_old_backups "$USB_MOUNT_POINT" "$USB_RETENTION_DAYS"` → `unmount-usb.sh` (always, via `trap`). | Run as non-root. Restore. |

### 3.3 LUKS keyfile permissions enforcement (defense in depth)

`mount-usb.sh` runs this **before** `cryptsetup open`:

```bash
keyfile_mode="$(stat -c '%a' "$USB_KEYFILE")"
keyfile_owner="$(stat -c '%U:%G' "$USB_KEYFILE")"
if [[ "$keyfile_mode" != "600" ]] || [[ "$keyfile_owner" != "root:root" ]]; then
  log ERROR "keyfile $USB_KEYFILE has mode $keyfile_mode owner $keyfile_owner; refusing to mount (expected 600 root:root)"
  exit 1
fi
```

Catches accidental `chmod 644` or ownership drift before `cryptsetup` reads the keyfile. Bats test verifies the exit-1 path.

### 3.4 Cron entry style

**Extend** B1a's `/etc/cron.d/athlos-backup` file with a second line. Run as **`root`** (LUKS requires root). Same log file `/var/log/athlos-backup.log`. The cron file itself is NOT in git (lives in `/etc/`) — the runbook documents the install.

```cron
# Daily 3 AM — local backup (admin, B1a)
0 3 * * *   admin /opt/athlos-scripts/backup.sh >> /var/log/athlos-backup.log 2>&1

# Weekly Sunday 4 AM — USB rotation (root, B1b)
0 4 * * 0   root  /opt/athlos-scripts/backup-to-usb.sh >> /var/log/athlos-backup.log 2>&1
```

### 3.5 Concurrency

`flock -n /var/lock/athlos-backup.lock` at start of `backup-to-usb.sh`. Non-blocking: if held by daily backup (overrun), `backup-to-usb.sh` exits 0 silently — safe because next Sunday will retry.

### 3.6 CI extension (NOT a new job)

B1a's `backup-bats` job already exists. B1b adds `cryptsetup rsync` to the apt install line and 3 bats files to the bats command (`setup-usb.test.bats` is excluded from CI because it does `cryptsetup luksFormat` which is destructive — that script is test-only with `--help` / dry-run paths exercised by bats). Shellcheck list gets the 4 new scripts.

---

## 4. Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/` | New (4 scripts + 1 bats) | Adds the backup-to-USB surface; does not touch `backup.sh` / `restore.sh`. |
| `scripts/lib/common.sh` | Extend (+20 bash) | Three small helpers following the same shape as B1a's `require_env` / `require_cmd`. |
| `.env.example` | Extend (+5 vars) | New `─── Backup USB (PR Slice B1b) ───` section appended after line 48. |
| `docs/runbook.md` | Extend (+15 net) | New `### USB Rotation (weekly)` subsection inside `## Backup & Restore`. |
| `openspec/specs/deployment-devops/spec.md` | MODIFIED (+25) | New `### Requirement: USB Rotation (weekly)` + 4-5 scenarios. **Apply phase MUST sync atomically.** |
| `openspec/specs/database-migrations/spec.md` | None | B1a already MODIFIED this. No B1b delta. |
| `.github/workflows/test.yml` | Modify (+3 yaml) | Extend `backup-bats` install + test list. No new job. |
| `package.json` + 18 `packages/*/package.json` | Modify (+19 json) | Version bump in the closing release commit per B1a pattern. |
| `/etc/cron.d/athlos-backup` (NOT in git) | Operator install | Runbook documents; installer adds the second cron line. |
| `/var/lock/athlos-backup.lock` | Runtime | Created by `flock`; preinstalled via `util-linux`. |

---

## 5. Risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| 1 | **LUKS keyfile perms drift** — operator accidentally `chmod 644` and forgets. | Medium | `mount-usb.sh` checks `600` + `root:root` via `stat -c '%a'` / `stat -c '%U:%G'` BEFORE `cryptsetup open`, exits 1 on mismatch. Bats test asserts. |
| 2 | **USB not plugged on Sunday 4 AM** — admin traveling or forgot. | Medium | `mount-usb.sh` exits 2 with `[ERROR] USB device $USB_DEVICE not found`; cron emails admin; runbook documents local-backup fallback. |
| 3 | **USB device path changes between reboots** (`/dev/sdX` renumbering). | Medium | Use `/dev/disk/by-label/athlos-backup-usb` (label set via `mkfs.ext4 -L`). udev maintains the symlink regardless of enumeration. |
| 4 | **Cron runs as `admin` instead of `root`** — operator copies the daily line and forgets to switch user; `cryptsetup open` fails cryptically. | Medium | `require_root()` helper in `lib/common.sh` extension → exits 2 with clear message; bats test verifies non-root invocation. Runbook highlights `admin` vs `root` in both cron lines. |
| 5 | **Concurrent cron invocations** — daily 3 AM backup still running when weekly 4 AM Sunday fires. | Low | `flock -n /var/lock/athlos-backup.lock` at start of `backup-to-usb.sh`; non-blocking silent skip on contention. |
| 6 | **MODIFIED canonical sync gap (B1a's biggest lesson)** — apply phase commits partial delta; verify doesn't catch missing scenarios; archive needs 2 extra commits. | High (recurring) | Apply sub-agent MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` AS PART OF the apply step, loop until empty for the new USB Rotation requirement. Verify-report includes the diff in its checklist. |

---

## 6. B1a lessons applied (CRITICAL — read carefully)

From B1a's archive-report (Engram id 2302) and verify-report (id 2298):

1. **Canonical sync is NOT automatic** — B1a's apply replaced the `s3://` literal but missed both the filename pattern AND the 5 new scenarios; archive phase needed 2 extra commits. **B1b's apply MUST self-verify delta vs canonical atomically** before marking TASK complete. Verify-report MUST diff canonical vs delta for the new USB Rotation requirement; empty diff = pass.
2. **Path/env replacements must be COMPLETE** — verify that every `$USB_MOUNT_POINT`, `$USB_DEVICE`, `$USB_MAPPER`, `$USB_KEYFILE`, `$USB_RETENTION_DAYS` reference in scripts + spec delta + runbook uses the env var (not a literal path like `/mnt/athlos-backup-usb`).
3. **CI job extends cleanly** — `backup-bats` is the single surface; B1b just adds `cryptsetup rsync` to install + 3 bats files to the test command. No new job, no new runner.
4. **Verify must check canonical, not just delta** — grep for each new scenario title in BOTH the delta spec AND the canonical spec; both must contain it.
5. **Apply self-verification atomicity** — `diff` runs AS PART OF apply, not as a separate post-step; loops until empty for the modified requirement block.

---

## 7. Rollback Plan

B1b is reversible in two layers, both via the existing release tooling:

1. **Code/scripts rollback** — `git revert` the merge commit (or `pnpm version` revert in the closing release commit if not yet tagged). Reverts all 4 new scripts, the `lib/common.sh` extension, the `.env.example` additions, the runbook extension, the CI extension, and the spec delta in a single atomic commit. Existing cron line (B1a's daily) is untouched.
2. **Operator-action rollback** — if B1b ships and operators need to back out the USB rotation without reverting the code:
   - Comment out the second line in `/etc/cron.d/athlos-backup`.
   - Run `unmount-usb.sh` once to close any open LUKS mapper.
   - Done — daily local backup (B1a) continues working independently.

The `deployment-devops/spec.md` MODIFIED delta is reversed by the same `git revert` (no data migrations, no schema changes; pure spec delta).

---

## 8. Dependencies

### 8.1 External (Ubuntu apt packages, NOT npm)

| Package | apt name | Status | Why |
|---------|----------|--------|-----|
| `cryptsetup` | `cryptsetup` | NEW for B1b | LUKS open/close. CI install extended. |
| `rsync` | `rsync` | NEW for B1b | USB rotation. Preinstalled on most Ubuntu; explicit install for CI safety. |
| `flock` | `util-linux` | preinstalled | Cron concurrency lock. |
| `mount` / `umount` / `mountpoint` | `util-linux` | preinstalled | Mount lifecycle. |
| `stat` | `coreutils` | preinstalled | Keyfile perms/owner check. |
| `find` | `findutils` | preinstalled | Retention sweep (B1a's `cleanup_old_backups`). |

**B1b adds zero npm packages.** Repo stays at 18 packages + 4 integration adapters.

### 8.2 Internal (project deps)

- `scripts/lib/common.sh` — provides `log`, `die`, `require_env`, `require_cmd`, `cleanup_old_backups`. B1b extends.
- `scripts/backup.sh` (B1a) — produces `$BACKUP_DIR/athlos-<ts>.sql.gz` that `rsync` mirrors. NOT modified by B1b.
- `.env.example` B1a vars (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) — read by `backup-to-usb.sh`. NOT modified.
- `.github/workflows/test.yml` `backup-bats` job — extended, not duplicated.

---

## 9. Acceptance Criteria

All must pass before the PR merges. Every check is greppable and scriptable.

- [ ] `bash scripts/mount-usb.sh` (mocked LUKS + mount) opens LUKS via keyfile and mounts, exits 0.
- [ ] `bash scripts/mount-usb.sh` with keyfile mode != 600 → exits 1 with perms/owner message.
- [ ] `bash scripts/mount-usb.sh` with keyfile owner != root:root → exits 1.
- [ ] `bash scripts/mount-usb.sh` with USB not present (`[[ ! -b "$USB_DEVICE" ]]`) → exits 2 with clear error.
- [ ] `bash scripts/mount-usb.sh` when already mounted → exits 0 (idempotent, no re-mount).
- [ ] `bash scripts/mount-usb.sh` when LUKS already open → skips open, mounts, exits 0.
- [ ] `bash scripts/mount-usb.sh` as non-root (EUID != 0) → exits 2 via `require_root`.
- [ ] `bash scripts/unmount-usb.sh` (mocked) umounts then closes LUKS, exits 0.
- [ ] `bash scripts/unmount-usb.sh` when not mounted → exits 0 (idempotent).
- [ ] `bash scripts/backup-to-usb.sh` (mocked) runs flock + mount + rsync + retention + unmount, exits 0.
- [ ] `bash scripts/backup-to-usb.sh` when flock contended → exits 0 (silent skip).
- [ ] `bash scripts/setup-usb.sh --help` → prints usage.
- [ ] `bash scripts/setup-usb.sh` without `--confirm` → refuses, exits 1.
- [ ] `bats scripts/tests/mount-usb.test.bats scripts/tests/unmount-usb.test.bats scripts/tests/backup-to-usb.test.bats scripts/tests/setup-usb.test.bats` — all PASS.
- [ ] `shellcheck scripts/mount-usb.sh scripts/unmount-usb.sh scripts/backup-to-usb.sh scripts/setup-usb.sh scripts/lib/common.sh` — clean.
- [ ] `grep -c "USB_DEVICE" .env.example` ≥ 1.
- [ ] `grep -c "USB_RETENTION_DAYS" .env.example` ≥ 1.
- [ ] `grep -c "backup-to-usb.sh" docs/runbook.md` ≥ 1.
- [ ] `grep -c "USB Rotation" openspec/specs/deployment-devops/spec.md` = 1 (new requirement heading).
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md` shows ONLY the new USB Rotation requirement + scenarios (no missing text in canonical).
- [ ] `grep -c "cryptsetup" .github/workflows/test.yml` ≥ 1.
- [ ] `grep -c "backup-to-usb.test.bats" .github/workflows/test.yml` ≥ 1.
- [ ] `pnpm test:run` — 464 tests pass (no TS regression; same count as v0.4.3 since B1b is bash-only).
- [ ] Strict TDD traceable in `apply-progress` (RED tests committed before GREEN impl per task).
- [ ] Version in `package.json` and 18 `packages/*/package.json` = `0.4.4` in the closing release commit.
- [ ] No new docker-compose service; no new GitHub Actions job; no new npm package.

---

## 10. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | **~353** (4 new scripts + 1 common.sh extend + 4 bats + .env + runbook + spec delta + CI; setup-usb.sh adds ~50 LoC above B1a's 245-LoC B1b baseline) |
| 400-line review budget risk | **LOW** (~88% of budget; matches B1a's actual 440 LoC single-PR pattern that reviewers handled in one pass) |
| Chained PRs recommended | **No** |
| Commit structure | 2 commits: (1) `feat(deploy): USB rotation — mount/unmount/backup scripts + bats + spec delta`, (2) `chore(release): v0.4.4` |
| Work-unit count | **~16** (3 setup tasks + 4 RED bats tasks + 4 GREEN impl tasks + 1 common.sh extend + 1 .env + 1 runbook + 1 spec delta + 1 CI + 1 verify + 1 release) |
| Reviewer focus areas | LUKS perms check (`stat -c '%a'` block), rsync flags (`-av --delete`), idempotency, canonical-sync diff in apply-phase checklist |
| Estimated reviewer time | ~20-30 min (one pass) |

---

## 11. Open Questions (for user)

These three questions shape the proposal but can each be answered quickly. The recommendation in each row is the proposed default; the user can accept all three by responding "defaults ok" or override individually.

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | **Version bump:** patch `v0.4.3 → v0.4.4` (mirrors B1a's patch bump) or minor `v0.5.0` (USB rotation is "user-visible new capability")? | **Patch** — backup scripts are infra, not user-facing feature surface. Same shape as B1a. |
| 2 | **`USB_RETENTION_DAYS` default:** `30` (matches `5-Server-Infrastructure.md` §8) or `14` (faster swap-out for small USB drives) or `60` (longer history)? | **30** — locked by Server Infra doc §8. |
| 3 | **`setup-usb.sh` scope:** just LUKS + ext4 + keyfile preconditions (~30 LoC, recommended) OR also include pre-flight checks (USB detected, correct size, not a system disk)? | **Just LUKS + ext4 + keyfile** — pre-flight checks add bats complexity without operator value; the runbook covers "did I pick the right disk?". |
| 4 | **Should `setup-usb.sh` also mount + create a test backup** (extra ~10 LoC, lets the operator verify end-to-end before cron takes over) **or just leave the disk ready** (cleaner separation, cron handles verification)? | **Just leave ready** — operator verification is one command (`mount-usb.sh && rsync ... && unmount-usb.sh`); bundling makes the script harder to reason about. |

---

## 12. Ready for spec?

**Yes** — pending the four open questions above. Once answered (or accepted as defaults), the next phase is `sdd-spec` to produce `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md` (the MODIFIED delta with the USB Rotation requirement + 4-5 scenarios), then `sdd-design` for the technical approach, then `sdd-tasks` for the 16-work-unit breakdown, then `sdd-apply` (strict TDD with atomic canonical sync) → `sdd-verify` → `sdd-archive`.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-b1b-usb-rotation/proposal.md`*
- *Engram topic `sdd/athlos-deploy-slice-b1b-usb-rotation/proposal`*