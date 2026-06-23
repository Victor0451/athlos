# Exploration: athlos-deploy-slice-b1b

**Date:** 2026-06-22
**Mode:** Standalone exploration (Slice B1b has not been named as a change yet).
**Parent roadmap:** `openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md` (id 2260) — the source of truth for B1b scope; locked the chained B1a/B1b split and the USB approach when S3 was rejected.
**Sister change:** `athlos-deploy-slice-b1a-backup-restore` (SHIPPED 2026-06-19, v0.4.3) — B1b depends on B1a's `.env` contract (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) and the `athlos-<YYYY-MM-DD-HHMM>.sql.gz` filename convention that `rsync` will mirror to USB.
**Locked decisions source:** `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` ADRs #28-#33 (created 2026-06-19).
**B1a lessons source:** `sdd/athlos-deploy-slice-b1a-backup-restore/{verify-report,archive-report}` (ids 2298 + 2302) — canonical sync gap + filename-pattern drift are the two highest-impact lessons.

---

## Verdict

Slice B1b is **smaller and safer** than the parent exploration estimated at the time of B1 planning (~245 LoC then → ~280 LoC now) because B1a's design settled the `.env` and filename contracts that B1b consumes. Single autonomous PR, well within the 400-line review budget, no chained PRs needed.

B1b is **greenfield from a spec perspective**: zero existing capability mentions USB, LUKS, `cryptsetup`, or `by-label` paths (verified via grep on `openspec/specs/**`). The only spec coupling is **MODIFIED** on `deployment-devops` (add USB rotation requirement + scenarios). `database-migrations` does NOT need another delta — B1a already replaced the `s3://` literal and added the 5 backup scenarios; USB rotation is a separate concern that lives in `deployment-devops`.

The LUKS surface is the riskiest part (kernel module + root + keyfile). B1b isolates it in its own PR specifically to keep the blast radius small per the parent exploration's recommendation.

---

## 1. B1a context (already on main at v0.4.3, must extend not duplicate)

| Asset | Path | State | Reuse for B1b |
|-------|------|-------|---------------|
| `scripts/lib/common.sh` | `/run/media/vlongo/Archivos/Projectos/Athlos/scripts/lib/common.sh` (99 lines) | ✅ shipped | Reuse `log`, `die`, `require_env`, `require_cmd`, `get_timestamp`, `cleanup_old_backups`. **Extend** with USB-specific helpers (`require_root`, `is_mounted`, `is_luks_open`, USB-specific `cleanup_old_backups` wrapper if needed). |
| `scripts/backup.sh` | 91 lines | ✅ shipped | Not modified. Output `$BACKUP_DIR/athlos-<ts>.sql.gz` is the source for B1b's `rsync`. |
| `scripts/restore.sh` | 145 lines | ✅ shipped | Not modified. B1b's USB backup is read-only by restore; no new restore code. |
| `.env.example` | 48 lines, ends at line 48 | ✅ shipped | **Append** a new `─── Backup USB (PR Slice B1b) ───` section with 5 USB_* vars. |
| `docs/runbook.md` | 166 lines | ✅ shipped | **Extend** the `## Backup & Restore` section with an `### USB Rotation (weekly)` subsection (~15 lines). |
| `.github/workflows/test.yml` `backup-bats` job | lines 85-126 | ✅ shipped | **Extend**: add `cryptsetup` and `rsync` to the `apt-get install` line, add the 3 new bats files to the bats command. |
| `openspec/specs/database-migrations/spec.md` | 208 lines, MODIFIED in B1a | ✅ shipped + synced | **No delta for B1b.** All backup-related scenarios (5) live here already; USB rotation is a deployment concern. |
| `openspec/specs/deployment-devops/spec.md` | 255 lines, MODIFIED in B1a | ✅ shipped + synced | **MODIFIED delta for B1b**: add `USB Rotation (weekly)` requirement + ~4 scenarios on mount/unmount/keyfile/rsync. |
| CI `backup-bats` job | already runs bats + shellcheck | ✅ shipped | Reuses the same CI surface; just extends the install + test list. |

**Key invariant:** B1b does NOT modify `backup.sh`, `restore.sh`, or `database-migrations/spec.md`. B1b's only contract surface is the **read-side**: it consumes files at `$BACKUP_DIR/athlos-*.sql.gz` (produced by B1a) and mirrors them to `$USB_MOUNT_POINT`.

---

## 2. Infrastructure context (locked by `5-Server-Infrastructure.md` ADRs #28-#33)

| Decision | Locked value | ADR | Implication for B1b |
|----------|-------------|-----|---------------------|
| OS | Ubuntu Server 24.04 LTS | #29 | bash + cron, no PowerShell, no systemd timers (defer) |
| Storage | local disk + external USB rotation (no S3, no cloud) | #30 | Already pivoted from S3 in B1a; B1b continues the local+USB arc |
| Encryption | **LUKS on USB disk only** | #31 | System + local backup disk are unencrypted; USB is LUKS-protected. Mount script needs `cryptsetup open --key-file /root/athlos-usb.key` |
| Restore | assisted CLI with `--confirm` mandatory | #32 | B1b's `backup-to-usb.sh` is read-only by design — no restore interaction needed |
| Apps adicionales | Samba/Nextcloud/AD are separate future changes | #33 | B1b does NOT scope-creep into those |

