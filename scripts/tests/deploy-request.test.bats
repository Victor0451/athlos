#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031 # Bats runs each test in a subshell by design.

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REQUEST="$ROOT/scripts/deploy/request.sh"
  DIGEST="ghcr.io/victor0451/athlos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  WEB_DIGEST="ghcr.io/victor0451/athlos-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  TMPDIR="$(mktemp -d)"
  KEY="$TMPDIR/deploy-key"
  KNOWN_HOSTS="$TMPDIR/known_hosts"
  CAPTURE="$TMPDIR/ssh.argv"
  FAKE_BIN="$TMPDIR/bin"
  mkdir -p "$FAKE_BIN"
  printf 'private-key\n' > "$KEY"
  chmod 600 "$KEY"
  printf '[100.78.95.34]:2244 ssh-ed25519 pinned-host-key\n' > "$KNOWN_HOSTS"
  cat > "$FAKE_BIN/ssh" <<'EOF'
#!/usr/bin/env bash
printf '<%s>\n' "$@" > "$SSH_CAPTURE"
cat > "$SSH_STDIN_CAPTURE"
if [[ "${SSH_STALE_KEY:-}" == 1 && "${*: -1}" == preflight* ]]; then
  printf 'Permission denied (publickey).\n' >&2
  exit 1
fi
[[ "${SSH_FAIL_PREFLIGHT:-}" != 1 || "${*: -1}" != preflight* ]]
EOF
  chmod +x "$FAKE_BIN/ssh"
}

teardown() {
  rm -rf "$TMPDIR"
}

run_request() {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    SSH_STDIN_CAPTURE="$TMPDIR/ssh.stdin" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" "$@"
}

@test "preflight invokes exactly the pinned restricted SSH argv" {
  run_request preflight
  [ "$status" -eq 0 ]
  expected="$(cat <<EOF
<-o>
<BatchMode=yes>
<-o>
<StrictHostKeyChecking=yes>
<-o>
<UserKnownHostsFile=$KNOWN_HOSTS>
<-o>
<GlobalKnownHostsFile=/dev/null>
<-o>
<IdentitiesOnly=yes>
<-i>
<$KEY>
<-p>
<2244>
<-T>
<vlongo@100.78.95.34>
<preflight $DIGEST $WEB_DIGEST>
EOF
)"
  [ "$(cat "$CAPTURE")" = "$expected" ]
}

@test "mutable image references fail before SSH" {
  DIGEST="ghcr.io/victor0451/athlos-api:latest"
  run_request preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"immutable Athlos API GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "metacharacters in the image reference fail before SSH" {
  DIGEST="${DIGEST};touch${IFS}/tmp/pwned"
  run_request preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"immutable Athlos API GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "alternate host and deployment path fail before SSH" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    DEPLOY_SSH_KEY_FILE="$KEY" DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" \
    DEPLOY_HOST="100.78.95.35" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPLOY_HOST must be 100.78.95.34"* ]]
  [ ! -e "$CAPTURE" ]
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    DEPLOY_SSH_KEY_FILE="$KEY" DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" \
    DEPLOY_PATH="/tmp/athlos" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPLOY_PATH must be /srv/apps/athlos"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "missing or mismatched key and known-host prerequisites fail before SSH" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPLOY_SSH_KEY_FILE must name a readable restricted key"* ]]
  [ ! -e "$CAPTURE" ]
  printf '[100.78.95.35]:2244 ssh-ed25519 wrong-host\n' > "$KNOWN_HOSTS"
  run_request preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not pin the deployment host"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "missing immutable image prerequisite fails before SSH" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"ATHLOS_API_IMAGE must be an immutable Athlos API GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "a failed preflight prevents the deploy request" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" SSH_FAIL_PREFLIGHT=1 \
    ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" deploy
  [ "$status" -ne 0 ]
  captured="$(cat "$CAPTURE")"
  [[ "$captured" == *"<preflight $DIGEST $WEB_DIGEST>"* ]]
  [[ "$captured" != *"<deploy $DIGEST>"* ]]
}

@test "a stale private key is rejected during preflight without deploy" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" SSH_STALE_KEY=1 \
    ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" deploy
  [ "$status" -ne 0 ]
  [[ "$output" == *"preflight rejected the restricted SSH credential or connectivity"* ]]
  captured="$(cat "$CAPTURE")"
  [[ "$captured" == *"<preflight $DIGEST $WEB_DIGEST>"* && "$captured" != *"<deploy $DIGEST $WEB_DIGEST>"* ]]
}

