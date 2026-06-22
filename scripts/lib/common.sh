#!/usr/bin/env bash
#
# common.sh — shared bash helpers for backup.sh and restore.sh
#
# Exit codes:
#   0 — success
#   1 — general error (missing env, missing command, bad argv)
#   2 — safety gate refused (e.g., active connections)
#   3 — operation failed (e.g., pg_dump, psql)
#
# When sourced under bats (BATS_TEST_DIRNAME set), exports ATHLOS_COMMON_LOADED=1
# so tests can assert the library was loaded.
#

set -euo pipefail

# Mark loaded under bats
if [[ -n "${BATS_TEST_DIRNAME:-}" ]]; then
  export ATHLOS_COMMON_LOADED=1
fi

# ─────────────────────────────────────────────────────────────────────────────
# log LEVEL MSG...
#
# Writes a timestamped log line to stderr.
# LEVEL: INFO | WARN | ERROR
# ─────────────────────────────────────────────────────────────────────────────
log() {
  local level="$1"
  shift
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] [$level] $msg" >&2
}

# ─────────────────────────────────────────────────────────────────────────────
# die MSG...
#
# Logs ERROR and exits with code 1.
# ─────────────────────────────────────────────────────────────────────────────
die() {
  log ERROR "$*"
  exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# require_env VAR
#
# Exits 1 if $VAR is unset or empty.
# ─────────────────────────────────────────────────────────────────────────────
require_env() {
  local var_name="$1"
  local val
  # Indirect expansion — intentionally unquoted to catch empty-string too
  # shellcheck disable=SC2086
  val=${!var_name}
  if [[ -z "$val" ]]; then
    die "$var_name is required but is unset or empty"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# require_cmd CMD
#
# Exits 1 if CMD is not found in PATH.
# ─────────────────────────────────────────────────────────────────────────────
require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die "required command '$cmd' not found in PATH"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# get_timestamp
#
# Echoes UTC timestamp in YYYY-MM-DD-HHMM format (sortable, human-readable).
# ─────────────────────────────────────────────────────────────────────────────
get_timestamp() {
  date -u +%Y-%m-%d-%H%M
}

# ─────────────────────────────────────────────────────────────────────────────
# cleanup_old_backups DIR DAYS
#
# Deletes athlos-*.sql.gz files older than DAYS days in DIR.
# Idempotent: if DIR does not exist, returns 0 without error.
# ─────────────────────────────────────────────────────────────────────────────
cleanup_old_backups() {
  local dir="$1"
  local days="$2"

  # Idempotent: no dir = nothing to clean
  [[ -d "$dir" ]] || return 0

  # Only match our backup naming pattern — be conservative
  find "$dir" -maxdepth 1 -name 'athlos-*.sql.gz' -mtime "+$days" -delete
}
