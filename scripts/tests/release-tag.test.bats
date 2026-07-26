#!/usr/bin/env bats

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$ROOT/scripts/release/create-tag.sh"
  TEMP="$(mktemp -d)"
  git init --bare "$TEMP/remote.git" >/dev/null
  git init "$TEMP/repo" >/dev/null
  git -C "$TEMP/repo" config user.name test
  git -C "$TEMP/repo" config user.email test@example.com
  git -C "$TEMP/repo" remote add origin "$TEMP/remote.git"
  printf '{"version":"0.6.0"}\n' > "$TEMP/repo/package.json"
  git -C "$TEMP/repo" add package.json
  git -C "$TEMP/repo" commit -m initial >/dev/null
  git -C "$TEMP/repo" push -u origin HEAD:main >/dev/null
  OUTPUT="$TEMP/output"
}

teardown() {
  rm -rf "$TEMP"
}

run_tag() {
  run bash -c "cd '$TEMP/repo' && GITHUB_OUTPUT='$OUTPUT' '$SCRIPT' '$1'"
}

@test "beta tags increment without moving previous prereleases" {
  run_tag beta
  [ "$status" -eq 0 ]
  grep -Fxq 'release-tag=v0.6.0-beta.1' "$OUTPUT"
  : > "$OUTPUT"
  run_tag beta
  [ "$status" -eq 0 ]
  grep -Fxq 'release-tag=v0.6.0-beta.2' "$OUTPUT"
  git -C "$TEMP/repo" rev-parse v0.6.0-beta.1 v0.6.0-beta.2 >/dev/null
}

@test "production tag is stable and cannot be reused" {
  run_tag production
  [ "$status" -eq 0 ]
  grep -Fxq 'release-tag=v0.6.0' "$OUTPUT"
  run_tag production
  [ "$status" -eq 1 ]
  [[ "$output" == *"stable release tag already exists"* ]]
}

@test "invalid versions fail before creating a tag" {
  printf '{"version":"next"}\n' > "$TEMP/repo/package.json"
  run_tag beta
  [ "$status" -eq 1 ]
  [[ "$output" == *"release version must be stable SemVer"* ]]
}

@test "beta branch creates prerelease tags and deploys only beta" {
  workflow="$ROOT/.github/workflows/release-beta.yml"
  grep -Fq 'branches: [beta]' "$workflow"
  grep -Fq './scripts/release/create-tag.sh beta' "$workflow"
  grep -Fq 'environment: beta' "$workflow"
  grep -Fq 'deploy-operation: deploy-beta' "$workflow"
}

@test "production branch creates stable tags and deploys only production" {
  workflow="$ROOT/.github/workflows/release-production.yml"
  grep -Fq 'branches: [production]' "$workflow"
  grep -Fq './scripts/release/create-tag.sh production' "$workflow"
  grep -Fq 'environment: production' "$workflow"
  grep -Fq 'deploy-operation: deploy' "$workflow"
}
