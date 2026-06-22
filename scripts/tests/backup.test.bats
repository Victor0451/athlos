#!/usr/bin/env bats
#
# backup.test.bats — RED phase tests for scripts/backup.sh
# These tests FAIL at this commit because scripts/backup.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# Fixture setup / teardown
# ────────────────────────────────────────────────────────────────

setup() {
  # Use a temp backup dir for all tests
  TEST_BACKUP_DIR="$(mktemp -d)"
  export BACKUP_DIR="$TEST_BACKUP_DIR"
  export BACKUP_RETENTION_DAYS=7
  # Point at the test Postgres (CI will have postgres service)
  export DATABASE_URL="${DATABASE_URL:-postgresql://athlos:athlos@localhost:5432/athlos}"
}

teardown() {
  rm -rf "${TEST_BACKUP_DIR:-}"
}

# ────────────────────────────────────────────────────────────────
# End-to-end backup: pg_dump + gzip produces a valid .sql.gz
# ────────────────────────────────────────────────────────────────

@test "successful backup produces a .sql.gz file" {
  # Skip if no real DATABASE_URL (local dev without postgres)
  [[ -n "${DATABASE_URL:-}" ]] || skip "DATABASE_URL not set"

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "
  assert_success "$status"

  # A backup file should exist in BACKUP_DIR
  local backup_file
  backup_file="$(ls "$TEST_BACKUP_DIR"/athlos-*.sql.gz 2>/dev/null | head -1)"
  [[ -n "$backup_file" ]]
  [[ -s "$backup_file" ]]
}

@test "backup output passes gunzip -t integrity check" {
  [[ -n "${DATABASE_URL:-}" ]] || skip "DATABASE_URL not set"

  # Generate a backup first
  bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "

  local backup_file
  backup_file="$(ls "$TEST_BACKUP_DIR"/athlos-*.sql.gz 2>/dev/null | head -1)"
  [[ -n "$backup_file" ]] || skip "No backup file found"

  # gunzip -t must exit 0 (valid gzip)
  run gunzip -t "$backup_file"
  assert_success "$status"
}

# ────────────────────────────────────────────────────────────────
# Missing env / dir — must exit non-zero
# ────────────────────────────────────────────────────────────────

@test "missing DATABASE_URL exits non-zero" {
  local saved_url="$DATABASE_URL"
  unset DATABASE_URL

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "

  # Script must refuse to run without DATABASE_URL
  assert_failure "$status"

  # Restore
  export DATABASE_URL="$saved_url"
}

@test "missing BACKUP_DIR (non-existent) exits non-zero" {
  BACKUP_DIR="/this/path/does/not/exist/$$"
  export BACKUP_DIR

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "

  assert_failure "$status"
}

# ────────────────────────────────────────────────────────────────
# Retention sweep — old files are deleted, recent files are kept
# ────────────────────────────────────────────────────────────────

@test "retention sweep deletes files older than BACKUP_RETENTION_DAYS" {
  # Pre-create an 8-day-old backup file
  local old_file="$TEST_BACKUP_DIR/athlos-2020-01-01-0300.sql.gz"
  # Create a minimal gzip (touch with content)
  echo "dummy" | gzip > "$old_file"
  touch -d "8 days ago" "$old_file"

  # Pre-create a recent backup file
  local recent_file="$TEST_BACKUP_DIR/athlos-$(date -u +%Y-%m-%d-%H%M).sql.gz"
  echo "dummy" | gzip > "$recent_file"

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "
  assert_success "$status"

  # Old file must be gone; recent file must remain
  [[ ! -f "$old_file" ]]
  [[ -f "$recent_file" ]]
}

@test "retention sweep keeps recent files" {
  # Create a fresh backup file
  local recent_file="$TEST_BACKUP_DIR/athlos-$(date -u +%Y-%m-%d-%H%M).sql.gz"
  echo "dummy" | gzip > "$recent_file"

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../backup.sh'
  "
  assert_success "$status"

  # Recent file must still exist
  [[ -f "$recent_file" ]]
}
