#!/usr/bin/env bash
#
# backup.sh — Daily pg_dump + gzip backup with inline retention sweep
#
# Exit codes:
#   0 — success
#   1 — missing env (DATABASE_URL, BACKUP_DIR) or bad argv
#   2 — safety gate refused (reserved for future use)
#   3 — pg_dump or gzip failed (partial file removed before exit)
#
# Env vars (required):
#   DATABASE_URL         — Postgres connection string
#   BACKUP_DIR           — Local backup directory
#   BACKUP_RETENTION_DAYS — Days to retain backups (default: 7)
#
# Output: $BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz
#

set -euo pipefail

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/common.sh"

# ─── Validate environment ───────────────────────────────────────
require_env DATABASE_URL
require_env BACKUP_DIR

# Validate BACKUP_DIR exists and is writable
if [[ ! -d "$BACKUP_DIR" ]]; then
  die "BACKUP_DIR '$BACKUP_DIR' does not exist or is not a directory"
fi
if [[ ! -w "$BACKUP_DIR" ]]; then
  die "BACKUP_DIR '$BACKUP_DIR' is not writable"
fi

# Validate required commands
require_cmd pg_dump
require_cmd gzip
require_cmd gunzip

# Retention days (default 7)
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

# ─── Generate timestamped filename ──────────────────────────────
TIMESTAMP="$(get_timestamp)"
DEST="$BACKUP_DIR/athlos-$TIMESTAMP.sql.gz"

log INFO "Starting backup: DATABASE_URL=<hidden> -> $DEST"

# ─── pg_dump + gzip pipeline ─────────────────────────────────────
# --format=plain       — plain SQL text (not custom pg_dump format)
# --no-owner           — skip OWNER commands
# --no-acl            — skip GRANT/REVOKE commands
# --lock-wait-timeout=30s — abort if table lock held >30s (not --single-transaction
#                          which blocks ALL writes for the entire dump duration)
#
# Using pipefail so a pg_dump failure (non-zero exit) causes the pipeline to fail
# before gzip finishes writing a partial file.
set -o pipefail

if ! pg_dump \
    --format=plain \
    --no-owner \
    --no-acl \
    --lock-wait-timeout=30s \
    "$DATABASE_URL" | gzip > "$DEST"; then
  # pg_dump failed — remove any partial file to avoid corrupt backups
  rm -f "$DEST"
  log ERROR "pg_dump failed; backup aborted"
  exit 3
fi

# Restore pipefail to default (redundant but explicit)
set +o pipefail

# ─── Integrity check ─────────────────────────────────────────────
log INFO "Verifying backup integrity with gunzip -t"
if ! gunzip -t "$DEST"; then
  rm -f "$DEST"
  log ERROR "gunzip integrity check failed; backup removed"
  exit 3
fi

# ─── Retention sweep ────────────────────────────────────────────
log INFO "Running retention sweep: deleting backups older than $RETENTION_DAYS days"
cleanup_old_backups "$BACKUP_DIR" "$RETENTION_DAYS"

log INFO "Backup complete: $DEST"
exit 0
