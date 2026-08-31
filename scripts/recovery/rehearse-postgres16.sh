#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
nonce="$(openssl rand -hex 16)"

# shellcheck disable=SC2016 # The lifecycle executes this literal consumer script in a child Bash process.
"$root/scripts/lib/disposable-postgres.sh" run --caller recovery-rehearsal -- bash -c '
  root=$1
  nonce=$2
  docker exec "$ATHLOS_DP_CONTAINER_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE recovery;" >/dev/null
  docker exec "$ATHLOS_DP_CONTAINER_NAME" psql -U postgres -d recovery -v ON_ERROR_STOP=1 \
    -c "CREATE TABLE audit_events (id bigint PRIMARY KEY); INSERT INTO audit_events VALUES (1);" >/dev/null
  docker exec "$ATHLOS_DP_CONTAINER_NAME" psql -U postgres -d recovery -v ON_ERROR_STOP=1 \
    -c "CREATE TABLE recovery_clone_attestation (nonce text PRIMARY KEY); INSERT INTO recovery_clone_attestation VALUES ('\''$nonce'\'');" >/dev/null
  RECOVERY_TARGET=ephemeral-clone RECOVERY_APPROVAL_REF=postgres16 RECOVERY_CLONE_NONCE="$nonce" \
    DATABASE_URL="${ATHLOS_TEST_DATABASE_URL%/postgres}/recovery" \
    "$root/scripts/recovery/rehearse.sh" --sql "$root/packages/db/recovery/0001_auth_scheduler.sql"
' bash "$root" "$nonce"
