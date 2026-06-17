#!/usr/bin/env bash
#
# Negative test: verify ci-check-audit-fp.sh exits 1 when auditPlugin
# is NOT wrapped with fp().
#
# This script is NOT part of the normal test suite — run it manually:
#   bash apps/api/scripts/test-ci-guard-negative.sh
#
# It temporarily removes the fp() wrap from middleware.ts, runs the guard,
# expects exit 1, then restores the original.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIDDLEWARE_FILE="$SCRIPT_DIR/../../../packages/audit/src/middleware.ts"
GUARD_FILE="$SCRIPT_DIR/ci-check-audit-fp.sh"

if [ ! -f "$MIDDLEWARE_FILE" ]; then
  echo "ERROR: middleware.ts not found at $MIDDLEWARE_FILE"
  exit 1
fi

if [ ! -f "$GUARD_FILE" ]; then
  echo "ERROR: guard script not found at $GUARD_FILE"
  exit 1
fi

# Backup the original
cp "$MIDDLEWARE_FILE" "${MIDDLEWARE_FILE}.bak"

cleanup() {
  # Restore original
  mv "${MIDDLEWARE_FILE}.bak" "$MIDDLEWARE_FILE"
}
trap cleanup EXIT

# Remove the fp() wrap — replace with unwrapped export AND remove the JSDoc comment that contains the pattern
# First, unwrap the export:
sed -i "s/export const auditPlugin = fp(auditPluginImpl, { name: 'athlos-audit' })/export const auditPlugin = auditPluginImpl/" "$MIDDLEWARE_FILE"
# Comment-out line 11 which contains the fp pattern in the JSDoc:
sed -i '11s/.*/ *   (fp wrap removed for negative test)/' "$MIDDLEWARE_FILE"

# Run the guard — should exit 1
echo "Running guard with unwrapped auditPlugin..."
if bash "$GUARD_FILE" 2>&1; then
  echo "FAIL: guard should have exited 1 but exited 0"
  exit 1
else
  echo "PASS: guard correctly exited 1 when auditPlugin is unwrapped"
  exit 0
fi
