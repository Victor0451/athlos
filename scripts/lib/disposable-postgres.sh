#!/usr/bin/env bash
set -euo pipefail

readonly ATHLOS_DP_OWNER='athlos'
readonly ATHLOS_DP_LIFECYCLE='disposable-postgres'
readonly ATHLOS_DP_IMAGE='postgres:16-alpine'
ATHLOS_DP_REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly ATHLOS_DP_REPOSITORY_ROOT
export ATHLOS_DP_REPOSITORY_ROOT

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

teardown() {
  [ "${cleanup_done:-0}" = 1 ] && return 0
  cleanup_done=1
  local failed=0 outcome
  if [ -n "${container_name:-}" ]; then
    if docker rm -f "$container_name" >/dev/null 2>&1; then outcome=removed; else outcome=absent; fi
    emit teardown container "$outcome"
  fi
  if [ -n "${volume_name:-}" ]; then
    if docker volume rm "$volume_name" >/dev/null 2>&1; then outcome=removed; else outcome=absent; fi
    emit teardown volume "$outcome"
  fi
  if [ -n "${container_name:-}" ]; then
    if docker container inspect "$container_name" >/dev/null 2>&1; then
      emit absence container present
      failed=1
    else emit absence container absent; fi
  fi
  if [ -n "${volume_name:-}" ]; then
    if docker volume inspect "$volume_name" >/dev/null 2>&1; then
      emit absence volume present
      failed=1
    else emit absence volume absent; fi
  fi
  return "$failed"
}

owner_labels() {
  docker inspect --format '{{index .Config.Labels "com.athlos.repository"}}|{{index .Config.Labels "com.athlos.lifecycle"}}|{{index .Config.Labels "com.athlos.run"}}|{{index .Config.Labels "com.athlos.caller"}}|{{index .Config.Labels "com.athlos.created-at"}}|{{index .Config.Labels "com.athlos.owner-machine"}}|{{index .Config.Labels "com.athlos.owner-boot"}}|{{index .Config.Labels "com.athlos.owner-pid"}}|{{index .Config.Labels "com.athlos.owner-start"}}' "$1"
}

volume_owner_labels() {
  docker volume inspect --format '{{index .Labels "com.athlos.repository"}}|{{index .Labels "com.athlos.lifecycle"}}|{{index .Labels "com.athlos.run"}}|{{index .Labels "com.athlos.caller"}}|{{index .Labels "com.athlos.created-at"}}|{{index .Labels "com.athlos.owner-machine"}}|{{index .Labels "com.athlos.owner-boot"}}|{{index .Labels "com.athlos.owner-pid"}}|{{index .Labels "com.athlos.owner-start"}}' "$1"
}

owner_is_dead() {
  local pid=$1 start=$2 observed
  if [ -n "${ATHLOS_DP_PROC_EVIDENCE+x}" ]; then observed=${ATHLOS_DP_PROC_EVIDENCE:-}; else observed=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null) || return 2; fi
  [ -n "$observed" ] || return 2
  [ "$observed" != "$start" ]
}

recover_stale() {
  local current_machine current_boot candidate labels volume_labels repository lifecycle stale_run caller created machine boot pid start stale_container stale_volume
  current_machine=$(hash "$(machine_id)")
  current_boot=$(hash "$(boot_id)")
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    labels=$(owner_labels "$candidate" 2>/dev/null) || continue
    IFS='|' read -r repository lifecycle stale_run caller created machine boot pid start <<<"$labels"
    [[ $repository = "$ATHLOS_DP_OWNER" && $lifecycle = "$ATHLOS_DP_LIFECYCLE" ]] || continue
    validate_caller "$caller" || continue
    [[ $stale_run =~ ^[0-9]+-[0-9]+-[0-9a-f]{16}$ && $created =~ ^[0-9]+$ && $machine =~ ^[0-9a-f]{64}$ && $boot =~ ^[0-9a-f]{64}$ && $pid =~ ^[0-9]+$ && $start =~ ^[0-9]+$ ]] || continue
    stale_container="athlos-dp-pg-$stale_run"
    stale_volume="athlos-dp-pgdata-$stale_run"
    [ "$candidate" = "$stale_container" ] || continue
    docker volume ls --filter "label=com.athlos.repository=$ATHLOS_DP_OWNER" --filter "label=com.athlos.lifecycle=$ATHLOS_DP_LIFECYCLE" --format '{{.Name}}' | grep -Fx "$stale_volume" >/dev/null || continue
    volume_labels=$(volume_owner_labels "$stale_volume" 2>/dev/null) || continue
    [ "$volume_labels" = "$labels" ] || continue
    [ "$machine" = "$current_machine" ] || {
      run=$stale_run
      emit stale-decision lifecycle uncertain
      continue
    }
    [ "$(clock)" -gt $((created + 21600)) ] || {
      run=$stale_run
      emit stale-decision lifecycle uncertain
      continue
    }
    if [ "$boot" != "$current_boot" ]; then
      run=$stale_run container_name=$stale_container volume_name=$stale_volume cleanup_done=0
      emit stale-decision lifecycle stale
      teardown || return $?
    elif owner_is_dead "$pid" "$start"; then
      run=$stale_run container_name=$stale_container volume_name=$stale_volume cleanup_done=0
      emit stale-decision lifecycle stale
      teardown || return $?
    elif [ "$?" -eq 1 ]; then
      run=$stale_run
      emit stale-decision lifecycle active
    else
      run=$stale_run
      emit stale-decision lifecycle uncertain
    fi
  done < <(docker ps -a --filter "label=com.athlos.repository=$ATHLOS_DP_OWNER" --filter "label=com.athlos.lifecycle=$ATHLOS_DP_LIFECYCLE" --format '{{.Names}}' 2>/dev/null || true)
}

on_signal() {
  local code=$1
  trap - EXIT INT TERM
  teardown || true
  exit "$code"
}

validate_caller() {
  [[ $1 =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]
}

run_lifecycle() {
  local caller=$1
  shift
  local epoch pid random machine boot start
  recover_stale || return $?
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
  cleanup_done=0
  trap 'teardown >/dev/null || true' EXIT
  trap 'on_signal 130' INT
  trap 'on_signal 143' TERM
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
    teardown || true
    return 1
  fi
  emit created container created
  local port deadline
  # shellcheck disable=SC2034 # Records the host endpoint allocated for the consumer.
  port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container_name") || {
    teardown || true
    return 1
  }
  deadline=$((epoch + ${ATHLOS_DP_READY_TIMEOUT:-60}))
  while ! docker exec "$container_name" pg_isready -U postgres -h 127.0.0.1 -p 5432 >/dev/null 2>&1; do
    if [ "$(clock)" -ge "$deadline" ]; then
      teardown || true
      return 1
    fi
    sleep 1
  done
  emit created endpoint created
  local consumer_status cleanup_status
  if ATHLOS_DP_CONTAINER_NAME="$container_name" \
    ATHLOS_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$port/postgres" "$@"; then
    consumer_status=0
  else
    consumer_status=$?
  fi
  if teardown; then cleanup_status=0; else cleanup_status=$?; fi
  trap - EXIT
  if [ "$consumer_status" -eq 0 ]; then return "$cleanup_status"; fi
  return "$consumer_status"
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
