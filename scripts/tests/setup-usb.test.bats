#!/usr/bin/env bats
#
# setup-usb.test.bats — RED phase tests for scripts/setup-usb.sh
# These tests FAIL at this commit because scripts/setup-usb.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# --help prints usage and exits 0
# ────────────────────────────────────────────────────────────────

@test "setup-usb --help prints usage and exits 0" {
  run bash "$SCRIPT_DIR/../setup-usb.sh" --help
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"setup-usb.sh"* ]]
}

# ────────────────────────────────────────────────────────────────
# --dry-run prints plan without formatting, exits 0
# ────────────────────────────────────────────────────────────────

@test "setup-usb --dry-run prints plan without formatting" {
  skip "Requires root and real device — skip in CI"
}

# ────────────────────────────────────────────────────────────────
# Missing required args → exit 1
# ────────────────────────────────────────────────────────────────

@test "setup-usb exits 1 when --device is missing" {
  run bash "$SCRIPT_DIR/../setup-usb.sh"
  [[ "$status" -eq 1 ]]
}

# ────────────────────────────────────────────────────────────────
# --device not present → exit 2
# ────────────────────────────────────────────────────────────────

@test "setup-usb exits 2 when --device does not exist" {
  run bash "$SCRIPT_DIR/../setup-usb.sh" --device "/dev/nonexistent-usb-device-$(date +%s)" --dry-run
  [[ "$status" -eq 2 ]]
}
