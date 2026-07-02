# Delta for deployment-devops

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e2` |
| **Date** | 2026-06-25 |
| **Phase** | Spec |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for design |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` |
| **Modified capability** | `deployment-devops` (3 NEW ADDITIVE requirements — B1b LESSON #1) |
| **Source artifacts** | `openspec/changes/explore-athlos-promote-projection-to-master-e2/exploration.md` (989 lines) · `openspec/changes/athlos-promote-projection-to-master-e2/proposal.md` (802 lines) |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1, commit `bc6aa60`) · `e1b1` (v0.5.2/v0.5.3, commit `4a29571`) · `e1b2a` (v0.5.4, commit `b8d8e43`) · **`e1b2b` (v0.5.5, commit `36ac630`, FINAL atomic sync applied in `e753528`)** |
| **Sister slice (THIS, FINAL)** | `athlos-promote-projection-to-master-e2` (v0.5.6) — closes Slice E permanently with admin API + `promoted_at` audit + runbook + 3 NEW ADDITIVE canonical-spec requirements |
| **Target release** | v0.5.5 → **v0.5.6** (PATCH — additive: 1 NEW column `raw_events.promoted_at`, 1 NEW endpoint `POST /api/v1/promote/trigger`, 1 NEW `GET /api/v1/promote/status`, 1 NEW runbook section, 3 NEW canonical-spec requirements; no breaking changes) |
| **B1b LESSONs embedded** | #1 (HIGHEST, additive-only) atomic sync — 3 NEW requirements appended, NO modifications to existing Promotion Pipeline requirement from E1b2b FINAL sync · #2 separate release commit (`chore(release): v0.5.6`) · #3 cherry-pick reorder · #4 merge-before-delete |
| **E1b1/E1b2a/E1b2b LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `061be50` extended to 8 master tables) · migration via `psql` NOT `drizzle-kit migrate` · existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug fix); E2 admin endpoint tests use Fastify `app.inject` mock-container pattern (mirrors `import.test.ts`) |

