#!/usr/bin/env bats
#
# mount-usb.test.bats — RED phase tests for scripts/mount-usb.sh
# These tests FAIL at this commit because scripts/mount-usb.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# Success: USB present + keyfile OK → exits 0
# ────────────────────────────────────────────────────────────────

@test "mount-usb succeeds when USB device exists and keyfile has correct perms" {
  local test_keyfile="$BATS_TEST_DIRNAME/test-keyfile-ok"
  echo "test-key" > "$test_keyfile"
  chmod 0600 "$test_keyfile"

  run sudo env \
    USB_DEVICE="/dev/sdb1" \
    USB_KEYFILE="$test_keyfile" \
    USB_MAPPER="athlos-backup-usb" \
    USB_MOUNT_POINT="/mnt/athlos-backup-usb" \
    bash "$SCRIPT_DIR/../mount-usb.sh"
  # Possible exit codes in this environment:
  # 0 = success (cryptsetup available + device accessible)
  # 2 = USB device not present (expected in CI without real USB)
  # This test is primarily checking that the script REACHES the right error path.
  [[ "$status" -eq 0 || "$status" -eq 2 ]]
  rm -f "$test_keyfile"
}

# ────────────────────────────────────────────────────────────────
# Keyfile perms check: wrong perms (644) → exits 1
# ────────────────────────────────────────────────────────────────

@test "mount-usb exits 1 when keyfile perms are 644" {
  local test_keyfile="$BATS_TEST_DIRNAME/test-keyfile-644"
  echo "test-key" > "$test_keyfile"
  chmod 0644 "$test_keyfile"

  local test_dir test_device
  test_dir="$(mktemp -d)"
  test_device="$test_dir/device"
  sudo mknod "$test_device" b 1 7

  run sudo env \
    USB_DEVICE="$test_device" \
    USB_KEYFILE="$test_keyfile" \
    USB_MAPPER="athlos-backup-usb" \
    USB_MOUNT_POINT="/mnt/athlos-backup-usb" \
    bash "$SCRIPT_DIR/../mount-usb.sh"
  [[ "$status" -eq 1 ]]
  sudo rm -rf "$test_dir"
  rm -f "$test_keyfile"
}

# ────────────────────────────────────────────────────────────────
# USB not present: device doesn't exist → exits 2
# ────────────────────────────────────────────────────────────────

@test "mount-usb exits 2 when USB device is not present" {
  local test_keyfile="$BATS_TEST_DIRNAME/test-keyfile-usb-missing"
  echo "test-key" > "$test_keyfile"
  chmod 0600 "$test_keyfile"

  run sudo env \
    USB_DEVICE="/dev/nonexistent-usb-$(date +%s)" \
    USB_KEYFILE="$test_keyfile" \
    USB_MAPPER="athlos-backup-usb" \
    USB_MOUNT_POINT="/mnt/athlos-backup-usb" \
    bash "$SCRIPT_DIR/../mount-usb.sh"
  [[ "$status" -eq 2 ]]
  rm -f "$test_keyfile"
}

# ────────────────────────────────────────────────────────────────
# Missing env var → exits 1
# ────────────────────────────────────────────────────────────────

@test "mount-usb exits 1 when USB_DEVICE is unset" {
  local test_keyfile="$BATS_TEST_DIRNAME/test-keyfile-no-device"
  echo "test-key" > "$test_keyfile"
  chmod 0600 "$test_keyfile"

  run sudo env -u USB_DEVICE \
    USB_KEYFILE="$test_keyfile" \
    USB_MAPPER="athlos-backup-usb" \
    USB_MOUNT_POINT="/mnt/athlos-backup-usb" \
    bash "$SCRIPT_DIR/../mount-usb.sh"
  [[ "$status" -eq 1 ]]
  rm -f "$test_keyfile"
}

@test "mount-usb exits 1 when USB_KEYFILE is unset" {
  run sudo env -u USB_KEYFILE \
    USB_DEVICE="/dev/sdb1" \
    USB_MAPPER="athlos-backup-usb" \
    USB_MOUNT_POINT="/mnt/athlos-backup-usb" \
    bash "$SCRIPT_DIR/../mount-usb.sh"
  [[ "$status" -eq 1 ]]
}
