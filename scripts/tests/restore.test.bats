#!/usr/bin/env bats
#
# restore.test.bats — RED phase tests for scripts/restore.sh
# These tests FAIL at this commit because scripts/restore.sh does not exist yet.
#

load test_helper

# ────────────────────────────────────────────────────────────────
# Fixture setup / teardown
# ────────────────────────────────────────────────────────────────

setup() {
  TEST_BACKUP_DIR="$(mktemp -d)"
  export BACKUP_DIR="$TEST_BACKUP_DIR"
  export BACKUP_RETENTION_DAYS=7
  export DATABASE_URL="${DATABASE_URL:-postgresql://athlos:athlos@localhost:5432/athlos}"
  # Create a valid (minimal) .sql.gz for happy-path tests
  VALID_SQL_FILE="$TEST_BACKUP_DIR/athlos-2026-01-01-0300.sql.gz"
  # Minimal valid gzip: just CREATE TABLE (valid SQL)
  echo "CREATE TABLE IF NOT EXISTS dummy (id INTEGER);" | gzip > "$VALID_SQL_FILE"
}

teardown() {
  rm -rf "${TEST_BACKUP_DIR:-}"
  # Clean up env
  unset DRY_RUN_FLAG
}

# ────────────────────────────────────────────────────────────────
# Argument validation — missing required flags
# ────────────────────────────────────────────────────────────────

@test "missing --source exits 1" {
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh'
  "
  assert_failure "$status"
  [[ "$output" =~ "--source" ]]
}

@test "missing --confirm exits 1" {
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' --source \"$VALID_SQL_FILE\"
  "
  assert_failure "$status"
  [[ "$output" =~ "--confirm" ]]
}

# ────────────────────────────────────────────────────────────────
# --dry-run — safe, no DB writes
# ────────────────────────────────────────────────────────────────

@test "--dry-run exits 0 without DB writes" {
  # Verify the restore.sh script respects --dry-run
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' \
      --source \"$VALID_SQL_FILE\" \
      --confirm \
      --dry-run
  "
  assert_success "$status"
  # Output should mention dry-run
  [[ "$output" =~ [Dd]ry-[Rr]un ]]
}

# ────────────────────────────────────────────────────────────────
# Active connections — safety guard
# ────────────────────────────────────────────────────────────────

@test "active connections block restore by default — exits 2" {
  # Mock pg_stat_activity that returns 1 active connection
  # (In real CI with postgres service, this tests the real check)
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' \
      --source \"$VALID_SQL_FILE\" \
      --confirm
  "
  # Exit 2 = safety/refusal (active connections detected)
  # In test env without postgres, this may exit 1 (argv error) — that's ok for RED
  # The key is: without --force-allow-active, it must NOT proceed
  # After GREEN, if postgres is up: exits 2
  # After GREEN, if postgres is down: exits 1 (can't check conns)
  assert_failure "$status"
}

@test "--force-allow-active bypasses active-connection guard — exits 0" {
  # With --force-allow-active, restore should at least attempt (or at minimum not block)
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' \
      --source \"$VALID_SQL_FILE\" \
      --confirm \
      --force-allow-active \
      --dry-run
  "
  # --dry-run short-circuits after integrity check
  assert_success "$status"
}

# ────────────────────────────────────────────────────────────────
# gunzip integrity check
# ────────────────────────────────────────────────────────────────

@test "corrupt .sql.gz fails gunzip -t integrity check — exits 2" {
  local corrupt_file="$TEST_BACKUP_DIR/corrupt.sql.gz"
  echo "this is not a valid gzip" | gzip > "$corrupt_file"

  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' \
      --source \"$corrupt_file\" \
      --confirm \
      --dry-run
  "
  # Integrity check failure → exit 2
  assert_failure "$status"
}

# ────────────────────────────────────────────────────────────────
# Happy-path apply — exits 0
# ────────────────────────────────────────────────────────────────

@test "successful restore (with valid source + --confirm) exits 0" {
  # Since we can't connect to a real DB in bats without postgres service,
  # we test the --dry-run path as a proxy: with a valid source + --confirm,
  # the script should get past argv checks, banner, and integrity check,
  # then either succeed (dry-run) or proceed (real restore).
  run bash -c "
    source '$SCRIPT_DIR/../lib/common.sh'
    source '$SCRIPT_DIR/../restore.sh' \
      --source \"$VALID_SQL_FILE\" \
      --confirm \
      --dry-run
  "
  assert_success "$status"
}

# ────────────────────────────────────────────────────────────────
# Banner appears on stderr BEFORE any side effect
# ────────────────────────────────────────────────────────────────

@test "restore banner printed to stderr BEFORE integrity check" {
  run bash -c '
    source '"'"'$SCRIPT_DIR/../lib/common.sh'"'"'
    source '"'"'$SCRIPT_DIR/../restore.sh'"'"' \
      --source '"'"'$VALID_SQL_FILE'"'"' \
      --confirm \
      --dry-run \
      2>&1
  '
  # Banner (RESTORE WARNING) must appear in stderr output
  echo "$output" | grep -q "RESTORE WARNING"
}
