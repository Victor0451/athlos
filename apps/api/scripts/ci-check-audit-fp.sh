#!/usr/bin/env bash
#
# CI guard: verify auditPlugin is fp()-wrapped with name 'athlos-audit'.
#
# This script enforces the PR 3a bugfix lesson (Engram #1990):
# unwrapped Fastify plugins silently 401 every protected route because
# the hooks only fire inside the plugin's encapsulated context.
#
# The correct pattern is:
#   export const auditPlugin = fp(auditPlugin, { name: 'athlos-audit' })
#
# This grep checks for exactly that pattern in the middleware source.
#
# Exit codes:
#   0 — pattern found (guard PASSED)
#   1 — pattern not found (guard FAILED)

set -euo pipefail

MIDDLEWARE_FILE="packages/audit/src/middleware.ts"

if [ ! -f "$MIDDLEWARE_FILE" ]; then
  echo "ERROR: $MIDDLEWARE_FILE not found"
  exit 1
fi

# Grep for the fp-wrap with name 'athlos-audit'
# Matches: fp(auditPluginImpl, { name: 'athlos-audit' })
# The pattern must have fp( and name: 'athlos-audit' on the same "step"
# (same logical statement, allowing whitespace between them).
FOUND=$(grep -cE "fp\([^)]*,\s*\{\s*name:\s*'athlos-audit'\s*\}" "$MIDDLEWARE_FILE" || true)

if [ "$FOUND" -ge 1 ]; then
  echo "PASS: auditPlugin is fp()-wrapped with name 'athlos-audit'"
  exit 0
else
  echo "FAIL: auditPlugin MUST be fp()-wrapped with name 'athlos-audit'"
  echo "Expected pattern in $MIDDLEWARE_FILE:"
  echo "  export const auditPlugin = fp(auditPlugin, { name: 'athlos-audit' })"
  echo ""
  echo "Searched for: fp(... { name: 'athlos-audit' })"
  exit 1
fi
