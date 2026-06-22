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
