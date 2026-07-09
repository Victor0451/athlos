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
# log_info / log_warn / log_error
#
# Level-tagged shortcuts around `log LEVEL`. Mirror the convention used
# in docker-entrypoint.sh (which calls log_error directly); the longer
# `log ERROR "..."` form still works everywhere else.
# ─────────────────────────────────────────────────────────────────────────────
log_info() {
  log INFO "$*"
}

log_warn() {
  log WARN "$*"
}

log_error() {
  log ERROR "$*"
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

# ─────────────────────────────────────────────────────────────────────────────
# require_root
#
# Exits 1 if the current EUID is not 0 (root).
# ─────────────────────────────────────────────────────────────────────────────
require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "must run as root (EUID=${EUID:-$(id -u)})"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# is_mounted PATH
#
# Returns 0 (success) if PATH is a mount point, non-zero otherwise.
# Uses /proc/mounts for reliable detection.
# ─────────────────────────────────────────────────────────────────────────────
is_mounted() {
  local path="$1"
  [[ -d "$path" ]] || return 1
  mountpoint -q "$path"
}

# ─────────────────────────────────────────────────────────────────────────────
# is_luks_open MAPPER
#
# Returns 0 (success) if the LUKS mapper is currently open in /dev/mapper/,
# non-zero otherwise.
# ─────────────────────────────────────────────────────────────────────────────
is_luks_open() {
  local mapper="$1"
  cryptsetup status "$mapper" >/dev/null 2>&1
}
