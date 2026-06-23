# Design: athlos-deploy-slice-b1b-usb-rotation

| Field | Value |
|-------|-------|
| **Change** | `athlos-deploy-slice-b1b-usb-rotation` |
| **Date** | 2026-06-23 |
| **Phase** | Design (SDD) |
| **Mode** | both (Engram + OpenSpec) |
| **Status** | Draft |
| **File path** | `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/design.md` |
| **Parent** | `openspec/changes/explore-athlos-deploy-slice-b1b/exploration.md` (Engram id 2309) |
| **Sister change (DONE)** | `athlos-deploy-slice-b1a-backup-restore` (v0.4.3, archived 2026-06-19) |
| **Target release** | v0.4.4 (patch bump) |
| **Locked ADRs** | `#29 Ubuntu Server 24.04 LTS` · `#30 local + USB (no S3)` · `#31 LUKS on USB only` |

---

## 1. Context

Slice **B1b** completes the backup story Slice **B1a** began. B1a ships daily `pg_dump` to a local 7-day rotating directory (`$BACKUP_DIR`), giving the project an in-server safety net but **zero offsite copy**. B1b adds **weekly LUKS-encrypted USB rotation** — every Sunday at 04:00 a LUKS-locked external disk is mounted via a keyfile, mirrored from `$BACKUP_DIR` with `rsync --delete`, swept for retention, and unmounted. This is the state that `5-Server-Infrastructure.md` ADRs #28–#33 lock in as the contract: local disk for daily fast recovery, encrypted USB for weekly offsite rotation, no S3, no cloud, no PITR.

Operators gain four new scripts in `scripts/`: `setup-usb.sh` for one-time USB preparation (manual, NOT in CI), `mount-usb.sh` for the workhorse LUKS-open+mount, `unmount-usb.sh` for the inverse (cron-callable for emergencies), and `backup-to-usb.sh` for the cron entry point that orchestrates mount → rsync → retention sweep → unmount. The shared library `scripts/lib/common.sh` gains three small helpers (`require_root`, `is_mounted`, `is_luks_open`) following the same shape as B1a's `require_env` / `require_cmd`.

The LUKS keyfile at `/root/athlos-usb.key` is the highest-stakes config item. Defense in depth: `mount-usb.sh` checks keyfile perms (`0600`) and owner (`root:root`) **before** calling `cryptsetup open`, refusing to mount if anything drifts. B1b is **greenfield from B1a** — no deprecation, no duplication. `scripts/backup.sh`, `scripts/restore.sh`, `database-migrations/spec.md`, and the B1a portion of `deployment-devops/spec.md` are frozen at v0.4.3. ~353 LoC, single PR, strict TDD (RED-first per the user-locked decision).

---

## 2. Goals / Non-Goals

### Goals

- `scripts/backup-to-usb.sh` works end-to-end: `flock -n` → mount via `mount-usb.sh` → `rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"` → `cleanup_old_backups` on USB → unmount via `unmount-usb.sh`; exits 0 on success, 2 on device-missing, 1 on keyfile perms wrong, 3 on rsync/retention failure.
- `scripts/mount-usb.sh` is idempotent: refuses non-root (`require_root` exits 1), checks keyfile `0600` + `root:root` via `stat -c '%a'` / `stat -c '%U:%G'` BEFORE `cryptsetup open`, skips open if LUKS already open, skips mount if already mounted, exits 2 if `$USB_DEVICE` does not exist.
- `scripts/unmount-usb.sh` is cron-callable: umounts then closes LUKS (in that order — closing LUKS first corrupts the mapper); safe to call when nothing mounted (exits 0 silently).
- `scripts/setup-usb.sh` is a manual one-shot: requires `--confirm` (refuses exit 1 without), supports `--dry-run` (prints plan, exits 0), refuses to format wrong device via operator-confirmation prompt (`YES` typed literally).
- bats tests catch regressions: 4 new bats files (one per script) with negative + positive + idempotency cases, RED-first per task.
- CI `backup-bats` job extended with `cryptsetup rsync` apt install + 3 new bats files in the bats command.
- Canonical `deployment-devops/spec.md` sync verified atomically by apply (B1a lesson) — `diff` between delta and canonical for the new USB Rotation requirement + 5 scenarios MUST be empty.

