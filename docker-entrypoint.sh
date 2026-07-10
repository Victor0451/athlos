#!/usr/bin/env bash
# docker-entrypoint.sh — runs before the API process in the container.
#
# Responsibilities:
# 1. Wait for Postgres to be ready (pg_isready loop, max 60s).
# 2. If BACKUP_BEFORE_MIGRATE=true, run scripts/backup.sh to $BACKUP_DIR.
#    Exits with code 2 on backup failure (compose will restart unless-stopped).
# 3. If RUN_MIGRATIONS=true, run pnpm --filter @athlos/db migrate.
#    Exits with code 3 on migration failure.
# 4. exec "$@" — replaces the shell, so Node becomes PID 1 and receives
#    SIGTERM directly from Docker stop (graceful shutdown via Fastify).

set -euo pipefail

# Permit image smoke/debug commands to run without a database. The normal
# production command still follows the readiness and migration flow below.
if [ "${1:-}" = "node" ]; then
  exec "$@"
fi

# Source shared helpers (mirror B1a/B1b scripts/lib/common.sh pattern)
# shellcheck source=scripts/lib/common.sh
source /app/scripts/lib/common.sh

log INFO "Entrypoint: waiting for database at ${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}..."
ready=0
for i in $(seq 1 60); do
  if pg_isready -h "${POSTGRES_HOST:-db}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-athlos}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  log INFO "Database not ready, attempt $i/60 — sleeping 1s..."
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  log_error "Database not ready after 60s. Aborting."
  exit 4
fi

log INFO "Database is ready."

# Optional pre-migration backup
if [ "${BACKUP_BEFORE_MIGRATE:-false}" = "true" ]; then
  log INFO "BACKUP_BEFORE_MIGRATE=true — running backup.sh..."
  if ! /app/scripts/backup.sh; then
    log_error "Backup failed. Aborting migration."
    exit 2
  fi
  log INFO "Backup complete."
fi

# Optional migration
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  log INFO "RUN_MIGRATIONS=true — running migrations..."
  if ! pnpm --filter @athlos/db migrate; then
    log_error "Migration failed."
    exit 3
  fi
  log INFO "Migrations complete."
fi

log INFO "Starting API: $*"
exec "$@"
