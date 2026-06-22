#!/usr/bin/env bash
#
# restore.sh — Assisted database restore with --confirm safety gates
#
# Exit codes:
#   0 — success
#   1 — bad argv (missing --source or --confirm)
#   2 — safety/refusal (active connections, corrupt source, bad source path)
#   3 — psql apply failed
#
# Argv:
#   --source <path>         (required) Path to .sql.gz backup file
#   --confirm               (required) Explicit opt-in to overwrite live data
#   --target <connstring>   (optional) Defaults to $DATABASE_URL
#   --dry-run               (optional) Print plan, verify, exit 0 (no DB writes)
#   --force-allow-active    (optional) Bypass active-connection guard
#

set -euo pipefail

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/common.sh"

# ─── Argument parsing ────────────────────────────────────────────
SOURCE_FILE=""
TARGET_DB="${DATABASE_URL:-}"
DRY_RUN="no"
FORCE_ALLOW_ACTIVE="no"
CONFIRMED="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_FILE="$2"
      shift 2
      ;;
    --confirm)
      CONFIRMED="yes"
      shift
      ;;
    --target)
      TARGET_DB="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="yes"
      shift
      ;;
    --force-allow-active)
      FORCE_ALLOW_ACTIVE="yes"
      shift
      ;;
    *)
      echo "Usage: $0 --source <path> --confirm [--target <connstring>] [--dry-run] [--force-allow-active]" >&2
      exit 1
      ;;
  esac
done

# ─── Safety gate 1: --source required ────────────────────────────
if [[ -z "$SOURCE_FILE" ]]; then
  echo "ERROR: --source <path> is required" >&2
  exit 1
fi

# ─── Safety gate 2: --confirm required ─────────────────────────
if [[ "$CONFIRMED" != "yes" ]]; then
  echo "ERROR: --confirm is required to proceed with restore" >&2
  exit 1
fi

# ─── Safety gate 3: source must exist and end in .sql.gz ───────
if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "ERROR: source file '$SOURCE_FILE' does not exist" >&2
  exit 1
fi
if [[ ! "$SOURCE_FILE" =~ \.sql\.gz$ ]]; then
  echo "ERROR: source file '$SOURCE_FILE' must end in .sql.gz" >&2
  exit 1
fi

# ─── Extract target host for banner ─────────────────────────────
TARGET_HOST="$(printf '%s' "$TARGET_DB" | sed -E 's|.*@([^:/]+).*|\1|')"

# ─── Banner (printed to stderr BEFORE any side effect) ──────────
MODE_LABEL="APPLY"
if [[ "$DRY_RUN" == "yes" ]]; then
  MODE_LABEL="dry-run"
fi

cat >&2 <<EOF
╔════════════════════════════════════════════════════════════╗
║  RESTORE WARNING                                            ║
║  Target DB: $TARGET_HOST                                    ║
║  Source:    $SOURCE_FILE
║  Mode:      $MODE_LABEL                                       ║
║  This will OVERWRITE all data in the target database.       ║
║  --confirm was passed; proceeding.                          ║
╚════════════════════════════════════════════════════════════╝
EOF

# ─── Safety gate 4: gunzip -t integrity check ─────────────────
log INFO "Verifying backup integrity with gunzip -t"
if ! gunzip -t "$SOURCE_FILE" 2>/dev/null; then
  log ERROR "gunzip integrity check failed: $SOURCE_FILE is corrupt or not a valid gzip"
  exit 2
fi

# ─── Safety gate 5: active connection check ─────────────────────
if [[ "$FORCE_ALLOW_ACTIVE" != "yes" ]]; then
  log INFO "Checking for active connections on target DB"
  # Query returns count of active connections (excluding self)
  # If psql fails (no postgres), treat as 0 connections
  ACTIVE_CONN_COUNT="$(psql "$TARGET_DB" -t -c "
    SELECT count(*)
    FROM pg_stat_activity
    WHERE state = 'active'
      AND pid <> pg_backend_pid()
  " 2>/dev/null | tr -d '[:space:]')" || ACTIVE_CONN_COUNT="0"

  if [[ "$ACTIVE_CONN_COUNT" -gt 0 ]]; then
    log ERROR "Refusing restore: $ACTIVE_CONN_COUNT active connection(s) detected on target DB"
    log ERROR "Use --force-allow-active to bypass this safety check"
    exit 2
  fi
fi

# ─── Dry-run short-circuit ──────────────────────────────────────
if [[ "$DRY_RUN" == "yes" ]]; then
  log INFO "dry-run: integrity check passed, exiting before any DB write"
  exit 0
fi

# ─── Apply restore ─────────────────────────────────────────────
log INFO "Applying restore from $SOURCE_FILE to $TARGET_DB"

if ! gunzip -c "$SOURCE_FILE" | psql "$TARGET_DB" --set ON_ERROR_STOP=on; then
  log ERROR "psql restore failed; database may be in a partial state"
  exit 3
fi

log INFO "Restore complete: $SOURCE_FILE -> $TARGET_DB"
exit 0
