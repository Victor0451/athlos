#!/usr/bin/env bash
set -euo pipefail

die() { printf '%s\n' "$1" >&2; exit 2; }
[[ ${RECOVERY_TARGET:-} == ephemeral-clone || ${RECOVERY_TARGET:-} == clone ]] || die 'rehearsal requires an isolated clone'
[[ -n ${RECOVERY_APPROVAL_REF:-} ]] || die 'RECOVERY_APPROVAL_REF is required'
[[ ${DATABASE_URL:-} ]] || die 'DATABASE_URL is required'
[[ ${RECOVERY_CLONE_NONCE:-} ]] || die 'RECOVERY_CLONE_NONCE is required'
[[ $RECOVERY_CLONE_NONCE =~ ^[0-9a-f]{32}$ ]] || die 'RECOVERY_CLONE_NONCE must be 32 lowercase hex characters'
[[ $# -ge 2 && $1 == --sql ]] || die 'usage: rehearse.sh --sql FILE [--checksum SHA256]'
sql=$2; shift 2; [[ -f $sql ]] || die 'recovery SQL is missing'
sum="$(sha256sum "$sql" | cut -d' ' -f1)"
if [[ $# -gt 0 ]]; then [[ $# == 2 && $1 == --checksum && $2 == "$sum" ]] || die 'checksum drift or hostile argument'; fi
attested="$(psql "$DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c "SELECT count(*) FROM recovery_clone_attestation WHERE nonce = '$RECOVERY_CLONE_NONCE'")" || die 'clone attestation failed'
[[ $attested == 1 ]] || die 'clone attestation mismatch'
relations="$(psql "$DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c "SELECT to_regclass('public.audit_events');")" || die 'relation inventory failed'
[[ $relations == *audit_events* ]] || die 'missing relation: audit_events'
before="$(psql "$DATABASE_URL" -XAt -c 'SELECT count(*) FROM audit_events')" || die 'audit inventory failed'
psql "$DATABASE_URL" -Xv ON_ERROR_STOP=1 -f "$sql" >/dev/null
psql "$DATABASE_URL" -Xv ON_ERROR_STOP=1 -f "$sql" >/dev/null
relations="$(psql "$DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c "SELECT to_regclass('public.operators'), to_regclass('public.refresh_tokens'), to_regclass('public.job_runs'), to_regclass('public.audit_events');")" || die 'relation post-check failed'
for relation in operators refresh_tokens job_runs audit_events; do [[ $relations == *"$relation"* ]] || die "missing relation: $relation"; done
structure="$(psql "$DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c "WITH required(t, cs) AS (VALUES ('operators', ARRAY['id','username','password_hash','role']), ('refresh_tokens', ARRAY['id','operator_id','token_hash','expires_at']), ('job_runs', ARRAY['id','job_name','scheduled_at','status','attempt','metadata','triggered_by'])), columns AS (SELECT t, unnest(cs) c FROM required) SELECT count(*) FROM (SELECT 1 FROM columns LEFT JOIN information_schema.columns i ON i.table_schema = 'public' AND i.table_name = t AND i.column_name = c WHERE i.column_name IS NULL UNION ALL SELECT 1 FROM (VALUES ('operators'::regclass, 'p'::char, ARRAY['id']::text[], NULL::regclass), ('operators'::regclass, 'u'::char, ARRAY['username']::text[], NULL::regclass), ('refresh_tokens'::regclass, 'p'::char, ARRAY['id']::text[], NULL::regclass), ('refresh_tokens'::regclass, 'u'::char, ARRAY['token_hash']::text[], NULL::regclass), ('refresh_tokens'::regclass, 'f'::char, ARRAY['operator_id']::text[], 'operators'::regclass), ('job_runs'::regclass, 'p'::char, ARRAY['id']::text[], NULL::regclass)) r(rel, typ, cs, ref) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conrelid = rel AND x.contype = typ AND ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(attnum, n) JOIN pg_attribute a ON a.attrelid = rel AND a.attnum = k.attnum ORDER BY k.n) = cs AND (ref IS NULL OR x.confrelid = ref))) invalid")" || die 'relation structure check failed'
[[ $structure == 0 ]] || die 'required relation structure is incomplete'
after="$(psql "$DATABASE_URL" -XAt -c 'SELECT count(*) FROM audit_events')" || die 'audit post-check failed'
[[ $before == "$after" ]] || die 'audit_events count decreased or changed'
printf '{"target":"%s","checksum":"%s","runs":2,"audit_events":%s,"rollback":"revert recovery SQL/scripts only"}\n' "$RECOVERY_TARGET" "$sum" "$after"
