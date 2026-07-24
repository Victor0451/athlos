#!/usr/bin/env bash
set -euo pipefail

name="athlos-recovery-${RANDOM}"
nonce="$(openssl rand -hex 16)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$name" -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=recovery postgres:16-alpine >/dev/null
ready=false
for _ in {1..60}; do
  if docker logs "$name" 2>&1 | grep -q 'PostgreSQL init process complete; ready for start up.' && \
    docker exec "$name" pg_isready -U postgres -d recovery >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || { printf 'PostgreSQL 16 rehearsal did not become ready\n' >&2; exit 2; }
docker exec "$name" psql -U postgres -d recovery -v ON_ERROR_STOP=1 -c 'CREATE TABLE audit_events (id bigint PRIMARY KEY); INSERT INTO audit_events VALUES (1);' >/dev/null
docker exec "$name" psql -U postgres -d recovery -v ON_ERROR_STOP=1 -c "CREATE TABLE recovery_clone_attestation (nonce text PRIMARY KEY); INSERT INTO recovery_clone_attestation VALUES ('$nonce');" >/dev/null
RECOVERY_TARGET=ephemeral-clone RECOVERY_APPROVAL_REF=postgres16 RECOVERY_CLONE_NONCE="$nonce" DATABASE_URL="postgresql://postgres:rehearsal@127.0.0.1:55432/recovery" \
  ./scripts/recovery/rehearse.sh --sql packages/db/recovery/0001_auth_scheduler.sql
