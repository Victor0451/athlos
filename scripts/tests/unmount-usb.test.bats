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
  run sudo env \
    USB_MAPPER="athlos-test-usb" \
    USB_MOUNT_POINT="$BATS_TEST_TMPDIR/athlos-test-usb" \
    bash "$SCRIPT_DIR/../unmount-usb.sh"
  # In CI without real USB: exit 0 because is_mounted and is_luks_open both fail (false)
  # In real environment: unmounts and closes, exit 0
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# Not mounted: idempotent → exits 0 silently
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 0 when not mounted (idempotent)" {
  run sudo env \
    USB_MAPPER="athlos-test-usb-absent" \
    USB_MOUNT_POINT="$BATS_TEST_TMPDIR/athlos-test-usb-absent" \
    bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# LUKS not open: skip close → exit 0
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 0 when LUKS is not open (skip close)" {
  run sudo env \
    USB_MAPPER="athlos-test-usb-absent" \
    USB_MOUNT_POINT="$BATS_TEST_TMPDIR/athlos-test-usb" \
    bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# Missing env var → exits 1
# ────────────────────────────────────────────────────────────────

@test "unmount-usb exits 1 when USB_MAPPER is unset" {
  run sudo env -u USB_MAPPER \
    USB_MOUNT_POINT="$BATS_TEST_TMPDIR/athlos-test-usb" \
    bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 1 ]]
}

@test "unmount-usb exits 1 when USB_MOUNT_POINT is unset" {
  run sudo env -u USB_MOUNT_POINT \
    USB_MAPPER="athlos-test-usb" \
    bash "$SCRIPT_DIR/../unmount-usb.sh"
  [[ "$status" -eq 1 ]]
}
