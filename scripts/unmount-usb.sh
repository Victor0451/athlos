#!/usr/bin/env bash
#
# unmount-usb.sh — Unmount USB and close LUKS partition
#
# Usage: bash scripts/unmount-usb.sh
# Requires: USB_MAPPER, USB_MOUNT_POINT env vars
#
# Exit codes:
#   0 — always success (idempotent)
#
# CRITICAL: umount BEFORE cryptsetup close (order matters!)
#

set -euo pipefail

# shellcheck source=/dev/null
source "$(dirname "$0")/lib/common.sh"

# ── Guard: root required ─────────────────────────────────────────
require_root

# ── Guard: required env vars ─────────────────────────────────────
require_env USB_MAPPER
require_env USB_MOUNT_POINT

# ── Unmount if mounted ───────────────────────────────────────────
if is_mounted "$USB_MOUNT_POINT"; then
  log INFO "Unmounting $USB_MOUNT_POINT"
  umount "$USB_MOUNT_POINT"
fi

# ── Close LUKS if open ───────────────────────────────────────────
if is_luks_open "$USB_MAPPER"; then
  log INFO "Closing LUKS mapper $USB_MAPPER"
  cryptsetup close "$USB_MAPPER"
fi

# ── Remove mount point if empty ──────────────────────────────────
if [[ -d "$USB_MOUNT_POINT" ]] && [[ -z "$(ls -A "$USB_MOUNT_POINT" 2>/dev/null)" ]]; then
  rmdir "$USB_MOUNT_POINT"
fi

log INFO "USB unmounted successfully"