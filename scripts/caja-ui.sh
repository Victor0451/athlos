#!/usr/bin/env bash
# caja-ui.sh — Full local stack for UI/UX walkthrough of the caja implementations.
#
# Wrapped by `scripts/lib/disposable-postgres.sh run --caller caja-ui` (see the caja:ui
# runner in the root package.json): the wrapper provisions a disposable PostgreSQL and
# exports ATHLOS_TEST_DATABASE_URL; this script applies the canonical chain + walkthrough
# seeds, starts the real Fastify API and the real Next.js web app against it, and prints
# the URLs, credentials, and a screen map. When it exits (Ctrl-C included), the wrapper
# tears the database container down — the whole stack is disposable, nothing persists.
#
# Env overrides:
#   CAJA_UI_OPERATOR / CAJA_UI_PASSWORD — login credentials (defaults: simulador / simulador123)
#   CAJA_UI_WEB_PORT                    — web port (default 3000)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- walkthrough configuration (dev-only values; nothing secret is committed) ---
DB_NAME="athlos_caja_ui"
OPERATOR_USERNAME="${CAJA_UI_OPERATOR:-simulador}"
OPERATOR_PASSWORD="${CAJA_UI_PASSWORD:-simulador123}"
WEB_PORT="${CAJA_UI_WEB_PORT:-3000}"
API_PORT="${CAJA_UI_API_PORT:-3001}"

# Fail fast with an actionable message when a previous stack still holds the ports.
for port in "$WEB_PORT" "$API_PORT"; do
  if ss -ltn "sport = :$port" | grep -q LISTEN; then
    echo "caja-ui: puerto $port ocupado — bajá el stack anterior (Ctrl-C o pkill) y reintentá." >&2
    exit 1
  fi
done

API_LOG="/tmp/caja-ui-api.log"
WEB_LOG="/tmp/caja-ui-web.log"

if [[ -z "${ATHLOS_TEST_DATABASE_URL:-}" ]]; then
  echo "ATHLOS_TEST_DATABASE_URL is not set — run through the caja:ui runner (disposable-postgres wrapper)" >&2
  exit 2
fi
# Point the API at the walkthrough database (the wrapper URL points at the container's
# default 'postgres' database; the setup script provisions athlos_caja_ui beside it).
DATABASE_URL="$(printf '%s' "$ATHLOS_TEST_DATABASE_URL" | sed -E "s|/[^/]+$|/$DB_NAME|")"
export DATABASE_URL

# --- API envs (@athlos/config schema, dev-only values) ---
export NODE_ENV=development
export PORT="$API_PORT"
export JWT_SECRET="caja-ui-walkthrough-access-secret-0123456789abcdef"
export JWT_REFRESH_SECRET="caja-ui-walkthrough-refresh-secret-fedcba9876543210"
export LEGACY_DB_PATH="${LEGACY_DB_PATH:-/tmp/athlos-caja-ui/legacy.sqlite3}"
export IMPLEMENTATION_CONTACT_RECIPIENT="caja-ui-walkthrough@localhost.dev"
mkdir -p "$(dirname "$LEGACY_DB_PATH")"
[[ -e "$LEGACY_DB_PATH" ]] || : >"$LEGACY_DB_PATH"

# --- caja feature flags (default false in production config; forced on for the walkthrough) ---
export DUES_CASH_ENABLED=true
export NATIVE_COLLECTIONS_WEB_ENABLED=true
export DUES_AGREEMENTS_ENABLED=true
export DUES_ASSESSMENT_ENABLED=true

API_PID=""
WEB_PID=""
cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

wait_for_url() {
  local url=$1 name=$2 log=$3 attempts=${4:-60}
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$API_PID" 2>/dev/null && [[ "$name" == "api" ]]; then
      echo "api dev server died — last log lines:" >&2
      tail -20 "$log" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "$name did not become ready at $url — last log lines:" >&2
  tail -20 "$log" >&2 || true
  return 1
}

echo "==> applying canonical chain + walkthrough seeds (database: $DB_NAME)"
pnpm --filter @athlos/api exec tsx src/scripts/caja-ui-setup.ts "$DB_NAME" "$OPERATOR_USERNAME" "$OPERATOR_PASSWORD"

echo "==> starting API (dev) on :$API_PORT — log $API_LOG"
(
  export DATABASE_URL
  pnpm --filter @athlos/api dev
) >"$API_LOG" 2>&1 &
API_PID=$!

if ! wait_for_url "http://127.0.0.1:$API_PORT/health" api "$API_LOG"; then
  exit 1
fi

echo "==> starting web (dev) on :$WEB_PORT — log $WEB_LOG"
(
  export API_INTERNAL_URL="http://127.0.0.1:$API_PORT"
  export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$API_PORT"
  pnpm --filter @athlos/web dev --hostname 127.0.0.1 --port "$WEB_PORT"
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

if ! wait_for_url "http://127.0.0.1:$WEB_PORT/login" web "$WEB_LOG"; then
  exit 1
fi

echo
echo "======================================================================="
echo " caja UI walkthrough ready"
echo "======================================================================="
echo "   web          http://localhost:$WEB_PORT"
echo "   api          http://127.0.0.1:$API_PORT  (health: /health)"
echo "   login        $OPERATOR_USERNAME / $OPERATOR_PASSWORD  (ADMIN, supervisión)"
echo "   login cajero cajero / cajero123  (OPERADOR — journey personal de Caja)"
echo
echo "   screens (implementation -> page)"
echo "     login/auth                       /login"
echo "     collections nativa (épica caja)  /collections"
echo "     tesorería / caja                 /tesoreria  (1 turno abierto + 1 cerrado sembrados)"
echo "     admin gastos                     /admin/gastos"
echo "     dashboard                        /dashboard"
echo
echo "   logs         $API_LOG / $WEB_LOG"
echo "   teardown     Ctrl-C drops web + api; the wrapper drops the database container"
echo "======================================================================="
echo

# Wait for either dev server to exit; if one dies, take the whole stack down (the wrapper
# then drops the database container too).
if wait -n; then
  code=$?
else
  code=$?
fi
exit "$code"
