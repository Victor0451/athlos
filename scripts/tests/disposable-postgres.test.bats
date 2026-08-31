#!/usr/bin/env bats

setup() {
  workspace="$BATS_TEST_TMPDIR/workspace"
  mkdir -p "$workspace/bin"
  transcript="$workspace/docker.ndjson"
  cat >"$workspace/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(printf '%s\n' "$@" | jq -R . | jq -sc .)" >> "${FAKE_DOCKER_TRANSCRIPT:?}"
case "${1:-}" in
  volume)
    [ "${2:-}" = create ] && { [ "${FAKE_DOCKER_FAIL_VOLUME:-0}" = 1 ] && exit 41; printf 'volume-id\n'; exit 0; }
    [ "${2:-}" = rm ] && { [ "${FAKE_DOCKER_ABSENT_VOLUME:-0}" = 1 ] && exit 1; exit 0; }
    [ "${2:-}" = inspect ] && exit 1
    ;;
  container) [ "${2:-}" = inspect ] && { [ "${FAKE_DOCKER_PRESENT_CONTAINER:-0}" = 1 ] && exit 0; exit 1; } ;;
  run) [ "${FAKE_DOCKER_FAIL_RUN:-0}" = 1 ] && exit 42; printf 'container-id\n' ;;
  inspect) [ "${FAKE_DOCKER_FAIL_INSPECT:-0}" = 1 ] && exit 43; printf '["inspect-result","49152"]\n' >> "${FAKE_DOCKER_TRANSCRIPT:?}"; printf '49152\n' ;;
  exec) [ "${FAKE_DOCKER_FAIL_READY:-0}" = 1 ] && exit 1; exit 0 ;;
  rm) [ "${FAKE_DOCKER_ABSENT_CONTAINER:-0}" = 1 ] && exit 1; exit 0 ;;
esac
FAKE
  cat >"$workspace/bin/pnpm" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(printf '%s\n' "$@" | jq -R . | jq -sc .)" >> "${FAKE_PNPM_TRANSCRIPT:?}"
FAKE
  chmod +x "$workspace/bin/docker" "$workspace/bin/pnpm"
  export PATH="$workspace/bin:$PATH"
  export FAKE_DOCKER_TRANSCRIPT="$transcript"
  export FAKE_PNPM_TRANSCRIPT="$workspace/pnpm.ndjson"
  export ATHLOS_DP_CLOCK=1700000000
  export ATHLOS_DP_RANDOM=0123456789abcdef
  export ATHLOS_DP_PID=4242
  export ATHLOS_DP_MACHINE_ID=machine-fixture
  export ATHLOS_DP_BOOT_ID=boot-fixture
  export ATHLOS_DP_PROC_START=12345
  export ATHLOS_DP_READY_TIMEOUT=60
  library="$BATS_TEST_DIRNAME/../lib/disposable-postgres.sh"
  evidence="$workspace/evidence.ndjson"
}

invoke_lifecycle() {
  "$library" "$@" 2>"$evidence"
}

@test "creates deterministic labeled named storage and exposes only bounded lifecycle evidence" {
  run invoke_lifecycle run --caller recovery-test -- bash -c 'printf consumer-ran'

  [ "$status" -eq 0 ]
  [ "$output" = 'consumer-ran' ]
  run grep -F 'athlos-dp-pgdata-1700000000-4242-0123456789abcdef' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'athlos-dp-pg-1700000000-4242-0123456789abcdef' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.repository=athlos' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.lifecycle=disposable-postgres' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.run=1700000000-4242-0123456789abcdef' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.caller=recovery-test' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.created-at=1700000000' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.owner-machine=' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.owner-boot=' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.owner-pid=4242' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'com.athlos.owner-start=12345' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F 'PGDATA=/var/lib/postgresql/data' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '127.0.0.1::5432' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '["inspect","--format","{{(index (index .NetworkSettings.Ports \"5432/tcp\") 0).HostPort}}","athlos-dp-pg-1700000000-4242-0123456789abcdef"]' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '["inspect-result","49152"]' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '["exec","athlos-dp-pg-1700000000-4242-0123456789abcdef","pg_isready","-U","postgres","-h","127.0.0.1","-p","5432"]' "$transcript"
  [ "$status" -eq 0 ]
  run cat "$evidence"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"event":"identity"'* ]]
  [[ "$output" == *'"event":"created"'* ]]
  [[ "$output" != *'password'* ]]
}

@test "rejects unsafe callers and preserves hostile consumer argv literally" {
  run invoke_lifecycle run --caller 'bad caller' -- printf ignored
  [ "$status" -eq 2 ]
  [ ! -e "$transcript" ]

  # The hostile payload must remain literal to verify it is not evaluated.
  # shellcheck disable=SC2016
  hostile='argument with spaces;$(touch should-not-exist)'
  # The child-shell program intentionally receives a literal positional parameter reference.
  # shellcheck disable=SC2016
  run invoke_lifecycle run --caller recovery-test -- bash -c 'printf "%s" "$1"' -- "$hostile"
  [ "$status" -eq 0 ]
  [ "$output" = "$hostile" ]
  [ ! -e should-not-exist ]
}

