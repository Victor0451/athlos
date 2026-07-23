#!/usr/bin/env bats

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REQUEST="$ROOT/scripts/deploy/request.sh"
  DIGEST="ghcr.io/victor0451/athlos-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
    DEPLOY_SSH_KEY_FILE="$KEY" DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" "$@"
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
<preflight $DIGEST>
EOF
)"
  [ "$(cat "$CAPTURE")" = "$expected" ]
}

@test "mutable image references fail before SSH" {
  DIGEST="ghcr.io/victor0451/athlos-api:latest"
  run_request preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"immutable Athlos GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "metacharacters in the image reference fail before SSH" {
  DIGEST="${DIGEST};touch${IFS}/tmp/pwned"
  run_request preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"immutable Athlos GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "alternate host and deployment path fail before SSH" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    DEPLOY_SSH_KEY_FILE="$KEY" DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" \
    DEPLOY_HOST="100.78.95.35" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPLOY_HOST must be 100.78.95.34"* ]]
  [ ! -e "$CAPTURE" ]
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    DEPLOY_SSH_KEY_FILE="$KEY" DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" \
    DEPLOY_PATH="/tmp/athlos" "$REQUEST" preflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"DEPLOY_PATH must be /srv/apps/athlos"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "missing or mismatched key and known-host prerequisites fail before SSH" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
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
  [[ "$output" == *"ATHLOS_API_IMAGE must be an immutable Athlos GHCR digest"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "a failed preflight prevents the deploy request" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" SSH_FAIL_PREFLIGHT=1 \
    ATHLOS_API_IMAGE="$DIGEST" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" deploy
  [ "$status" -ne 0 ]
  captured="$(cat "$CAPTURE")"
  [[ "$captured" == *"<preflight $DIGEST>"* ]]
  [[ "$captured" != *"<deploy $DIGEST>"* ]]
}

@test "a stale private key is rejected during preflight without deploy" {
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" SSH_STALE_KEY=1 \
    ATHLOS_API_IMAGE="$DIGEST" DEPLOY_SSH_KEY_FILE="$KEY" \
    DEPLOY_KNOWN_HOSTS_FILE="$KNOWN_HOSTS" "$REQUEST" deploy
  [ "$status" -ne 0 ]
  [[ "$output" == *"preflight rejected the restricted SSH credential or connectivity"* ]]
  captured="$(cat "$CAPTURE")"
  [[ "$captured" == *"<preflight $DIGEST>"* && "$captured" != *"<deploy $DIGEST>"* ]]
}

@test "dry-run diagnostics redact secret values and do not invoke SSH" {
  secret="do-not-log-this-secret"
  run env PATH="$FAKE_BIN:$PATH" SSH_CAPTURE="$CAPTURE" ATHLOS_API_IMAGE="$DIGEST" \
    DEPLOY_SSH_KEY="$secret" TS_OAUTH_SECRET="$secret" "$REQUEST" --dry-run preflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"operation=preflight"* ]]
  [[ "$output" != *"$secret"* ]]
  [ ! -e "$CAPTURE" ]
}

@test "Compose substitutes only the API image with an immutable digest" {
  run env ATHLOS_API_IMAGE="$DIGEST" docker compose -f "$ROOT/docker-compose.yml" config --images
  [ "$status" -eq 0 ]
  [ "$output" = "$DIGEST" ]
}

@test "Compose fails closed without an API image" {
  run env -u ATHLOS_API_IMAGE docker compose -f "$ROOT/docker-compose.yml" config --images
  [ "$status" -ne 0 ]
  [[ "$output" == *"ATHLOS_API_IMAGE must be set to an immutable GHCR digest"* ]]
  [[ "$output" != *":latest"* ]]
}