### §7 setup del disco USB (from doc lines 537-559, single-shot manual setup, OUT OF B1b SCOPE)

The Server Infrastructure doc defines the one-time manual setup:

```bash
sudo cryptsetup luksFormat /dev/sdc1          # CONFIRMAR con YES mayúscula + passphrase
sudo cryptsetup open /dev/sdc1 athlos-backup-usb
sudo mkfs.ext4 -L athlos-backup-usb /dev/mapper/athlos-backup-usb
sudo mkdir -p /mnt/athlos-backup-usb
sudo mount /dev/mapper/athlos-backup-usb /mnt/athlos-backup-usb
```

**This one-shot setup is operator knowledge, NOT a script.** B1b's `mount-usb.sh` assumes the disk is already LUKS-formatted and ext4-formatted with label `athlos-backup-usb`. The runbook will reference §7 for the setup.

### §8 schedule + retention (from doc lines 565-573)

| Backup | Frequency | When | Storage | Retention | Cron user |
|--------|-----------|------|---------|-----------|-----------|
| Daily local | cron 3 AM | already in B1a | `/var/backups/athlos/` | 7 days | `admin` |
| **Weekly USB** | **cron Sunday 4 AM** | **B1b** | `/mnt/athlos-backup-usb/` (LUKS) | 30 days | **`root`** (LUKS needs root) |

---

## 3. Decisions (locked for proposal phase)

### 3.1 Script list and language

| Script | Path | Lang | Shebang | New/Extend | LoC |
|--------|------|------|---------|-----------|-----|
| `mount-usb.sh` | `scripts/mount-usb.sh` | bash | `#!/usr/bin/env bash` | **new** | ~40 |
| `unmount-usb.sh` | `scripts/unmount-usb.sh` | bash | `#!/usr/bin/env bash` | **new** | ~20 |
| `backup-to-usb.sh` | `scripts/backup-to-usb.sh` | bash | `#!/usr/bin/env bash` | **new** | ~55 |
| `lib/common.sh` | `scripts/lib/common.sh` | bash | sourced | **extend** (+~20 bash) | +20 |
| `tests/mount-usb.test.bats` | `scripts/tests/mount-usb.test.bats` | bats | n/a | **new** | ~40 |
| `tests/unmount-usb.test.bats` | `scripts/tests/unmount-usb.test.bats` | bats | n/a | **new** | ~25 |
| `tests/backup-to-usb.test.bats` | `scripts/tests/backup-to-usb.test.bats` | bats | n/a | **new** | ~55 |
| `.env.example` additions | `.env.example` | env | n/a | **extend** (+5) | +5 |
| `docs/runbook.md` additions | `docs/runbook.md` | md | n/a | **extend** (+~15) | +15 |
| `.github/workflows/test.yml` `backup-bats` job extension | `.github/workflows/test.yml` | yaml | n/a | **modify** (+~3 lines) | +3 |
| `openspec/specs/deployment-devops/spec.md` MODIFIED delta | delta spec | md | n/a | **new delta** (~25 net) | +25 |
| **PR LoC total (B1b)** | — | — | — | — | **~285** |
| Planning artifacts (proposal/design/tasks/exploration — NOT in PR) | — | — | — | — | ~250 |

### 3.2 Conventions (apply to ALL new scripts, mirrors B1a)

- **Shebang:** `#!/usr/bin/env bash` (matches B1a + `ci-check-audit-fp.sh:1`).
- **Error handling:** `set -euo pipefail` at top.
- **Exit codes (documented in file header):**
  - `0` — success
  - `1` — validation error (missing env, bad argv, missing keyfile)
  - `2` — connection/device error (USB device missing, LUKS open failed, mount failed)
  - `3` — operation error (rsync failed, retention sweep failed)
- **Logging:** same `log LEVEL MSG...` helper from `lib/common.sh` → stderr. Plus `backup-to-usb.sh` writes its own stderr to `/var/log/athlos-backup.log` via the cron line (not a separate redirection in the script — cron handles it).
- **Idempotency:**
  - `mount-usb.sh`: if `mountpoint -q "$USB_MOUNT_POINT"` → log INFO + exit 0 (don't re-open LUKS, don't re-mount). If `cryptsetup status "$USB_MAPPER"` shows already open → skip open step. If the device is not present (`[[ ! -b "$USB_DEVICE" ]]`) → exit 2 with `[ERROR] USB device $USB_DEVICE not found`.
  - `unmount-usb.sh`: if not mounted → exit 0 (idempotent). If LUKS not open → skip close step.
  - `backup-to-usb.sh`: wraps `mount-usb.sh` (idempotent) at start, `unmount-usb.sh` at end. Runs `rsync` only on success.
- **Locking (concurrency safety):**
  - `backup-to-usb.sh` opens `flock -n /var/lock/athlos-backup.lock` at start. If another backup holds the lock → exit 0 (silent skip — safe because both daily and weekly should not overlap anyway).
  - `flock` ships with `util-linux` (preinstalled on Ubuntu).
