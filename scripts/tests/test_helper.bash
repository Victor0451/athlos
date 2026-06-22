#!/usr/bin/env bash
#
# test_helper.bash — shared bats load helper for backup scripts
#

# Resolve the lib/ directory relative to this helper's location
HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$HELPER_DIR/../lib"

# Load common.sh if it exists
if [[ -f "$LIB_DIR/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$LIB_DIR/common.sh"
fi

# bats-assert-style helpers (minimal, no external deps)
function assert_equal() {
  local expected="$1" actual="$2"
  if [[ "$expected" != "$actual" ]]; then
    echo "ERROR: expected '$expected', got '$actual'" >&2
    return 1
  fi
}

function assert_success() {
  if [[ $1 -ne 0 ]]; then
    echo "ERROR: expected success (exit 0), got exit $1" >&2
    return 1
  fi
}

function assert_failure() {
  if [[ $1 -eq 0 ]]; then
    echo "ERROR: expected failure (non-zero), got exit 0" >&2
    return 1
  fi
}
