#!/usr/bin/env bats
#
# common.test.bats — RED phase tests for scripts/lib/common.sh
# These tests FAIL at this commit because scripts/lib/common.sh does not exist yet.
#

load test_helper

# bats-core requires this marker for library loading
export ATHLOS_COMMON_LOADED

# ────────────────────────────────────────────────────────────────
# require_env — exits non-zero on missing env var
# ────────────────────────────────────────────────────────────────

@test "require_env exits non-zero when var is unset" {
  unset DATABASE_URL
  run require_env DATABASE_URL
  assert_failure "$status"
}

@test "require_env exits non-zero when var is empty" {
  DATABASE_URL=""
  run require_env DATABASE_URL
  assert_failure "$status"
}

@test "require_env succeeds when var is set and non-empty" {
  DATABASE_URL="postgresql://user:pass@localhost:5432/db"
  run require_env DATABASE_URL
  assert_success "$status"
}

# ────────────────────────────────────────────────────────────────
# require_cmd — exits non-zero when command is not found
# ────────────────────────────────────────────────────────────────

@test "require_cmd exits non-zero when command does not exist" {
  run require_cmd this_command_does_not_exist_xyz
  assert_failure "$status"
}

@test "require_cmd succeeds when command is in PATH" {
  run require_cmd ls
  assert_success "$status"
}

# ────────────────────────────────────────────────────────────────
# get_timestamp — returns ISO-8601 format YYYY-MM-DD-HHMM
# ────────────────────────────────────────────────────────────────

@test "get_timestamp returns UTC ISO-8601 format" {
  run get_timestamp
  assert_success "$status"
  # Regex: YYYY-MM-DD-HHMM (24-hour, no separators except dashes)
  [[ "$output" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$ ]]
}

# ────────────────────────────────────────────────────────────────
# log — writes to stderr, not stdout
# ────────────────────────────────────────────────────────────────

@test "log writes to stderr not stdout" {
  run bash -c 'log INFO "test message" 2>&1'
  # stdout should be empty (output is empty or just whitespace)
  [[ -z "$(echo "$output" | tr -d '[:space:]')" ]]
}

@test "log writes a line containing the level tag" {
  run bash -c 'log ERROR "something broke" 2>&1'
  echo "$output" | grep -q "ERROR"
}

# ────────────────────────────────────────────────────────────────
# log_error / log_info / log_warn — level-tagged shortcuts for log
# (required by docker-entrypoint.sh, which calls them directly)
# ────────────────────────────────────────────────────────────────

@test "log_error writes a line containing the ERROR tag" {
  run log_error "database not ready"
  echo "$output" | grep -q "ERROR"
  echo "$output" | grep -q "database not ready"
}

@test "log_info writes a line containing the INFO tag" {
  run log_info "starting up"
  echo "$output" | grep -q "INFO"
  echo "$output" | grep -q "starting up"
}

@test "log_warn writes a line containing the WARN tag" {
  run log_warn "deprecated path"
  echo "$output" | grep -q "WARN"
  echo "$output" | grep -q "deprecated path"
}

@test "log_error writes to stderr not stdout" {
  # stderr should contain the message; stdout should NOT (output is
  # empty or whitespace because bats captures stderr separately)
  run log_error "boom"
  echo "$output" | grep -q "boom"
}

# ────────────────────────────────────────────────────────────────
# cleanup_old_backups — deletes files older than N days
# ────────────────────────────────────────────────────────────────

@test "cleanup_old_backups deletes files older than N days" {
  # Create a temp dir and two files: one 8 days old, one 1 day old
  local tmpdir
  tmpdir="$(mktemp -d)"
  touch -d "8 days ago" "$tmpdir/athlos-old.sql.gz"
  touch -d "1 day ago" "$tmpdir/athlos-recent.sql.gz"

  run cleanup_old_backups "$tmpdir" 7
  assert_success "$status"

  # Old file should be gone, recent file should remain
  [[ ! -f "$tmpdir/athlos-old.sql.gz" ]]
  [[ -f "$tmpdir/athlos-recent.sql.gz" ]]

  rm -rf "$tmpdir"
}

@test "cleanup_old_backups is idempotent when dir does not exist" {
  run cleanup_old_backups "/nonexistent/path/$(date +%s)" 7
  assert_success "$status"
}

@test "cleanup_old_backups only matches athlos-*.sql.gz files" {
  local tmpdir
  tmpdir="$(mktemp -d)"
  touch -d "8 days ago" "$tmpdir/athlos-old.sql.gz"
  touch -d "8 days ago" "$tmpdir/other-file.txt"   # should NOT be deleted
  touch -d "8 days ago" "$tmpdir/athlos-old.zip"   # should NOT be deleted (wrong extension)

  run cleanup_old_backups "$tmpdir" 7
  assert_success "$status"

  [[ ! -f "$tmpdir/athlos-old.sql.gz" ]]
  [[ -f "$tmpdir/other-file.txt" ]]
  [[ -f "$tmpdir/athlos-old.zip" ]]

  rm -rf "$tmpdir"
}

# ────────────────────────────────────────────────────────────────
# ATHLOS_COMMON_LOADED marker under bats
# ────────────────────────────────────────────────────────────────

@test "common.sh sets ATHLOS_COMMON_LOADED=1 under bats" {
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/../lib/common.sh"
  [[ "$ATHLOS_COMMON_LOADED" == "1" ]]
}

# ────────────────────────────────────────────────────────────────
# require_root — exits non-zero if not running as root
# ────────────────────────────────────────────────────────────────

@test "require_root exits non-zero when EUID != 0" {
  run bash -c '
    id() { echo 9999; }
    export -f id
    source "$SCRIPT_DIR/../lib/common.sh"
    require_root
  '
  [[ "$status" -ne 0 ]]
}

@test "require_root succeeds when EUID == 0" {
  run bash -c '
    id() { echo 0; }
    export -f id
    source "$SCRIPT_DIR/../lib/common.sh"
    require_root
  '
  [[ "$status" -eq 0 ]]
}

# ────────────────────────────────────────────────────────────────
# is_mounted — returns true (0) if given path is a mount point
# ────────────────────────────────────────────────────────────────

@test "is_mounted returns true for / (root mount)" {
  run is_mounted "/"
  [[ "$status" -eq 0 ]]
}

@test "is_mounted returns false for /nonexistent/mount/point" {
  run is_mounted "/nonexistent/mount/point/$(date +%s)"
  [[ "$status" -ne 0 ]]
}

# ────────────────────────────────────────────────────────────────
# is_luks_open — returns true (0) if given mapper is open in /dev/mapper/
# ────────────────────────────────────────────────────────────────

@test "is_luks_open returns false for nonexistent mapper" {
  run is_luks_open "nonexistent-mapper-$(date +%s)"
  [[ "$status" -ne 0 ]]
}
