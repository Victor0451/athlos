#!/usr/bin/env bats

setup() {
  repo="$(mktemp -d)"
  mkdir -p "$repo/scripts/recovery"
  cp "$BATS_TEST_DIRNAME/../recovery/check-scope.sh" "$repo/scripts/recovery/check-scope.sh" 2>/dev/null || true
  git -C "$repo" init -q
  git -C "$repo" config user.email recovery@example.test
  git -C "$repo" config user.name recovery
  touch "$repo/README"
  git -C "$repo" add README scripts/recovery/check-scope.sh && git -C "$repo" commit -qm initial
}

teardown() { rm -rf "$repo"; }

@test "rejects a relative worktree selector" {
  run bash -c "cd '$repo' && scripts/recovery/check-scope.sh --worktree ."
  [ "$status" -eq 2 ]
}

@test "rejects a selector outside the recovery worktree" {
  other="$(mktemp -d)"
  git -C "$other" init -q
  run "$repo/scripts/recovery/check-scope.sh" --worktree "$other"
  rm -rf "$other"
  [ "$status" -eq 2 ]
}

@test "rejects staged pollution" {
  printf 'x\n' > "$repo/apps-web-pr2"
  git -C "$repo" add apps-web-pr2
  run "$repo/scripts/recovery/check-scope.sh" --worktree "$repo"
  [ "$status" -eq 3 ]
}

@test "rejects unstaged pollution" {
  printf 'x\n' >> "$repo/README"
  run "$repo/scripts/recovery/check-scope.sh" --worktree "$repo"
  [ "$status" -eq 3 ]
}

@test "rejects untracked pollution" {
  touch "$repo/untracked-candidate"
  run "$repo/scripts/recovery/check-scope.sh" --worktree "$repo"
  [ "$status" -eq 3 ]
}

@test "accepts an empty index and clean worktree" {
  run "$repo/scripts/recovery/check-scope.sh" --worktree "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"scope: ok"* ]]
}
