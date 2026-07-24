#!/usr/bin/env bats

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORKFLOW="$ROOT/.github/workflows/deploy.yml"
}

assert_after() {
  local before_pattern="$1"
  local after_pattern="$2"

  local before_line
  before_line="$(grep -n -- "${before_pattern}" "$WORKFLOW" | head -n1 | cut -d: -f1 || true)"
  local after_line
  after_line="$(grep -n -- "${after_pattern}" "$WORKFLOW" | head -n1 | cut -d: -f1 || true)"

  [ -n "$before_line" ]
  [ -n "$after_line" ]
  [ "$before_line" -lt "$after_line" ]
}

@test "deploy workflow is main-push only" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]

  [[ "$output" == *"on:"* ]]
  [[ "$output" == *"push:"* ]]
  [[ "$output" == *"branches: [main]"* ]]

  # No PR workflow trigger is allowed in PR2 recovery flow.
  [[ "$output" != *"pull_request:"* ]]
}

@test "deploy workflow defines publish and deploy jobs" {
  run grep -E "^  (publish|deploy):$" "$WORKFLOW"
  [ "$status" -eq 0 ]
  grep -q "^  publish:$" "$WORKFLOW"
  grep -q "^  deploy:$" "$WORKFLOW"
}

@test "deploy job requires a canonical immutable publish output via needs" {
  run grep -n "^  deploy:$\|^    needs: publish$\|^      image-reference:" "$WORKFLOW"
  [ "$status" -eq 0 ]

  assert_after "^  publish:$" "^    outputs:$"
  grep -q "^    outputs:$" "$WORKFLOW"
  grep -Fq "      image-reference: \${{ format('ghcr.io/victor0451/athlos-api@{0}', steps.push.outputs.digest) }}" "$WORKFLOW"
  grep -q "^    needs: publish$" "$WORKFLOW"
  grep -q "^      ATHLOS_API_IMAGE: \${{ needs.publish.outputs.image-reference }}$" "$WORKFLOW"
  run ! grep -q "^      ATHLOS_API_IMAGE: \${{ needs.publish.outputs.image-digest }}$" "$WORKFLOW"
}

@test "deploy job is protected by production environment" {
  run grep -n "^  deploy:$\|^    environment:$\|^      name: production$" "$WORKFLOW"
  [ "$status" -eq 0 ]

  assert_after "^  deploy:$" "^    environment:$"
  assert_after "^    environment:$" "^      name: production$"
  grep -q "^    environment:$" "$WORKFLOW"
  grep -q "^      name: production$" "$WORKFLOW"
}

@test "deploy path uses immutable digest handoff and fixed target metadata" {
  run grep -n "100.78.95.34\|2244\|/srv/apps/athlos\|vlongo\|@sha256:\|needs.publish.outputs.image-reference\|request.sh preflight\|request.sh deploy" "$WORKFLOW"
  [ "$status" -eq 0 ]

  grep -q "100.78.95.34" "$WORKFLOW"
  grep -q "2244" "$WORKFLOW"
  grep -q "/srv/apps/athlos" "$WORKFLOW"
  grep -q "vlongo" "$WORKFLOW"
  grep -q "needs.publish.outputs.image-reference" "$WORKFLOW"
  grep -q "./scripts/deploy/request.sh preflight" "$WORKFLOW"
  grep -q "./scripts/deploy/request.sh deploy" "$WORKFLOW"
}

@test "deploy uses the restricted request client for real preflight before deploy" {
  run grep -n "request.sh --dry-run\|request.sh preflight\|request.sh deploy" "$WORKFLOW"
  [ "$status" -eq 0 ]

  [[ "$output" != *"request.sh --dry-run"* ]]
  assert_after "request.sh preflight" "request.sh deploy"
}

@test "both restricted requests inherit the canonical immutable fixed target contract" {
  assert_after "ATHLOS_API_IMAGE: \${{ needs.publish.outputs.image-reference }}" "request.sh preflight"
  assert_after "ATHLOS_API_IMAGE: \${{ needs.publish.outputs.image-reference }}" "request.sh deploy"
  assert_after "DEPLOY_HOST: 100.78.95.34" "request.sh preflight"
  assert_after "DEPLOY_PORT: 2244" "request.sh deploy"
  assert_after "DEPLOY_USER: vlongo" "request.sh preflight"
  assert_after "DEPLOY_PATH: /srv/apps/athlos" "request.sh deploy"
}

@test "deploy script avoids mutable image references" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]

  # Digest must be passed through outputs from publish; mutable refs are never used.
  [[ "$output" != *"ATHLOS_API_IMAGE=ghcr.io/victor0451/athlos-api:latest"* ]]
  [[ "$output" != *"ATHLOS_API_IMAGE=ghcr.io/victor0451/athlos-api:v"* ]]
  [[ "$output" == *"needs.publish.outputs.image-reference"* ]]
}

