#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031,SC2155 # Bats test cases intentionally scope fixture exports.

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
    [ "${2:-}" = ls ] && { printf '%s\n' "${FAKE_DOCKER_STALE_VOLUME:-}"; exit 0; }
        [ "${2:-}" = inspect ] && {
          if [ "${3:-}" = --format ]; then
            labels=${FAKE_DOCKER_STALE_LABELS:-}
            if [ -n "${FAKE_DOCKER_LABEL_FILE:-}" ]; then
              name=${!#}; labels=$(awk -F '\t' -v name="$name" '$1 == name { print $2 }' "$FAKE_DOCKER_LABEL_FILE")
            fi
            printf '%s\n' "$labels"
          else [ "${FAKE_DOCKER_PRESENT_VOLUME:-0}" = 1 && exit 0; exit 1; fi
        }
    ;;
  container) [ "${2:-}" = inspect ] && { [ "${FAKE_DOCKER_PRESENT_CONTAINER:-0}" = 1 ] && exit 0; exit 1; } ;;
  ps) printf '%s\n' "${FAKE_DOCKER_STALE_CONTAINER:-}" ;;
  run) [ "${FAKE_DOCKER_FAIL_RUN:-0}" = 1 ] && exit 42; printf 'container-id\n' ;;
      inspect)
        [ "${FAKE_DOCKER_FAIL_INSPECT:-0}" = 1 ] && exit 43
        if [[ "${3:-}" == *'owner-start'* ]]; then
              labels=${FAKE_DOCKER_STALE_LABELS:-}
              if [ -n "${FAKE_DOCKER_LABEL_FILE:-}" ]; then
              name=${!#}; labels=$(awk -F '\t' -v name="$name" '$1 == name { print $2 }' "$FAKE_DOCKER_LABEL_FILE")
            fi
              printf '%s\n' "$labels"
        else
          printf '["inspect-result","49152"]\n' >> "${FAKE_DOCKER_TRANSCRIPT:?}"
          printf '49152\n'
        fi
        ;;
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

@test "recovers only a complete, old, same-machine dead run before creating its own resources" {
  stale_run='1699970000-99-fedcba9876543210'
  FAKE_DOCKER_STALE_CONTAINER="athlos-dp-pg-$stale_run"
  FAKE_DOCKER_STALE_VOLUME="athlos-dp-pgdata-$stale_run"
  FAKE_DOCKER_STALE_LABELS="athlos|disposable-postgres|$stale_run|recovery-test|1699970000|$(printf machine-fixture | sha256sum | awk '{print $1}')|$(printf different-boot | sha256sum | awk '{print $1}')|99|1"
  export FAKE_DOCKER_STALE_CONTAINER FAKE_DOCKER_STALE_VOLUME FAKE_DOCKER_STALE_LABELS

  run invoke_lifecycle run --caller recovery-test -- true

  [ "$status" -eq 0 ]
  run grep -F '["ps","-a","--filter","label=com.athlos.repository=athlos","--filter","label=com.athlos.lifecycle=disposable-postgres"' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F "athlos-dp-pg-$stale_run" "$transcript"
  [ "$status" -eq 0 ]
  run grep -F "athlos-dp-pgdata-$stale_run" "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '"event":"stale-decision"' "$evidence"
  [ "$status" -eq 0 ]
}

@test "stops before creation when stale recovery cannot confirm final absence" {
  stale_run='1699970000-99-fedcba9876543210'
  machine=$(printf machine-fixture | sha256sum | awk '{print $1}')
  stale_labels="athlos|disposable-postgres|$stale_run|recovery-test|1699970000|$machine|$(printf different-boot | sha256sum | awk '{print $1}')|99|1"
  export FAKE_DOCKER_STALE_CONTAINER="athlos-dp-pg-$stale_run"
  export FAKE_DOCKER_STALE_VOLUME="athlos-dp-pgdata-$stale_run"
  export FAKE_DOCKER_STALE_LABELS="$stale_labels"
  export FAKE_DOCKER_PRESENT_CONTAINER=1

  run invoke_lifecycle run --caller recovery-test -- true

  [ "$status" -ne 0 ]
  run grep -F '"event":"stale-decision"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -F '"resource":"container","outcome":"present"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -q '^\["volume","create"' "$transcript"
  [ "$status" -ne 0 ]
  run grep -q '^\["run"' "$transcript"
  [ "$status" -ne 0 ]
}

@test "protects live and foreign stale candidates without adopting their resources" {
  stale_run='1699970000-99-fedcba9876543210'
  FAKE_DOCKER_STALE_CONTAINER="athlos-dp-pg-$stale_run"
  FAKE_DOCKER_STALE_VOLUME="athlos-dp-pgdata-$stale_run"
  ATHLOS_DP_PROC_EVIDENCE=12345
  FAKE_DOCKER_STALE_LABELS="athlos|disposable-postgres|$stale_run|recovery-test|1699970000|$(printf machine-fixture | sha256sum | awk '{print $1}')|$(printf boot-fixture | sha256sum | awk '{print $1}')|4242|12345"
  export FAKE_DOCKER_STALE_CONTAINER FAKE_DOCKER_STALE_VOLUME ATHLOS_DP_PROC_EVIDENCE FAKE_DOCKER_STALE_LABELS

  run invoke_lifecycle run --caller recovery-test -- true

  [ "$status" -eq 0 ]
  run grep -F '"event":"stale-decision"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -F '"outcome":"active"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale_run\"" "$transcript"
  [ "$status" -ne 0 ]

  : >"$transcript"
  export FAKE_DOCKER_STALE_LABELS="athlos|disposable-postgres|$stale_run|recovery-test|1699970000|foreign-machine|$(printf different-boot | sha256sum | awk '{print $1}')|99|1"
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale_run\"" "$transcript"
  [ "$status" -ne 0 ]

  : >"$transcript"
  export ATHLOS_DP_PROC_EVIDENCE=''
  FAKE_DOCKER_STALE_LABELS="athlos|disposable-postgres|$stale_run|recovery-test|1699970000|$(printf machine-fixture | sha256sum | awk '{print $1}')|$(printf boot-fixture | sha256sum | awk '{print $1}')|4242|12345"
  export FAKE_DOCKER_STALE_LABELS
  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F '"outcome":"uncertain"' "$evidence"
  [ "$status" -eq 0 ]
  run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale_run\"" "$transcript"
  [ "$status" -ne 0 ]
}

@test "recovers a crash residue before creation while synchronized active and excluded owners remain isolated" {
  stale='1699970000-99-fedcba9876543210'
  active_a='1699970001-98-0123456789abcdef'
  active_b='1699970002-97-abcdef0123456789'
  machine=$(printf machine-fixture | sha256sum | awk '{print $1}')
  boot=$(printf boot-fixture | sha256sum | awk '{print $1}')
  labels="$workspace/labels.tsv"
  cat >"$labels" <<EOF
athlos-dp-pg-$stale	athlos|disposable-postgres|$stale|recovery-test|1699970000|$machine|$(printf crash-boot | sha256sum | awk '{print $1}')|99|1
athlos-dp-pgdata-$stale	athlos|disposable-postgres|$stale|recovery-test|1699970000|$machine|$(printf crash-boot | sha256sum | awk '{print $1}')|99|1
athlos-dp-pg-$active_a	athlos|disposable-postgres|$active_a|recovery-test|1699970001|$machine|$boot|4242|12345
athlos-dp-pgdata-$active_a	athlos|disposable-postgres|$active_a|recovery-test|1699970001|$machine|$boot|4242|12345
athlos-dp-pg-$active_b	athlos|disposable-postgres|$active_b|recovery-test|1699970002|$machine|$boot|4242|12345
athlos-dp-pgdata-$active_b	athlos|disposable-postgres|$active_b|recovery-test|1699970002|$machine|$boot|4242|12345
athlos-dp-pg-production	production|postgres|x|ops|1|$machine|$boot|1|1
athlos-dp-pg-beta	athlos|beta|x|ops|1|$machine|$boot|1|1
athlos-dp-pg-persistent	athlos|disposable-postgres|x|ops|1|$machine|$boot|1|1
EOF
  export FAKE_DOCKER_LABEL_FILE="$labels" ATHLOS_DP_PROC_EVIDENCE=12345
  export FAKE_DOCKER_STALE_CONTAINER="athlos-dp-pg-$stale
athlos-dp-pg-$active_a
athlos-dp-pg-$active_b
athlos-dp-pg-production
athlos-dp-pg-beta
athlos-dp-pg-persistent
unlabeled"
  export FAKE_DOCKER_STALE_VOLUME="athlos-dp-pgdata-$stale
athlos-dp-pgdata-$active_a
athlos-dp-pgdata-$active_b"

  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale\"" "$transcript"
  [ "$status" -eq 0 ]
  for run_id in "$active_a" "$active_b" production beta persistent; do
    run grep -Fq "[\"rm\",\"-f\",\"athlos-dp-pg-$run_id\"" "$transcript"
    [ "$status" -ne 0 ]
  done
  for run_id in "$active_a" "$active_b"; do
    run grep -Fq "[\"volume\",\"rm\",\"athlos-dp-pgdata-$run_id\"" "$transcript"
    [ "$status" -ne 0 ]
  done
  stale_rm=$(grep -n "^\[\"rm\",\"-f\",\"athlos-dp-pg-$stale\"" "$transcript" | cut -d: -f1)
  new_volume=$(grep -n '^\["volume","create"' "$transcript" | cut -d: -f1)
  [ "$stale_rm" -lt "$new_volume" ]
  run grep -F '"event":"stale-decision"' "$evidence"
  [ "$status" -eq 0 ]
}

@test "cleans up once and preserves SIGTERM exit status" {
  # shellcheck disable=SC2016 # The consumer shell must expand PPID at runtime.
  run invoke_lifecycle run --caller recovery-test -- bash -c 'kill -TERM "$PPID"; sleep 1'

  [ "$status" -eq 143 ]
  run grep -F '["rm","-f","athlos-dp-pg-1700000000-4242-0123456789abcdef"]' "$transcript"
  [ "$status" -eq 0 ]
  run grep -F '["volume","rm","athlos-dp-pgdata-1700000000-4242-0123456789abcdef"]' "$transcript"
  [ "$status" -eq 0 ]
}

@test "recovers only complete correlated old dead ownership and fails closed at the six-hour boundary" {
  stale_run='1699978399-99-fedcba9876543210'
  machine=$(printf machine-fixture | sha256sum | awk '{print $1}')
  boot=$(printf boot-fixture | sha256sum | awk '{print $1}')
  foreign_boot=$(printf different-boot | sha256sum | awk '{print $1}')
  complete="athlos|disposable-postgres|$stale_run|recovery-test|1699978399|$machine|$foreign_boot|99|1"
  export FAKE_DOCKER_STALE_CONTAINER="athlos-dp-pg-$stale_run"
  export FAKE_DOCKER_STALE_VOLUME="athlos-dp-pgdata-$stale_run"
  export FAKE_DOCKER_STALE_LABELS="$complete"

  run invoke_lifecycle run --caller recovery-test -- true
  [ "$status" -eq 0 ]
  run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale_run\"" "$transcript"
  [ "$status" -eq 0 ]
  run grep -F "[\"volume\",\"rm\",\"athlos-dp-pgdata-$stale_run\"" "$transcript"
  [ "$status" -eq 0 ]

  for invalid in \
    "athlos|disposable-postgres|${stale_run}|recovery-test|1699978400|$machine|$boot|99|1" \
    "athlos|disposable-postgres|${stale_run}|bad caller|1699978399|$machine|$boot|99|1" \
    "athlos|disposable-postgres|${stale_run}|recovery-test|bad|$machine|$boot|99|1" \
    "athlos|disposable-postgres|${stale_run}|recovery-test|1699978399|foreign-machine|$boot|99|1"; do
    : >"$transcript"
    export FAKE_DOCKER_STALE_LABELS="$invalid"
    run invoke_lifecycle run --caller recovery-test -- true
    [ "$status" -eq 0 ]
    run grep -F "[\"rm\",\"-f\",\"athlos-dp-pg-$stale_run\"" "$transcript"
    [ "$status" -ne 0 ]
  done
}

@test "preserves SIGINT after exact awaited cleanup without recursive trap cleanup" {
  # shellcheck disable=SC2016
  run invoke_lifecycle run --caller recovery-test -- bash -c 'kill -INT "$PPID"; sleep 1'

  [ "$status" -eq 130 ]
  removals=$(grep -nE '^\["rm"|^\["volume","rm"' "$transcript")
  [ "$(printf '%s\n' "$removals" | wc -l)" -eq 2 ]
  [[ "$removals" == *$'1:["rm"'* || "$removals" == *$'2:["rm"'* || "$removals" == *'["rm","-f"'* ]]
  [ "$(printf '%s\n' "$removals" | sed -n '1p' | cut -d: -f2- | cut -c1-5)" = '["rm"' ]
  [ "$(printf '%s\n' "$removals" | sed -n '2p' | cut -d: -f2- | cut -c1-14)" = '["volume","rm"' ]
  run grep -F '"event":"absence","owner":"athlos"' "$evidence"
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
  expected_root="$(cd -- "$(dirname -- "$library")/../.." && pwd -P)"
  actual_root_line=$(printf '%s\n' "$output" | grep -F "$expected_root|" || true)
  [[ "$actual_root_line" == "$expected_root|$foreign_cwd|$selector"* ]]
  [ ! -e "$foreign_cwd/should-not-exist" ]
}
