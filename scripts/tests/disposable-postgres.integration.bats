#!/usr/bin/env bats
# Real-Docker contract tests: every created fixture is removed by its exact ID/name.

setup() {
  root="$(cd -- "$BATS_TEST_DIRNAME/../.." && pwd -P)"
  lifecycle="$root/scripts/lib/disposable-postgres.sh"
  fixture_prefix="athlos-pr4-${BATS_TEST_NUMBER}-$$-${RANDOM}"
  fixture_containers=()
  fixture_volumes=()
  evidence="$BATS_TEST_TMPDIR/evidence"
  command -v docker >/dev/null || unavailable_docker
  docker info >/dev/null 2>&1 || unavailable_docker
  baseline="$(owned_inventory)"
}

unavailable_docker() {
  if [ "${ATHLOS_REQUIRE_DOCKER:-0}" = 1 ]; then
    echo 'Docker is required but unavailable' >&2
    return 1
  fi
  skip 'Docker unavailable; set ATHLOS_REQUIRE_DOCKER=1 to require this suite'
}

teardown() {
  local id volume
  for id in "${fixture_containers[@]}"; do docker rm -f "$id" >/dev/null 2>&1 || true; done
  for volume in "${fixture_volumes[@]}"; do docker volume rm "$volume" >/dev/null 2>&1 || true; done
  [ "$(owned_inventory)" = "$baseline" ]
}

owned_inventory() {
  {
    docker ps -a --filter label=com.athlos.repository=athlos \
      --filter label=com.athlos.lifecycle=disposable-postgres \
      --format 'container {{.ID}} {{.Names}}'
    docker volume ls --filter label=com.athlos.repository=athlos \
      --filter label=com.athlos.lifecycle=disposable-postgres --format 'volume {{.Name}}'
  } | LC_ALL=C sort
}

run_lifecycle() {
  local random=$1
  shift
  ATHLOS_DP_RANDOM="$random" ATHLOS_DP_READY_TIMEOUT="${ATHLOS_DP_READY_TIMEOUT:-15}" \
    "$lifecycle" run --caller integration-test -- "$@" 2>>"$evidence"
}

assert_baseline() { [ "$(owned_inventory)" = "$baseline" ]; }

create_fixture() {
  local kind=$1 name="$fixture_prefix-$1" volume="$fixture_prefix-$1-data" run_id=$1 machine
  shift 2 || true
  machine="$(printf 'fixture-machine' | sha256sum | awk '{print $1}')"
  if [ "$kind" = foreign-machine ]; then
    run_id=1000000000-999999-aaaaaaaaaaaaaaaa
    machine="$(printf 'foreign-machine' | sha256sum | awk '{print $1}')"
  fi
  local -a labels=(
    --label com.athlos.repository=athlos
    --label com.athlos.lifecycle=disposable-postgres
    --label "com.athlos.run=$run_id"
    --label com.athlos.caller=integration-test
    --label com.athlos.created-at=1000000000
    --label "com.athlos.owner-machine=$machine"
    --label com.athlos.owner-boot="$(printf 'fixture-boot' | sha256sum | awk '{print $1}')"
    --label com.athlos.owner-pid=999999
    --label com.athlos.owner-start=1
  )
  docker volume create "${labels[@]}" "$@" --name "$volume" >/dev/null
  docker create --name "$name" --mount "type=volume,src=$volume,dst=/var/lib/postgresql/data" \
    "${labels[@]}" "$@" postgres:16-alpine >/dev/null
  fixture_containers+=("$name")
  fixture_volumes+=("$volume")
}

@test "success and failing consumers preserve status and restore exact owned inventory" {
  run run_lifecycle 1111111111111111 bash -c 'exit 0'
  [ "$status" -eq 0 ]
  assert_baseline
  run run_lifecycle 2222222222222222 bash -c 'exit 23'
  [ "$status" -eq 23 ]
  assert_baseline
  grep -F '"event":"teardown"' "$evidence"
  grep -F '"event":"absence"' "$evidence"
}

@test "candidate timeout is bounded and a later retry waits for prior absence" {
  shim="$BATS_TEST_TMPDIR/timeout-bin"
  mkdir -p "$shim"
  real_docker="$(command -v docker)"
  cat >"$shim/docker" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = exec ]; then exit 1; fi
