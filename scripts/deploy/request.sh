#!/usr/bin/env bash
# Request the server-owned restricted deployment gate. This client never opens a shell.
set -euo pipefail

readonly API_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-api@sha256:[0-9a-f]{64}$'
readonly WEB_IMAGE_PATTERN='^ghcr\.io/victor0451/athlos-web@sha256:[0-9a-f]{64}$'
readonly DEPLOY_HOST_PIN='100.78.95.34'
readonly DEPLOY_PORT_PIN='2244'
readonly DEPLOY_USER_PIN='vlongo'
readonly DEPLOY_PATH_PIN='/srv/apps/athlos'
REPOSITORY_ROOT=''
REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPOSITORY_ROOT
readonly BETA_COMPOSE_PATH="$REPOSITORY_ROOT/docker-compose.beta.yml"

die() {
  printf 'deploy request refused: %s\n' "$1" >&2
  exit 1
}

require_fixed() {
  local name="$1" expected="$2" actual="${!1:-$2}"
  [[ "$actual" == "$expected" ]] || die "$name must be $expected"
}

validate_image() {
  [[ "${ATHLOS_API_IMAGE:-}" =~ $API_IMAGE_PATTERN ]] || die 'ATHLOS_API_IMAGE must be an immutable Athlos API GHCR digest'
  [[ "${ATHLOS_WEB_IMAGE:-}" =~ $WEB_IMAGE_PATTERN ]] || die 'ATHLOS_WEB_IMAGE must be an immutable Athlos web GHCR digest'
}

validate_coordinates() {
  require_fixed DEPLOY_HOST "$DEPLOY_HOST_PIN"
  require_fixed DEPLOY_PORT "$DEPLOY_PORT_PIN"
  require_fixed DEPLOY_USER "$DEPLOY_USER_PIN"
  require_fixed DEPLOY_PATH "$DEPLOY_PATH_PIN"
}

validate_ssh_prerequisites() {
  [[ -n "${DEPLOY_SSH_KEY_FILE:-}" && -r "$DEPLOY_SSH_KEY_FILE" ]] || die 'DEPLOY_SSH_KEY_FILE must name a readable restricted key'
  [[ -n "${DEPLOY_KNOWN_HOSTS_FILE:-}" && -r "$DEPLOY_KNOWN_HOSTS_FILE" ]] || die 'DEPLOY_KNOWN_HOSTS_FILE must name a readable pinned host file'
  grep -Fq "[$DEPLOY_HOST_PIN]:$DEPLOY_PORT_PIN " "$DEPLOY_KNOWN_HOSTS_FILE" || die 'DEPLOY_KNOWN_HOSTS_FILE does not pin the deployment host'
}

validate_beta_artifact() {
  local artifact_path="${ATHLOS_BETA_COMPOSE_FILE:-$BETA_COMPOSE_PATH}"
  [[ "$artifact_path" == "$BETA_COMPOSE_PATH" ]] || die 'beta Compose source must be the allowlisted repository path'
  [[ -f "$artifact_path" && ! -L "$artifact_path" && -r "$artifact_path" ]] || die 'beta Compose source must be a readable regular file'
  printf '%s\n' "$artifact_path"
}

ssh_request() {
  local command="$1" input_file="${2:-/dev/null}"
  ssh \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS_FILE" \
    -o GlobalKnownHostsFile=/dev/null \
    -o IdentitiesOnly=yes \
    -i "$DEPLOY_SSH_KEY_FILE" \
    -p "$DEPLOY_PORT_PIN" \
    -T "$DEPLOY_USER_PIN@$DEPLOY_HOST_PIN" \
    "$command" < "$input_file"
}

request() {
  local operation="$1" artifact_path='' snapshot='' hash='' status
  if [[ "$operation" == *-beta ]]; then
    artifact_path="$(validate_beta_artifact)"
    snapshot="$(mktemp "${TMPDIR:-/tmp}/athlos-beta-compose.XXXXXX")"
    chmod 600 "$snapshot"
    cp -- "$artifact_path" "$snapshot"
    hash="$(sha256sum "$snapshot" | cut -d' ' -f1)"
    if ssh_request "$operation $ATHLOS_API_IMAGE $ATHLOS_WEB_IMAGE $hash" "$snapshot"; then
      status=0
    else
      status=$?
    fi
    rm -f -- "$snapshot"
    return "$status"
  fi
  ssh_request "$operation $ATHLOS_API_IMAGE $ATHLOS_WEB_IMAGE"
}

dry_run=false
if [[ "${1:-}" == '--dry-run' ]]; then
  dry_run=true
  shift
fi

operation="${1:-}"
[[ $# -eq 1 && ( "$operation" == preflight || "$operation" == deploy || "$operation" == preflight-beta || "$operation" == deploy-beta ) ]] || die 'usage: request.sh [--dry-run] <preflight|deploy|preflight-beta|deploy-beta>'
validate_image
validate_coordinates
if [[ "$operation" == *-beta ]]; then
  validate_beta_artifact >/dev/null
fi

if "$dry_run"; then
  printf 'dry-run operation=%s host=%s port=%s user=%s api_image=%s web_image=%s ssh_key=<redacted> tailscale=<redacted>\n' \
    "$operation" "$DEPLOY_HOST_PIN" "$DEPLOY_PORT_PIN" "$DEPLOY_USER_PIN" "$ATHLOS_API_IMAGE" "$ATHLOS_WEB_IMAGE"
  exit 0
fi

validate_ssh_prerequisites
preflight_operation=preflight
[[ "$operation" == *-beta ]] && preflight_operation=preflight-beta
if ! request "$preflight_operation"; then
  die 'preflight rejected the restricted SSH credential or connectivity'
fi
if [[ "$operation" == deploy || "$operation" == deploy-beta ]]; then
  request "$operation"
fi