### Non-Goals (deferred or rejected)

| Item | Reason | Future owner |
|------|--------|--------------|
| B1a changes (`backup.sh`, `restore.sh`, B1a `.env` vars, B1a spec deltas) | Frozen at v0.4.3; B1b only extends | None (frozen) |
| Slice C (Dockerfile + entrypoint + prod compose) | Separate change | `athlos-deploy-slice-c-prod-deploy` |
| Slice D (CI deploy workflow + `db-destructive` label gate) | Separate change | `athlos-deploy-slice-d-ci-deploy` |
| AWS S3 / cloud backups | Rejected by ADR #30 | Never |
| `pg_basebackup` / WAL archiving / PITR | Much larger slice | Post-Slice D |
| `restore-drill.sh` (scheduled restore testing) | Explicitly out-of-scope per `5-Server-Infrastructure.md:589-591` | Future change |
| systemd timers instead of cron | Deferred — cron sufficient per ADR #29 | v2 |
| Cockpit alerting on backup failures | Manual `grep CRON /var/log/syslog` enough for v1 | v2 |
| Samba / Nextcloud / AD | Separate future changes per ADR #33 | Future |
| Storage volume tar (`file-storage/spec.md:525-529`) | Storage volume not implemented | Future v2 |
| `logrotate` snippet for `/var/log/athlos-backup.log` | Deferred per B1a decision | None (setup-time ops) |
| Auto-failover to local backup if USB fails | Manual fallback per runbook | Future v2 |
| `ci-check-backup-files-present.sh` CI guard | Deferred per B1a decision | Possibly future |
| Multi-DB / per-tenant backup partitioning | Athlos is single-DB today | Future |

---

## 3. Architecture / Approach

### 3.1 `scripts/lib/common.sh` extension (+20 bash, written FIRST)

Three new helpers following the same shape as B1a's `require_env` / `require_cmd`. Same exit-code contract documented in file header.

| Function | Signature | Behavior |
|----------|-----------|----------|
| `require_root` | `require_root` | `[ "$(id -u)" -ne 0 ] && die "must run as root (EUID=$EUID)"` → exit 1 |
| `is_mounted` | `is_mounted PATH` | `mountpoint -q "$1"` → exit 0 (true) or 1 (false) |
| `is_luks_open` | `is_luks_open MAPPER` | `cryptsetup status "$1" >/dev/null 2>&1` → exit 0 (true) or 1 (false) |

The `is_mounted` / `is_luks_open` helpers follow the bash convention "return via exit code, no stdout" — callers compose them with `&&` / `||`. The existing `BATS_TEST_DIRNAME` marker block at the top of `common.sh` is unchanged; no new exports needed.

**Key snippet** — `require_root`:

```bash
require_root() {
  local euid
  euid="$(id -u)"
  if [[ "$euid" -ne 0 ]]; then
    die "must run as root (current EUID=$euid)"
  fi
}
```

### 3.2 `scripts/mount-usb.sh` (~40 bash, strict TDD)

**TDD order:**
1. **RED** — write `scripts/tests/mount-usb.test.bats` with 5 cases:
   - success path (mocked LUKS open + mocked mount) → exit 0
   - keyfile mode != `0600` → exit 1 with perms/owner message
   - keyfile owner != `root:root` → exit 1
   - `$USB_DEVICE` not present (`[[ ! -b "$USB_DEVICE" ]]`) → exit 2
   - already mounted (idempotent) → exit 0 without re-mount
2. **GREEN** — implement `mount-usb.sh` minimally to make the 5 cases pass.
3. **REFACTOR** — dedup the perms/owner check, tighten error messages, run shellcheck clean.

**Implementation outline:**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_root
require_env USB_DEVICE USB_MAPPER USB_MOUNT_POINT USB_KEYFILE
require_cmd cryptsetup mount mountpoint

# Keyfile perms/owner check (defense in depth — BEFORE cryptsetup open)
keyfile_mode="$(stat -c '%a' "$USB_KEYFILE")"
keyfile_owner="$(stat -c '%U:%G' "$USB_KEYFILE")"
if [[ "$keyfile_mode" != "600" ]] || [[ "$keyfile_owner" != "root:root" ]]; then
  die "keyfile $USB_KEYFILE has mode $keyfile_mode owner $keyfile_owner; refusing to mount (expected 600 root:root)"
