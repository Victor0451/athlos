#!/usr/bin/env bash
set -euo pipefail

die() { printf '%s\n' "$1" >&2; exit 2; }
target="${RECOVERY_TARGET:-}"; url="${DATABASE_URL:-}"
[[ $target == ephemeral-clone || $target == clone ]] || die 'preflight requires RECOVERY_TARGET=ephemeral-clone or clone'
[[ -n $url ]] || die 'DATABASE_URL is required'
psql "$url" -XAtv ON_ERROR_STOP=1 -c "BEGIN READ ONLY; SELECT to_regclass('public.operators'), to_regclass('public.refresh_tokens'), to_regclass('public.job_runs'), to_regclass('public.audit_events'); COMMIT;" >/dev/null || die 'read-only inventory failed'
printf '{"target":"%s","database":"postgresql://<redacted>@%s","mode":"read-only"}\n' "$target" "${url#*@}"
