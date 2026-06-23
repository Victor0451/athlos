#!/usr/bin/env bats
#
# unmount-usb.test.bats — RED phase tests for scripts/unmount-usb.sh
# These tests FAIL at this commit because scripts/unmount-usb.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# Success: unmount + LUKS close → exits 0
# ────────────────────────────────────────────────────────────────

@test "unmount-usb succeeds when USB is mounted and LUKS is open" {
  USB_MAPPER="athlos-backup-usb"
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"

  run bash "$SCRIPT_DIR/../unmount-usb.sh"
  # In CI without real USB: exit 0 because is_mounted and is_luks_open both fail (false)
  # In real environment: unmounts and closes, exit 0
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# Not mounted: idempotent → exits 0 silently
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 0 when not mounted (idempotent)" {
  USB_MAPPER="athlos-backup-usb-nonexistent"
  USB_MOUNT_POINT="/mnt/nonexistent-athlos-backup-usb-$(date +%s)"

  run bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# LUKS not open: skip close → exit 0
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 0 when LUKS is not open (skip close)" {
  USB_MAPPER="athlos-backup-usb-nonexistent"
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"

  run bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# Missing env var → exits 1
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 1 when USB_MAPPER is unset" {
  unset USB_MAPPER
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"

  run bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 1 ]]
}

@test "unmount-usb exits 1 when USB_MOUNT_POINT is unset" {
  USB_MAPPER="athlos-backup-usb"
  unset USB_MOUNT_POINT

  run bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 1 ]]
}