fi

# USB device present?
if [[ ! -b "$USB_DEVICE" ]]; then
  log ERROR "USB device $USB_DEVICE not found (unplugged or not yet labeled)"
  exit 2
fi

# Open LUKS (idempotent)
if is_luks_open "$USB_MAPPER"; then
  log INFO "LUKS mapper $USB_MAPPER already open; skipping open step"
else
  log INFO "Opening LUKS device $USB_DEVICE as $USB_MAPPER"
  cryptsetup open "$USB_DEVICE" "$USB_MAPPER" --key-file="$USB_KEYFILE"
fi

# Mount (idempotent)
if is_mounted "$USB_MOUNT_POINT"; then
  log INFO "$USB_MOUNT_POINT already mounted; skipping mount step"
else
  log INFO "Mounting /dev/mapper/$USB_MAPPER to $USB_MOUNT_POINT"
  mount "/dev/mapper/$USB_MAPPER" "$USB_MOUNT_POINT"
fi

log INFO "USB ready: $USB_MOUNT_POINT"
exit 0
```

### 3.3 `scripts/unmount-usb.sh` (~20 bash, strict TDD)

**TDD order:**
1. **RED** — write `scripts/tests/unmount-usb.test.bats` with 3–4 cases:
   - success path (mocked umount + mocked close) → exit 0
   - nothing mounted (idempotent) → exit 0 silently
   - LUKS not open (idempotent) → skip close, exit 0
   - missing `$USB_MAPPER` env → exit 1
2. **GREEN** — implement.
3. **REFACTOR** — tighten, shellcheck.

**Implementation outline:**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_root
require_env USB_MAPPER USB_MOUNT_POINT

# Umount first (idempotent — order matters: closing LUKS before umount corrupts mapper)
if is_mounted "$USB_MOUNT_POINT"; then
  log INFO "Unmounting $USB_MOUNT_POINT"
  umount "$USB_MOUNT_POINT"
else
  log INFO "$USB_MOUNT_POINT not mounted; skipping umount"
fi

# Close LUKS
if is_luks_open "$USB_MAPPER"; then
  log INFO "Closing LUKS mapper $USB_MAPPER"
  cryptsetup close "$USB_MAPPER"
else
  log INFO "LUKS mapper $USB_MAPPER not open; skipping close"
fi

log INFO "USB cleanup complete"
exit 0
```

### 3.4 `scripts/backup-to-usb.sh` (~55 bash, strict TDD)

**TDD order:**
1. **RED** — write `scripts/tests/backup-to-usb.test.bats` with 6–7 cases:
   - full pipeline success (mocked flock acquire, mount, rsync, retention, unmount) → exit 0
   - mount fails → exit 2 (skips rsync)
   - rsync fails → exit 3 (LUKS stays open for admin investigation)
   - retention sweep fails → exit 3
   - flock contended (non-blocking) → exit 0 silently
   - missing env var → exit 1
   - rsync command uses `--delete` flag (verified via mock invocation log)
2. **GREEN** — implement.
3. **REFACTOR** — extract the flock setup, tighten log messages.

**Implementation outline:**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

require_root
require_env BACKUP_DIR USB_DEVICE USB_MAPPER USB_MOUNT_POINT USB_KEYFILE USB_RETENTION_DAYS
require_cmd rsync flock

# Concurrency: non-blocking flock. If held by daily backup (overrun), exit silently.
exec 9>/var/lock/athlos-backup.lock
if ! flock -n 9; then
  log INFO "another backup is running; skipping weekly USB rotation"
  exit 0
fi