@test "image publication includes latest and main-short-sha tags" {
  run grep -nE "^[[:space:]]*type=raw,value=latest,enable=\{\{is_default_branch\}\}$" "$WORKFLOW"
  [ "$status" -eq 0 ]

  # Ensure main-short-sha tag is explicitly emitted.
  run grep -nE "type=sha,.*format=short.*prefix=main-" "$WORKFLOW"
  [ "$status" -eq 0 ]
}

@test "deploy runner joins Tailnet as ephemeral tag:ci before both request operations" {
  run grep -n "tailscale/github-action@\|tag:ci\|request.sh preflight\|request.sh deploy" "$WORKFLOW"
  [ "$status" -eq 0 ]

  grep -q "uses: tailscale/github-action@" "$WORKFLOW"
  grep -q "tags: tag:ci" "$WORKFLOW"
  assert_after "uses: tailscale/github-action@" "request.sh preflight"
  assert_after "uses: tailscale/github-action@" "request.sh deploy"
}

@test "remote SSH script never joins Tailnet" {
  run grep -n "tailscale up\|--advertise-tags=tag:ci" "$WORKFLOW"
  [ "$status" -ne 0 ]
}

@test "workflow has no inline remote deployment or readiness rollback logic" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]

  [[ "$output" != *"appleboy/ssh-action"* ]]
  [[ "$output" != *"docker compose"* ]]
  [[ "$output" != *"/health/ready"* ]]
  [[ "$output" != *"PREVIOUS_TAG"* ]]
  [[ "$output" != *"rolling back"* ]]
}

@test "workflow materializes restricted SSH files safely and removes them" {
  # shellcheck disable=SC2016 # Literal workflow-source contract; preserve $RUNNER_TEMP.
  local ssh_key_path='DEPLOY_SSH_KEY_FILE="$RUNNER_TEMP/deploy_ssh_key"'
  # shellcheck disable=SC2016 # Literal workflow-source contract; preserve $RUNNER_TEMP.
  local known_hosts_path='DEPLOY_KNOWN_HOSTS_FILE="$RUNNER_TEMP/deploy_known_hosts"'
  local ssh_key_write="printf '%s\\n' \"\${{ secrets.DEPLOY_SSH_KEY }}\" > \"\$DEPLOY_SSH_KEY_FILE\""
  local known_hosts_write="printf '%s\\n' \"\${{ secrets.DEPLOY_KNOWN_HOSTS }}\" > \"\$DEPLOY_KNOWN_HOSTS_FILE\""
  local permissions="chmod 600 \"\$DEPLOY_SSH_KEY_FILE\" \"\$DEPLOY_KNOWN_HOSTS_FILE\""
  local ssh_key_export="printf 'DEPLOY_SSH_KEY_FILE=%s\\n' \"\$DEPLOY_SSH_KEY_FILE\" >> \"\$GITHUB_ENV\""
  local known_hosts_export="printf 'DEPLOY_KNOWN_HOSTS_FILE=%s\\n' \"\$DEPLOY_KNOWN_HOSTS_FILE\" >> \"\$GITHUB_ENV\""
  local always="if: \${{ always() }}"
  local cleanup="rm -f \"\$RUNNER_TEMP/deploy_ssh_key\" \"\$RUNNER_TEMP/deploy_known_hosts\""
  local preflight='^[[:space:]]*run: \./scripts/deploy/request\.sh preflight$'
  local deploy='^[[:space:]]*run: \./scripts/deploy/request\.sh deploy$'

  run grep -n "umask 077\|$ssh_key_path\|$known_hosts_path\|chmod 600\|GITHUB_ENV\|$cleanup" "$WORKFLOW"
  [ "$status" -eq 0 ]

  grep -q "umask 077" "$WORKFLOW"
  grep -Fq "$ssh_key_path" "$WORKFLOW"
  grep -Fq "$known_hosts_path" "$WORKFLOW"
  grep -Fq "$ssh_key_write" "$WORKFLOW"
  grep -Fq "$known_hosts_write" "$WORKFLOW"
  grep -Fq "$permissions" "$WORKFLOW"
  grep -Fq "$ssh_key_export" "$WORKFLOW"
  grep -Fq "$known_hosts_export" "$WORKFLOW"
  grep -Fq "$always" "$WORKFLOW"
  grep -Fq "$cleanup" "$WORKFLOW"
  assert_after 'DEPLOY_SSH_KEY_FILE=%s' "$preflight"
  assert_after 'DEPLOY_KNOWN_HOSTS_FILE=%s' "$preflight"
  assert_after "$preflight" "$deploy"
}
