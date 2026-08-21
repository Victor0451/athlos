#!/usr/bin/env bash
# Server-owned forced command for the dedicated CI deploy key.
set -euo pipefail

readonly API_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-api@sha256:[0-9a-f]{64}$'
readonly WEB_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-web@sha256:[0-9a-f]{64}$'
readonly DEFAULT_DEPLOY_PATH='/srv/apps/athlos'
readonly DEFAULT_PM2_BIN='/home/vlongo/.local/bin/pm2'
readonly BETA_CONFIG_NAME='docker-compose.beta.yml'
readonly MAX_BETA_CONFIG_BYTES=1048576

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

read -r -a argv <<< "$command"
operation="${argv[0]:-}"
api_image="${argv[1]:-}"
web_image="${argv[2]:-}"
config_hash="${argv[3]:-}"
[[ "$operation" == preflight || "$operation" == deploy || "$operation" == preflight-beta || "$operation" == deploy-beta ]] || die 'unsupported operation'
[[ "${api_image:-}" =~ $API_IMAGE_PATTERN ]] || die 'immutable Athlos API GHCR digest required'
[[ "${web_image:-}" =~ $WEB_IMAGE_PATTERN ]] || die 'immutable Athlos web GHCR digest required'
is_beta=0
if [[ "$operation" == *-beta ]]; then
  is_beta=1
  [[ "${#argv[@]}" -eq 4 && "$config_hash" =~ ^[0-9a-f]{64}$ ]] || die 'beta requires one lowercase SHA-256 config hash'
  [[ "$command" == "$operation $api_image $web_image $config_hash" ]] || die 'unexpected command bytes'
else
  [[ "${#argv[@]}" -eq 3 ]] || die 'production rejects config arguments'
  [[ "$command" == "$operation $api_image $web_image" ]] || die 'unexpected command bytes'
fi

reject_production_input() {
  local probe
  probe="$(mktemp "${TMPDIR:-/tmp}/athlos-deploy-input.XXXXXX")"
  dd of="$probe" bs=1 count=1 status=none || true
  has_input=0
  [[ ! -s "$probe" ]] || has_input=1
  rm -f -- "$probe"
  [[ "$has_input" == 0 ]] || die 'production rejects config input'
}

read_beta_artifact() {
  local actual_size actual_hash
  beta_candidate="$(mktemp "$deploy_path/.docker-compose.beta.incoming.XXXXXX")" || die 'cannot create beta config temporary file'
  chmod 600 "$beta_candidate"
  dd of="$beta_candidate" bs=$((MAX_BETA_CONFIG_BYTES + 1)) count=1 status=none || true
  actual_size="$(wc -c < "$beta_candidate")"
  [[ "$actual_size" -le "$MAX_BETA_CONFIG_BYTES" ]] || die 'beta config payload exceeds size limit'
  extra_file="$(mktemp "$deploy_path/.docker-compose.beta.extra.XXXXXX")" || die 'cannot create beta EOF probe'
  chmod 600 "$extra_file"
  dd of="$extra_file" bs=1 count=1 status=none || true
  [[ ! -s "$extra_file" ]] || die 'beta config payload has trailing bytes'
  rm -f -- "$extra_file"
  extra_file=''
  actual_hash="$(sha256sum "$beta_candidate" | cut -d' ' -f1)"
  [[ "$actual_hash" == "$config_hash" ]] || die 'beta config SHA-256 mismatch'
}

validate_beta_policy() {
  local config_file="$1"
  grep -Eq '^[[:space:]]*- "3100:3000"$' "$config_file" || die 'beta policy requires web port 3100:3000'
  grep -Eq '^[[:space:]]*- "4100:3001"$' "$config_file" || die 'beta policy requires API port 4100:3001'
  grep -Fq '.env.beta' "$config_file" || die 'beta policy requires .env.beta'
  grep -Fq 'name: athlos_default' "$config_file" || die 'beta policy requires the shared database network'
  grep -Fq 'storage-beta:/app/storage' "$config_file" || die 'beta policy requires isolated storage'
  ! grep -Eq '"3000:3000"|"4000:3001"' "$config_file" || die 'beta policy rejects production ports'
}

preflight() {
  docker info >/dev/null || die 'docker daemon is unavailable'
  ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image" "${compose[@]}" config --quiet || die 'compose configuration is invalid'
  printf 'preflight ok api_image=%s web_image=%s\n' "$api_image" "$web_image"
}

command -v docker >/dev/null || die 'docker is unavailable'
command -v curl >/dev/null || die 'curl is unavailable'
[[ -d "$deploy_path" && -r "$deploy_path/docker-compose.yml" && -r "$deploy_path/$BETA_CONFIG_NAME" ]] || die 'deploy path is unavailable'
[[ ! -L "$deploy_path/$BETA_CONFIG_NAME" ]] || die 'beta Compose destination must not be a symlink'
cd "$deploy_path"
target=production
compose=(docker compose -f docker-compose.yml)
api_health_url='http://localhost:4000/health/ready'
web_health_url='http://localhost:3000/login'
api_container='athlos-api-1'
web_container='athlos-web-1'
beta_candidate=''
extra_file=''
beta_config="$deploy_path/$BETA_CONFIG_NAME"
rollback_candidate=''
installed=0
legacy_web_stopped=0
# shellcheck disable=SC2317,SC2329 # EXIT trap invokes this function indirectly.
on_exit() {
  local status=$?
  if [[ "$status" -ne 0 && "$installed" == 1 && -n "$rollback_candidate" ]]; then
    mv -f -- "$rollback_candidate" "$beta_config" || true
    rollback_candidate=''
    installed=0
  fi
  if [[ "$legacy_web_stopped" == 1 ]]; then
    "$pm2_bin" start /srv/config/athlos/ecosystem.config.js >/dev/null 2>&1 || true
  fi
  rm -f -- "$beta_candidate" "$extra_file" "$rollback_candidate"
  exit "$status"
}
trap on_exit EXIT
if [[ "$operation" == *-beta ]]; then
  target=beta
  read_beta_artifact
  validate_beta_policy "$beta_candidate"
  compose=(docker compose -p athlos-beta -f "$beta_candidate")
  api_health_url='http://localhost:4100/health/ready'
  web_health_url='http://localhost:3100/login'
  api_container='athlos-beta-api-1'
  web_container='athlos-beta-web-1'
elif [[ -f docker-compose.qa.yml ]]; then
  compose+=(-f docker-compose.qa.yml)
fi

if [[ "$is_beta" == 0 ]]; then
  reject_production_input
fi
preflight
[[ "$operation" == deploy || "$operation" == deploy-beta ]] || exit 0

if [[ "$is_beta" == 1 ]]; then
  if ! cmp -s "$beta_candidate" "$beta_config"; then
    rollback_candidate="$(mktemp "$deploy_path/.docker-compose.beta.rollback.XXXXXX")"
    chmod 600 "$rollback_candidate"
    cp -p -- "$beta_config" "$rollback_candidate"
    mv -f -- "$beta_candidate" "$beta_config"
    beta_candidate=''
    installed=1
  fi
  compose=(docker compose -p athlos-beta -f "$beta_config")
fi

export ATHLOS_API_IMAGE="$api_image" ATHLOS_WEB_IMAGE="$web_image"
"${compose[@]}" pull api web
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