- **Root requirement:**
  - `mount-usb.sh` needs root (`cryptsetup open` + `mount` are root-only).
  - `unmount-usb.sh` needs root (`umount` + `cryptsetup close`).
  - `backup-to-usb.sh` needs root because it calls the above (cron line runs as `root`).
  - Add a `require_root()` helper to `lib/common.sh` extension — exits 2 if `EUID != 0`. (Mirrors `require_env` / `require_cmd` shape.)

### 3.3 LUKS keyfile strategy (CRITICAL — see §8 risks)

**Path:** `/root/athlos-usb.key` (chmod 0600, owner root:root). Locked by `5-Server-Infrastructure.md:580`.

**Generation:** **operator knowledge** — the runbook documents the one-time command:

```bash
sudo dd if=/dev/urandom of=/root/athlos-usb.key bs=64 count=1
sudo chmod 0600 /root/athlos-usb.key
sudo chown root:root /root/athlos-usb.key
```

**NOT** generated by any script. **NOT** committed to git. **NOT** in any `.env` value (only the PATH is in `.env.example` as `USB_KEYFILE=/root/athlos-usb.key`).

**First-time USB setup:** separate one-shot manual steps in §7 of the Server Infra doc. B1b's `mount-usb.sh` assumes the disk is already LUKS-formatted and ext4-formatted with label `athlos-backup-usb`.

**Mount script permissions enforcement (defense in depth):** `mount-usb.sh` checks the keyfile perms BEFORE calling `cryptsetup open`:

```bash
keyfile_mode="$(stat -c '%a' "$USB_KEYFILE")"
keyfile_owner="$(stat -c '%U:%G' "$USB_KEYFILE")"
if [[ "$keyfile_mode" != "600" ]] || [[ "$keyfile_owner" != "root:root" ]]; then
  log ERROR "keyfile $USB_KEYFILE has mode $keyfile_mode owner $keyfile_owner; refusing to mount (expected 600 root:root)"
  exit 1
fi
```

This catches accidental `chmod 644` / wrong owner before `cryptsetup` touches the device.

**Backup of keyfile:** runbook warns that the keyfile SHOULD also be stored in a password manager (Bitwarden, 1Password, etc.). Losing the keyfile = losing access to USB backups. B1b cannot enforce this; it documents it.

### 3.4 USB device detection (the by-label decision)

**Decision: `/dev/disk/by-label/athlos-backup-usb`** (label-based).

| Option | Robustness | Tradeoff |
|--------|-----------|----------|
| `/dev/disk/by-label/athlos-backup-usb` ✅ | **Robust to port changes** — label is set during `mkfs.ext4 -L` and persists regardless of which USB port or `/dev/sdX` letter the kernel assigns | Requires `mkfs.ext4 -L` during one-time setup (already in §7) |
| `/dev/sdc1` | Brittle — `/dev/sdX` letters shift on reboot or when other USB devices are plugged in | Will silently fail or worse, point at the wrong disk |
| `/dev/disk/by-uuid/<uuid>` | Robust but UUID is opaque to humans | Worse for debugging |

The label is set in `mkfs.ext4 -L athlos-backup-usb` (Server Infra §7 line 553). The by-label symlink is created by `udev` automatically.

### 3.5 Rsync strategy

**Decision: `rsync -av --delete $BACKUP_DIR/ $USB_MOUNT_POINT/`**

```bash
rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"
```

Flags:
- `-a` — archive (preserves timestamps, recursive, symlinks as symlinks, perms)
- `-v` — verbose (shows file count; useful for cron log)
- `--delete` — remove files on USB that no longer exist in `$BACKUP_DIR` (keeps USB in sync; bounded by USB retention sweep)

Rejected:
- `rsync -av $BACKUP_DIR/ $USB_MOUNT_POINT/` (no `--delete`) → USB grows unbounded by local retention. Runbook would need to explain why the weekly USB has different retention from local, and a separate cleanup job would be needed.
- `cp -r $BACKUP_DIR/* $USB_MOUNT_POINT/` → no incremental behavior; always copies everything (slow for large backups).

After rsync, run the same retention sweep on the USB mount point:

```bash
cleanup_old_backups "$USB_MOUNT_POINT" "$USB_RETENTION_DAYS"
```

(reuses `cleanup_old_backups` from `lib/common.sh` — same filename pattern `athlos-*.sql.gz`, different directory, different retention window).

### 3.6 Mount timeout / error handling

**Decision: fail fast, exit 2 with clear error.**

| Scenario | Behavior |
|----------|----------|
| USB not plugged on Sunday 4 AM | `mount-usb.sh` → `[ERROR] USB device $USB_DEVICE not found` → exit 2. Cron daemon emails admin. Runbook documents fallback to local backup. |
| LUKS keyfile wrong perms | exit 1 with clear perms/owner message (defense in depth, see §3.3). |
| `cryptsetup open` fails (corrupt keyfile, wrong key) | exit 2 with `[ERROR] cryptsetup open failed: <stderr>`. |
| `mount` fails (filesystem corrupt) | exit 2 with `[ERROR] mount failed: <stderr>`. |
| `rsync` fails mid-transfer (USB full, cable yanked) | exit 3; LUKS stays open so admin can investigate. |
| Already mounted (re-run) | log INFO + exit 0 (idempotent). |
| Already LUKS open (re-run) | skip open step, proceed to mount. |

