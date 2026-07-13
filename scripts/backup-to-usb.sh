#!/usr/bin/env bash
#
# backup-to-usb.sh — Weekly USB backup rotation pipeline
#
# Usage: bash scripts/backup-to-usb.sh
# Requires: USB_DEVICE, USB_KEYFILE, USB_MAPPER, USB_MOUNT_POINT,
#           BACKUP_DIR, USB_RETENTION_DAYS env vars
#
# Exit codes:
#   0 — success
#   1 — configuration error
#   2 — mount failed
#   3 — rsync or retention failed
#

set -euo pipefail

# shellcheck source=/dev/null
source "$(dirname "$0")/lib/common.sh"

LOCK_FILE="${LOCK_FILE:-/var/lock/athlos-backup.lock}"

# ── Non-blocking flock for concurrency safety ────────────────────
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log INFO "backup-to-usb.sh: another instance is running, skipping (flock contention)"
  exit 0
fi

# ── Guards ───────────────────────────────────────────────────────
require_env USB_DEVICE
require_env USB_KEYFILE
require_env USB_MAPPER
require_env USB_MOUNT_POINT
require_env BACKUP_DIR
require_env USB_RETENTION_DAYS

# ── Default retention ────────────────────────────────────────────
: "${USB_RETENTION_DAYS:=30}"

# ── Error handler: unmount on any failure ───────────────────────
# Uses a flag to avoid re-entrance when cleanup itself calls exit
USB_BACKUP_FAILED=0
on_error() {
  local exit_code=$?
  if [[ "$USB_BACKUP_FAILED" -eq 0 ]]; then
    USB_BACKUP_FAILED=1
    log INFO "Cleaning up USB mount after error (exit $exit_code)"
    bash "$(dirname "$0")/unmount-usb.sh" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap on_error ERR

# ── Mount ────────────────────────────────────────────────────────
log INFO "Mounting USB for backup rotation"
if ! bash "$(dirname "$0")/mount-usb.sh"; then
  log ERROR "mount-usb.sh failed — USB device may not be present"
  exit 2
fi

# ── Rsync ────────────────────────────────────────────────────────
log INFO "Running rsync to mirror $BACKUP_DIR to $USB_MOUNT_POINT"
if ! rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"; then
  log ERROR "rsync failed"
  exit 3
fi

# ── Retention ────────────────────────────────────────────────────
log INFO "Applying retention policy: removing files older than $USB_RETENTION_DAYS days on USB"
if ! cleanup_old_backups "$USB_MOUNT_POINT" "$USB_RETENTION_DAYS"; then
  log ERROR "retention cleanup failed"
  exit 3
fi

# ── Unmount on success ───────────────────────────────────────────
log INFO "Backup complete — unmounting USB"
bash "$(dirname "$0")/unmount-usb.sh"

# ── Success ──────────────────────────────────────────────────────
trap - ERR
log INFO "Backup to USB completed successfully"
