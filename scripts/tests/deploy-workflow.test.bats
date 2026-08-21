#!/usr/bin/env bats
# shellcheck disable=SC2016 # Assertions intentionally match literal workflow expressions.

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

@test "deploy workflow is reusable and does not deploy main directly" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]

  [[ "$output" == *"on:"* ]]
  [[ "$output" == *"workflow_call:"* ]]
  [[ "$output" != *"branches: [main]"* ]]

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
  run grep -n "^  deploy:$\|^    needs: publish$\|image-reference:" "$WORKFLOW"
  [ "$status" -eq 0 ]

  assert_after "^  publish:$" "^    outputs:$"
  grep -q "^    outputs:$" "$WORKFLOW"
  grep -Fq "      api-image-reference: \${{ format('ghcr.io/victor0451/athlos-api@{0}', steps.api-push.outputs.digest) }}" "$WORKFLOW"
  grep -Fq "      web-image-reference: \${{ format('ghcr.io/victor0451/athlos-web@{0}', steps.web-push.outputs.digest) }}" "$WORKFLOW"
  grep -q "^    needs: publish$" "$WORKFLOW"
  grep -q "^      ATHLOS_API_IMAGE: \${{ needs.publish.outputs.api-image-reference }}$" "$WORKFLOW"
  grep -q "^      ATHLOS_WEB_IMAGE: \${{ needs.publish.outputs.web-image-reference }}$" "$WORKFLOW"
}

@test "deploy job uses the requested protected environment" {
  run grep -n "^  deploy:$\|^    environment:$\|^      name:.*inputs.environment" "$WORKFLOW"
  [ "$status" -eq 0 ]

  assert_after "^  deploy:$" "^    environment:$"
  assert_after "^    environment:$" "^      name:.*inputs.environment"
  grep -q "^    environment:$" "$WORKFLOW"
  grep -Fq 'name: ${{ inputs.environment }}' "$WORKFLOW"
}

@test "deploy path uses immutable digest handoff and fixed target metadata" {
  run grep -n "100.78.95.34\|2244\|/srv/apps/athlos\|vlongo\|needs.publish.outputs.api-image-reference\|request.sh.*operation" "$WORKFLOW"
  [ "$status" -eq 0 ]

  grep -q "100.78.95.34" "$WORKFLOW"
  grep -q "2244" "$WORKFLOW"
  grep -q "/srv/apps/athlos" "$WORKFLOW"
  grep -q "vlongo" "$WORKFLOW"
  grep -q "needs.publish.outputs.api-image-reference" "$WORKFLOW"
  grep -q "needs.publish.outputs.web-image-reference" "$WORKFLOW"
  grep -Fq './scripts/deploy/request.sh ${{ inputs.preflight-operation }}' "$WORKFLOW"
  grep -Fq './scripts/deploy/request.sh ${{ inputs.deploy-operation }}' "$WORKFLOW"
}

@test "deploy uses the restricted request client for real preflight before deploy" {
  run grep -n "request.sh --dry-run\|request.sh.*operation" "$WORKFLOW"
  [ "$status" -eq 0 ]

  [[ "$output" != *"request.sh --dry-run"* ]]
  assert_after "request.sh.*preflight-operation" "request.sh.*deploy-operation"
}

@test "beta wiring sends only the checked-out canonical compose artifact" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]
  assert_after "actions/checkout@v4" "ATHLOS_BETA_COMPOSE_FILE:.*docker-compose.beta.yml"
  [[ "$output" == *'if: ${{ inputs.environment == '\''beta'\'' }}'* ]]
  [[ "$output" == *'ATHLOS_BETA_COMPOSE_FILE: ${{ github.workspace }}/docker-compose.beta.yml'* ]]
  [[ "$output" != *'.env.beta'* ]]
  [[ "$output" != *'scp '* && "$output" != *'rsync '* && "$output" != *'git pull'* ]]
}

@test "production request steps have no beta artifact input" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]
  [[ "$output" == *'if: ${{ inputs.environment == '\''production'\'' }}'* ]]
  run grep -A3 "Run restricted production read-only preflight" "$WORKFLOW"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ATHLOS_BETA_COMPOSE_FILE"* ]]
  run grep -A3 "Request production deploy" "$WORKFLOW"
  [ "$status" -eq 0 ]
  [[ "$output" != *"ATHLOS_BETA_COMPOSE_FILE"* ]]
}

@test "both restricted requests inherit the canonical immutable fixed target contract" {
  assert_after "ATHLOS_API_IMAGE: \${{ needs.publish.outputs.api-image-reference }}" "request.sh.*preflight-operation"
  assert_after "ATHLOS_WEB_IMAGE: \${{ needs.publish.outputs.web-image-reference }}" "request.sh.*deploy-operation"
  assert_after "DEPLOY_HOST: 100.78.95.34" "request.sh.*preflight-operation"
  assert_after "DEPLOY_PORT: 2244" "request.sh.*deploy-operation"
  assert_after "DEPLOY_USER: vlongo" "request.sh.*preflight-operation"
  assert_after "DEPLOY_PATH: /srv/apps/athlos" "request.sh.*deploy-operation"
}

@test "deploy script avoids mutable image references" {
  run cat "$WORKFLOW"
  [ "$status" -eq 0 ]

  # Digest must be passed through outputs from publish; mutable refs are never used.
  [[ "$output" != *"ATHLOS_API_IMAGE=ghcr.io/victor0451/athlos-api:latest"* ]]
  [[ "$output" != *"ATHLOS_API_IMAGE=ghcr.io/victor0451/athlos-api:v"* ]]
  [[ "$output" == *"needs.publish.outputs.api-image-reference"* ]]
  [[ "$output" == *"needs.publish.outputs.web-image-reference"* ]]
}

@test "image publication includes release and production latest tags" {
  run grep -nF 'type=raw,value=${{ inputs.release-tag }}' "$WORKFLOW"
  [ "$status" -eq 0 ]

  run grep -nF "type=raw,value=latest" "$WORKFLOW"
  [ "$status" -eq 0 ]
}

@test "deploy runner joins Tailnet as ephemeral tag:ci before both request operations" {
  run grep -n "tailscale/github-action@\|tag:ci\|request.sh.*operation" "$WORKFLOW"
  [ "$status" -eq 0 ]

  grep -q "uses: tailscale/github-action@" "$WORKFLOW"
  grep -q "tags: tag:ci" "$WORKFLOW"
  assert_after "uses: tailscale/github-action@" "request.sh.*preflight-operation"
  assert_after "uses: tailscale/github-action@" "request.sh.*deploy-operation"
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
  local preflight='request\.sh.*preflight-operation'
  local deploy='request\.sh.*deploy-operation'

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
