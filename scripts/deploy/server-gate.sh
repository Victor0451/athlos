#!/usr/bin/env bash
# Server-owned forced command for the dedicated CI deploy key.
set -euo pipefail

readonly API_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-api@sha256:[0-9a-f]{64}$'
readonly WEB_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-web@sha256:[0-9a-f]{64}$'
readonly DEFAULT_DEPLOY_PATH='/srv/apps/athlos'
readonly API_HEALTH_URL='http://localhost:4000/health/ready'
readonly WEB_HEALTH_URL='http://localhost:3000/login'
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
[[ "$operation" == preflight || "$operation" == deploy ]] || die 'operation must be preflight or deploy'
[[ "${api_image:-}" =~ $API_IMAGE_PATTERN ]] || die 'immutable Athlos API GHCR digest required'
[[ "${web_image:-}" =~ $WEB_IMAGE_PATTERN ]] || die 'immutable Athlos web GHCR digest required'

preflight() {
  docker info >/dev/null || die 'docker daemon is unavailable'
  ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image" "${compose[@]}" config --quiet || die 'compose configuration is invalid'
  printf 'preflight ok api_image=%s web_image=%s\n' "$api_image" "$web_image"
}

command -v docker >/dev/null || die 'docker is unavailable'
command -v curl >/dev/null || die 'curl is unavailable'
[[ -d "$deploy_path" && -r "$deploy_path/docker-compose.yml" ]] || die 'deploy path is unavailable'
cd "$deploy_path"
compose=(docker compose -f docker-compose.yml)
if [[ -f docker-compose.qa.yml ]]; then
  compose+=(-f docker-compose.qa.yml)
fi

preflight
[[ "$operation" == deploy ]] || exit 0

export ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image"
"${compose[@]}" pull api web
legacy_web_stopped=0
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
restore_legacy_web() {
  if [[ "$legacy_web_stopped" == 1 ]]; then
    "$pm2_bin" start /srv/config/athlos/ecosystem.config.js >/dev/null 2>&1 || true
  fi
}
trap restore_legacy_web EXIT
if [[ -x "$pm2_bin" ]] && "$pm2_bin" stop athlos-web >/dev/null 2>&1; then
  legacy_web_stopped=1
fi
"${compose[@]}" up -d api web

for _ in {1..24}; do
  if curl --fail --silent --show-error "$API_HEALTH_URL" >/dev/null && \
    curl --fail --silent --show-error "$WEB_HEALTH_URL" >/dev/null; then
    running_api_image="$(docker inspect --format '{{.Config.Image}}' athlos-api-1)"
    running_web_image="$(docker inspect --format '{{.Config.Image}}' athlos-web-1)"
    [[ "$running_api_image" == "$api_image" ]] || die 'running API image does not match requested digest'
    [[ "$running_web_image" == "$web_image" ]] || die 'running web image does not match requested digest'
    if [[ -x "$pm2_bin" ]]; then
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
