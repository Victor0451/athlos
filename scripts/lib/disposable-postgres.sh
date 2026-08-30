#!/usr/bin/env bash
set -euo pipefail

readonly ATHLOS_DP_OWNER='athlos'
readonly ATHLOS_DP_LIFECYCLE='disposable-postgres'
readonly ATHLOS_DP_IMAGE='postgres:16-alpine'

clock() { printf '%s' "${ATHLOS_DP_CLOCK:-$(date +%s)}"; }
random_hex() { printf '%s' "${ATHLOS_DP_RANDOM:-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')}"; }
process_id() { printf '%s' "${ATHLOS_DP_PID:-$$}"; }
machine_id() { printf '%s' "${ATHLOS_DP_MACHINE_ID:-$(cat /etc/machine-id)}"; }
boot_id() { printf '%s' "${ATHLOS_DP_BOOT_ID:-$(cat /proc/sys/kernel/random/boot_id)}"; }
proc_start() { printf '%s' "${ATHLOS_DP_PROC_START:-$(awk '{print $22}' /proc/$$/stat)}"; }
hash() { printf '%s' "$1" | sha256sum | awk '{print $1}'; }

emit() {
  local event=$1 resource=$2 outcome=$3
  printf '{"event":"%s","owner":"%s","run":"%s","resource":"%s","outcome":"%s"}\n' \
    "$event" "$ATHLOS_DP_OWNER" "$run" "$resource" "$outcome" >&2
}

cleanup_partial() {
  [ -z "${container_name:-}" ] || docker rm -f "$container_name" >/dev/null 2>&1 || true
  [ -z "${volume_name:-}" ] || docker volume rm "$volume_name" >/dev/null 2>&1 || true
}

validate_caller() {
  [[ $1 =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]
}

run_lifecycle() {
  local caller=$1
  shift
  local epoch pid random machine boot start
  epoch=$(clock)
  pid=$(process_id)
  random=$(random_hex)
  [[ $epoch =~ ^[0-9]+$ && $pid =~ ^[0-9]+$ && $random =~ ^[0-9a-f]{16}$ ]] || {
    printf 'invalid lifecycle fixture identity\n' >&2
    return 2
  }
  run="$epoch-$pid-$random"
  volume_name="athlos-dp-pgdata-$run"
  container_name="athlos-dp-pg-$run"
  machine=$(hash "$(machine_id)")
  boot=$(hash "$(boot_id)")
  start=$(proc_start)
  local -a labels=(
    --label "com.athlos.repository=$ATHLOS_DP_OWNER"
    --label "com.athlos.lifecycle=$ATHLOS_DP_LIFECYCLE"
    --label "com.athlos.run=$run"
    --label "com.athlos.caller=$caller"
    --label "com.athlos.created-at=$epoch"
    --label "com.athlos.owner-machine=$machine"
    --label "com.athlos.owner-boot=$boot"
    --label "com.athlos.owner-pid=$pid"
    --label "com.athlos.owner-start=$start"
  )
  emit identity lifecycle created
  docker volume create "${labels[@]}" --name "$volume_name" >/dev/null || return 1
  emit created volume created
  if ! docker run --detach --name "$container_name" "${labels[@]}" \
    --publish '127.0.0.1::5432' --mount "type=volume,src=$volume_name,dst=/var/lib/postgresql/data" \
    --env 'PGDATA=/var/lib/postgresql/data' --env 'POSTGRES_HOST_AUTH_METHOD=trust' "$ATHLOS_DP_IMAGE" >/dev/null; then
    cleanup_partial
    return 1
  fi
  emit created container created
  local port deadline
  # shellcheck disable=SC2034 # Records the host endpoint allocated for the consumer.
  port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container_name") || {
    cleanup_partial
    return 1
  }
  deadline=$((epoch + ${ATHLOS_DP_READY_TIMEOUT:-60}))
  while ! docker exec "$container_name" pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; do
    if [ "$(clock)" -ge "$deadline" ]; then
      cleanup_partial
      return 1
    fi
    sleep 1
  done
  emit created endpoint created
  "$@"
}

main() {
  [ "${1:-}" = run ] || {
    printf 'usage: disposable-postgres.sh run --caller SLUG -- COMMAND [ARG...]\n' >&2
    return 2
  }
  shift
  [ "${1:-}" = --caller ] && [ $# -ge 4 ] && [ "${3:-}" = -- ] || {
    printf 'usage: disposable-postgres.sh run --caller SLUG -- COMMAND [ARG...]\n' >&2
    return 2
  }
  validate_caller "$2" || {
    printf 'invalid caller slug\n' >&2
    return 2
  }
  local caller=$2
  shift 3
  run_lifecycle "$caller" "$@"
}

run=''
volume_name=''
container_name=''
main "$@"
