#!/usr/bin/env bash
# Server-owned forced command for the dedicated CI deploy key.
set -euo pipefail

readonly API_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-api@sha256:[0-9a-f]{64}$'
readonly WEB_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-web@sha256:[0-9a-f]{64}$'
readonly DEFAULT_DEPLOY_PATH='/srv/apps/athlos'
readonly DEFAULT_PM2_BIN='/home/vlongo/.local/bin/pm2'

die() {
  printf 'deploy gate refused: %s\n' "$1" >&2
  exit 1
}

if [[ -n "${ATHLOS_GATE_DEPLOY_PATH:-}" && "${ATHLOS_GATE_TEST_MODE:-}" != 1 ]]; then
  die 'deploy path override is test-only'
fi
if [[ -n "${ATHLOS_GATE_PM2_BIN:-}" && "${ATHLOS_GATE_TEST_MODE:-}" != 1 ]]; then
  die 'PM2 path override is test-only'
fi
deploy_path="${ATHLOS_GATE_DEPLOY_PATH:-$DEFAULT_DEPLOY_PATH}"
pm2_bin="${ATHLOS_GATE_PM2_BIN:-$DEFAULT_PM2_BIN}"

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  command="$SSH_ORIGINAL_COMMAND"
elif [[ "${ATHLOS_GATE_TEST_MODE:-}" == 1 ]]; then
  command="$*"
else
  die 'SSH_ORIGINAL_COMMAND is required'
fi

read -r operation api_image web_image extra <<< "$command"
[[ -z "${extra:-}" ]] || die 'unexpected arguments'
[[ "$operation" == preflight || "$operation" == deploy || "$operation" == preflight-beta || "$operation" == deploy-beta ]] || die 'unsupported operation'
[[ "${api_image:-}" =~ $API_IMAGE_PATTERN ]] || die 'immutable Athlos API GHCR digest required'
[[ "${web_image:-}" =~ $WEB_IMAGE_PATTERN ]] || die 'immutable Athlos web GHCR digest required'

preflight() {
  docker info >/dev/null || die 'docker daemon is unavailable'
  ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image" "${compose[@]}" config --quiet || die 'compose configuration is invalid'
  printf 'preflight ok api_image=%s web_image=%s\n' "$api_image" "$web_image"
}

command -v docker >/dev/null || die 'docker is unavailable'
command -v curl >/dev/null || die 'curl is unavailable'
[[ -d "$deploy_path" && -r "$deploy_path/docker-compose.yml" && -r "$deploy_path/docker-compose.beta.yml" ]] || die 'deploy path is unavailable'
cd "$deploy_path"
target=production
compose=(docker compose -f docker-compose.yml)
api_health_url='http://localhost:4000/health/ready'
web_health_url='http://localhost:3000/login'
api_container='athlos-api-1'
web_container='athlos-web-1'
if [[ "$operation" == *-beta ]]; then
  target=beta
  compose=(docker compose -p athlos-beta -f docker-compose.beta.yml)
  api_health_url='http://localhost:4100/health/ready'
  web_health_url='http://localhost:3100/login'
  api_container='athlos-beta-api-1'
  web_container='athlos-beta-web-1'
elif [[ -f docker-compose.qa.yml ]]; then
  compose+=(-f docker-compose.qa.yml)
fi

preflight
[[ "$operation" == deploy || "$operation" == deploy-beta ]] || exit 0

export ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image"
"${compose[@]}" pull api web
legacy_web_stopped=0
# shellcheck disable=SC2317,SC2329 # Function and body are invoked by the EXIT trap.
restore_legacy_web() {
  if [[ "$legacy_web_stopped" == 1 ]]; then
    "$pm2_bin" start /srv/config/athlos/ecosystem.config.js >/dev/null 2>&1 || true
  fi
}
trap restore_legacy_web EXIT
if [[ "$target" == production && -x "$pm2_bin" ]] && "$pm2_bin" stop athlos-web >/dev/null 2>&1; then
  legacy_web_stopped=1
fi
"${compose[@]}" up -d api web

for _ in {1..24}; do
  if curl --fail --silent --show-error "$api_health_url" >/dev/null && \
    curl --fail --silent --show-error "$web_health_url" >/dev/null; then
    running_api_image="$(docker inspect --format '{{.Config.Image}}' "$api_container")"
    running_web_image="$(docker inspect --format '{{.Config.Image}}' "$web_container")"
    [[ "$running_api_image" == "$api_image" ]] || die 'running API image does not match requested digest'
    [[ "$running_web_image" == "$web_image" ]] || die 'running web image does not match requested digest'
    if [[ "$target" == production && -x "$pm2_bin" ]]; then
      "$pm2_bin" delete athlos-web >/dev/null 2>&1 || true
      "$pm2_bin" save >/dev/null 2>&1 || true
    fi
    legacy_web_stopped=0
    trap - EXIT
    printf 'deploy ok api_image=%s web_image=%s\n' "$api_image" "$web_image"
    exit 0
  fi
  sleep 5
done

"${compose[@]}" logs --tail 200 api web >&2 || true
die 'readiness timeout'
