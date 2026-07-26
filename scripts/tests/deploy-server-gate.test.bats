#!/usr/bin/env bats

setup() {
  root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  gate="$root/scripts/deploy/server-gate.sh"
  temp="$(mktemp -d)"
  mkdir -p "$temp/bin" "$temp/deploy"
  touch "$temp/deploy/docker-compose.yml" "$temp/deploy/docker-compose.qa.yml" "$temp/deploy/docker-compose.beta.yml"
  export ATHLOS_GATE_TEST_MODE=1
  export ATHLOS_GATE_DEPLOY_PATH="$temp/deploy"
  export ATHLOS_GATE_PM2_BIN="$temp/bin/pm2"
  export PATH="$temp/bin:$PATH"
  export CALLS="$temp/calls"
  export DIGEST='ghcr.io/victor0451/athlos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  export WEB_DIGEST='ghcr.io/victor0451/athlos-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  cat > "$temp/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALLS"
if [[ "$1" == inspect ]]; then
  if [[ "${*: -1}" == *web-1 ]]; then printf '%s\n' "$WEB_DIGEST"; else printf '%s\n' "$DIGEST"; fi
fi
EOF
  cat > "$temp/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$CALLS"
[[ "${CURL_FAIL:-}" != 1 ]]
EOF
  cat > "$temp/bin/pm2" <<'EOF'
#!/usr/bin/env bash
printf 'pm2 %s\n' "$*" >> "$CALLS"
EOF
  cat > "$temp/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$temp/bin/docker" "$temp/bin/curl" "$temp/bin/pm2" "$temp/bin/sleep"
}

teardown() {
  rm -rf "$temp"
}

@test "rejects shells, mutable images, and extra arguments" {
  run "$gate" bash
  [ "$status" -eq 1 ]
  run "$gate" preflight ghcr.io/victor0451/athlos-api:latest "$WEB_DIGEST"
  [ "$status" -eq 1 ]
  run "$gate" preflight "$DIGEST" "$WEB_DIGEST" extra
  [ "$status" -eq 1 ]
  [ ! -e "$CALLS" ]
}

@test "preflight validates both compose files without deployment" {
  run "$gate" preflight "$DIGEST" "$WEB_DIGEST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"preflight ok"* ]]
  calls="$(<"$CALLS")"
  [[ "$calls" == *"docker info"* ]]
  [[ "$calls" == *"docker compose -f docker-compose.yml -f docker-compose.qa.yml config --quiet"* ]]
  [[ "$calls" != *" pull api"* ]]
  [[ "$calls" != *" up -d api"* ]]
}

@test "deploy pulls, starts, verifies readiness and exact digest" {
  run "$gate" deploy "$DIGEST" "$WEB_DIGEST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"deploy ok"* ]]
  calls="$(<"$CALLS")"
  [[ "$calls" == *" pull api web"* ]]
  [[ "$calls" == *" up -d api web"* ]]
  [[ "$calls" == *"curl --fail --silent --show-error http://localhost:4000/health/ready"* ]]
  [[ "$calls" == *"curl --fail --silent --show-error http://localhost:3000/login"* ]]
  [[ "$calls" == *"docker inspect --format {{.Config.Image}} athlos-api-1"* ]]
  [[ "$calls" == *"docker inspect --format {{.Config.Image}} athlos-web-1"* ]]
  [[ "$calls" == *"pm2 stop athlos-web"* ]]
  [[ "$calls" == *"pm2 delete athlos-web"* ]]
  [[ "$calls" == *"pm2 save"* ]]
}

@test "failed web readiness restores the legacy PM2 process" {
  run env CURL_FAIL=1 "$gate" deploy "$DIGEST" "$WEB_DIGEST"
  [ "$status" -eq 1 ]
  [[ "$output" == *"readiness timeout"* ]]
  calls="$(<"$CALLS")"
  [[ "$calls" == *"pm2 stop athlos-web"* ]]
  [[ "$calls" == *"pm2 start /srv/config/athlos/ecosystem.config.js"* ]]
  [[ "$calls" != *"pm2 delete athlos-web"* ]]
}

@test "beta deploy uses isolated project ports and containers without touching PM2" {
  run "$gate" deploy-beta "$DIGEST" "$WEB_DIGEST"
  [ "$status" -eq 0 ]
  calls="$(<"$CALLS")"
  [[ "$calls" == *"docker compose -p athlos-beta -f docker-compose.beta.yml pull api web"* ]]
  [[ "$calls" == *"http://localhost:4100/health/ready"* ]]
  [[ "$calls" == *"http://localhost:3100/login"* ]]
  [[ "$calls" == *"athlos-beta-api-1"* && "$calls" == *"athlos-beta-web-1"* ]]
  [[ "$calls" != *"pm2 "* ]]
}

@test "requires forced-command context outside test mode" {
  run env -u ATHLOS_GATE_TEST_MODE -u ATHLOS_GATE_DEPLOY_PATH -u ATHLOS_GATE_PM2_BIN "$gate" preflight "$DIGEST" "$WEB_DIGEST"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SSH_ORIGINAL_COMMAND is required"* ]]
}