**No retry with backoff.** Rationale: a flaky USB connection is a hardware problem that won't fix itself in 5 minutes. A clear error log is more useful than 5 retries that all fail.

### 3.7 Cron entry style

**Decision: extend the existing `/etc/cron.d/athlos-backup` file** (created by B1a) with a second line.

```cron
# /etc/cron.d/athlos-backup
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DATABASE_URL=postgresql://athlos:CHANGE_ME@localhost:5432/athlos
BACKUP_DIR=/var/backups/athlos
BACKUP_RETENTION_DAYS=7
USB_DEVICE=/dev/disk/by-label/athlos-backup-usb
USB_MAPPER=athlos-backup-usb
USB_MOUNT_POINT=/mnt/athlos-backup-usb
USB_KEYFILE=/root/athlos-usb.key
USB_RETENTION_DAYS=30

# Daily 3 AM — local backup
0 3 * * *   admin /opt/athlos-scripts/backup.sh >> /var/log/athlos-backup.log 2>&1

# Weekly Sunday 4 AM — USB rotation (root for LUKS)
0 4 * * 0   root  /opt/athlos-scripts/backup-to-usb.sh >> /var/log/athlos-backup.log 2>&1
```

Rationale (re-affirmed from B1 explore §3.4):
- Single file, visible in `/etc`, easier to reproduce than two `crontab -e` lines.
- Run-as-user explicit per line: `admin` for daily, `root` for weekly (LUKS requires root).
- Both lines redirect to `/var/log/athlos-backup.log` — single log file, rotated by `logrotate` (deferred; out of scope).
- Rejected: separate `/etc/cron.d/athlos-backup-usb` file (unnecessary file proliferation).

