#!/usr/bin/env bash
set -euo pipefail

die() { printf '%s\n' "$1" >&2; exit "${2:-2}"; }
[[ $# -eq 2 && $1 == --worktree ]] || die 'usage: check-scope.sh --worktree /absolute/recovery-worktree'
[[ $2 = /* ]] || die 'relative worktree selectors are forbidden'
root="$(git -C "$2" rev-parse --show-toplevel 2>/dev/null)" || die 'worktree is not a git repository'
expected="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ $root == "$expected" ]] || die 'selector is outside this recovery worktree'
changes="$(git -C "$root" diff --name-only HEAD; git -C "$root" diff --cached --name-only; git -C "$root" ls-files --others --exclude-standard)"
[[ -z $changes ]] || die 'staged or unstaged candidate pollution detected' 3
printf 'scope: ok\n'
