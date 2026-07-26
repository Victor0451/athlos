#!/usr/bin/env bats

setup() {
  root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  gate="$root/scripts/deploy/server-gate.sh"
  temp="$(mktemp -d)"
  mkdir -p "$temp/bin" "$temp/deploy"
  touch "$temp/deploy/docker-compose.yml" "$temp/deploy/docker-compose.qa.yml"
  export ATHLOS_GATE_TEST_MODE=1
  export ATHLOS_GATE_DEPLOY_PATH="$temp/deploy"
  export PATH="$temp/bin:$PATH"
  export CALLS="$temp/calls"
  export DIGEST='ghcr.io/victor0451/athlos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  cat > "$temp/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALLS"
if [[ "$1" == inspect ]]; then
  printf '%s\n' "$DIGEST"
fi
EOF
  cat > "$temp/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$CALLS"
EOF
  cat > "$temp/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$temp/bin/docker" "$temp/bin/curl" "$temp/bin/sleep"
}

teardown() {
  rm -rf "$temp"
}

@test "rejects shells, mutable images, and extra arguments" {
  run "$gate" bash
  [ "$status" -eq 1 ]
  run "$gate" preflight ghcr.io/victor0451/athlos-api:latest
  [ "$status" -eq 1 ]
  run "$gate" preflight "$DIGEST" extra
  [ "$status" -eq 1 ]
  [ ! -e "$CALLS" ]
}

@test "preflight validates both compose files without deployment" {
  run "$gate" preflight "$DIGEST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"preflight ok"* ]]
  calls="$(<"$CALLS")"
  [[ "$calls" == *"docker info"* ]]
  [[ "$calls" == *"docker compose -f docker-compose.yml -f docker-compose.qa.yml config --quiet"* ]]
  [[ "$calls" != *" pull api"* ]]
  [[ "$calls" != *" up -d api"* ]]
}

@test "deploy pulls, starts, verifies readiness and exact digest" {
  run "$gate" deploy "$DIGEST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"deploy ok"* ]]
  calls="$(<"$CALLS")"
  [[ "$calls" == *" pull api"* ]]
  [[ "$calls" == *" up -d api"* ]]
  [[ "$calls" == *"curl --fail --silent --show-error http://localhost:4000/health/ready"* ]]
  [[ "$calls" == *"docker inspect --format {{.Config.Image}} athlos-api-1"* ]]
}

@test "requires forced-command context outside test mode" {
  run env -u ATHLOS_GATE_TEST_MODE -u ATHLOS_GATE_DEPLOY_PATH "$gate" preflight "$DIGEST"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SSH_ORIGINAL_COMMAND is required"* ]]
}
