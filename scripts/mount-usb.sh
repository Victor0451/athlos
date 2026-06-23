#!/usr/bin/env bash
#
# mount-usb.sh — Open LUKS partition and mount USB for backup rotation
#
# Usage: bash scripts/mount-usb.sh
# Requires: USB_DEVICE, USB_KEYFILE, USB_MAPPER, USB_MOUNT_POINT env vars
#
# Exit codes:
#   0 — success (mounted or already mounted)
#   1 — configuration/keyfile error
#   2 — USB device not present
#

set -euo pipefail

# shellcheck source=/dev/null
source "$(dirname "$0")/lib/common.sh"

# ── Guard: root required ─────────────────────────────────────────
require_root

# ── Guard: required env vars ─────────────────────────────────────
require_env USB_DEVICE
require_env USB_KEYFILE
require_env USB_MAPPER
require_env USB_MOUNT_POINT

# ── Guard: USB device must exist ─────────────────────────────────
if [[ ! -b "$USB_DEVICE" ]]; then
  die "USB device $USB_DEVICE not found (not plugged in or not labeled)"
fi

# ── Guard: keyfile must exist ────────────────────────────────────
if [[ ! -f "$USB_KEYFILE" ]]; then
  die "keyfile $USB_KEYFILE not found"
fi

# ── Guard: keyfile perms must be 0600 ───────────────────────────
keyfile_perms="$(stat -c '%a' "$USB_KEYFILE")"
if [[ "$keyfile_perms" != "600" ]]; then
  die "keyfile $USB_KEYFILE has permissions $keyfile_perms, expected 0600 (chmod 0600 $USB_KEYFILE)"
fi

# ── Guard: keyfile owner must be root:root ──────────────────────
keyfile_owner="$(stat -c '%U:%G' "$USB_KEYFILE")"
if [[ "$keyfile_owner" != "root:root" ]]; then
  die "keyfile $USB_KEYFILE is owned by $keyfile_owner, expected root:root"
fi

# ── Idempotent: already mounted ──────────────────────────────────
if is_mounted "$USB_MOUNT_POINT"; then
  log INFO "$USB_MOUNT_POINT is already mounted — idempotent skip"
  exit 0
fi

# ── Create mount point if missing ────────────────────────────────
if [[ ! -d "$USB_MOUNT_POINT" ]]; then
  mkdir -p "$USB_MOUNT_POINT"
fi

# ── Open LUKS partition ──────────────────────────────────────────
if ! is_luks_open "$USB_MAPPER"; then
  log INFO "Opening LUKS partition $USB_DEVICE via mapper $USB_MAPPER"
  cryptsetup open --key-file "$USB_KEYFILE" "$USB_DEVICE" "$USB_MAPPER"
fi

# ── Mount ────────────────────────────────────────────────────────
log INFO "Mounting $USB_MAPPER at $USB_MOUNT_POINT"
mount "/dev/mapper/$USB_MAPPER" "$USB_MOUNT_POINT"

log INFO "USB mounted successfully at $USB_MOUNT_POINT"