@test "dry-run diagnostics redact secret values and do not invoke SSH" {
  secret="do-not-log-this-secret"
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    DEPLOY_SSH_KEY="$secret" TS_OAUTH_SECRET="$secret" "$REQUEST" --dry-run preflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"operation=preflight"* ]]
  [[ "$output" != *"$secret"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "beta deployment uses the restricted beta operation" {
  run_request deploy-beta
  [ "$status" -eq 0 ]
  hash="$(sha256sum "$ROOT/docker-compose.beta.yml" | cut -d' ' -f1)"
  [[ "$(cat "$CAPTURE")" == *"<deploy-beta $DIGEST $WEB_DIGEST $hash>"* ]]
  [ "$(cat "$TMPDIR/ssh.stdin")" = "$(cat "$ROOT/docker-compose.beta.yml")" ]
}

@test "production requests keep the old command and send no config input" {
  run_request deploy
  [ "$status" -eq 0 ]
  [[ "$(cat "$CAPTURE")" == *"<deploy $DIGEST $WEB_DIGEST>"* ]]
  [ ! -s "$TMPDIR/ssh.stdin" ]
}

@test "beta rejects a missing, unreadable, or non-allowlisted source" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" SSH_STDIN_CAPTURE="$TMPDIR/ssh.stdin" \
    ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" ATHLOS_BETA_COMPOSE_FILE="$TMPDIR/missing.yml" \
    "$REQUEST" preflight-beta
  [ "$status" -ne 0 ]
  [[ "$output" == *"allowlisted repository path"* ]]
  [ ! -e "$CAPTURE" ]

  mv "$ROOT/docker-compose.beta.yml" "$TMPDIR/docker-compose.beta.yml"
  trap 'mv "$TMPDIR/docker-compose.beta.yml" "$ROOT/docker-compose.beta.yml"' EXIT
  run_request preflight-beta
  [ "$status" -ne 0 ]
  [[ "$output" == *"allowlisted repository path"* || "$output" == *"readable"* ]]
  trap - EXIT
  mv "$TMPDIR/docker-compose.beta.yml" "$ROOT/docker-compose.beta.yml"

  chmod 000 "$ROOT/docker-compose.beta.yml"
  run_request preflight-beta
  chmod 644 "$ROOT/docker-compose.beta.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"readable regular file"* ]]
}

@test "beta source is snapshotted before hash and stdin transfer" {
  run_request preflight-beta
  [ "$status" -eq 0 ]
  hash="$(sha256sum "$ROOT/docker-compose.beta.yml" | cut -d' ' -f1)"
  [ "${#hash}" -eq 64 ]
  [[ "$hash" != *[A-F]* ]]
  [ "$(sha256sum "$TMPDIR/ssh.stdin" | cut -d' ' -f1)" = "$hash" ]
}

@test "Compose substitutes both images with immutable digests" {
  run env ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" docker compose -f "$ROOT/docker-compose.yml" config --images
  [ "$status" -eq 0 ]
  [[ "$output" == *"$DIGEST"* ]]
  [[ "$output" == *"$WEB_DIGEST"* ]]
}

@test "Compose fails closed without an API image" {
  run env -u ATHLOS_API_IMAGE ATHLOS_WEB_IMAGE="$WEB_DIGEST" docker compose -f "$ROOT/docker-compose.yml" config --images
  [ "$status" -ne 0 ]
  [[ "$output" == *"ATHLOS_API_IMAGE must be set to an immutable GHCR digest"* ]]
  [[ "$output" != *":latest"* ]]
}

@test "beta Compose uses isolated ports and requires both immutable images" {
  cp "$ROOT/docker-compose.beta.yml" "$TMPDIR/docker-compose.beta.yml"
  touch "$TMPDIR/.env.beta"
  run env ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" docker compose \
    -p athlos-beta -f "$TMPDIR/docker-compose.beta.yml" config
  [ "$status" -eq 0 ]
  [[ "$output" == *"published: \"3100\""* ]]
  [[ "$output" == *"published: \"4100\""* ]]
  [[ "$output" == *"name: athlos_default"* ]]
}

@test "beta Compose enables the complete four-flag dues set" {
  cp "$ROOT/docker-compose.beta.yml" "$TMPDIR/docker-compose.beta.yml"
  touch "$TMPDIR/.env.beta"

  run env -u NATIVE_COLLECTIONS_WEB_ENABLED -u DUES_ASSESSMENT_ENABLED \
    -u DUES_AGREEMENTS_ENABLED -u DUES_CASH_ENABLED \
    ATHLOS_API_IMAGE="$DIGEST" ATHLOS_WEB_IMAGE="$WEB_DIGEST" \
    docker compose -p athlos-beta -f "$TMPDIR/docker-compose.beta.yml" config --format json
  [ "$status" -eq 0 ]
  compose_output="$output"
  for flag in NATIVE_COLLECTIONS_WEB_ENABLED DUES_ASSESSMENT_ENABLED DUES_AGREEMENTS_ENABLED DUES_CASH_ENABLED; do
    run jq -e ".services.web.environment.$flag == \"true\" and .services.api.environment.$flag == \"true\"" <<<"$compose_output"
    [ "$status" -eq 0 ]
  done
}