> **ADDITIVE-ONLY ATOMIC SPEC SYNC (B1b LESSON #1, CRITICAL — closes Slice E permanently).** This delta adds 3 NEW requirements AT THE END of `openspec/specs/deployment-devops/spec.md`. The existing **Promotion Pipeline** requirement (canonical lines 167-276) and the **`tesoreria.gastos` master table** requirement (canonical lines 280-315) remain UNCHANGED. The `diff` between this delta and the canonical spec SHALL be purely additive (no removals, no rewrites of prior Slice E scenarios). **E2 is the FINAL sub-slice of Slice E — no further atomic syncs are planned.**

> **NEW CLARIFICATION (discovered during propose phase, 2026-06-25 12:42 UTC, engram observation #2547).** The `promoted_at` backfill in migration `0016_promoted_at.sql` covers **`socios` ONLY**. ctacte/ctacte1 backfill requires a `raw_events.legacy_id` column (E3+) — the column does not exist today. Backfilling via `(source_table, source_key)` JOIN through `ctacte.legacy_id` would also be wrong because `raw_events.source_key` for ctacte is the VFP key, NOT the socio carnet. E2 documents ctacte/ctacte1 backfill as TODO E3+ in the runbook "Known Limitations" + spec success criteria; the `promoted_at IS NULL` filter on `promote.ts` still works correctly for ctacte/ctacte1 because those domains use `master.legacy_id` UNIQUE INDEX as the primary dedup mechanism (the `promoted_at` filter is the secondary cross-check).

---

## Context

**State post-E1b2b/v0.5.5 (commit `36ac630`, FINAL atomic sync in `e753528`).** All 8 master domains populate via `pnpm db:promote`. `scripts/verify-slice.sh` (commit `061be50`) exits 0 against the live DB (`192.168.1.102:5432/athlos`) — verified 2026-06-25T15:06:09Z. The Promotion Pipeline requirement at canonical lines 167-276 is the closed, locked Slice E data layer.

| Master table | Projection rows | Current rows | Status |
|--------------|----------------:|-------------:|--------|
| `socios.socios` | 39,357 | 16,383 | partial (E1a `legacy_id` idempotency works on re-run; some pre-E1a manual entries lack `legacy_id`) |
| `tesoreria.ctacte` | 326,275 | 197,521 | partial (cctcuenta backfill yields 0 from stale `entity_uuids`; re-promote inserts the missing ~129k) |
| `tesoreria.ctacte1` | 245,370 | 150,129 | partial (~61% — N14 stale `entity_uuids`) |
| `socios.escuela` | 66 | 61 | partial (re-promote fills 5 missing) |
| `deportes.disciplinas` | 32 | 32 | full |
| `socios.locacion` | 89 | 91 | full (+2 from re-promote) |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | full (+4 from re-promote) |
| `tesoreria.gastos` | 2,114 | 2,114 | full |

**What's LEFT for Slice E closure (E2 — this delta).** The data layer is COMPLETE. What operators need now is **operational glue**, not new data-layer code:

1. **Admin API endpoint** — `POST /api/v1/promote/trigger` so an ADMIN can trigger `pnpm db:promote` from the API (currently CLI-only via `db:promote`). Mirrors the existing `POST /api/v1/import/trigger` (`apps/api/src/routes/import.ts:41-63`) but **synchronously** (returns 200 + `PromotionResult[]` when done, NOT 202 + `batchId`). Rate-limited per-operator (1/min) via `@fastify/rate-limit` `keyGenerator: operator.sub`.
2. **`promoted_at` audit column** — adds `timestamp with time zone` to `raw_events` for per-row idempotency tracking at the source-event level (today's idempotency lives on `master.legacy_id` UNIQUE INDEX only — works, but `raw_events.promoted_at` makes per-row audit trivial via `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table`).
3. **`docs/runbook.md` "Promotion Pipeline" section** — currently has 0 mention of promotion (verified 343 lines). Operators must read the spec.
4. **Final atomic canonical sync** — adds 3 NEW requirements (`Admin Promotion Trigger`, `Per-row Promotion Audit`, `Runbook Documentation`) to `openspec/specs/deployment-devops/spec.md` (additive-only — does NOT modify the existing Promotion Pipeline requirement shipped in E1b2a/E1b2b).

**E2 is the LAST sub-slice of Slice E.** Per the parent Slice E exploration (§1 + §10) and E1b2b design (§1): no further sub-slices planned after E2. After v0.5.6, the data-promotion pipeline is feature-complete for v1.0. **Slice F or beyond is NOT planned** (E2 closes the data-promotion pipeline for v1.0).

**Why E2 ships as one PR.** The 4 deliverables (migration + endpoint + runbook + spec sync) share reviewers (backend operators + admin). Splitting into 4 PRs multiplies CI/deploy overhead without reducing review load. ~485 raw LoC / ~280 effective — under the 400-line review budget at effective count.

This delta modifies the `deployment-devops` capability by **appending 3 NEW requirements** to the end of the canonical spec. No existing requirement is modified, removed, or rewritten. The diff SHALL be additive-only (per B1b LESSON #1, verified by `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md`).

---

## Capability: `deployment-devops` (modified)

### 5 LOCKED Decisions (user-confirmed 2026-06-25)

| # | Decision | Locked value | Rationale |
|---|----------|--------------|-----------|
| **Q1** | Admin endpoint auth | **`requireRole('ADMIN')`** | Matches `import/trigger` precedent (`apps/api/src/routes/import.ts:47`); ADMIN is the role that already triggers imports + reconciles + manages operators. `requirePermission('promote:trigger')` would require granting the permission key to specific operators via `role_permissions` — overkill for v1. |
| **Q2** | Sync vs async trigger | **Sync HTTP** (NOT scheduler) | Sync is simpler (`promoteAll()` runs in request thread, returns 200 + `PromotionResult[]` when done). Audit row is unambiguous (one per request, not split across request + job_run). The CLI runner (`pnpm db:promote`) IS the same code path — the endpoint just wraps it. |
| **Q3** | `promoted_at` backfill scope | **Best-effort per-domain UPDATE for `socios` ONLY** (NEW clarification: ctacte/ctacte1 deferred to E3+ because `raw_events.legacy_id` column doesn't exist yet) | Full backfill (`UPDATE ... WHERE source_table IN (...)`) would mask reality — would mark ~107k ctacte1 orphan rows as promoted (they're NOT in master). socios backfill via `(raw_events.source_key = socios.numero_socio)` is exact. No backfill leaves the column useless until operator manually runs UPDATE. socios-only backfill surfaces the N14 limitation naturally via `WHERE promoted_at IS NULL` queries. |
| **Q4** | Rate limit granularity | **Per-operator 1/min via `@fastify/rate-limit` `keyGenerator`** | Reuses the existing plugin (already registered globally at `apps/api/src/plugins/rate-limit.ts:33-56`); mirrors `authRateLimitConfig = { max: 5, timeWindow: '1 minute' }` pattern. `keyGenerator: (req) => req.operator?.sub ?? 'anonymous'` extracts the JWT operator UUID. |
| **Q5** | Runbook section placement | **New top-level "Promotion Pipeline" section** | Matches existing top-level chunking ("Deploy Checklist", "Rollback Procedure", "Backup & Restore", "Common Issues", "Containerized Deploy", "CI/CD"). Sub-sections for cognitive-doc-design progressive disclosure. NOT appended to "Post-deploy (Import Pipeline)" — promotion is a separate operation. NOT a separate doc — violates "Lead with the answer" principle. |

---

## ADDED Requirements

### Requirement: Admin Promotion Trigger (NEW)

The system SHALL provide a `POST /api/v1/promote/trigger` HTTP endpoint on the Fastify v5.2.0 API server that allows an authenticated operator with the `ADMIN` role to trigger a synchronous promotion run from the API surface (mirroring the existing `pnpm db:promote` CLI runner) without SSHing into the server. The endpoint SHALL be per-operator rate-limited to 1 request per 60 seconds via `@fastify/rate-limit`'s `keyGenerator` extracting the JWT operator subject (`request.operator.sub`). The endpoint SHALL emit exactly 1 `audit_events` row per successful trigger with `action: 'PROMOTE_TRIGGER'`, and SHALL guard against concurrent triggers via an in-memory `promotionInFlight` boolean flag on the `AppContainer` (auto-released in `finally`). The response body SHALL be JSON with `{ status, inserted, skipped, failed, durationMs, domains: PromotionResult[] }` and HTTP status 200 on completion.

The endpoint SHALL be implemented in a new file `apps/api/src/routes/promote.ts` (~150 LoC), registered in `apps/api/src/server.ts` alongside `importRoutes`, and exposed via the `FastifyPluginCallback` pattern matching the existing import routes (`apps/api/src/routes/import.ts:31-65`). The endpoint SHALL accept a request body `{ domain?: 'all' | Domain }` (default `'all'`) validated by a `zod` schema. The request SHALL have a 120-second timeout via `request.routeOptions.config.timeout = 120_000` to avoid NGINX `proxy_read_timeout 60s` mid-flight cut for full `domain: 'all'` promotions (~60-90s on live DB). The route SHALL also expose `GET /api/v1/promote/status` (ADMIN-only) returning the last 20 promotion runs read from `audit_events` where `action = 'PROMOTE_TRIGGER'`.

#### Scenario: Admin trigger succeeds (sync HTTP, returns 200)

- GIVEN the API server is running and connected to `192.168.1.102:5432/athlos`
- AND an operator with `role: 'ADMIN'` is authenticated via JWT
- WHEN the operator POSTs `/api/v1/promote/trigger` with body `{}` (defaults to `domain: 'all'`)
- THEN the API SHALL call `promoteAll(container.db)` synchronously
- AND the response HTTP status SHALL be 200
- AND the response body SHALL be `{ status: 'completed' | 'failed', inserted: number, skipped: number, failed: number, durationMs: number, domains: PromotionResult[] }`
- AND on a re-run after E1b2b (8 domains fully populated): `inserted` SHALL be 0 across all 8 domains (idempotent), `skipped` SHALL match the projected rows count (~613k total: 16,383 socios + 197,521 ctacte + 150,129 ctacte1 + 61 escuela + 32 deportes + 91 locacion + 8,149 caja + 2,114 gastos), and `failed` SHALL match the documented FK failures (~10 from pre-E1a ctacte orphans)
- AND exactly 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'`, `entity_type: 'promotion'`, `entity_id: 'promotion-<timestamp>'`, and `new_value: { domain: 'all', totals, durationMs }`

#### Scenario: Admin trigger rate-limited (returns 429)

- GIVEN an ADMIN operator just triggered `POST /api/v1/promote/trigger` 10 seconds ago
- WHEN they POST `/api/v1/promote/trigger` again
- THEN the API SHALL return HTTP 429 (Too Many Requests)
- AND the response SHALL include a `Retry-After` header indicating seconds until the window resets
- AND the response body SHALL match `{ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', retry_after: <seconds> }` (the existing `apps/api/src/plugins/rate-limit.ts` errorResponseBuilder shape)

#### Scenario: Non-admin operator blocked (returns 403)

- GIVEN an operator with `role: 'CONSULTA'` (NOT ADMIN) is authenticated via JWT
- WHEN they POST `/api/v1/promote/trigger`
- THEN the API SHALL return HTTP 403 (Forbidden) via `requireRole('ADMIN')` middleware
- AND no promotion SHALL execute
- AND no `audit_events` row SHALL be inserted (the request never reaches the handler)

#### Scenario: Unauthenticated request blocked (returns 401)

- GIVEN no JWT is present in the `Authorization` header
- WHEN a request is made to `POST /api/v1/promote/trigger`
- THEN the API SHALL return HTTP 401 (Unauthorized) via `requireRole('ADMIN')` middleware chain
- AND no promotion SHALL execute

#### Scenario: Concurrent trigger returns `already_running`

- GIVEN `container.promotionInFlight` is `true` (a promotion is already executing from a previous trigger)
- WHEN a second ADMIN operator POSTs `/api/v1/promote/trigger`
- THEN the API SHALL return HTTP 200
- AND the response body SHALL be `{ status: 'already_running' }`
- AND the second promotion SHALL NOT execute
- AND no second `audit_events` row SHALL be inserted for the second request
- AND when the first promotion completes, `container.promotionInFlight` SHALL be reset to `false` in the `finally` block (guaranteed by try/finally even on exception)

#### Scenario: Promotion failure returns 500 with error summary

- GIVEN an ADMIN operator POSTs `/api/v1/promote/trigger` and `promoteAll()` throws an uncaught exception (e.g., DB connection drop)
- WHEN the handler catches the error
- THEN the API SHALL return HTTP 500 (Internal Server Error)
- AND the response body SHALL be `{ status: 'failed', error: <error message>, durationMs: <ms> }`
- AND `container.promotionInFlight` SHALL still be reset to `false` via the `finally` block

#### Scenario: `GET /api/v1/promote/status` returns last 20 promotion runs

- GIVEN an ADMIN operator is authenticated
- WHEN they GET `/api/v1/promote/status`
- THEN the API SHALL return HTTP 200
- AND the response body SHALL be `{ runs: AuditEvent[] }` containing the last 20 `audit_events` rows where `action = 'PROMOTE_TRIGGER'`, ordered by `created_at DESC`
- AND each run SHALL expose `id`, `operatorId`, `action`, `entityId`, `newValue`, `createdAt`

---

### Requirement: Per-row Promotion Audit (`promoted_at` column) (NEW)

The system SHALL provide a `raw_events.promoted_at timestamp with time zone` column for per-row promotion tracking at the source-event level (belt-and-suspenders with the `master.legacy_id` UNIQUE INDEX). The column SHALL be added via a new hand-written migration `packages/db/drizzle/0016_promoted_at.sql` applied via `psql` (NOT `drizzle-kit migrate` — per E1b1 LESSON re: `_journal.json` tracking mismatch). The migration SHALL also create an index `idx_raw_events_promoted_at` on `(promoted_at)` for fast `WHERE promoted_at IS NULL` queries, and SHALL include a best-effort backfill UPDATE for the `socios` source_table (narrowed from the original 3-domain plan due to the `raw_events.legacy_id` column not existing yet — see NEW clarification). ctacte/ctacte1 backfill is documented as TODO E3+ in the runbook "Known Limitations" + spec success criteria.

The promotion algorithm (`packages/promotion/src/promote.ts`) SHALL filter the projection scan by `WHERE raw_events.promoted_at IS NULL` via JOIN `(source_table, source_key)`, and SHALL bulk-update `raw_events.promoted_at = now()` for all successfully inserted `(source_table, source_key)` pairs after `insertMasterBatch` completes for the domain. The Drizzle schema (`packages/db/src/schema/public.ts`) SHALL add `promotedAt: timestamp('promoted_at', { withTimezone: true })` to the `rawEvents` table definition.

#### Scenario: Migration 0016 adds `promoted_at` column + INDEX (idempotent)

- GIVEN the test DB `192.168.1.102:5432/athlos` is running and `raw_events` has 652,661 rows
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql` is executed
- THEN the migration SHALL add column `promoted_at timestamptz` to `public.raw_events` (nullable, no default)
- AND the migration SHALL create index `idx_raw_events_promoted_at` on `public.raw_events(promoted_at)` (plain btree — partial `WHERE promoted_at IS NOT NULL` is acceptable but NOT required)
- AND the migration SHALL be wrapped in a single transaction with `SET LOCAL statement_timeout = '60s'`
- AND running the same SQL twice SHALL be a no-op (`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` guards)
- AND `\d public.raw_events` SHALL show the `promoted_at` column + `idx_raw_events_promoted_at` index
- AND `_journal.json` SHALL have a NEW idx-16 entry with tag `0016_promoted_at` (next sequential after E1b2b's idx 15)

#### Scenario: `socios` backfill marks ~16,383 raw_events rows as promoted

- GIVEN migration 0016 has just been applied and `raw_events.promoted_at` is NULL for all 652,661 rows
- WHEN the best-effort backfill UPDATE runs (in the same transaction as the migration):
  ```sql
  UPDATE "public"."raw_events" re SET "promoted_at" = now()
  FROM "socios"."socios" s
  WHERE re.source_table = 'socios' AND re.source_key = s.numero_socio
    AND re.promoted_at IS NULL;
  ```
- THEN approximately **16,383** `raw_events` rows SHALL be backfilled with `promoted_at = <migration timestamp>` (the count of `socios.socios` master rows verified live 2026-06-25)
- AND `SELECT count(*) FROM public.raw_events WHERE source_table = 'socios' AND promoted_at IS NOT NULL` SHALL return ~16,383
- AND `SELECT count(*) FROM public.raw_events WHERE source_table = 'socios' AND promoted_at IS NULL` SHALL return ~22,974 (the pre-E1a orphans without `legacy_id`)
- AND ctacte/ctacte1 raw_events rows SHALL remain `promoted_at IS NULL` post-backfill (TODO E3+)

#### Scenario: `promote.ts` filters projection by `WHERE raw_events.promoted_at IS NULL`

- GIVEN some `raw_events` rows have `promoted_at IS NULL` (unpromoted) and some have `promoted_at IS NOT NULL` (already promoted, including backfilled `socios` rows)
- WHEN `promoteDomain(db, $domain)` runs against a projection table
- THEN the projection scan query SHALL include a JOIN clause:
  ```sql
  JOIN public.raw_events re
    ON re.source_table = $domain
   AND re.source_key = pe.source_key
   AND re.promoted_at IS NULL
  ```
- AND only rows whose corresponding `raw_events` row has `promoted_at IS NULL` SHALL be considered for promotion
- AND the `(source_table, source_key)` btree index on `raw_events` (`idx_raw_events_source_key`) SHALL make the JOIN fast

#### Scenario: Successful INSERT stamps `promoted_at = now()` (bulk UPDATE)

- GIVEN `promoteDomain` has just successfully inserted a batch of N rows into the master table
- WHEN `insertMasterBatch` returns
- THEN the handler SHALL execute a bulk UPDATE:
  ```sql
  UPDATE public.raw_events
  SET promoted_at = now()
  WHERE source_table = $domain
    AND source_key = ANY($insertedKeys::varchar[])
  ```
- AND the N corresponding `raw_events` rows SHALL have `promoted_at = now()` populated
- AND on a 2nd `promoteDomain` run, those N rows SHALL be skipped (filtered by `WHERE re.promoted_at IS NULL`)

#### Scenario: Cross-run idempotency via `promoted_at`

- GIVEN a `raw_events` row has `promoted_at = '2026-06-25T10:00:00Z'` (already promoted)
- WHEN `promoteDomain(db, $domain)` runs against the same projection table
- THEN the row SHALL be skipped by the `WHERE re.promoted_at IS NULL` filter
- AND `promoted_at` SHALL NOT be re-updated (no UPDATE fires for skipped rows)
- AND `bash scripts/verify-slice.sh` SHALL still exit 0 (TRUE idempotency preserved at both layers: `promoted_at` filter + `master.legacy_id` UNIQUE INDEX)

#### Scenario: Per-row audit query surfaces promotion status

- GIVEN the operator wants to inspect promotion coverage
- WHEN they run `SELECT source_table, count(*) AS total, count(promoted_at) AS promoted FROM public.raw_events GROUP BY source_table ORDER BY source_table;`
- THEN the result SHALL show per-source_table totals + promoted counts:
  - `socios`: total ~39,357, promoted ~16,383 (backfilled), unpromoted ~22,974 (pre-E1a orphans)
  - `ctacte`: total ~326,275, promoted ~0 (TODO E3+ — no backfill yet), unpromoted ~326,275
  - `ctacte1`: total ~245,370, promoted ~0 (TODO E3+), unpromoted ~245,370
  - `escuela`, `deportes`, `locacion`, `caja`, `gastos`: total ~10,446, promoted ~0 (these 5 domains use composite NK dedup at the master level, NOT `raw_events.promoted_at` for primary idempotency; promoted_at stays NULL)
- AND the operator can immediately identify per-domain promotion gaps

---

### Requirement: Runbook Documentation (NEW)

The system SHALL provide operator-facing documentation in `docs/runbook.md` under a NEW top-level section "Promotion Pipeline" (placed between "Containerized Deploy" and "CI/CD" to match existing top-level chunking). The section SHALL explain how to trigger a promotion (CLI vs API), document the 8 master tables + their natural keys + `legacy_id` pattern, describe the `promoted_at` audit column semantics, document the cross-run idempotency contract, detail the admin API `POST /promote/trigger` endpoint (auth, rate limits, response shape, error responses), and document known limitations (N7/N8/N14/N16). Each sub-section SHALL include at least one code example or table for cognitive load reduction.

The runbook section SHALL mirror the spec but be operator-focused (using CLI invocations + curl examples) rather than implementation-focused (TypeScript interfaces, RFC 2119 keywords). The documentation SHALL be added as a PATCH to `docs/runbook.md` (+~90 LoC) — NOT as a separate doc file — to preserve the "Lead with the answer" cognitive-doc-design principle (operators should look in ONE place).

#### Scenario: Runbook has "Promotion Pipeline" section with CLI + API examples

- GIVEN the runbook has the new "Promotion Pipeline" section
- WHEN an operator reads the "How to run promotion (CLI vs API)" sub-section
- THEN they SHALL see the CLI example: `DATABASE_URL=... pnpm db:promote`
- AND they SHALL see the API example: `curl -X POST http://localhost:3001/api/v1/promote/trigger -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" -d '{}'`
- AND they SHALL see the verification command: `bash scripts/verify-slice.sh` (the REAL gate, per E1b1/E1b2a/E1b2b LESSON)
- AND a recommendation SHALL state: "Use the API for single-domain promotions (<10s, no NGINX timeout risk). Use the CLI for full `domain: 'all'` promotions."

#### Scenario: Runbook documents the 8 master tables + their natural keys

- GIVEN the runbook has the "The 8 master tables + their natural keys" sub-section
- WHEN an operator reads it
- THEN they SHALL see a table mapping each `Domain` to its master table + natural key + `legacy_id` source:
  - `socios` → `socios.socios` → `numero_socio` → `deterministicUuid('socios:'+numeroSocio)`
  - `escuela` → `socios.escuela` → `codigo` → `deterministicUuid('escuela:'+codigo)`
  - `deportes` → `deportes.disciplinas` → `codigo` → `deterministicUuid('deporte:'+codigo)`
  - `locacion` → `socios.locacion` → composite `(tipo_principal, numero)` → `deterministicUuid('locacion:'+tipo|numero)`
  - `caja` → `tesoreria.caja_movimiento` → 4-tuple → `deterministicUuid('caja:'+4-tuple)`
  - `gastos` → `tesoreria.gastos` → 5-tuple → `deterministicUuid('gastos:'+5-tuple)`
  - `ctacte` → `tesoreria.ctacte` → 5-tuple → `deterministicUuid('ctacte:'+5-tuple)`
  - `ctacte1` → `tesoreria.ctacte1` → 5-tuple → `deterministicUuid('ctacte1:'+5-tuple)`
- AND they SHALL see the `PROMOTION_ORDER` sequence: `socios → escuela → deportes → locacion → caja → gastos → ctacte → ctacte1`

#### Scenario: Runbook documents the `promoted_at` audit column

- GIVEN the runbook has the "The `promoted_at` audit column" sub-section
- WHEN an operator reads it
- THEN they SHALL see the per-row query: `SELECT source_table, count(*) AS total, count(promoted_at) AS promoted FROM public.raw_events GROUP BY source_table ORDER BY source_table;`
- AND they SHALL see the expected post-E2 output (matching the scenario "Per-row audit query surfaces promotion status")
- AND they SHALL see a backfill limitation note: "Migration 0016 backfills `promoted_at` for `socios` ONLY. ctacte/ctacte1 backfill requires `raw_events.legacy_id` (E3+)."

#### Scenario: Runbook documents the Admin API contract

- GIVEN the runbook has the "Admin API: `POST /promote/trigger`" sub-section
- WHEN an operator reads it
- THEN they SHALL see a table with: Method + path, Auth (`requireRole('ADMIN')`), Rate limit (1/min/operator), Request body shape, Response 200 shape, Response 200 concurrent shape, Response 401/403/429/500 mappings, Request timeout (120s), Audit row contract (1 `audit_events` row per trigger with `action: 'PROMOTE_TRIGGER'`)

#### Scenario: Runbook documents known limitations

- GIVEN the runbook has the "Known Limitations" sub-section
- WHEN an operator reads it
- THEN they SHALL see a table documenting N7 (caja_detalle — 122 wide columns deferred), N8 (deportes.inscripciones rebuild deferred), N14 (stale `entity_uuids` → ctacte1 promotion rate stuck at ~61% — ~107k orphan rows), N16 (gastos FK to ctacte — flat ledger in v1, FK deferred)
- AND each limitation SHALL include a "Future slice" column (N7, N8, N14, N16 respectively)
- AND the operator SHALL understand the limitations don't block v1.0 promotion but are tracked for post-MVP work

---

## Success Criteria (3 NEW for E2 scope — additive only)

1. **E2 NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) after E2 lands — promotion works for all **8 domains** + TRUE idempotency verified on 2nd run (0 new inserts across all 8 master tables). The E2 migration adds a column + index + backfill but does NOT change master row counts; the existing verify-slice.sh gate (commit `061be50`) covers all 8 tables unchanged.

2. **E2 NEW**: `POST /api/v1/promote/trigger` (ADMIN JWT) returns 200 with `{ status: 'completed', inserted, skipped, failed, durationMs, domains: PromotionResult[] }` after running `promoteAll(db)` synchronously. On a re-run after E1b2b, `inserted` SHALL be 0 across all 8 domains (idempotent), `skipped` SHALL match the projected rows count (~613k total). Verified by `apps/api/src/routes/promote.test.ts` mock-container tests (6 vitest cases mirroring `import.test.ts`).

3. **E2 NEW**: `SELECT count(*) FROM public.raw_events WHERE promoted_at IS NOT NULL` returns **~16,383** post-migration (the `socios` backfill count — verified live against `socios.socios` master count). ctacte/ctacte1 remain 0 (TODO E3+). The 5 other domains (escuela/deportes/locacion/caja/gastos) also remain 0 because they use composite-NK master-level dedup, NOT `raw_events.promoted_at`.

> Existing canonical criteria #1-30 (post-Slice D), #47-48 (post-E1b2b) remain UNCHANGED. E2 adds criteria #49-51 above for the admin API + audit column + runbook. The same `diff` verification against `openspec/specs/deployment-devops/spec.md` SHALL be additive-only with no removals, no modifications to the existing Promotion Pipeline requirement at canonical lines 167-276, and no modifications to the existing `tesoreria.gastos` master table requirement at canonical lines 280-315.

---

## Scope Boundary

### In scope for E2 (this delta ships)

| Item | Description |
|------|-------------|
| `packages/db/drizzle/0016_promoted_at.sql` | NEW migration (~20 LoC, hand-written SQL) — ALTER TABLE + INDEX + `socios`-only backfill UPDATE wrapped in single transaction with `SET LOCAL statement_timeout = '60s'` |
| `packages/db/drizzle/meta/_journal.json` | MODIFY (+6 LoC) — idx 16 entry with tag `0016_promoted_at` (next sequential after E1b2b's idx 15) |
| `packages/db/src/schema/public.ts` | MODIFY (+3 LoC) — add `promotedAt: timestamp('promoted_at', { withTimezone: true })` to `rawEvents` table definition |
| `packages/promotion/src/promote.ts` | MODIFY (+30 LoC) — `WHERE raw_events.promoted_at IS NULL` filter on projection scan; bulk UPDATE `promoted_at = now()` for inserted keys after `insertMasterBatch` |
| `packages/promotion/src/dedup.ts` | MODIFY (+15 LoC) — `loadExistingNaturalKeys` reads `raw_events.promoted_at IS NOT NULL` for ctacte/ctacte1 as secondary cross-check (belt-and-suspenders with `master.legacy_id`) |
| `packages/promotion/src/index.ts` | MODIFY (+2 LoC) — re-export new helpers if added |
| `apps/api/src/routes/promote.ts` | NEW (~150 LoC) — `POST /api/v1/promote/trigger` (ADMIN + per-operator 1/min) + `GET /api/v1/promote/status` (ADMIN, last 20 runs) |
| `apps/api/src/routes/promote.test.ts` | NEW (~120 LoC) — 6 vitest cases (ADMIN 200, CONSULTA 403, unauth 401, rate-limit 429, concurrent `already_running`, status 200) mirroring `import.test.ts` mock-container pattern |
| `apps/api/src/server.ts` | MODIFY (+5 LoC) — register `promoteRoutes` alongside `importRoutes` |
| `apps/api/src/container.ts` | MODIFY (+3 LoC) — add `promotionInFlight: boolean` to `AppContainer` interface + initialize `false` in `buildContainer` |
| `docs/runbook.md` | MODIFY (+90 LoC) — new top-level "Promotion Pipeline" section with 6 sub-sections |
| `openspec/specs/deployment-devops/spec.md` | MODIFY (+~250 LoC of spec.md) — 3 NEW additive requirements + 13 NEW scenarios + 3 NEW success criteria (#49-51); existing Promotion Pipeline requirement UNCHANGED |
| `CHANGELOG.md` | MODIFY (+5 LoC) — v0.5.6 entry |
| Root + 18 `packages/*/package.json` | MODIFY (+1 each) — bump 0.5.5 → 0.5.6 in SEPARATE release commit (B1b LESSON #2) |
| **Total raw LoC** | **~485 raw / ~280 effective** — under the 400-line review budget at effective count |

### Deferred to E3+ (out of scope for E2)

| Item | Reason | Future slice |
|------|--------|--------------|
| `raw_events.legacy_id` column | Required for ctacte/ctacte1 backfill (JOIN through `master.legacy_id`); doesn't exist today | **E3+** |
| ctacte/ctacte1 backfill of `promoted_at` | Blocked on `raw_events.legacy_id`; documented as TODO in runbook "Known Limitations" | **E3+** |
| Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` | Sync HTTP works for v1 (operator manually triggers; ~60-90s acceptable) | E3+ |
| `pg_advisory_lock` for multi-process concurrent-promotion prevention | In-memory flag sufficient for v1 single-process API | E3+ |
| Dry-run mode (`POST /promote/trigger?dryRun=true`) | CLI `--dry` flag is the future home | E3+ |
| OpenAPI / Swagger spec generation | No OpenAPI in repo; API documented via spec + runbook | E3+ |
| **N7**: caja_detalle (122 wide columns per header) | Deferred per E1b2a scope | N7 (future) |
| **N8**: `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table yet | N8 (future) |
| **N14**: stale `entity_uuids` repopulation | Would unlock ~107k orphan ctacte1 rows → ~100% ctacte1 promotion rate; documented as known limitation | N14 (future) |
| **N16**: `gastos` FK to `ctacte` via `cctcuenta` lookup | Flat ledger in v1 (scope correction #C7); FK reconstruction deferred | N16 (future) |
| **Slice F or beyond** | NOT planned — Slice E closes the data-promotion pipeline for v1.0 | NEVER |

---

## Out of Scope (re-stated for clarity)

- **No NEW master tables** in E2. All 8 are already created by E1a/E1b1/E1b2a/E1b2b.
- **No NEW FK constraints** in E2. `gastos` deliberately has NO socio_id FK (#C8) and NO ctacte FK (#C7) in v1 — unchanged from E1b2b.
- **No modification to the existing Promotion Pipeline requirement** at canonical lines 167-276 (the E1b2b FINAL sync shipped it as-is; E2 adds 3 NEW requirements below it).
- **No modification to the existing `tesoreria.gastos` master table requirement** at canonical lines 280-315 (E1b2b shipped it as-is; E2 doesn't touch gastos domain logic).
- **No `pnpm typecheck` / `pnpm lint` regressions** — all existing 11+ vitest cases must remain green (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug; new admin endpoint tests use mock container pattern).
- **No chained PRs within E2** (per session preflight `delivery_strategy: ask-always` + `review_budget_lines: 400`). E2 alone is one PR (~485 raw LoC / ~280 effective — over the budget at raw count ~121%, well under at effective ~70%). **No split recommended** because (a) all 4 deliverables share reviewers, (b) splitting multiplies CI/deploy overhead, (c) Slice E is the LAST data-promotion slice — no further sub-slices planned.

---

## Acceptance Criteria (delta-specific, pre-apply checklist)

These are the E2 delta's acceptance criteria; the full set lives in `proposal.md` §10. Restated here for spec-phase completeness:

- [ ] Migration `0016_promoted_at.sql` adds `raw_events.promoted_at` column + index + backfills `socios` rows (idempotent via `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + `WHERE promoted_at IS NULL` on backfill)
- [ ] Migration applied via `psql` (NOT `drizzle-kit migrate` per E1b1 LESSON); manual `_journal.json` entry update with idx 16
- [ ] ctacte/ctacte1 backfill documented as TODO E3+ (NEW clarification from propose phase)
- [ ] Admin endpoint `POST /api/v1/promote/trigger` exists in Fastify v5.2.0 route (`apps/api/src/routes/promote.ts`)
- [ ] Admin endpoint requires `ADMIN` role via `requireRole('ADMIN')` (403 for non-admin via `requireRole` middleware)
- [ ] Admin endpoint enforces 1 trigger/minute per operator via `@fastify/rate-limit` `keyGenerator: operator.sub` (429 on rapid retry)
- [ ] Admin endpoint returns 200 with `{ status, inserted, skipped, failed, durationMs, domains: PromotionResult[] }` on success
- [ ] Admin endpoint returns `{ status: 'already_running' }` when `container.promotionInFlight` is true (concurrent-trigger guard)
- [ ] Admin endpoint emits exactly 1 `audit_events` row per successful trigger with `action: 'PROMOTE_TRIGGER'`
- [ ] `GET /api/v1/promote/status` returns last 20 `audit_events` rows where `action = 'PROMOTE_TRIGGER'` (ADMIN-only)
- [ ] 6 NEW vitest cases in `apps/api/src/routes/promote.test.ts` (mirrors `import.test.ts` mock-container pattern)
- [ ] `promote.ts` filters projection by `WHERE raw_events.promoted_at IS NULL` (verified by inspecting test DB before/after; socios backfilled rows SHALL be skipped on re-run)
- [ ] `promote.ts` updates `raw_events.promoted_at = now()` after successful INSERT (verified by selecting 1 promoted row)
- [ ] Cross-run idempotency via `promoted_at` works (re-run inserts 0 new rows; `bash scripts/verify-slice.sh` exits 0)
- [ ] `bash scripts/verify-slice.sh` exits 0 (PASS — promotion works + idempotency verified for all 8 domains — E1b1/E1b2a/E1b2b LESSON non-negotiable)
- [ ] `docs/runbook.md` has top-level "Promotion Pipeline" section (between "Containerized Deploy" and "CI/CD")
- [ ] Section has 6 sub-sections: How to run promotion (CLI vs API), 8 master tables + NKs + legacy_id pattern, `promoted_at` audit column, Cross-run idempotency contract, Admin API: `POST /promote/trigger`, Known Limitations (N7/N8/N14/N16)
- [ ] Known Limitations documents N7/N8/N14/N16 with current impact + future slice
- [ ] Canonical spec adds 3 NEW requirements ADDITIVE-only — `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes (no removals, no modifications to existing Promotion Pipeline requirement at canonical lines 167-276)
- [ ] No `Co-Authored-By` or AI attribution in any commit message (Conventional Commits only)
- [ ] 3-commit shape preserved: `feat(promotion): wire admin endpoint + promoted_at audit (v0.5.6 prep)` → `docs(spec): atomic sync — 3 NEW Slice E2 requirements (admin API + audit + runbook)` → `chore(release): v0.5.6` (B1b LESSON #2)
- [ ] Merge to `main` BEFORE `git branch -D spec/athlos-promote-projection-to-master-e2` (B1b LESSON #4)
- [ ] `apps/api/src/container.ts` adds `promotionInFlight: boolean` field (initialized `false` in `buildContainer`)
- [ ] `apps/api/src/server.ts` registers `promoteRoutes` alongside `importRoutes` (around line 202)

---

## Open Questions (RESOLVED + LOCKED 2026-06-25)

All open questions for E2 scope are RESOLVED + LOCKED:

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| **Q1** | Admin endpoint auth | `requireRole('ADMIN')` (NOT `requirePermission`) | E2 explore Q1 default + user-confirmed 2026-06-25 |
| **Q2** | Sync vs async trigger | **Sync HTTP** (NOT scheduler) | E2 explore Q2 default + user-confirmed 2026-06-25 |
| **Q3** | `promoted_at` backfill scope | Best-effort per-domain UPDATE; **narrowed to `socios` ONLY** (NEW clarification during propose phase — ctacte/ctacte1 deferred to E3+ because `raw_events.legacy_id` column doesn't exist yet) | E2 explore Q3 default + user-confirmed 2026-06-25 + engram observation #2547 |
| **Q4** | Rate limit granularity | Per-operator 1/min via `@fastify/rate-limit` `keyGenerator: operator.sub` | E2 explore Q4 default + user-confirmed 2026-06-25 |
| **Q5** | Runbook section placement | New top-level "Promotion Pipeline" section | E2 explore Q5 default + user-confirmed 2026-06-25 |

**All 5 decisions LOCKED. E2 scope is fully bounded — no further open questions.**

---

## Ready for design?

**YES.** The scope is precisely bounded:

- 1 NEW column (`raw_events.promoted_at`) + 1 NEW endpoint (`POST /promote/trigger`) + 1 NEW endpoint (`GET /promote/status`) + 1 NEW runbook section + 3 NEW ADDITIVE canonical-spec requirements
- ~485 raw LoC / ~280 effective (over the 400-line review budget at raw count ~121%, well under at effective ~70%; no split recommended)
- All 5 user-confirmed decisions + 1 NEW clarification (backfill narrowed to `socios` only) embedded explicitly
- All E1b1/E1b2a/E1b2b LESSONs applied: `bash scripts/verify-slice.sh` is HARD GATE (E1b1/E1b2a/E1b2b non-negotiable), migration via `psql` (E1b1), existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug), 6 NEW admin endpoint tests use Fastify mock-container pattern (no destructive setup)
- All B1b LESSONs applied: atomic canonical sync (additive only, B1b LESSON #1 HIGHEST), separate release commit (B1b LESSON #2), cherry-pick reorder (B1b LESSON #3), merge-before-delete (B1b LESSON #4)
- Slice E is the LAST data-promotion slice — no further sub-slices planned after E2

**Next step:** sdd-design → write `design.md` mirroring E1b2b design format (~200-300 lines, focused on admin endpoint design + `promoted_at` filter + runbook section structure + canonical sync diff strategy). Then sdd-tasks → break into 12 implementation tasks (TASK-001..TASK-012 per `proposal.md` §7). Then sdd-apply → wire admin endpoint + migration + `promoted_at` filter + runbook with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a/E1b2b LESSON — non-negotiable). Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` to close Slice E permanently.

**Apply-phase CRITICAL reminders (all in acceptance criteria above):**

1. **Additive-only atomic sync** (B1b LESSON #1, HIGHEST) — apply MUST verify `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes. No removals, no rewrites of prior Slice E scenarios. The existing Promotion Pipeline requirement (canonical lines 167-276) and `tesoreria.gastos` requirement (canonical lines 280-315) SHALL remain UNCHANGED.
2. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix). Migration 0016 adds a column + index + backfill but does NOT change master row counts; existing verify-slice.sh covers all 8 tables unchanged.
3. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch. Manual idx-16 `_journal.json` entry.
4. **`socios` backfill count verification** at apply time: `SELECT count(*) FROM raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL` MUST equal ~16,383 (the live `socios.socios` master count). ctacte/ctacte1 backfill documented as TODO E3+ — NOT blocking E2 acceptance.
5. **3-commit shape preserved** per B1b LESSON: `feat` → `docs(spec)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D` (B1b LESSON #4).

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e2/spec` (via `mem_save`)*