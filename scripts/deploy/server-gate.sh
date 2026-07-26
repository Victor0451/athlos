#!/usr/bin/env bash
# Server-owned forced command for the dedicated CI deploy key.
set -euo pipefail

readonly IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-api@sha256:[0-9a-f]{64}$'
readonly DEFAULT_DEPLOY_PATH='/srv/apps/athlos'
readonly HEALTH_URL='http://localhost:4000/health/ready'

die() {
  printf 'deploy gate refused: %s\n' "$1" >&2
  exit 1
}

if [[ -n "${ATHLOS_GATE_DEPLOY_PATH:-}" && "${ATHLOS_GATE_TEST_MODE:-}" != 1 ]]; then
  die 'deploy path override is test-only'
fi
deploy_path="${ATHLOS_GATE_DEPLOY_PATH:-$DEFAULT_DEPLOY_PATH}"

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  command="$SSH_ORIGINAL_COMMAND"
elif [[ "${ATHLOS_GATE_TEST_MODE:-}" == 1 ]]; then
  command="$*"
else
  die 'SSH_ORIGINAL_COMMAND is required'
fi

read -r operation image extra <<< "$command"
[[ -z "${extra:-}" ]] || die 'unexpected arguments'
[[ "$operation" == preflight || "$operation" == deploy ]] || die 'operation must be preflight or deploy'
[[ "${image:-}" =~ $IMAGE_PATTERN ]] || die 'immutable Athlos GHCR digest required'

preflight() {
  docker info >/dev/null || die 'docker daemon is unavailable'
  ATHLOS_API_IMAGE="$image" "${compose[@]}" config --quiet || die 'compose configuration is invalid'
  printf 'preflight ok image=%s\n' "$image"
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

export ATHLOS_API_IMAGE="$image"
"${compose[@]}" pull api
"${compose[@]}" up -d api

for _ in {1..24}; do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    running_image="$(docker inspect --format '{{.Config.Image}}' athlos-api-1)"
    [[ "$running_image" == "$image" ]] || die 'running image does not match requested digest'
    printf 'deploy ok image=%s\n' "$image"
    exit 0
  fi
  sleep 5
done

"${compose[@]}" logs --tail 200 api >&2 || true
die 'readiness timeout'
