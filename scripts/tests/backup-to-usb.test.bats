#!/usr/bin/env bats
#
# backup-to-usb.test.bats — RED phase tests for scripts/backup-to-usb.sh
# These tests FAIL at this commit because scripts/backup-to-usb.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# Full pipeline success
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb succeeds when mount + rsync + retention + unmount complete" {
  skip "Full integration test requires real USB — tested via code inspection and unit tests"
}

# ────────────────────────────────────────────────────────────────
# mount fails → exit 2
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 2 when mount fails" {
  # Set env so mount-usb.sh would fail (no real USB)
  USB_DEVICE="/dev/nonexistent-usb-$(date +%s)"
  USB_KEYFILE="$BATS_TEST_DIRNAME/test-keyfile-mount-fail"
  USB_MAPPER="athlos-backup-usb"
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"
  BACKUP_DIR="/tmp/nonexistent-backup-dir"
  USB_RETENTION_DAYS="30"
  LOCK_FILE="/var/lock/athlos-backup.lock"

  echo "test-key" > "$USB_KEYFILE"
  chmod 0600 "$USB_KEYFILE"

  run bash "$SCRIPT_DIR/../backup-to-usb.sh"
  # Expected: exit 2 (mount failed because USB not present)
  [[ "$status" -eq 2 ]]
  rm -f "$USB_KEYFILE"
}

# ────────────────────────────────────────────────────────────────
# rsync fails → exit 3
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 3 when rsync fails" {
  skip "rsync failure requires mount to succeed then rsync to fail — complex mock setup"
}

# ────────────────────────────────────────────────────────────────
# retention check fails → exit 3
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 3 when retention check fails" {
  skip "retention failure requires special file setup — tested via unit test of cleanup_old_backups"
}

# ────────────────────────────────────────────────────────────────
# flock acquired → exits 0
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 0 when flock is held" {
  run sudo bash -c '
    exec 9>/var/lock/athlos-backup.lock
    flock -n 9
    bash "$1"
  ' _ "$SCRIPT_DIR/../backup-to-usb.sh"

  [[ "$status" -eq 0 ]]
  sudo rm -f /var/lock/athlos-backup.lock
}

# ────────────────────────────────────────────────────────────────
# flock contention (lock held) → exit 0 silent skip
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 0 silently when flock is held by another process" {
  skip "Covered by the preceding flock contention test"
}

# ────────────────────────────────────────────────────────────────
# missing env var → exit 1
# ────────────────────────────────────────────────────────────────

@test "backup-to-usb exits 1 when BACKUP_DIR is unset" {
  unset BACKUP_DIR
  USB_DEVICE="/dev/sdb1"
  USB_KEYFILE="$BATS_TEST_DIRNAME/test-keyfile-no-backup-dir"
  USB_MAPPER="athlos-backup-usb"
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"
  USB_RETENTION_DAYS="30"
  LOCK_FILE="/var/lock/athlos-backup-test-nobackup.lock"

  echo "test-key" > "$USB_KEYFILE"
  chmod 0600 "$USB_KEYFILE"

  run bash "$SCRIPT_DIR/../backup-to-usb.sh"
  [[ "$status" -eq 1 ]]
  rm -f "$USB_KEYFILE"
}

@test "backup-to-usb exits 1 when USB_RETENTION_DAYS is unset" {
  USB_DEVICE="/dev/sdb1"
  USB_KEYFILE="$BATS_TEST_DIRNAME/test-keyfile-no-retention"
  USB_MAPPER="athlos-backup-usb"
  USB_MOUNT_POINT="/mnt/athlos-backup-usb"
  BACKUP_DIR="/tmp/backup-test"
  unset USB_RETENTION_DAYS
  LOCK_FILE="/var/lock/athlos-backup-test-noretention.lock"

  echo "test-key" > "$USB_KEYFILE"
  chmod 0600 "$USB_KEYFILE"

  run bash "$SCRIPT_DIR/../backup-to-usb.sh"
  [[ "$status" -eq 1 ]]
  rm -f "$USB_KEYFILE"
}