**Note on cron file:** the `/etc/cron.d/athlos-backup` file itself is **NOT** committed to git (it's `/etc/`, not the repo). B1a's runbook documents it as the install location. B1b extends the runbook's existing snippet with the USB_* env vars and the second cron line.

### 3.8 `.env.example` additions

```bash
# ── Backup USB (PR Slice B1b) ──────────────────────────────
# External USB disk for weekly rotation (LUKS-encrypted, mounted on demand).
# Device path uses /dev/disk/by-label/ for robustness against /dev/sdX renumbering.
USB_DEVICE=/dev/disk/by-label/athlos-backup-usb
# LUKS mapper name (set during cryptsetup open)
USB_MAPPER=athlos-backup-usb
# Mount point (created by operator during one-time setup per §7 of Server Infra doc)
USB_MOUNT_POINT=/mnt/athlos-backup-usb
# LUKS keyfile (operator creates once with dd + chmod 0600; documented in runbook)
USB_KEYFILE=/root/athlos-usb.key
# Retention for weekly USB backups (days)
USB_RETENTION_DAYS=30
```

Append after the existing `─── Backup (PR Slice B1a) ───` section (line 48). Five new vars, no other changes.

### 3.9 Spec deltas (1 MODIFIED capability only)

**`deployment-devops/spec.md` MODIFIED** — add a new requirement `### Requirement: USB Rotation (weekly)` between the existing `### Requirement: Backup Strategy` (line 165) and `### Requirement: Import Data Volume` (line 218). Add 4-5 scenarios:

1. **Weekly USB backup via `backup-to-usb.sh` runs on Sunday 4 AM as root via cron** — verifies the cron entry exists and runs as root (not admin) because LUKS requires root.
2. **`mount-usb.sh` opens LUKS via keyfile and mounts to `$USB_MOUNT_POINT`** — verifies env vars (`USB_DEVICE`, `USB_MAPPER`, `USB_MOUNT_POINT`, `USB_KEYFILE`) are read; verifies `cryptsetup open --key-file "$USB_KEYFILE"` is called; verifies `mount` is called.
3. **`unmount-usb.sh` closes LUKS and unmounts** — verifies `umount` then `cryptsetup close` (in that order — closing LUKS before umount corrupts the mapper).
4. **LUKS keyfile at `$USB_KEYFILE` MUST be chmod 0600 and root:root** — `mount-usb.sh` aborts if perms differ (defense in depth).
5. **USB retention sweep deletes files older than `USB_RETENTION_DAYS`** — same `cleanup_old_backups` helper, applied to `$USB_MOUNT_POINT` after rsync.

**`database-migrations/spec.md` — NO delta for B1b.** B1a already MODIFIED this with the 5 backup scenarios + `s3://` replacement. USB rotation is a deployment concern; it lives in `deployment-devops`.

### 3.10 CI integration (extend `backup-bats` job, NOT new job)

Two-line change to `.github/workflows/test.yml`:

```diff
- run: sudo apt-get install -y bats shellcheck postgresql-client
+ run: sudo apt-get install -y bats shellcheck postgresql-client cryptsetup rsync
```

```diff
- run: bats scripts/tests/common.test.bats scripts/tests/backup.test.bats scripts/tests/restore.test.bats
+ run: bats scripts/tests/common.test.bats scripts/tests/backup.test.bats scripts/tests/restore.test.bats scripts/tests/mount-usb.test.bats scripts/tests/unmount-usb.test.bats scripts/tests/backup-to-usb.test.bats
```

Plus extend the `shellcheck` command to include the new scripts:

```diff
- run: shellcheck scripts/backup.sh scripts/restore.sh scripts/lib/common.sh
+ run: shellcheck scripts/backup.sh scripts/restore.sh scripts/mount-usb.sh scripts/unmount-usb.sh scripts/backup-to-usb.sh scripts/lib/common.sh
```

`cryptsetup` is available in the `ubuntu-latest` GitHub Actions runner via `apt-get`; same for `rsync` (already preinstalled but explicit install is safe). The actual `cryptsetup open` call only runs if the test mock passes — bats tests will mock LUKS via skip-if-not-root (similar pattern to B1a's `BACKUP_DIR` skip-if-no-Postgres).

### 3.11 External dependencies (Ubuntu packages — NOT npm)

| Package | apt name | Why | Installed via | Already in B1a install list? |
|---------|----------|-----|---------------|------------------------------|
| `cryptsetup` | `cryptsetup` | LUKS open/close | `apt install cryptsetup` | ❌ NEW for B1b |
| `rsync` | `rsync` | USB rotation | `apt install rsync` (likely preinstalled) | ❌ NEW for B1b |
| `flock` | `util-linux` | cron concurrency lock | preinstalled | n/a |
| `mount`, `mountpoint`, `umount` | `util-linux` | mount/unmount | preinstalled | n/a |
| `stat` | `coreutils` | keyfile perms check | preinstalled | n/a |
| `find` | `findutils` | retention sweep | preinstalled | used by B1a |

**B1b adds zero npm packages.** Repo stays at 18 packages + 4 integration adapters.

### 3.12 Compose integration

**Decision: NO new docker-compose service.** Cron runs on HOST via `/etc/cron.d/athlos-backup`. Mirrors B1a's decision (B1a explore §3.6).

Rationale:
- Server Infrastructure doc (§6.L) explicitly lists backup scripts at `/opt/athlos-scripts/` — HOST paths.
- LUKS mount requires real `/dev/sdc1` access; a container would need `--privileged` + device passthrough, which is heavier than the current cron-on-host.
- `docker-compose.yml` stays a placeholder (real prod compose lands in Slice C).

---

## 4. Estimated LoC (PR-contributing only)

| Component | New | Extend | Total |
|-----------|-----|--------|-------|
| `scripts/mount-usb.sh` | 40 | 0 | 40 |
| `scripts/unmount-usb.sh` | 20 | 0 | 20 |
| `scripts/backup-to-usb.sh` | 55 | 0 | 55 |
| `scripts/lib/common.sh` (extend: `require_root`, `is_mounted`, `is_luks_open`) | 0 | 20 | 20 |
| `scripts/tests/mount-usb.test.bats` | 40 | 0 | 40 |
| `scripts/tests/unmount-usb.test.bats` | 25 | 0 | 25 |
| `scripts/tests/backup-to-usb.test.bats` | 55 | 0 | 55 |
| `.env.example` additions | 0 | 5 | 5 |
| `docs/runbook.md` additions | 0 | 15 | 15 |
| `.github/workflows/test.yml` `backup-bats` job extension | 0 | 5 | 5 |
| `openspec/specs/deployment-devops/spec.md` MODIFIED delta | 0 | 25 | 25 |
| **Total PR LoC (B1b)** | **235** | **70** | **~305** |

Under the 400-line review budget. **Single PR, no chained PRs.**

(Compare: parent B1 explore estimated 245 LoC; B1a's actual was 440 LoC; B1b's actual estimate ~285-305 LoC — slightly over the original estimate because of the `lib/common.sh` extension for USB-specific helpers and the larger `backup-to-usb.sh` that now does mount + rsync + retention sweep + unmount.)

---

## 5. Risks (top 5, with mitigations)

### Risk 1 — LUKS keyfile permissions drift

**Scenario:** Operator accidentally `chmod 644 /root/athlos-usb.key` to "share" with another tool, then forgets. `cryptsetup` succeeds (file is readable), but the keyfile is now exposed to any user with shell access.

**Mitigation:**
1. `mount-usb.sh` checks perms (0600) and owner (root:root) BEFORE `cryptsetup open` (see §3.3).
2. Runbook documents the expected perms and warns about chmod drift.
3. Bats test mounts a fake device with a keyfile that has wrong perms → asserts exit 1.

**Residual:** if the operator chmods while a USB mount is active, the running `cryptsetup` already has the key loaded — perms check only catches the next mount. Acceptable for v1.

### Risk 2 — USB not plugged on Sunday 4 AM

**Scenario:** Sunday morning, admin sees the weekly USB didn't plug in (forgot, traveling, etc.). Cron runs, script exits 2.

**Mitigation:**
1. `mount-usb.sh` fails fast with `[ERROR] USB device $USB_DEVICE not found` → exit 2.
2. Cron emails admin (default Ubuntu behavior).
3. Runbook documents the failure mode and the fallback: "if USB not plugged on Sunday, restore from `/var/backups/athlos` for that week; plug USB before next Sunday."
4. No alerting integration in v1 (deferred per Server Infra doc §9).

**Residual:** missed weekly backup = no offsite copy for that week. The local 7-day backup is still intact. Acceptable for v1.

### Risk 3 — USB device path changes between reboots

**Scenario:** `/dev/sdc1` (the original device path used during `cryptsetup luksFormat`) shifts to `/dev/sdd1` after reboot because the kernel enumerates USB devices differently.

**Mitigation:** use `/dev/disk/by-label/athlos-backup-usb` (set via `mkfs.ext4 -L` during one-time setup). The `by-label` symlink is created by `udev` and persists regardless of `/dev/sdX` numbering.

**Residual:** if the label is somehow overwritten (very unlikely; would require re-formatting), the mount fails with a clear error. Acceptable.

### Risk 4 — Cron runs as `admin` instead of `root` for the USB line

**Scenario:** Operator copies the daily line and forgets to change user from `admin` to `root`. `cryptsetup open` fails with permission denied.

**Mitigation:**
1. Runbook shows the exact cron file with both lines, with `admin` and `root` explicitly highlighted in code-fence comments.
2. `mount-usb.sh` calls `require_root` (new helper in `lib/common.sh`) → exits 2 with `[ERROR] mount-usb.sh must run as root (current EUID=$EUID)`.
3. Bats test verifies that running `mount-usb.sh` as a non-root user exits 2.

**Residual:** if the operator removes the `require_root` check, the script could attempt `cryptsetup open` and fail cryptically. The check is a single line; refactoring past it requires intent.

### Risk 5 — Concurrent cron invocations (B1a daily + B1b weekly overlapping)

**Scenario:** Daily local backup at 3 AM is still running when the weekly USB backup fires at 4 AM Sunday (e.g., Saturday 3 AM daily was slow due to large DB). Both try to rsync / lock the same file.

**Mitigation:**
1. `backup-to-usb.sh` opens `flock -n /var/lock/athlos-backup.lock` at start.
2. If `flock -n` (non-blocking) fails → exit 0 (silent skip — admin will see the next successful run on Monday).
3. `backup.sh` (daily) could optionally also use the same lock, but it's currently sequential to pg_dump so the risk is low. Document but don't change B1a's contract.

**Residual:** silent skip on race condition. Runbook documents that missing USB rotations will show up as `flock: failed` in cron logs. Acceptable.

### Lesser risks

- **rsync mid-transfer USB disconnect** → exit 3; LUKS stays open; admin runs `unmount-usb.sh` manually after investigation.
- **B1b apply misses the canonical spec sync** (B1a's biggest lesson — see §6) → caught by sdd-verify's comprehensive grep checklist.
- **`/var/log/athlos-backup.log` grows unbounded** → logrotate config deferred to ops (out of scope per B1a design).
- **The by-label symlink doesn't exist yet** → caught by `mount-usb.sh` exit 2; runbook documents the one-time setup.

---

## 6. B1a lessons to apply (CRITICAL — read carefully)

From `sdd/athlos-deploy-slice-b1a-backup-restore/archive-report` (id 2302) and `verify-report` (id 2298):

### Lesson 1 — Canonical spec sync is NOT automatic

B1a's apply phase committed the canonical spec delta partially: it replaced the `s3://` literal with `$BACKUP_DIR/` but **missed both**:
1. The filename pattern update (`pre-deploy-<sha>.sql.gz` → `athlos-<YYYY-MM-DD-HHMM>.sql.gz`)
2. The 5 new scenarios entirely

The verify phase caught the filename pattern but **not** the missing new scenarios. The archive phase diff check found it post-merge. Two commits were needed (`a7828ba` orchestrator fix + `d4b90b2` archive sync) to fully reconcile.

**B1b implication:** the orchestrator MUST explicitly verify that the canonical `deployment-devops/spec.md` matches the delta spec — **every new scenario, every modified line**. Apply must self-verify delta vs canonical atomically before marking TASK complete. Verify must grep for each new scenario title.

### Lesson 2 — Filename / path / extension replacements must be COMPLETE

When B1a changed the file naming convention, several things needed to move together:
- `scripts/backup.sh` writes the new pattern
- `.env.example` doesn't reference the old pattern (none in B1a)
- `docs/runbook.md` shows the new pattern in examples
- `database-migrations/spec.md` references the new pattern in scenarios
- `deployment-devops/spec.md` references the new pattern in scenarios

**B1b implication:** B1b adds `$USB_MOUNT_POINT` and `$USB_DEVICE` as path references. Verify that:
- `mount-usb.sh` references `$USB_DEVICE` (and not `/dev/sdc1` literal)
- `unmount-usb.sh` references `$USB_MAPPER` (and not `athlos-backup-usb` literal)
- `backup-to-usb.sh` references `$BACKUP_DIR`, `$USB_MOUNT_POINT`, `$USB_RETENTION_DAYS`
- `deployment-devops/spec.md` MODIFIED delta uses `$USB_MOUNT_POINT` not `/mnt/athlos-backup-usb` literal
- runbook uses the same vars in example invocations

### Lesson 3 — bats + shellcheck via apt extends cleanly

B1a's CI install line was:
```
sudo apt-get install -y bats shellcheck postgresql-client
```

B1b extends with `+ cryptsetup + rsync`. No new job, no new runner. Mirrors B1a's pattern. Same `bats scripts/tests/*.test.bats` command, just with more files.

### Lesson 4 — Verify must check canonical sync, not just delta

B1a's verify-report only grep'd the delta spec (it was correct) and confirmed the canonical `s3://` count was 0 (it was, post-fix). But it didn't grep for the NEW scenarios that were added in the delta — those existed in delta but NOT in canonical.

**B1b implication:** verify-report must include a checklist that does a `diff` between `openspec/specs/deployment-devops/spec.md` (canonical) and `openspec/changes/<B1b>/specs/deployment-devops/spec.md` (delta) for the new requirement. If `diff` shows non-zero output, the canonical needs another sync commit.

### Lesson 5 — Apply self-verification atomicity

B1a's apply phase (TASK-013) did a partial sync. The orchestrator's verify phase caught some drift but not all. The archive phase was the only phase that did a comprehensive diff check.

**B1b implication:** the apply sub-agent must run a `diff` between delta and canonical AS PART OF the apply step, before marking the canonical-sync task complete. If `diff` is non-empty for the new USB rotation requirement + scenarios, apply must loop until empty.

---

## 7. Out of scope (defer to future changes)

Per Server Infra doc §9 and B1a archive report:

- **Restore drill (`restore-drill.sh`)** — explicitly out-of-scope per `5-Server-Infrastructure.md:589-591`. Needs a separate test DB + scheduled drill. **Future change** (`athlos-restore-drill` or similar).
- **`pg_basebackup` / WAL archiving / PITR** — much larger slice. **Future change** (`athlos-deploy-slice-b-pitr` or similar).
- **S3 / cloud backups** — explicitly REJECTED by ADR #30. Never.
- **Multi-database backups** — Athlos is single-DB today.
- **Per-tenant backup partitioning** — multi-tenancy future work.
- **systemd timers instead of cron** — defer; cron is sufficient per ADR #29.
- **Cockpit alerting on backup failures** — defer; manual `grep CRON /var/log/syslog` is enough for v1.
- **Apps adicionales (Samba, Nextcloud, AD)** — separate future changes per ADR #33.
- **Storage volume tar (`file-storage/spec.md:525-529`)** — storage volume itself not implemented.
- **`apps/api/scripts/ci-check-backup-files-present.sh` CI guard** — defensible but deferred per B1a decision.
- **`logrotate` snippet for `/var/log/athlos-backup.log`** — deferred per B1a decision (setup-time ops concern).
- **Auto-failover to local backup if USB fails** — manual fallback per runbook; no script-level fallback in v1.
- **Slice C** (Dockerfile + entrypoint + compose prod) — separate change.
- **Slice D** (CI deploy workflow + `db-destructive` PR label gate) — separate change.

---

## 8. Ready for proposal?

**Yes.**

### What the orchestrator should do

1. **Propose `athlos-deploy-slice-b1b-usb-rotation` as the next SDD change.** Single autonomous PR at v0.4.4 (patch bump from v0.4.3, per B1a's pattern).
2. **Sequencing:** runs AFTER B1a is shipped on main (already done — B1a is at v0.4.3 on main as of 2026-06-19).
3. **Chained PRs:** **none** — B1b is well within the 400-line review budget (~305 LoC).
4. **Pre-flight checks for proposal phase:**
   - Confirm v0.4.3 is the current version on main ✅ (verified: `package.json` shows `0.4.3`).
   - Confirm B1a's `.env` contract is in place ✅ (verified: `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` in `.env.example:46-48`).
   - Confirm B1a's `athlos-<ts>.sql.gz` filename convention is in production code ✅ (verified: `scripts/backup.sh:48`).
   - Confirm canonical specs are post-archive ✅ (verified: `database-migrations/spec.md` and `deployment-devops/spec.md` are MODIFIED and synced as of `d4b90b2`).
   - Confirm `cleanups_old_backups` helper exists ✅ (verified: `scripts/lib/common.sh:90-99`).

### Open questions to confirm at proposal phase

1. **Keyfile backup responsibility:** the runbook will document that the operator SHOULD also store the keyfile in a password manager. Is this acceptable, or does the operator want a script-level reminder (e.g., `mount-usb.sh` logs a one-time warning if the keyfile is not also present in `$HOME/.password-store` or similar)? Recommend: **runbook-only for v1**.
2. **`require_root` helper placement:** add to `lib/common.sh` extension (recommended, ~5 lines) OR inline in each USB script? Recommend: **shared helper** — same pattern as B1a's `require_env` / `require_cmd`.
3. **`unmount-usb.sh` from cron vs manual:** the weekly cron calls `backup-to-usb.sh` which calls `unmount-usb.sh` internally. Should `unmount-usb.sh` ALSO be cron-callable for emergency unmount? Recommend: **yes** — already supported by being a standalone script; runbook documents the emergency invocation.
4. **First-time USB setup helper:** the Server Infra doc has §7 with manual `cryptsetup luksFormat` + `mkfs.ext4` commands. Should B1b ship a separate `setup-usb.sh` (run once, then never again) to wrap these? Recommend: **NO** — the manual setup is operator knowledge per B1a's deferral pattern. Runbook + Server Infra doc §7 is sufficient. Adds risk for zero gain.

### Immediate next step

Propose `athlos-deploy-slice-b1b-usb-rotation` as the next SDD change:

- **Why B1b now:** operators have daily local backups (B1a) but no offsite rotation. B1b completes the backup story per ADR #30. ~305 LoC, single PR, no chained PRs.
- **Why not defer:** every week without USB rotation is a week of single-disk failure risk. B1a's local-only backup is a stopgap; B1b is the actual ADR-compliant state.
- **Risks:** all 5 risks in §5 have explicit mitigations + bats tests. The LUKS surface is the riskiest part (keyfile management, root privileges) but well-isolated in 3 dedicated scripts.

After B1b lands:

- **Slice C** (Dockerfile + entrypoint + compose prod, ~280 LoC).
- **Slice D** (CI deploy workflow + `db-destructive` PR label gate, ~250 LoC).
- **Restore drill** (`restore-drill.sh`, future change).
- **`athlos-fileserver`** (Samba, deferred per ADR #33).
- **`athlos-nextcloud`** (deploy Nextcloud, deferred per ADR #33).
- **`athlos-ad`** (Samba AD or Authentik, deferred per ADR #33).

---

## 9. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` | Locks ADRs #28-#33 (OS, storage, encryption, restore, apps-out-of-scope). §7 defines the one-time USB setup. §8 defines the schedule (daily 3 AM + weekly Sunday 4 AM) and retention (7d + 30d). Line 580 names the keyfile path `/root/athlos-usb.key`. |
| `openspec/changes/explore-athlos-deploy-slice-b1-scoping/exploration.md` (Engram id 2260) | **THIS IS THE SOURCE OF TRUTH FOR B1b.** §3.1 lists the script set, §3.3 defines the USB mount approach (fstab `noauto` + manual script), §3.4 defines the cron entry style, §3.5 lists the `.env.example` additions, §5 splits B1a/B1b. |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/exploration.md` | The B1a archive's exploration (snapshot of B1's explore). Used to verify B1b's contract surface. |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/design.md` | The B1a design — establishes the `.env` contract, the `athlos-<ts>.sql.gz` naming, and the `set -euo pipefail` + bats convention that B1b mirrors. |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/verify-report.md` (Engram id 2298) | **LESSON SOURCE #1** — canonical sync gap + filename pattern drift. B1b's verify-report must check BOTH. |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/archive-report.md` (Engram id 2302) | **LESSON SOURCE #2** — confirms 2 extra commits were needed (orchestrator fix + archive sync) for full canonical reconciliation. Apply phase MUST self-verify. |
| `scripts/lib/common.sh` | The 99-line shared library. B1b EXTENDS this with USB-specific helpers (`require_root`, `is_mounted`, `is_luks_open`). |
| `scripts/backup.sh` | The 91-line daily pg_dump script. B1b does NOT modify — reads from its output directory via `rsync`. |
| `scripts/restore.sh` | The 145-line restore script. B1b does NOT modify — read-only by restore interaction. |
| `.env.example:46-48` | Current `─── Backup (PR Slice B1a) ───` section. B1b appends a new `─── Backup USB (PR Slice B1b) ───` section after line 48. |
| `docs/runbook.md:82-145` | Current `## Backup & Restore` section. B1b extends with an `### USB Rotation (weekly)` subsection. |
| `openspec/specs/deployment-devops/spec.md:165-216` | Current `Backup Strategy` requirement + scenarios (post-B1a). B1b adds a new requirement `### Requirement: USB Rotation (weekly)` after line 216. |
| `openspec/specs/database-migrations/spec.md:65-112` | Current `Production Migration Discipline` scenarios (post-B1a). **No delta for B1b.** |
| `.github/workflows/test.yml:85-126` | Current `backup-bats` CI job. B1b extends the install line + bats command. |
| `package.json` + 18 `packages/*/package.json` + 0 `apps/*/package.json` (root version only) | Version 0.4.3. B1b bumps to 0.4.4 in a single closing commit (per B1a pattern). |
| `5-Server-Infrastructure.md:589-591` | Explicit out-of-scope declaration for `restore-drill.sh`. |

---

*Persisted to:*
- *`openspec/changes/explore-athlos-deploy-slice-b1b/exploration.md`*
- *Engram topic `sdd/explore/athlos-deploy-slice-b1b`*