# trap to ensure unmount on any exit path
cleanup() {
  local rc=$?
  "$SCRIPT_DIR/unmount-usb.sh" || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

# Mount (idempotent)
"$SCRIPT_DIR/mount-usb.sh"

# Mirror backups
log INFO "rsync $BACKUP_DIR/ -> $USB_MOUNT_POINT/"
if ! rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"; then
  log ERROR "rsync failed; backup aborted (LUKS stays open for admin investigation)"
  exit 3
fi

# Retention sweep on USB
log INFO "Running retention sweep: deleting USB backups older than $USB_RETENTION_DAYS days"
cleanup_old_backups "$USB_MOUNT_POINT" "$USB_RETENTION_DAYS"

log INFO "USB backup complete"
exit 0
```

The `trap cleanup EXIT INT TERM` ensures `unmount-usb.sh` runs even on rsync failure or interrupt — admin does not have to manually clean up a dangling LUKS mapper.

### 3.5 `scripts/setup-usb.sh` (~30 bash, strict TDD, manual one-shot)

**TDD order:**
1. **RED** — write `scripts/tests/setup-usb.test.bats` with 3–4 cases:
   - `--help` prints usage + exits 0
   - `--dry-run --device /dev/sdX1` prints the plan without formatting
   - missing `--device` → exit 1
   - device not present → exit 2
2. **GREEN** — implement (excluding the destructive `cryptsetup luksFormat` path — only exercised manually).
3. **REFACTOR** — extract plan-printing, tighten prompts.

**Args:** `--device <path>` (required), `--keyfile <path>` (default `/root/athlos-usb.key`), `--mapper <name>` (default `athlos-backup-usb`), `--label <name>` (default `athlos-backup-usb`), `--mount-point <path>` (default `/mnt/athlos-backup-usb`), `--dry-run`, `--help`.

**Implementation outline (manual flow only — bats exercises `--help` + `--dry-run` + arg parsing):**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# Arg parsing + --help + --dry-run guards (covered by bats)

require_root
DEVICE=""; KEYFILE="/root/athlos-usb.key"; MAPPER="athlos-backup-usb"
LABEL="athlos-backup-usb"; MOUNT_POINT="/mnt/athlos-backup-usb"
DRY_RUN="no"

# (parse args into the above)

# Confirm with operator (literal "YES" required)
printf 'Confirm format %s with LUKS? Type YES to continue: ' "$DEVICE"
read -r confirm
if [[ "$confirm" != "YES" ]]; then
  die "refused: confirmation was '$confirm' (must be exactly YES)"
fi

# Generate keyfile if missing
if [[ ! -f "$KEYFILE" ]]; then
  log INFO "Generating keyfile at $KEYFILE"
  dd if=/dev/urandom of="$KEYFILE" bs=64 count=1
  chmod 0600 "$KEYFILE"
  chown root:root "$KEYFILE"
fi

# LUKS format (header stores the keyfile's hash, NOT the keyfile itself)
cryptsetup luksFormat "$DEVICE" --key-file="$KEYFILE"

# Open + format ext4 + label + close
cryptsetup open "$DEVICE" "$MAPPER" --key-file="$KEYFILE"
mkfs.ext4 -L "$LABEL" "/dev/mapper/$MAPPER"
cryptsetup close "$MAPPER"

log INFO "USB setup complete. Disk NOT mounted — run mount-usb.sh or backup-to-usb.sh to start using it."
exit 0
```

### 3.6 `scripts/tests/{mount-usb,unmount-usb,backup-to-usb,setup-usb}.test.bats` (~140 bats, RED first)

Four separate bats files, one per script. Strict TDD: each test file committed **before** its script (per the user-locked decision). Cases per §3.2–§3.5.

Mock strategy:
- `cryptsetup`, `mount`, `umount`, `rsync`, `mountpoint`, `cryptsetup status` → mocked via `PATH` injection (`BATS_TEST_TMPDIR/bin/`) with shell-stub scripts that record invocations and return canned exit codes.
- `flock -n` → wrap in a subshell that returns a controlled exit code.
- Use `BATS_TEST_TMPDIR` for any temp filesystems (keyfile fixtures, mock USB device paths).
- `require_root` tests in `common.test.bats` use `run bash -c 'require_root'` under a non-root user (CI runs as root → that specific case skipped via `[ "$(id -u)" -ne 0 ]` guard at top of the test).

### 3.7 `.env.example` (+5 lines under new section)

Append after the existing `─── Backup (PR Slice B1a) ───` section (line 48):

```bash
# ── Backup USB (PR Slice B1b) ─────────────────────────────────────
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

### 3.8 `docs/runbook.md` (~15 net lines)

New `### USB Rotation (weekly)` subsection appended inside the existing `## Backup & Restore` section (after the Restore procedure, before `## Common Issues`). Content:

- **Overview:** weekly Sunday 04:00 root cron does LUKS mount + rsync + retention + unmount via `scripts/backup-to-usb.sh`. Single log file `/var/log/athlos-backup.log` (shared with B1a's daily backup).
- **First-time setup:** reference `scripts/setup-usb.sh --help` and the one-time keyfile generation (`dd if=/dev/urandom of=/root/athlos-usb.key bs=64 count=1` + `chmod 0600` + `chown root:root`).
- **Verify last weekly backup:** `sudo scripts/mount-usb.sh && ls -lh /mnt/athlos-backup-usb/ && sudo scripts/unmount-usb.sh`.
- **Emergency unmount:** `sudo scripts/unmount-usb.sh` (cron-callable for incident response).
- **Failure modes:** USB unplugged Sunday 4 AM → cron email + restore from local `/var/backups/athlos/`. Keyfile perms drifted → fix with `chmod 0600 && chown root:root /root/athlos-usb.key`.

### 3.9 `openspec/specs/deployment-devops/spec.md` (MODIFIED delta)

The MODIFIED delta is **already written** by `sdd-spec` at `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md` (320 lines). Apply phase MUST commit both:
1. The delta spec file (as-is, in the change folder).
2. The same content applied to canonical `openspec/specs/deployment-devops/spec.md` between line 216 (end of Backup Strategy scenarios) and line 218 (Import Data Volume heading).

**CRITICAL B1a LESSON** (from B1a archive-report id 2302): apply phase MUST self-verify delta vs canonical **atomically** — run `diff openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md openspec/specs/deployment-devops/spec.md` AS PART OF the apply step. Loop until the diff is empty for the new USB Rotation requirement + 5 scenarios + 5 Success Criteria items. The verify-report's checklist includes this diff command.

### 3.10 `.github/workflows/test.yml` (+3 lines YAML)

Extend the existing `backup-bats` job (lines 85–126). No new job, no new runner.

```diff
   backup-bats:
     ...
     - name: Install bats and shellcheck
-      run: sudo apt-get update && sudo apt-get install -y bats shellcheck postgresql-client
+      run: sudo apt-get update && sudo apt-get install -y bats shellcheck postgresql-client cryptsetup rsync
     - name: shellcheck (must be clean)
-      run: shellcheck scripts/backup.sh scripts/restore.sh scripts/lib/common.sh
+      run: shellcheck scripts/backup.sh scripts/restore.sh scripts/mount-usb.sh scripts/unmount-usb.sh scripts/backup-to-usb.sh scripts/setup-usb.sh scripts/lib/common.sh
     - name: bats tests (must all pass)
-      run: bats scripts/tests/common.test.bats scripts/tests/backup.test.bats scripts/tests/restore.test.bats
+      run: bats scripts/tests/common.test.bats scripts/tests/backup.test.bats scripts/tests/restore.test.bats scripts/tests/mount-usb.test.bats scripts/tests/unmount-usb.test.bats scripts/tests/backup-to-usb.test.bats scripts/tests/setup-usb.test.bats
```

(`setup-usb.test.bats` is included in CI because its 3–4 cases only exercise `--help`, `--dry-run`, and arg-parsing paths — none of them call `cryptsetup luksFormat`. The destructive format path is operator-only.)

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------|-------|
| `scripts/lib/common.sh` | modify | +20 | add `require_root`, `is_mounted`, `is_luks_open` |
| `scripts/mount-usb.sh` | create | ~40 | LUKS open + mount; keyfile perms check; idempotent |
| `scripts/unmount-usb.sh` | create | ~20 | umount + LUKS close; idempotent; cron-callable |
| `scripts/backup-to-usb.sh` | create | ~55 | flock + mount + rsync + retention + trap-unmount |
| `scripts/setup-usb.sh` | create | ~30 | first-time LUKS+ext4+keyfile; manual one-shot |
| `scripts/tests/common.test.bats` | modify | +~15 | 3 new cases for `require_root`, `is_mounted`, `is_luks_open` |
| `scripts/tests/mount-usb.test.bats` | create | ~40 | RED first; 5 cases |
| `scripts/tests/unmount-usb.test.bats` | create | ~25 | RED first; 3–4 cases |
| `scripts/tests/backup-to-usb.test.bats` | create | ~55 | RED first; 6–7 cases |
| `scripts/tests/setup-usb.test.bats` | create | ~20 | RED first; 3–4 cases (no destructive ops) |
| `.env.example` | modify | +5 | new `─── Backup USB (PR Slice B1b) ───` section |
| `docs/runbook.md` | modify | +15 net | new `### USB Rotation (weekly)` subsection |
| `openspec/specs/deployment-devops/spec.md` | modify | already written | sync delta content into canonical (apply-phase atomic) |
| `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md` | create | already written | delta spec (no change) |
| `.github/workflows/test.yml` | modify | +3 yaml | extend backup-bats install + test list |
| `package.json` + 18 `packages/*/package.json` | modify | +19 json | version bump `0.4.3 → 0.4.4` in closing release commit |
| **PR LoC total (B1b)** | — | **~353** | under 400-line review budget |

---

## 5. Implementation Order

Recommended sequence for `sdd-apply` (5 TDD chains + wiring + verify + release = 20 work-units):

**TDD chain 1 — `scripts/lib/common.sh` extension:**
1. Extend `scripts/tests/common.test.bats` with 3 new cases (RED: `require_root`, `is_mounted`, `is_luks_open`) — committed FIRST.
2. Extend `scripts/lib/common.sh` with the 3 helpers (GREEN).
3. REFACTOR + shellcheck clean.

**TDD chain 2 — `scripts/mount-usb.sh`:**
4. Create `scripts/tests/mount-usb.test.bats` (RED: 5 cases) — committed BEFORE the script.
5. Create `scripts/mount-usb.sh` (GREEN).
6. REFACTOR + shellcheck.

**TDD chain 3 — `scripts/unmount-usb.sh`:**
7. Create `scripts/tests/unmount-usb.test.bats` (RED: 3–4 cases).
8. Create `scripts/unmount-usb.sh` (GREEN).
9. REFACTOR + shellcheck.

**TDD chain 4 — `scripts/backup-to-usb.sh`:**
10. Create `scripts/tests/backup-to-usb.test.bats` (RED: 6–7 cases).
11. Create `scripts/backup-to-usb.sh` (GREEN).
12. REFACTOR + shellcheck.

**TDD chain 5 — `scripts/setup-usb.sh` (manual one-shot):**
13. Create `scripts/tests/setup-usb.test.bats` (RED: 3–4 cases — only `--help` / `--dry-run` / arg-parsing paths).
14. Create `scripts/setup-usb.sh` (GREEN).
15. REFACTOR + shellcheck.

**Wiring + docs + release:**
16. Append 5 USB vars to `.env.example` under new `─── Backup USB (PR Slice B1b) ───` section.
17. Add `### USB Rotation (weekly)` subsection to `docs/runbook.md`.
18. Extend `.github/workflows/test.yml` `backup-bats` job (apt install + shellcheck + bats command).
19. **Pre-closing verification + planning artifacts** (proposal, spec, design, tasks, explore). **CRITICAL: apply MUST self-verify delta vs canonical atomically here** — run `diff openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md openspec/specs/deployment-devops/spec.md` AS PART OF this step, loop until empty for the USB Rotation requirement + 5 scenarios + 5 Success Criteria items (B1a lesson).
20. Closing commit: `package.json` + 18 `packages/*/package.json` version bump `0.4.3 → 0.4.4` + CHANGELOG entry in a SEPARATE commit (`chore(release): v0.4.4`). 2-commit structure mirrors Slice A/B0/B1a precedent.

---

## 6. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| 1 | **LUKS keyfile perms drift** — operator accidentally `chmod 644` and forgets. | Medium | `mount-usb.sh` checks `600` + `root:root` via `stat -c '%a'` / `stat -c '%U:%G'` BEFORE `cryptsetup open`, exits 1 on mismatch. Bats test asserts. |
| 2 | **USB not plugged Sunday 4 AM** — admin traveling or forgot. | Medium | `mount-usb.sh` exits 2 with `[ERROR] USB device $USB_DEVICE not found`; cron emails admin; runbook documents fallback to local backup. |
| 3 | **USB device path changes between reboots** (`/dev/sdX` renumbering). | Medium | Use `/dev/disk/by-label/athlos-backup-usb` (label set via `mkfs.ext4 -L`); udev maintains the symlink regardless of enumeration. |
| 4 | **Cron runs as `admin` not `root`** — operator copies the daily line and forgets to switch user. | Medium | `require_root()` helper aborts with clear error; bats test verifies non-root invocation. Runbook highlights `admin` vs `root` in both cron lines. |
| 5 | **Concurrent cron invocations** — daily 3 AM backup still running when weekly 4 AM Sunday fires. | Low | `flock -n /var/lock/athlos-backup.lock` at start of `backup-to-usb.sh`; non-blocking silent skip on contention. |
| 6 | **MODIFIED canonical sync gap (B1a lesson — high recurrence)** — apply commits partial delta; verify doesn't catch missing scenarios; archive needs 2 extra commits. | High (recurring) | Apply sub-agent MUST run `diff openspec/changes/.../specs/deployment-devops/spec.md openspec/specs/deployment-devops/spec.md` AS PART OF TASK-019, loop until empty for the new USB Rotation requirement + 5 scenarios. Verify-report includes the diff in its checklist. |
| 7 | **`setup-usb.sh` accidentally formats wrong device** | Low | Requires operator to type literal `YES`; `--dry-run` flag prints plan without format; bats test verifies refusal without `--confirm`. |
| 8 | **Closing commit slippage** — version bump or CHANGELOG entry done mid-PR. | Medium (pattern risk) | Same as Slice A/B0/B1a — version bump and CHANGELOG entry MUST be in the closing release commit only; convention is locked. |
| 9 | **`rsync --delete` removes USB files matching local retention sweep prematurely** — local 7d vs USB 30d. | Low | `--delete` mirrors `$BACKUP_DIR/` exactly; USB retention sweep then deletes files older than `USB_RETENTION_DAYS` (30d) AFTER rsync. USB retains longer than local by design. |
| 10 | **CI runner missing `cryptsetup` or `rsync`** | Low | `apt-get install` line extended; `rsync` preinstalled on `ubuntu-latest` but explicit install is defensive. |

---

## 7. Acceptance / Verification

Concrete commands the user can run after apply. All greppable and scriptable.

- [ ] `sudo bash scripts/mount-usb.sh` (with real USB + keyfile) → opens LUKS, mounts, exits 0.
- [ ] `sudo bash scripts/mount-usb.sh` with keyfile mode `644` → exits 1 with perms/owner message.
- [ ] `sudo bash scripts/mount-usb.sh` with keyfile owner `admin:admin` → exits 1.
- [ ] `sudo bash scripts/mount-usb.sh` with USB unplugged → exits 2 with clear error.
- [ ] `sudo bash scripts/mount-usb.sh` when already mounted → exits 0 (idempotent, no re-mount).
- [ ] `sudo bash scripts/mount-usb.sh` when LUKS already open → skips open, mounts, exits 0.
- [ ] `sudo bash scripts/mount-usb.sh` as `admin` → exits 1 via `require_root`.
- [ ] `sudo bash scripts/unmount-usb.sh` → umounts then closes LUKS, exits 0.
- [ ] `sudo bash scripts/unmount-usb.sh` when not mounted → exits 0 (idempotent).
- [ ] `sudo bash scripts/backup-to-usb.sh` → flock + mount + rsync + retention + unmount, exits 0.
- [ ] `sudo bash scripts/backup-to-usb.sh` when flock contended → exits 0 (silent skip).
- [ ] `bash scripts/setup-usb.sh --help` → prints usage, exits 0.
- [ ] `bash scripts/setup-usb.sh --dry-run --device /dev/sdc1` → prints plan, no format.
- [ ] `bash scripts/setup-usb.sh` without `--device` → exits 1.
- [ ] `bats scripts/tests/common.test.bats scripts/tests/backup.test.bats scripts/tests/restore.test.bats scripts/tests/mount-usb.test.bats scripts/tests/unmount-usb.test.bats scripts/tests/backup-to-usb.test.bats scripts/tests/setup-usb.test.bats` — all PASS.
- [ ] `shellcheck scripts/backup.sh scripts/restore.sh scripts/mount-usb.sh scripts/unmount-usb.sh scripts/backup-to-usb.sh scripts/setup-usb.sh scripts/lib/common.sh` — clean.
- [ ] `grep -c "USB_DEVICE" .env.example` ≥ 1.
- [ ] `grep -c "USB_RETENTION_DAYS" .env.example` ≥ 1.
- [ ] `grep -c "backup-to-usb.sh" docs/runbook.md` ≥ 1.
- [ ] `grep -c "setup-usb.sh" docs/runbook.md` ≥ 1.
- [ ] `grep -c "USB Rotation" openspec/specs/deployment-devops/spec.md` = 1 (new requirement heading).
- [ ] `diff <(grep -A 200 "USB Rotation" openspec/specs/deployment-devops/spec.md | head -60) <(grep -A 200 "USB Rotation" openspec/changes/athlos-deploy-slice-b1b-usb-rotation/specs/deployment-devops/spec.md | head -60)` — must be empty (canonical sync verified).
- [ ] `grep -c "cryptsetup" .github/workflows/test.yml` ≥ 1.
- [ ] `grep -c "backup-to-usb.test.bats" .github/workflows/test.yml` ≥ 1.
- [ ] `pnpm test:run` — 464 tests pass (no TS regression; B1b is bash-only).
- [ ] `git show HEAD~1:package.json | grep '"version"'` = `"0.4.3"`.
- [ ] `git show HEAD:package.json | grep '"version"'` = `"0.4.4"`.
- [ ] Strict TDD traceable in `apply-progress.md` (RED bats committed before GREEN impl per task).

---

## 8. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | **~353** (4 new bash scripts + 1 common.sh extend + 4 new bats + 1 extend common.test.bats + .env + runbook + spec delta + CI + 19 json files) |
| 400-line review budget risk | **LOW** (~88% of budget; matches B1a's actual single-PR pattern) |
| Chained PRs recommended | **No** (single autonomous unit, well-isolated) |
| Suggested split | N/A |
| Commit structure | **2 commits:** (1) `feat(deploy): USB rotation — scripts + bats + spec delta`, (2) `chore(release): v0.4.4` |
| Work-unit count | **20** (5 TDD chains × 3 steps + 5 wiring/release steps) |
| Reviewer focus areas | LUKS perms check (`stat -c '%a'` block), rsync flags (`-av --delete`), idempotency, canonical-sync diff in apply-phase checklist, keyfile path (`/root/athlos-usb.key`, mode `0600`) |
| Estimated reviewer time | ~20–30 min (one pass) |

---

## 9. Strict TDD Verification Checklist

This section exists to make RED-first traceable in `apply-progress.md` and `verify-report.md`. **Every checkbox MUST be checkable from the git log + bats output before the PR merges.**

- [ ] `scripts/tests/common.test.bats` 3 new cases (require_root, is_mounted, is_luks_open) committed BEFORE `scripts/lib/common.sh` extension.
- [ ] `scripts/tests/mount-usb.test.bats` 5 cases committed BEFORE `scripts/mount-usb.sh`.
- [ ] `scripts/tests/unmount-usb.test.bats` 3–4 cases committed BEFORE `scripts/unmount-usb.sh`.
- [ ] `scripts/tests/backup-to-usb.test.bats` 6–7 cases committed BEFORE `scripts/backup-to-usb.sh`.
- [ ] `scripts/tests/setup-usb.test.bats` 3–4 cases committed BEFORE `scripts/setup-usb.sh` (only `--help` / `--dry-run` / arg-parsing paths — destructive `cryptsetup luksFormat` is operator-only).
- [ ] All RED-phase cases FAIL before implementation (verifiable via `git stash` of the script + re-run of bats).
- [ ] GREEN: all cases PASS after implementation.
- [ ] REFACTOR: bats tests stay green; shellcheck clean.
- [ ] Final count: 464 + ~19 new bats cases = ~483 total, no regression on existing 464 TS tests.
- [ ] No AI co-author; Conventional Commits throughout.
- [ ] PR title: `feat(deploy): USB rotation — scripts + bats + spec delta (v0.4.4)`.
- [ ] `apply-progress.md` ends with GREEN → REFACTOR verification + canonical sync self-verify (`diff` empty for USB Rotation requirement + 5 scenarios + 5 Success Criteria items).
- [ ] CI: `backup-bats` job extended with `cryptsetup rsync` apt install + 3 new bats files in the bats command + 4 new scripts in the shellcheck command.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-b1b-usb-rotation/design.md`*
- *Engram topic `sdd/athlos-deploy-slice-b1b-usb-rotation/design`*