@test "reconciles only created owned resources after docker failures and readiness timeout" {
  export FAKE_DOCKER_FAIL_RUN=1
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -ne 0 ]
  run grep -F '"volume"' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '"rm"' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '"athlos-dp-pgdata-1700000000-4242-0123456789abcdef"' "$transcript"
  [ "$status" -eq 0 ]
  run grep -Fq 'system"' "$transcript"
  [ "$status" -ne 0 ]

  : >"$transcript"
  unset FAKE_DOCKER_FAIL_RUN
  export FAKE_DOCKER_FAIL_READY=1 ATHLOS_DP_READY_TIMEOUT=0
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -ne 0 ]
  run grep -F '"athlos-dp-pg-1700000000-4242-0123456789abcdef"' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '"athlos-dp-pgdata-1700000000-4242-0123456789abcdef"' "$transcript"
  [ "$status" -eq 0 ]
}

@test "uses distinct deterministic names for sequential fixture identities" {
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  export ATHLOS_DP_RANDOM=fedcba9876543210
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F '1700000000-4242-0123456789abcdef' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '1700000000-4242-fedcba9876543210' "$transcript"
  [ "$status" -eq 0 ]
}

@test "awaits scoped container then volume teardown and preserves consumer status" {
  run invoke_lifecycle run --caller recovery-test -- bash -c 'exit 23'

  [ "$status" -eq 23 ]
  removals=$(grep -nE '^\["rm"|^\["volume","rm"' "$transcript")
  [[ "$removals" == *'["rm","-f","athlos-dp-pg-1700000000-4242-0123456789abcdef"]'* ]]
  [[ "$removals" == *'["volume","rm","athlos-dp-pgdata-1700000000-4242-0123456789abcdef"]'* ]]
  [ "$(printf '%s\n' "$removals" | sed -n '1p' | cut -d: -f2- | cut -c1-5)" = '["rm"' ]
  [ "$(printf '%s\n' "$removals" | sed -n '2p' | cut -d: -f2- | cut -c1-14)" = '["volume","rm"' ]
  run grep -F '"event":"teardown"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -F '"event":"absence"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -Fq 'system prune' "$transcript"
  [ "$status" -ne 0 ]
}

@test "returns cleanup failure after a successful consumer" {
  export FAKE_DOCKER_PRESENT_CONTAINER=1
  run invoke_lifecycle run --caller recovery-test -- true

  [ "$status" -ne 0 ]
  run grep -F '"event":"absence"' "$evidence"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"resource":"container","outcome":"present"'* ]]
}

@test "preserves timeout status and accepts absent teardown members idempotently" {
  run invoke_lifecycle run --caller recovery-test -- bash -c 'exit 124'
  [ "$status" -eq 124 ]

  export FAKE_DOCKER_ABSENT_CONTAINER=1 FAKE_DOCKER_ABSENT_VOLUME=1
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F '"event":"teardown"' "$evidence"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"outcome":"absent"'* ]]
}

@test "forwards package-script selectors to pnpm without shell evaluation" {
  root="$(cd -- "$BATS_TEST_DIRNAME/../.." && pwd -P)"
  # shellcheck disable=SC2016 # This is deliberately hostile literal argv.
  selector='db scope with spaces;$(touch should-not-exist)'
  script=$(jq -r '.scripts["test:disposable-postgres"]' "$root/package.json")
  run bash -c 'cd "$1" && bash -c "$2 \"\$1\"" bash "$3"' bash "$root" "$script" "$selector"

  [ "$status" -eq 0 ]
  # shellcheck disable=SC2016 # The expected transcript preserves the literal hostile argv.
  run grep -F '"--filter","@athlos/db","test:run","--","db scope with spaces;$(touch should-not-exist)"' "$FAKE_PNPM_TRANSCRIPT"
  [ "$status" -eq 0 ]
  [ ! -e "$root/should-not-exist" ]
}

@test "resolves the repository root and forwards spaced metacharacter argv from another cwd" {
  foreign_cwd="$workspace/elsewhere"
  mkdir -p "$foreign_cwd"
  # shellcheck disable=SC2016
  selector='scope with spaces;$(touch should-not-exist)'
  run bash -c 'cd "$1" && "$2" run --caller db-tests -- bash -c '\''printf "%s|%s|%s" "$ATHLOS_DP_REPOSITORY_ROOT" "$PWD" "$0"'\'' "$3"' bash "$foreign_cwd" "$library" "$selector"

  [ "$status" -eq 0 ]
  [[ "$output" == */Athlos-worktrees/docker-resource-lifecycle-pr2* ]]
  [[ "$output" == *"$foreign_cwd"* ]]
  [[ "$output" == *"$selector"* ]]
  [ ! -e "$foreign_cwd/should-not-exist" ]
}