exec "$REAL_DOCKER" "$@"
SH
  chmod +x "$shim/docker"
  run env REAL_DOCKER="$real_docker" PATH="$shim:$PATH" ATHLOS_DP_RANDOM=3333333333333333 \
    ATHLOS_DP_READY_TIMEOUT=0 "$lifecycle" run --caller integration-test -- true 2>>"$evidence"
  [ "$status" -ne 0 ]
  grep -F '"event":"absence"' "$evidence"
  assert_baseline
  run run_lifecycle 4444444444444444 true
  [ "$status" -eq 0 ]
  assert_baseline
  run ! grep -Eq 'system[[:space:]]+prune|volume[[:space:]]+prune' "$lifecycle"
  [ "$status" -eq 0 ]
}

@test "partial docker start failure removes the exact real volume" {
  shim="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$shim"
  real_docker="$(command -v docker)"
  cat >"$shim/docker" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = run ]; then exit 42; fi
exec "$REAL_DOCKER" "$@"
SH
  chmod +x "$shim/docker"
  run env REAL_DOCKER="$real_docker" PATH="$shim:$PATH" ATHLOS_DP_RANDOM=5555555555555555 \
    "$lifecycle" run --caller integration-test -- true
  [ "$status" -ne 0 ]
  assert_baseline
}

@test "SIGKILL residue is recovered conservatively by a later owner" {
  old_boot='crashed-boot'
  # shellcheck disable=SC2016 # The child expands PPID to the lifecycle parent at runtime.
  ATHLOS_DP_BOOT_ID="$old_boot" ATHLOS_DP_RANDOM=6666666666666666 ATHLOS_DP_READY_TIMEOUT=15 \
    "$lifecycle" run --caller integration-test -- bash -c 'kill -KILL "$PPID"; sleep 1' >/dev/null 2>>"$evidence" &
  crashed_pid=$!
  wait "$crashed_pid" || [ "$?" -eq 137 ]
  [ "$(owned_inventory)" != "$baseline" ]
  run run_lifecycle 7777777777777777 true
  [ "$status" -eq 0 ]
  assert_baseline
  grep -F '"event":"stale-decision"' "$evidence"
}

@test "concurrent owners remain distinct and do not delete each other" {
  run_a=8888888888888888
  run_b=9999999999999999
  ATHLOS_DP_RANDOM="$run_a" "$lifecycle" run --caller integration-test -- bash -c 'sleep 2' 2>>"$evidence" &
  pid_a=$!
  ATHLOS_DP_RANDOM="$run_b" "$lifecycle" run --caller integration-test -- bash -c 'sleep 2' 2>>"$evidence" &
  pid_b=$!
  sleep 1
  active="$(owned_inventory)"
  [[ "$active" == *"$run_a"* ]]
  [[ "$active" == *"$run_b"* ]]
  wait "$pid_a"
  wait "$pid_b"
  assert_baseline
}

@test "excluded fixture inventories are byte-for-byte unchanged and cleanup is exact" {
  create_fixture production fixture-machine --label com.athlos.lifecycle=production
  create_fixture beta fixture-machine --label com.athlos.lifecycle=beta
  create_fixture persistent fixture-machine
  create_fixture foreign-machine foreign-machine
  unlabeled_volume="$fixture_prefix-unlabeled-data"
  docker volume create --name "$unlabeled_volume" >/dev/null
  unlabeled_container="$(docker create --name "$fixture_prefix-unlabeled" --mount "type=volume,src=$unlabeled_volume,dst=/var/lib/postgresql/data" postgres:16-alpine)"
  fixture_containers+=("$unlabeled_container")
  fixture_volumes+=("$unlabeled_volume")
  owned_with_fixtures="$(owned_inventory)"
  excluded_before=''
  for id in "${fixture_containers[@]}"; do excluded_before+="$(docker inspect "$id")"; done
  for volume in "${fixture_volumes[@]}"; do excluded_before+="$(docker volume inspect "$volume")"; done
  run run_lifecycle aaaaaaaaaaaaaaaa true
  [ "$status" -eq 0 ]
  excluded_after=''
  for id in "${fixture_containers[@]}"; do excluded_after+="$(docker inspect "$id")"; done
  for volume in "${fixture_volumes[@]}"; do excluded_after+="$(docker volume inspect "$volume")"; done
  [ "$excluded_after" = "$excluded_before" ]
  [ "$(owned_inventory)" = "$owned_with_fixtures" ]
}
