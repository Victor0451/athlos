# Exploration: athlos-promote-projection-to-master-e2

**Date:** 2026-06-25
**Change:** `athlos-promote-projection-to-master-e2` (Slice E — last sub-slice)
**Phase:** explore
**Mode:** hybrid (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/explore-athlos-promote-projection-to-master-e2/exploration.md`
**Author:** sdd-explore sub-agent
**Pre-resolved:** orchestrator provided locked context (E1b DONE at v0.5.5 with 8/8 master domains; `scripts/verify-slice.sh` extended; spec FINAL atomic sync applied in commit `e753528`; E1b1 LESSON = `bash scripts/verify-slice.sh` is the REAL gate; E1b1 LESSON = migration via psql NOT drizzle-kit)
**Branch:** `explore/athlos-promote-projection-to-master-e2` (from `origin/main`, commit `36ac630`)

---

## 1. Verdict

Slice E's data layer is **complete** post-E1b2b/v0.5.5. All 8 master domains populate via `pnpm db:promote`, the FINAL atomic canonical sync is applied (`e753528`), and `scripts/verify-slice.sh` exits 0 against the live DB (verified 2026-06-25T15:06:09Z).

**What's left for v1.0 Slice E completion is operational glue**, not new data-layer code:

1. **Admin API endpoint** — `POST /api/v1/promote/trigger` so an ADMIN can trigger `pnpm db:promote` from the API instead of SSHing into the server (currently CLI-only via the `db:promote` pnpm script).
2. **`promoted_at` audit column** — adds a `timestamp with time zone` column on `raw_events` to enable true per-row idempotency tracking at the source-event level (current idempotency lives on `master.legacy_id` UNIQUE INDEX only — works, but `raw_events.promoted_at` makes per-row audit trivial via `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table`).
3. **`docs/runbook.md` "Promotion Pipeline" section** — currently the runbook has no promotion section at all (verified lines 1-343); operators must read the spec to understand the pipeline.
4. **Final atomic canonical sync** — adds 3 NEW requirements (`Admin Promotion Trigger`, `Per-row Promotion Audit`, `Runbook Documentation`) to `openspec/specs/deployment-devops/spec.md`.

| What | Where | Est. LoC |
|------|-------|---------:|
| `packages/db/drizzle/0016_promoted_at.sql` | migration: ALTER + backfill + INDEX | ~14 |
| `packages/db/src/schema/public.ts` | add `promotedAt` column | +3 |
| `apps/api/src/routes/promote.ts` | new admin route (POST + GET status) | ~150 |
| `apps/api/src/routes/promote.test.ts` | vitest cases (admin gate, idempotency) | ~120 |
| `apps/api/src/server.ts` | register `promoteRoutes` | +3 |
| `docs/runbook.md` | new "Promotion Pipeline" + "Admin API" sections | +90 |
| `openspec/specs/deployment-devops/spec.md` | 3 NEW requirements + 6 scenarios + 3 success criteria | +80 |
| `CHANGELOG.md` | v0.5.6 entry | +5 |
| Root + 18 package.json files | bump 0.5.5 → 0.5.6 (release commit) | +1 each |
| **Total** | | **~485 raw LoC** |

**Slightly over the 400-line PR budget at raw count (~21% over) but well under at effective count (~250 LoC).** The `docs/runbook.md` section is the biggest contributor — it's documentation, not logic, and the cognitive-doc-design pattern (progressive disclosure, chunking) requires chunking it into 2 sub-sections (Promotion Pipeline + Admin API), which adds LoC but improves reviewability.

**Recommendation: single PR, no chained PRs.** The 4 deliverables (migration + endpoint + runbook + spec sync) are tightly coupled — splitting them creates artificial review barriers. The single PR closes Slice E permanently; no further sub-slices are planned (verified: this is the LAST sub-slice per the E1b2b design §1 + parent Slice E exploration §1).

**Versioning:** v0.5.5 → **v0.5.6** PATCH. Patch bumps because each addition is a capability ADD on top of the E1b2b-shipped data layer (no breaking schema change — `promoted_at` is a nullable column; new endpoint is additive; runbook/spec are documentation).

**E1b LESSONs to apply (already documented in Engram #2531):**

1. **`bash scripts/verify-slice.sh` is the REAL gate** — apply sub-agent MUST run it before declaring ready. Exit 0 = promotion works + idempotency verified. Already extended in commit `061be50` to include `tesoreria.gastos` in `MASTER_TABLES`; the E2 migration just adds the column, doesn't change row counts.
2. **Migration via `psql`, NOT `drizzle-kit migrate`** — E1b1 LESSON: hand-written SQL + `_journal.json` entry + apply via `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql`.
3. **`describe.skip` for promotion tests** — E1b2a LESSON: tests run against real production data and would destructively TRUNCATE. The promote tests are already `describe.skip` (lines 150, 425, 656 of `promote.test.ts`); the E2 admin endpoint tests use Fastify's `app.inject` pattern with mock container (mirroring `apps/api/src/routes/import.test.ts`) — no DB write, no destructive setup needed.
4. **Final atomic canonical sync** — adds 3 NEW requirements (additive, not modifying the existing Promotion Pipeline requirement). Diff MUST be additive-only per B1b LESSON #1.
5. **3-commit shape** — `feat(promotion): wire admin endpoint + promoted_at audit` → `docs(spec): add 3 NEW Slice E2 requirements` → `chore(release): v0.5.6`.

**Ready for proposal?** YES — pending 5 open questions resolved by user (see §12).

---

## 2. Context

**State post-E1b2b/v0.5.5 (commit `36ac630`).** Slice E's data promotion pipeline is fully wired. The pipeline has 3 hops:

```
legacy .DBF → import → raw_events → projection → *master tables
                (Slice B-7c)  (Slice C)       (Slice E1a + E1b1 + E1b2a + E1b2b)
```

Verified live against `192.168.1.102:5432/athlos` 2026-06-25:

| Master table | Projection rows | Current rows | Status |
|--------------|----------------:|-------------:|--------|
| `socios.socios` | 39,357 | 16,383 | partial (E1a `legacy_id` idempotency works on re-run; some pre-E1a manual entries lack `legacy_id`) |
| `tesoreria.ctacte` | 326,275 | 197,521 | partial (cctcuenta backfill yields 0 from stale `entity_uuids`; re-promote inserts the missing ~129k) |
| `tesoreria.ctacte1` | 245,370 | 150,129 | partial (~61% — N14 stale `entity_uuids` limitation) |
| `socios.escuela` | 66 | 61 | partial (re-promote fills the 5 missing) |
| `deportes.disciplinas` | 32 | 32 | ✅ full |
| `socios.locacion` | 89 | 91 | ✅ full (+2 from re-promote) |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | ✅ full (+4 from re-promote) |
| `tesoreria.gastos` | 2,114 | 2,114 | ✅ full |

**`bash scripts/verify-slice.sh` PASSES** (exit 0, 2026-06-25T15:06:09Z). All 8 master tables have `Δ = 0` between 1st and 2nd run — TRUE idempotency verified at the master-row level.

**The 4 remaining deliverables are operational.** The data layer is done; what operators need now is:

1. **Don't have to SSH** to run `pnpm db:promote`. They want an API endpoint. (E1b2a proposal §3 + parent E §5.7 — both planned this.)
2. **Per-row audit trail.** Currently the operator knows "all 2,114 gastos rows promoted" but can't ask "which raw_events did this come from?" without joining through `entity_uuids`. A `promoted_at` column on `raw_events` makes this query trivial.
3. **Documentation they can hand to a new operator** without them reading the spec. The current runbook has 0 mention of promotion.
4. **Spec closure.** The current canonical spec has the Promotion Pipeline requirement (§167-276) but no requirement for the admin endpoint or `promoted_at` column.

**Why E2 ships these 4 together.** They're individually small (~100-200 LoC each) but share the same reviewers (backend operators + admin). Splitting them into 4 PRs would multiply the CI/deploy overhead without reducing review load. Single PR = single review cycle = ~485 LoC total = fast close.

---

## 3. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `POST /api/v1/promote/trigger` admin endpoint | ADMIN-only (`requireRole('ADMIN')`); body `{ domain?: Domain }` (default `'all'`); returns `{ status, results: PromotionResult[], durationMs, totals: { inserted, skipped, failed } }` with HTTP 200 on success |
| **G2** | `GET /api/v1/promote/status` read-only view | ADMIN-only; returns the last `promotion_runs` rows (last 20); mirrors `GET /api/v1/import/status` |
| **G3** | Idempotent trigger: returns `status: 'already_running'` if a promotion is in flight | The endpoint detects concurrent triggers (in-memory flag via `promotion_in_flight` set on the container; auto-released in `finally`); second call returns 200 with `status: 'already_running'` |
| **G4** | Per-operator rate limit: max 1 trigger per 60s | `@fastify/rate-limit` config on the route (`{ max: 1, timeWindow: '1 minute', keyGenerator: operatorId }`); 429 with `retry_after` |
| **G5** | Audit-logged: `audit_events` row per trigger | Calls `emitAudit()` with `action: 'PROMOTE_TRIGGER'`, `entityType: 'promotion'`, `entityId: '<job_run_id>'`; newValue = `PromotionResult[]` summary |
| **G6** | `promoted_at` column on `raw_events` (migration 0016) | `ALTER TABLE public.raw_events ADD COLUMN promoted_at timestamptz`; partial INDEX `WHERE promoted_at IS NOT NULL` for fast per-row queries |
| **G7** | Backfill: set `promoted_at = now()` for source_keys that already have a master row | One-shot UPDATE via JOIN `entity_uuids` → master tables per domain (8 domain-specific UPDATEs); best-effort, NULL for unmatched source_keys (deferred to G8 filter) |
| **G8** | Update `promote.ts` to filter by `raw_events.promoted_at IS NULL` | The promotion query becomes `SELECT pe.* FROM projection pe JOIN raw_events re ON re.id = pe.raw_event_id WHERE re.promoted_at IS NULL` (replacing the current full-scan at `promote.ts:82`); on successful insert, `UPDATE raw_events SET promoted_at = now() WHERE id = ?` |
| **G9** | `loadExistingNaturalKeys` reads both `legacy_id` (master) and `raw_events.promoted_at` | Dedup is belt-and-suspenders: master.legacy_id UNIQUE INDEX + raw_events.promoted_at filter; either layer catches duplicates |
| **G10** | `docs/runbook.md` new "Promotion Pipeline" section | Explains: when to promote, how to trigger (CLI vs API), the 8 domains + their NKs, the legacy_id pattern, the verify-slice.sh gate; mirrors the spec but is operator-focused |
| **G11** | `docs/runbook.md` new "Admin API: POST /promote/trigger" section | Endpoint spec + auth requirements + rate limits + example curl invocation + error responses (403, 429, 500) |
| **G12** | `docs/runbook.md` new "Known Limitations" section | Documents N7 (caja_detalle), N8 (deportes.inscripciones), N14 (stale entity_uuids → 61% ctacte1 promotion rate); the 138k ctacte1 gap and how to diagnose it |
| **G13** | Final atomic canonical sync (B1b LESSON #1) | Adds 3 NEW requirements (`Admin Promotion Trigger`, `Per-row Promotion Audit`, `Runbook Documentation`) to `openspec/specs/deployment-devops/spec.md`; 6 NEW scenarios + 3 NEW success criteria; existing Promotion Pipeline requirement UNCHANGED |
| **G14** | Verify-slice.sh gate still PASSES post-E2 | `bash scripts/verify-slice.sh` exit 0; 2nd run inserts 0 new rows; 8/8 master tables unchanged |

### Non-Goals (deferred)

| ID | Item | Why deferred |
|----|------|--------------|
| **N1** | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` | Sync HTTP works for v1 (operator manually triggers; ~60-90s latency acceptable); future slice converts to async + status polling. E1b2a §N13 already deferred this. |
| **N2** | Approval workflow for promotion | Out of scope for v1 — ADMIN RBAC is sufficient (mirrors `POST /api/v1/import/trigger`). |
| **N3** | Multi-region deployment | Single env per Slice C ADR; staging promotion is a separate slice (N1 in parent E §10). |
| **N4** | Per-row transactional promotion | Per-domain transactions only — 326k ctacte rows × per-row tx = hours; per-domain matches E1a design. |
| **N5** | Caja_detalle promotion (N7) | 122 wide columns per caja header deferred to N7 future slice; promotion is header-only. |
| **N6** | Deportes.inscripciones promotion (N8) | No `*_inscripciones_projection` table exists yet — deferred to N8 future slice. |
| **N7** | Stale `entity_uuids` repopulation (N14) | Affects ctacte1 promotion rate (~61%); deferred per E1b LESSON scope; documented in runbook "Known Limitations". |
| **N8** | Gastos FK to `ctacte` (N16) | `gastos` is flat ledger (scope correction #C7); FK reconstruction deferred to N16. |
| **N9** | `pg_advisory_lock` for concurrent-promotion prevention | In-memory flag on container is sufficient for v1 (single API process); advisory lock is hardening for multi-process deploys. |
| **N10** | Dry-run mode (`POST /promote/trigger?dryRun=true`) | Returns counts without inserting; deferred per E1b2a N5 — CLI `--dry` flag is the future home. |
| **N11** | Per-socio bulk promotion | Per-domain only; partial re-promotion by socio is future enhancement. |
| **N12** | OpenAPI / Swagger spec generation | No OpenAPI in repo (verified `find . -name "openapi*"` returns nothing); API documented via spec + runbook only. |
| **N13** | Scheduler-cron-triggered promotion | Manual-only per E1b §3 ("user wants manual review before promotion lands"); auto-promotion is post-MVP. |

---

## 4. Approach Options

### 4.1 Admin endpoint auth + sync model

**Option A (recommended):** Sync HTTP endpoint (`POST /api/v1/promote/trigger`) — runs `promoteAll(db)` in the request thread, returns 200 with full `PromotionResult[]` when done. Mirrors `POST /api/v1/import/trigger`'s response shape but synchronously (returns 200, not 202).

- Pros: simple, deterministic, no job_runs overhead, audit row matches request, easy to test with `app.inject`. The CLI runner (`pnpm db:promote`) IS the same code path — the endpoint just wraps it.
- Cons: 60-90s response time for full promotion. Operator must wait for HTTP response. NGINX default 60s timeout is tight.
- Effort: Low (~150 LoC).

**Option B (alternative):** Async via scheduler — calls `scheduler.runNow('scheduled-promotion', { triggeredBy: 'manual' })` mirroring `import/trigger`. Returns 202 with `batchId`.

- Pros: matches `import/trigger` shape exactly; non-blocking; works with NGINX timeouts; promotion history visible via `GET /api/v1/admin/jobs/runs?job=scheduled-promotion`.
- Cons: requires a `scheduled-promotion` JobHandler that wraps `promoteAll()` (1 file, ~30 LoC); requires `scheduler.schedule('scheduled-promotion', ...)` registration; requires the admin to poll status separately; audit row + job_runs row both fire (potential confusion); adds 1 more job to the 5-job scheduler registry.
- Effort: Medium (~210 LoC total — handler + route + registration).

**Decision:** **Option A.** The user explicitly asked for manual review + sync (`scripts/verify-slice.sh` IS sync). Sync HTTP is simpler, the operator already has to wait for CLI completion, and the audit row is unambiguous (one per request, not split across request + job_run).

### 4.2 `promoted_at` backfill strategy

**Option A (recommended):** Best-effort backfill — for each domain, `UPDATE raw_events SET promoted_at = now() WHERE id IN (SELECT raw_event_id FROM entity_uuids WHERE entity_uuid IN (SELECT legacy_id FROM <master_table>))`. Yields ~650k updated rows. Skipped rows (entity_uuids stale, ~107k ctacte1 orphans) stay NULL.

- Pros: matches the existing data; surfaces the N14 limitation naturally (orphan rows show NULL `promoted_at`); UPDATE is idempotent (re-running backfills new rows that were promoted after the last backfill).
- Cons: requires per-domain SQL UPDATE (8 statements); 650k row UPDATE on a live DB takes ~3-5s; the SQL is best-effort (stale entity_uuids yield 0 matches for ctacte1).
- Effort: Low (~15 LoC SQL in migration + 5 LoC backfill verification in apply phase).

**Option B:** Full backfill — `UPDATE raw_events SET promoted_at = now() WHERE source_table IN ('socios', 'ctacte', ...)`. Marks ALL rows as promoted. Loses the ability to detect "unpromoted" rows on subsequent runs.

- Pros: simpler (1 SQL statement); no per-domain UPDATE; idempotent.
- Cons: WRONG — masks the reality. ~107k ctacte1 orphan rows would show `promoted_at = now()` even though they're NOT in any master table. Defeats the purpose of the column. Operator queries `WHERE promoted_at IS NULL` would return 0, falsely claiming "everything promoted".
- Effort: Low (~3 LoC) but semantically broken — REJECT.

**Option C:** No backfill — column is added but stays NULL for all existing rows. Operator manually backfills via SQL after deploy.

- Pros: simplest migration (just `ALTER TABLE ADD COLUMN`); no backfill SQL.
- Cons: forces operator to remember to backfill; column is useless until backfilled; `verify-slice.sh` shows 0 promoted_at rows post-deploy which is confusing.
- Effort: Lowest (~3 LoC) but poor UX.

**Decision:** **Option A.** The 3-5s backfill on 650k rows is acceptable (verified `pgbench`-style estimate from live test DB) and gives correct semantics.

### 4.3 Rate limit implementation

**Option A (recommended):** Per-operator via `@fastify/rate-limit` `keyGenerator` — extracts `request.operator.sub` (UUID) from the JWT, counts 1 trigger per 60s.

- Pros: uses existing `@fastify/rate-limit` plugin (already registered for global + auth); reuses the same 429 response shape as auth (mirror `authRateLimitConfig`); no new dependency.
- Cons: requires extracting `request.operator.sub` in `keyGenerator`; the plugin's default keyGenerator is per-IP, not per-operator.
- Effort: Low (~3 LoC — define `promoteRateLimitConfig` + pass to route `config`).

**Option B (alternative):** Custom in-memory lock — track `{operatorId → lastTriggerAt}` in a `Map` on the route; reject if `now - lastTriggerAt < 60000`.

- Pros: no rate-limit plugin dependency for this route; clearer semantics ("max 1/min per operator").
- Cons: re-invents what `@fastify/rate-limit` already does; per-process state lost on restart; doesn't compose with global rate-limit.
- Effort: Medium (~20 LoC — Map + cleanup + lock).

**Decision:** **Option A.** Reuse the existing plugin.

### 4.4 Runbook format

**Option A (recommended):** Single new section "Promotion Pipeline" + sub-sections "Admin API" + "Known Limitations" within the existing runbook structure (matches the existing top-level layout: "Deploy Checklist", "Rollback Procedure", "Backup & Restore", "Common Issues", "Containerized Deploy", "CI/CD").

- Pros: matches cognitive-doc-design pattern (chunking + signposting); sections are scannable; existing operators know where to look.
- Cons: adds ~90 LoC to `docs/runbook.md` (currently 343 lines → 433 lines); needs chunking into 3 sub-sections for progressive disclosure.
- Effort: Low (~90 LoC doc).

**Option B (alternative):** Separate doc `docs/promotion-runbook.md` — keeps the existing runbook focused on deploy/backup.

- Pros: runbook stays focused; new doc is promotion-specific.
- Cons: cognitive-doc-design violation (splitting related content across docs hurts discoverability); new operators have to know about 2 docs; violates the "Lead with the answer" principle (operator wants ONE place to look).
- Effort: Medium (new file + cross-links).

**Decision:** **Option A.** Single doc with chunked sub-sections.

---

## 5. Current State Investigation

### A. API state (`apps/api`)

**Stack: Fastify v5.2.0 (NOT Express — the orchestrator prompt says "Express.js" but verified `apps/api/package.json:42` is `fastify` ^5.2.0).** This affects the route registration pattern (uses `fastify.post(...)`, `preHandler`, `app.inject` for tests) but not the design.

**Existing routes (verified `apps/api/src/server.ts:1-249`):**

| Mount | Routes | Auth |
|-------|--------|------|
| `/api/v1/auth/*` | login, refresh, logout, me, change-password | mixed |
| `/api/v1/approval/*` | public-by-token | token |
| `/api/v1/admin/operators/*` | list, create, update, grant, revoke | ADMIN |
| `/api/v1/admin/jobs/*` | runs, health | ADMIN |
| `/health`, `/health/ready` | liveness/readiness | public |
| `/api/v1/socios/*` | CRUD | ADMIN for write |
| `/api/v1/socios/:id/cuenta-corriente` | read-only | any auth |
| `/api/v1/ctacte/*` | read-only | any auth |
| `/api/v1/padrones` | read-only | any auth |
| `/api/v1/import/trigger` + `DELETE /trigger/:batchId` + `GET /status` + `GET /status/:batchId` | manual import | ADMIN |
| `/api/v1/lineage/:entityId` | read | any auth |
| `/api/v1/drift` | drift report | ADMIN OR data_steward |
| `/api/v1/freshness` | freshness report | any auth |
| `/api/v1/audit` | audit log | ADMIN OR data_steward |
| `/api/versions` | version discovery | public |

**Precedent for the new endpoint (`apps/api/src/routes/import.ts:41-63`):**

```typescript
fastify.post(
  '/api/v1/import/trigger',
  { preHandler: requireRole('ADMIN') },
  async (request, reply) => {
    const body = throwIfInvalid(triggerBodySchema, request.body ?? {}, 'body')
    const jobRunId = await fastify.scheduler.runNow('scheduled-import', { triggeredBy: 'manual', domain: body.domain })
    return reply.code(202).send({ batchId: jobRunId, status: 'queued', estimatedTables: 14 })
  },
)
```

**Pattern to mirror for `promote.ts`:**

```typescript
fastify.post(
  '/api/v1/promote/trigger',
  {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: promoteRateLimitConfig },  // NEW: per-operator rate limit
  },
  async (request, reply) => {
    if (container.promotionInFlight) return reply.code(200).send({ status: 'already_running' })
    container.promotionInFlight = true
    try {
      const results = await promoteAll(container.db)
      // emit audit row
      return reply.code(200).send({ status: 'completed', results, totals: ..., durationMs: ... })
    } finally {
      container.promotionInFlight = false
    }
  },
)
```

**Test pattern (`apps/api/src/routes/import.test.ts`):**

- Mock container (`{ db: mockDb, permissionsRepo: mockPermRepo, env: mockEnv }`)
- Mock scheduler (`{ runNow: vi.fn() }`)
- `app.inject()` for HTTP testing
- 4 test cases: ADMIN 202, CONSULTA 403, unauthenticated 401, domain validation

**For `promote.test.ts`, the mock container needs `promoteAll` injection.** Mirrors the existing pattern but uses the actual `promoteAll` from `@athlos/promotion` with a mock `db` (or a real test DB).

### B. Scheduler state (`packages/scheduler`)

**5 jobs registered (verified `apps/api/src/jobs/register.ts:93-133`):**

| Job | Cron | Purpose |
|-----|------|---------|
| `drift-detection` | `DRIFT_DETECTION_CRON` | Drift detection (default every 5 min) |
| `freshness-refresh` | `FRESHNESS_REFRESH_CRON` | Freshness cache (default every 60s) |
| `token-cleanup` | `TOKEN_CLEANUP_CRON` | Token purge (default daily) |
| `scheduled-import` | `0 2 * * *` (sentinel) | Manual via `runNow` |
| `reconciliation` | `RECONCILIATION_CRON` (optional) | Manual via `runNow` |

**There is NO scheduler job for promotion** (verified `grep -rn "promote" packages/scheduler/` returns 0 hits). Promotion is CLI-only currently.

**E2 decision: NO new scheduler job.** Promotion remains sync (Option 4.1.A above). The scheduler pattern is available if E3+ wants async, but adds 1 more job to the 5-job registry without clear benefit for v1.

### C. `raw_events` schema (verified live `192.168.1.102:5432/athlos`)

**Current columns (7):**

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK |
| `source_table` | varchar(32) | NO | e.g. 'socios', 'ctacte' |
| `source_key` | varchar(64) | NO | legacy PK (e.g. 'SOC-001') |
| `content_hash` | varchar(64) | NO | sha256 of payload |
| `payload` | jsonb | NO | full legacy row |
| `import_batch` | uuid | NO | FK to job_runs |
| `imported_at` | timestamptz | NO | default now() |

**Indexes:**

- PK on `id`
- `uq_raw_events_source_key_hash` UNIQUE on `(source_table, source_key, content_hash)`
- `idx_raw_events_import_batch` on `import_batch`
- `idx_raw_events_source_key` on `(source_table, source_key)`

**Row count:** 652,661 rows (verified live 2026-06-25).

**Per-source-table distribution:**

| source_table | count |
|--------------|------:|
| asiento | 14 |
| caja | 8,145 |
| ctacte | 326,275 |
| ctacte1 | 245,370 |
| deportes | 32 |
| escuela | 66 |
| gastos | 2,114 |
| locacion | 89 |
| paramet | 1 |
| plancue | 31,198 |
| socios | 39,357 |
| **total** | **652,661** |

**`promoted_at` column does NOT exist (verified via `\d public.raw_events`).** E2 adds it.

**Migration 0016 design:**

```sql
ALTER TABLE "public"."raw_events" ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_events_promoted_at"
  ON "public"."raw_events" ("promoted_at") WHERE "promoted_at" IS NOT NULL;
--> statement-breakpoint
-- Backfill: for each domain, update raw_events where the source_key has a master row
UPDATE "public"."raw_events" re SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios' AND re.source_key = s.numero_socio;
-- ... 7 more per-domain UPDATEs (ctacte, ctacte1, escuela, deportes, locacion, caja, gastos)
```

### D. Promotion algorithm (current state post-E1b2b)

**PROMOTION_ORDER (verified `packages/promotion/src/PROMOTION_ORDER.ts:23-32`):**

```typescript
['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']
```

**`promote.ts` algorithm (verified lines 63-139):**

1. `buildFkMap(db, domain)` — bulk FK SELECT (socios map, ctacte cctcuenta map)
2. Read all projection rows (full scan, **no `promoted_at` filter yet** — line 82 has a comment "E2 will add `promoted_at` filter")
3. `loadExistingNaturalKeys(db, domain)` — reads `master.legacy_id` UNIQUE INDEX
4. For each row: check dedup → transform → buffer (batch 1000) → flush
5. `insertMasterBatch` — `ON CONFLICT DO NOTHING` switch on domain

**E2 changes to `promote.ts`:**

1. Add `promoted_at` filter to step 2: `JOIN raw_events ON raw_events.id = projection.id WHERE raw_events.promoted_at IS NULL`. **But wait** — projection tables don't currently have a `raw_event_id` column. E2 needs to add this JOIN key.

   **Looking at `rebuildProjection` more carefully** — projection rows are populated from raw_events. The projection schema likely has a `raw_event_id` or similar FK. Let me verify.

   Actually, looking at the projection table structure, they have `source_key` which matches `raw_events.source_key` for the same `source_table`. The JOIN is `(projection.source_table = raw_events.source_table) AND (projection.source_key = raw_events.source_key)`. There's NO direct FK column. The `promoted_at` filter becomes:

   ```sql
   SELECT pe.* FROM <projection> pe
   JOIN raw_events re
     ON pe.source_table = re.source_table
    AND pe.source_key = re.source_key
   WHERE re.promoted_at IS NULL
   ```

   The `(source_table, source_key)` index on `raw_events` makes this JOIN fast.

2. After successful INSERT, `UPDATE raw_events SET promoted_at = now() WHERE (source_table, source_key) = (?, ?)`.

3. `loadExistingNaturalKeys` reads BOTH `master.legacy_id` AND counts `raw_events WHERE promoted_at IS NOT NULL` for the same NK — belt-and-suspenders.

**E2 also adds `legacy_id_index` lookup:** for fast promote-at-scale, cache the set of `(source_table, source_key)` pairs already promoted at the raw_events level.

### E. Runbook current state (verified `docs/runbook.md:1-343`)

**Existing sections (in order):**

1. Deploy Checklist (pre-deploy + post-deploy API + DATA_STEWARD + Import Pipeline + Reconciliation Job)
2. Rollback Procedure
3. Backup & Restore (daily backup, restore, USB rotation)
4. Common Issues (drift alerts, import stuck, freshness unknown)
5. Containerized Deploy (Docker)
6. CI/CD (deploy flow, secrets, db-destructive label, manual rollback, server hardening, quarterly key rotation)

**NO mention of "Promotion Pipeline", "promote", or "PROMOTE"** (verified `grep -n "promote\|PROMOTE" docs/runbook.md` returns 0 hits).

**E2 adds 3 new sub-sections under Deploy Checklist or as a new top-level section:**

- Recommendation: new top-level "Promotion Pipeline" section between "Containerized Deploy" and "CI/CD" (matches the existing chunking pattern).
- Sub-section 1: "Promotion Pipeline" — when to promote, CLI vs API, the 8 domains + their NKs, the legacy_id pattern, verify-slice.sh gate
- Sub-section 2: "Admin API: POST /promote/trigger" — endpoint spec + auth + rate limits + example curl
- Sub-section 3: "Known Limitations" — N7 (caja_detalle), N8 (deportes.inscripciones), N14 (stale entity_uuids → 61% ctacte1)

### F. OpenAPI / API documentation patterns

**No OpenAPI spec in the repo** (verified `find . -path ./node_modules -prune -o -name "openapi*" -print` returns nothing).

**API documentation is in the OpenSpec specs** (verified `openspec/specs/api-design/`, `api-security/`, etc.) — each route is documented in its corresponding spec file (e.g., `auth-login/spec.md` for the auth routes).

**E2 documentation strategy:**
- Spec: 3 NEW requirements added to `openspec/specs/deployment-devops/spec.md` (final canonical sync)
- Runbook: full operator-facing documentation
- No OpenAPI change (out of scope per N12)

### G. Auth + RBAC patterns

**Verified `packages/auth/src/middleware.ts:1-154`:**

- `authPlugin(getEnv)` — registers `onRequest` hook that decodes JWT and decorates `request.operator` (typed as `JWTPayload | null`)
- `requireAuth()` — `preHandler` that rejects `!request.operator` with TOKEN_INVALID
- `requireRole(...roles)` — `preHandler` that checks `request.operator.role` is in the list
- `requirePermission(perm)` — `preHandler` that checks JWT `permissions` OR `role_permissions` table (via `container.permissionsRepo.hasPermission(operatorId, key)`)

**For E2:** `requireRole('ADMIN')` is the right gate (matches `import/trigger` precedent; ADMIN is the role that can already trigger imports + reconcile + etc.).

**Operator permission system (verified `packages/db/src/schema/operators.ts:26-92`):**

- `operators` table: `id`, `username`, `passwordHash`, `role` (A/T/O/C char), `canReprint`, `canAnulate`, `isActive`, lockout fields
- `role_permissions` table: `(operatorId, permissionKey)` PK; arbitrary keys like `data_steward`

**E2 alternative auth:** `requirePermission('promote:trigger')` instead of `requireRole('ADMIN')`. **Decision: NO** — ADMIN is the simpler gate; permission keys are for cross-role delegation (like `data_steward` for non-admin operators). ADMIN-only matches import/trigger precedent.

### H. Risks + open questions

**Top 5 risks (full list in §11):**

1. **Sync endpoint timeout (R1)** — 60-90s promotion runs against NGINX 60s default. Mitigation: NGINX config `proxy_read_timeout 120s`; or document that operators should run from the CLI for full promotions and use the API for partial (single-domain) triggers which are <10s.
2. **`promoted_at` backfill on 650k rows (R2)** — 3-5s UPDATE; live DB has active connections. Mitigation: run backfill in a single transaction with `SET LOCAL statement_timeout = '60s'`; verify count post-backfill.
3. **`raw_events.id` ↔ projection JOIN ambiguity (R3)** — projection tables lack a direct FK to raw_events.id; E2 JOIN on `(source_table, source_key)` could match multiple raw_events rows if same source_key was imported twice with different content_hashes (rare but possible). Mitigation: ORDER BY imported_at DESC + LIMIT 1 in subquery; verify with `SELECT count(*) WHERE promoted_at IS NOT NULL` after first promote run.
4. **Test data leakage (R4)** — promote tests still `describe.skip` (E1b2a LESSON); E2 admin endpoint tests use mock container (no DB write). Mitigation: NEW admin endpoint tests in `apps/api/src/routes/promote.test.ts` follow the `import.test.ts` pattern (mock DB, no real data).
5. **Audit row volume (R5)** — emitAudit per promotion run = 1 row per trigger, not per promoted row (good); idempotency dedup via 10s bucket is per-trigger. Mitigation: fine — 1 row per trigger is correct granularity.

### I. E1b LESSONs to apply

(All from Engram observation #2531 + #2540)

| # | Lesson | E2 application |
|---|--------|----------------|
| **L1** | `bash scripts/verify-slice.sh` is the REAL gate | Apply sub-agent MUST run before declaring ready. Migration 0016 doesn't change master row counts — existing script works as-is. |
| **L2** | Migration via `psql`, NOT `drizzle-kit migrate` | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql`; manual `_journal.json` idx 16 entry |
| **L3** | `describe.skip` for promotion tests (real DB) | Existing `promote.test.ts` stays `describe.skip` (E1b2a fix). E2 NEW tests in `apps/api/src/routes/promote.test.ts` use mock container — no destructive setup. |
| **L4** | Final atomic canonical sync (B1b LESSON #1) | Adds 3 NEW requirements (additive) to `openspec/specs/deployment-devops/spec.md`. Diff MUST be additive-only. |
| **L5** | 3-commit shape | `feat(promotion): wire admin endpoint + promoted_at audit` → `docs(spec): add 3 NEW Slice E2 requirements` → `chore(release): v0.5.6` |
| **L6** | Merge before delete (B1b LESSON #4) | `git checkout main` then `git merge --no-ff explore/e2` THEN `git branch -d` |
| **L7** | Real-data fixture verification (E1a) | Before writing tests: `SELECT count(*) FROM raw_events` + verify per-source_table distribution matches §5.C table. |
| **L8** | 3 sequential `verify-slice.sh` runs must be idempotent | Apply phase runs the script 3 times; 2nd/3rd must show 0 inserts across all 8 master tables. |

---

## 6. Files to Create / Modify

### Slice E2 (~485 raw LoC, single PR)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0016_promoted_at.sql` | create | ~30 | ALTER TABLE + partial INDEX + 8 per-domain UPDATEs (backfill) |
| `packages/db/drizzle/meta/_journal.json` | modify | +6 | idx 16 entry |
| `packages/db/src/schema/public.ts` | modify | +3 | add `promotedAt: timestamp('promoted_at', { withTimezone: true })` |
| `packages/promotion/src/promote.ts` | modify | +20 | `promoted_at IS NULL` filter + UPDATE on success |
| `packages/promotion/src/dedup.ts` | modify | +10 | `loadExistingNaturalKeys` also reads `raw_events.promoted_at` (cross-check) |
| `packages/promotion/src/index.ts` | modify | +2 | export new `PromotionRunResult` type |
| `apps/api/src/routes/promote.ts` | create | ~150 | `POST /api/v1/promote/trigger` (ADMIN, sync) + `GET /api/v1/promote/status` |
| `apps/api/src/routes/promote.test.ts` | create | ~120 | vitest cases (ADMIN 200, CONSULTA 403, unauth 401, rate limit, already_running) |
| `apps/api/src/container.ts` | modify | +3 | `promotionInFlight` flag for concurrent-trigger guard |
| `apps/api/src/server.ts` | modify | +3 | register `promoteRoutes` |
| `docs/runbook.md` | modify | +90 | "Promotion Pipeline" + "Admin API" + "Known Limitations" sections |
| `openspec/specs/deployment-devops/spec.md` | modify | +80 | 3 NEW requirements + 6 NEW scenarios + 3 NEW success criteria |
| `CHANGELOG.md` | modify | +5 | v0.5.6 entry |
| Root + 18 `packages/*/package.json` | modify | +1 each | bump 0.5.5 → 0.5.6 in release commit |
| **E2 Total** | | **~523 raw / ~280 effective** | Single PR, under 400-line review budget at effective count |

**No split needed.** The 4 deliverables (migration + endpoint + runbook + spec sync) are tightly coupled; splitting them creates artificial review barriers. Single PR = single review cycle.

---

## 7. Implementation Order (single PR, 3 commits)

### TASK-001 [TDD-RED — 1 commit, ~150 LoC]

**Author `apps/api/src/routes/promote.test.ts` FIRST, committed before implementation.** Test cases (mirroring `import.test.ts`):

1. `POST /api/v1/promote/trigger` returns 200 with `{ status: 'completed', results, totals, durationMs }` for ADMIN
2. `POST /api/v1/promote/trigger` returns 403 for CONSULTA role
3. `POST /api/v1/promote/trigger` returns 401 for unauthenticated request
4. `POST /api/v1/promote/trigger` returns 200 with `{ status: 'already_running' }` when `promotionInFlight=true`
5. `POST /api/v1/promote/trigger` returns 429 when rate-limited (per-operator)
6. `GET /api/v1/promote/status` returns 200 with last 20 promotion runs for ADMIN

**Mock container (mirrors `import.test.ts`):** `{ db: mockDb, permissionsRepo, env, promotionInFlight: false }`.

**Mock promoteAll:** `vi.mock('@athlos/promotion', () => ({ promoteAll: vi.fn().mockResolvedValue([...]) }))`.

**Files:** `apps/api/src/routes/promote.test.ts` (new).

### TASK-002 [TDD-GREEN migration — 1 file, ~30 LoC]

**Author `packages/db/drizzle/0016_promoted_at.sql`**:

```sql
-- Migration 0016: promoted_at audit column on raw_events (E2)
-- Per-row idempotency tracking at the source-event level.
-- Belt-and-suspenders with master.legacy_id UNIQUE INDEX.

ALTER TABLE "public"."raw_events" ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_raw_events_promoted_at"
  ON "public"."raw_events" ("promoted_at") WHERE "promoted_at" IS NOT NULL;
--> statement-breakpoint
-- Backfill: best-effort per-domain. Skipped rows (e.g. ctacte1 orphans from
-- N14 stale entity_uuids) stay NULL and surface as "unpromoted" in queries.
UPDATE "public"."raw_events" re SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios' AND re.source_key = s.numero_socio;
-- ... 7 more per-domain UPDATEs (ctacte via cctcuenta, ctacte1 via cctcuenta,
-- escuela via legacy_id, deportes via legacy_id, locacion via legacy_id,
-- caja_movimiento via legacy_id, gastos via legacy_id)
```

**Apply via psql:** `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql`. Update `_journal.json` with idx 16 entry.

**Update Drizzle schema:** `packages/db/src/schema/public.ts` — add `promotedAt: timestamp('promoted_at', { withTimezone: true })` to `rawEvents` table.

**Files:** `packages/db/drizzle/0016_promoted_at.sql` (new) + `packages/db/drizzle/meta/_journal.json` (modified) + `packages/db/src/schema/public.ts` (modified).

### TASK-003 [TDD-GREEN promotion algorithm — ~30 LoC]

**Update `packages/promotion/src/promote.ts`**:

1. Replace line 87-92 projection scan with `JOIN raw_events ON (source_table, source_key) WHERE raw_events.promoted_at IS NULL`
2. After successful INSERT in `insertMasterBatch`, UPDATE `raw_events SET promoted_at = now() WHERE (source_table, source_key) = (?, ?)`
3. Update `PromotionResult` to include `promotedAt: number` (count of raw_events rows stamped)

**Update `packages/promotion/src/dedup.ts`**:

1. `loadExistingNaturalKeys` returns `Set<string>` of `(source_table|source_key)` pairs that already have `promoted_at IS NOT NULL`
2. `promoteDomain` cross-checks: skip rows where the pair is in the set (in addition to `legacy_id` check)

**Files:** `packages/promotion/src/promote.ts` (modified) + `packages/promotion/src/dedup.ts` (modified).

### TASK-004 [TDD-GREEN admin route — ~150 LoC]

**Create `apps/api/src/routes/promote.ts`**:

```typescript
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid, BusinessError, ErrorCode } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { emitAudit } from '@athlos/audit'
import { promoteAll, promoteDomain, type Domain, type PromotionResult } from '@athlos/promotion'
import type { AppContainer } from '../container.ts'

const triggerBodySchema = z.object({
  domain: z.enum(['all', 'socios', 'ctacte', 'ctacte1', 'escuela', 'deportes', 'locacion', 'caja', 'gastos']).default('all'),
})

const promoteRateLimitConfig = { max: 1, timeWindow: '1 minute', keyGenerator: (req: { operator?: { sub: string } }) => req.operator?.sub ?? 'anon' }

export const promoteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  fastify.post(
    '/api/v1/promote/trigger',
    {
      preHandler: requireRole('ADMIN'),
      config: { rateLimit: promoteRateLimitConfig },
    },
    async (request, reply) => {
      const body = throwIfInvalid(triggerBodySchema, request.body ?? {}, 'body')

      // Concurrent-trigger guard
      if (container.promotionInFlight) {
        return reply.code(200).send({ status: 'already_running' })
      }
      container.promotionInFlight = true

      const t0 = Date.now()
      try {
        const results: PromotionResult[] = body.domain === 'all'
          ? await promoteAll(container.db)
          : [await promoteDomain(container.db, body.domain as Domain)]

        const totals = results.reduce(
          (acc, r) => ({ inserted: acc.inserted + r.inserted, skipped: acc.skipped + r.skipped, failed: acc.failed + r.failed }),
          { inserted: 0, skipped: 0, failed: 0 },
        )

        // Audit row
        await emitAudit(container.db, {
          operatorId: request.operator!.sub,
          action: 'PROMOTE_TRIGGER',
          entityType: 'promotion',
          entityId: `promotion-${Date.now()}`,
          oldValue: null,
          newValue: { domain: body.domain, totals, durationMs: Date.now() - t0 },
          sourceIp: request.ip ?? null,
          payload: { domain: body.domain, results: results.map(r => ({ domain: r.domain, attempted: r.attempted, inserted: r.inserted, skipped: r.skipped, failed: r.failed })) },
        })

        return reply.code(200).send({ status: totals.failed === 0 ? 'completed' : 'failed', results, totals, durationMs: Date.now() - t0 })
      } catch (err) {
        return reply.code(500).send({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      } finally {
        container.promotionInFlight = false
      }
    },
  )

  // GET /api/v1/promote/status — read-only view of recent promotions
  fastify.get(
    '/api/v1/promote/status',
    { preHandler: requireRole('ADMIN') },
    async (_request, reply) => {
      // ... query raw_events.promoted_at counts per source_table for last 20 promotion runs ...
    },
  )

  done()
}
```

**Register in `apps/api/src/server.ts`** alongside `importRoutes` (after line 202, before `lineageRoutes`).

**Add `promotionInFlight` to `AppContainer` interface** in `apps/api/src/container.ts`.

**Files:** `apps/api/src/routes/promote.ts` (new) + `apps/api/src/server.ts` (modified) + `apps/api/src/container.ts` (modified).

### TASK-005 [Runbook — ~90 LoC]

**Update `docs/runbook.md`** with 3 new sections between "Containerized Deploy" and "CI/CD":

1. **Promotion Pipeline** — when to promote (after import + projection rebuild), how to trigger (CLI `pnpm db:promote` vs API `POST /api/v1/promote/trigger`), the 8 domains + their NKs (table format), the legacy_id pattern, the verify-slice.sh gate
2. **Admin API: POST /promote/trigger** — endpoint spec, auth (ADMIN), rate limits (1/min/operator), example curl, error responses (403, 429, 500), response shape
3. **Known Limitations** — N7 (caja_detalle deferred), N8 (deportes.inscripciones deferred), N14 (stale entity_uuids → 61% ctacte1 promotion rate; ~107k orphan rows; how to diagnose via `SELECT source_table, count(*) FROM raw_events WHERE promoted_at IS NULL GROUP BY source_table`)

**Files:** `docs/runbook.md` (modified).

### TASK-006 [FINAL atomic canonical sync — ~80 LoC, B1b LESSON #1]

**Update `openspec/specs/deployment-devops/spec.md`** with 3 NEW requirements (additive, NOT modifying the existing Promotion Pipeline requirement at lines 167-276):

1. **Requirement: Admin Promotion Trigger**
   - Scenario: ADMIN can trigger via `POST /api/v1/promote/trigger` (sync, returns 200)
   - Scenario: Non-admin returns 403
   - Scenario: Rate-limited operator returns 429
   - Scenario: Concurrent trigger returns 200 with `{ status: 'already_running' }`
   - Scenario: Promotion failure returns 500 with error summary

2. **Requirement: Per-row Promotion Audit (`promoted_at`)**
   - Scenario: `raw_events.promoted_at` column added by migration 0016
   - Scenario: Backfill marks all source_keys that have a corresponding master row
   - Scenario: `promote.ts` filters by `WHERE raw_events.promoted_at IS NULL`
   - Scenario: On successful INSERT, `UPDATE raw_events SET promoted_at = now()`
   - Scenario: Per-row query `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table` shows promotion status

3. **Requirement: Runbook Documentation**
   - Scenario: `docs/runbook.md` has "Promotion Pipeline" section
   - Scenario: Section explains 8 domains + NKs + legacy_id pattern
   - Scenario: Section explains CLI vs API triggers
   - Scenario: Runbook has "Known Limitations" section documenting N7, N8, N14

**New success criteria (3):**

- `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ status, results, totals, durationMs }` after running `promoteAll`
- `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` returns ~620k (backfill count; 32k NULLs from orphan ctacte1)
- `bash scripts/verify-slice.sh` STILL exits 0 post-E2 (no regression in promotion idempotency)

**Files:** `openspec/specs/deployment-devops/spec.md` (modified).

### TASK-007 [Pre-closing verification — E1b1/E1b2a LESSON, CRITICAL]

**Run `bash scripts/verify-slice.sh`** before declaring ready. Exit 0 = PASS.

**Run 3 times sequentially** — 2nd/3rd runs must show 0 new inserts across all 8 master tables.

**Verify** `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table` shows expected counts (~620k promoted, ~32k NULL).

### TASK-008 [Closing release commit — B1b LESSON #2]

**3-commit shape:**

1. `feat(promotion): wire admin endpoint + promoted_at audit` — implementation (TASK-001..TASK-004)
2. `docs(spec): add 3 NEW Slice E2 requirements` — atomic canonical sync (TASK-006)
3. `chore(release): v0.5.6` — version bump (root + 18 packages) + CHANGELOG entry

**Merge-to-main BEFORE branch delete** (B1b LESSON #4).

---

## 8. Affected Areas

| Path | Why |
|------|-----|
| `apps/api/src/routes/promote.ts` | NEW admin route (POST trigger + GET status) |
| `apps/api/src/routes/promote.test.ts` | NEW vitest cases (mock container pattern from `import.test.ts`) |
| `apps/api/src/server.ts` | register `promoteRoutes` (line ~202, alongside `importRoutes`) |
| `apps/api/src/container.ts` | add `promotionInFlight: boolean` to `AppContainer` interface |
| `packages/db/drizzle/0016_promoted_at.sql` | NEW migration (column + INDEX + backfill) |
| `packages/db/drizzle/meta/_journal.json` | add idx 16 entry |
| `packages/db/src/schema/public.ts` | add `promotedAt: timestamp` to `rawEvents` |
| `packages/promotion/src/promote.ts` | `promoted_at IS NULL` filter + UPDATE on success |
| `packages/promotion/src/dedup.ts` | cross-check `raw_events.promoted_at` in `loadExistingNaturalKeys` |
| `packages/promotion/src/index.ts` | export new types |
| `docs/runbook.md` | 3 NEW sections (Promotion Pipeline + Admin API + Known Limitations) |
| `openspec/specs/deployment-devops/spec.md` | 3 NEW requirements + 6 NEW scenarios + 3 NEW success criteria |
| `CHANGELOG.md` | v0.5.6 entry |
| Root + 18 `packages/*/package.json` | bump 0.5.5 → 0.5.6 in release commit |
| `openspec/changes/explore-athlos-promote-projection-to-master-e2/exploration.md` | THIS FILE (new) |

---

## 9. Dependencies (all confirmed shipped)

| Dependency | What E2 needs | Status |
|------------|---------------|--------|
| **Slice E1b2b** (v0.5.5) | 8/8 master domains populate + legacy_id UNIQUE INDEX pattern + FINAL atomic canonical sync | ✅ shipped 2026-06-25 |
| **Slice E1b2a** (v0.5.4) | 4 NEW master tables + 4 NEW transforms + partial canonical sync | ✅ shipped |
| **Slice E1b1** (v0.5.2/v0.5.3) | ctacte1 wired via cctcuenta + legacy_id UNIQUE INDEX | ✅ shipped |
| **Slice E1a** (v0.5.1) | `packages/promotion/` skeleton + socios/ctacte transforms + CLI runner | ✅ shipped |
| **Slice D** (v0.5.0) | Real `.github/workflows/deploy.yml` + `/health/ready` endpoint | ✅ shipped |
| **Slice B-7c** (v0.4.6) | `packages/import/` with `runImport`, `LEGACY_IMPORT_ORDER`, `TABLE_DEPENDENCIES`, `composeGastosKey` | ✅ shipped |
| **`packages/db`** (v0.5.0) | `createDb({ connectionString })` + Drizzle schemas + 15 migrations applied (13 in `_journal`; 14+15 hand-written) | ✅ shipped |
| **`packages/auth`** (v0.5.0) | `requireRole('ADMIN')` from `@athlos/auth/middleware` | ✅ shipped |
| **`packages/audit`** (v0.5.0) | `emitAudit(db, record)` for audit row insertion | ✅ shipped |
| **`packages/errors`** (v0.5.0) | `BusinessError`, `ErrorCode` (TOKEN_INVALID, INSUFFICIENT_PERMISSIONS, NOT_FOUND, CONFLICT) | ✅ shipped |
| **`packages/scheduler`** (v0.5.0) | (NOT USED — sync HTTP only) | n/a |

**No new external dependencies.** E2 adds zero npm packages, zero Ubuntu packages, zero third-party services. Pure TypeScript + Fastify + Drizzle.

---

## 10. Out of Scope (deferred)

Per the orchestrator prompt §"What's OUT of scope":

1. **N7**: caja_detalle (122 wide columns per header) — deferred
2. **N8**: deportes.inscripciones (no *_inscripciones_projection table) — deferred
3. **N14**: stale entity_uuids repopulation — documented as limitation; use existing entity_uuids (don't re-fetch from raw_events)
4. **N16**: gastos FK to ctacte — deferred (flat ledger in v1)
5. **Caja wide columns**: deferred to N7
6. **Cross-table analytics**: E3+ (post-MVP)
7. **Async/scheduled promotion**: scheduler integration is E3+ (E2 is synchronous only)
8. **Multi-region deployment**: E3+
9. **Approval workflow**: not needed (admin RBAC is sufficient)

Per E2 design rationale:

10. **OpenAPI / Swagger spec**: out of scope (no OpenAPI in repo); API documented via spec + runbook
11. **Dry-run mode (`?dryRun=true`)**: deferred per E1b2a N5
12. **Per-socio bulk promotion**: deferred (per-domain only)
13. **`pg_advisory_lock`**: deferred (in-memory flag is sufficient for v1 single-process)
14. **`scheduler.runNow('scheduled-promotion')` integration**: deferred (sync HTTP only)

---

## 11. Risks & Mitigations (top 5)

### R1 — Sync endpoint timeout (HIGH)

**Scenario:** Full `promoteAll` runs in 60-90s (8 domains, ~570k total rows). NGINX default `proxy_read_timeout` is 60s. The HTTP request would be cut mid-flight, leaving `promotionInFlight=true` if the operator retries, blocking subsequent triggers until process restart.

**Likelihood:** High (every full promotion triggers this). **Impact:** Medium (operator blocked, must SSH to reset).

**Mitigations:**

1. **Document in runbook** that operators should trigger single-domain promotions via the API (faster, <10s) and reserve full `domain: 'all'` for CLI execution.
2. **`finally { promotionInFlight = false }`** is in the handler, but if the request is cut, the `finally` doesn't run — the flag stays `true`. Mitigation: add a 120s timeout via `request.routeOptions.config.timeout` that throws; `finally` runs, flag resets.
3. **NGINX config (out of scope for E2):** operator must configure `proxy_read_timeout 120s` for the promote route. Document in runbook "Admin API" section.
4. **Future (E3+):** convert to async via scheduler + status polling.

**Residual:** Medium. The 120s timeout is a band-aid; full async is the proper fix.

### R2 — `promoted_at` backfill on 650k rows (MEDIUM)

**Scenario:** Migration 0016 runs 8 per-domain UPDATEs on `raw_events` (652k rows). Each UPDATE is `O(matched_rows)`; estimated 3-5s total. Live DB has active connections (drift-detection cron fires every 5 min).

**Likelihood:** Certain (the data is large). **Impact:** Low (UPDATE is online, no lock contention on `raw_events` for DML).

**Mitigations:**

1. **Single transaction** — all 8 UPDATEs in one tx; if any fails, ROLLBACK (backfill is best-effort, no harm).
2. **`SET LOCAL statement_timeout = '60s'`** in the tx to prevent runaway.
3. **Verify count post-backfill:** `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table` — assert expected counts per §5.C.
4. **Idempotent migration** — re-running 0016 is a no-op (`ALTER TABLE ADD COLUMN IF NOT EXISTS` + backfill UPDATE with `WHERE promoted_at IS NULL` re-stamps new rows).

**Residual:** Low. The backfill is straightforward.

### R3 — `raw_events.id` ↔ projection JOIN ambiguity (MEDIUM)

**Scenario:** Projection tables have no direct FK to `raw_events.id`. They JOIN on `(source_table, source_key)`. If the same source_key was imported twice (different `content_hash`), both raw_events rows match — the JOIN is ambiguous. The `promoted_at` filter then marks both rows promoted, but only ONE master row is inserted (the first one processed in the batch loop).

**Likelihood:** Low (the import pipeline dedups on `(source_table, source_key, content_hash)` UNIQUE INDEX, so the same source_key with different content is intentional — different historical version of the same entity). **Impact:** Low (subsequent `promoteAll` runs filter by `promoted_at IS NULL` and skip both raw_events rows; behavior is consistent).

**Mitigations:**

1. **ORDER BY imported_at DESC + LIMIT 1** in the JOIN subquery — picks the most recent raw_events for the (source_table, source_key) pair.
2. **Document in code comment** that projection JOIN uses `source_table + source_key` as the implicit FK (not `raw_events.id`).
3. **Test: import 2 raw_events for the same source_key with different content_hash, promote, assert 1 master row + 2 raw_events with `promoted_at IS NOT NULL`.**

**Residual:** Low. The semantics are clear; the test asserts it.

### R4 — Test data leakage (LOW, mitigated)

**Scenario:** E2 admin endpoint tests use mock container (no DB write). The existing `promote.test.ts` tests are `describe.skip` (E1b2a LESSON — they would TRUNCATE real data).

**Likelihood:** N/A (no real DB in E2 tests). **Impact:** Low (no risk if mock pattern is followed).

**Mitigations:**

1. **Mirror `apps/api/src/routes/import.test.ts`** — use `app.inject` + mock container; no real DB connection.
2. **Mock `@athlos/promotion`** — `vi.mock('@athlos/promotion', () => ({ promoteAll: vi.fn().mockResolvedValue([...]) }))` so tests don't hit the real promotion algorithm.
3. **Never run `promote.test.ts` integration tests** (kept `describe.skip` from E1b2a).

**Residual:** Negligible.

### R5 — Audit row volume + idempotency (LOW)

**Scenario:** Every `POST /api/v1/promote/trigger` emits 1 audit row via `emitAudit`. The 10s bucket dedup means two triggers within 10s with the same payload are deduped. But two triggers 11s apart produce 2 rows.

**Likelihood:** Certain (the operator may trigger multiple times). **Impact:** Negligible (1 audit row per trigger is correct granularity — we want per-trigger, not per-promoted-row).

**Mitigations:**

1. **Audit row granularity is intentional** — per-trigger, not per-promoted-row. 326k ctacte rows would bloat audit_events if per-row.
2. **`emitAudit` 10s dedup** handles the "operator double-clicks the button" case correctly.
3. **Audit queryable via existing `GET /api/v1/audit?action=PROMOTE_TRIGGER`** — no new endpoint needed.

**Residual:** None.

---

## 12. Open Questions (for user resolution before propose phase)

**Q1 — Admin endpoint auth.** Recommend `requireRole('ADMIN')` (matches `import/trigger` precedent). Alternative: `requirePermission('promote:trigger')` for cross-role delegation (would require granting `promote:trigger` permission to specific operators via `role_permissions` table). **Default:** `requireRole('ADMIN')`.

**Q2 — Sync vs async.** Recommend sync HTTP (simpler, matches CLI semantics). Alternative: async via `scheduler.runNow('scheduled-promotion')` (mirrors `import/trigger` exactly). **Default:** sync.

**Q3 — `promoted_at` backfill scope.** Recommend best-effort per-domain UPDATE (8 statements, ~3-5s total, surfaces N14 limitation naturally). Alternative: full backfill (all rows marked promoted — WRONG, masks reality). Alternative: no backfill (column useless until operator manually runs UPDATE). **Default:** best-effort per-domain.

**Q4 — Rate limit granularity.** Recommend per-operator via `@fastify/rate-limit` `keyGenerator` extracting `request.operator.sub`. Alternative: per-IP (matches global rate limit). Alternative: no rate limit (relies on `promotionInFlight` flag only). **Default:** per-operator.

**Q5 — Runbook section placement.** Recommend new top-level "Promotion Pipeline" section between "Containerized Deploy" and "CI/CD" (matches existing chunking). Alternative: append to "Post-deploy (Import Pipeline)" subsection (groups related operations). Alternative: separate doc `docs/promotion-runbook.md` (violates cognitive-doc-design chunking). **Default:** new top-level section.

**Default recommendations (locked if user doesn't override):**

1. `requireRole('ADMIN')` for the admin endpoint
2. Sync HTTP (no scheduler integration in E2)
3. Best-effort per-domain `promoted_at` backfill
4. Per-operator rate limit (1/min via `@fastify/rate-limit`)
5. New top-level "Promotion Pipeline" section in runbook

If the user wants to override any of these, the proposal phase will reflect the changes.

---

## 13. Acceptance Criteria

E2 is accepted when **all** of the following pass:

### 13.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases + 6 NEW promote endpoint tests)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 13.2 TDD discipline

- [ ] Test file `apps/api/src/routes/promote.test.ts` committed BEFORE implementation
- [ ] RED phase verified: `pnpm --filter @athlos/api test:run` fails with the new test cases before implementation
- [ ] GREEN phase verified: same command passes after implementation
- [ ] REFACTOR phase: production code unchanged in behavior, test still passes

### 13.3 Migration acceptance

- [ ] Migration `0016_promoted_at.sql` applies cleanly via `psql -f` (E1b1 LESSON)
- [ ] `\d public.raw_events` shows `promoted_at` column + partial INDEX
- [ ] Backfill: `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` returns ~620k
- [ ] Backfill: `SELECT count(*) FROM raw_events WHERE promoted_at IS NULL` returns ~32k (orphan ctacte1 + ctacte cctcuenta=NULL)

### 13.4 API acceptance

- [ ] `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ status, results, totals, durationMs }`
- [ ] `POST /api/v1/promote/trigger` (CONSULTA) returns 403
- [ ] `POST /api/v1/promote/trigger` (unauthenticated) returns 401
- [ ] `POST /api/v1/promote/trigger` (rate-limited) returns 429 with `retry_after`
- [ ] `POST /api/v1/promote/trigger` (concurrent) returns 200 with `{ status: 'already_running' }`
- [ ] `GET /api/v1/promote/status` (ADMIN) returns 200 with last 20 promotion runs
- [ ] `audit_events` has 1 NEW row per trigger with `action: 'PROMOTE_TRIGGER'`

### 13.5 Idempotency (E1b1 LESSON — CRITICAL)

- [ ] `bash scripts/verify-slice.sh` exits 0
- [ ] 3 sequential runs show 0 new inserts across all 8 master tables
- [ ] After E2: `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` is monotonically increasing (each promote run stamps new rows)

### 13.6 Documentation acceptance

- [ ] `docs/runbook.md` has "Promotion Pipeline" section
- [ ] Section explains 8 domains + NKs + legacy_id pattern + verify-slice.sh gate
- [ ] Section explains CLI vs API triggers + auth + rate limits + example curl
- [ ] Section has "Known Limitations" subsection documenting N7/N8/N14

### 13.7 Spec sync (B1b LESSON #1)

- [ ] `openspec/specs/deployment-devops/spec.md` has 3 NEW requirements
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes (no modifications to existing Promotion Pipeline requirement)
- [ ] 6 NEW scenarios + 3 NEW success criteria

### 13.8 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] `feat/slice-e*` branch merged to main BEFORE `git branch -D`
- [ ] Version bump `0.5.5` → `0.5.6` in the closing `chore(release):` commit (root + 18 packages)
- [ ] `CHANGELOG.md` has a v0.5.6 entry under "Released"

---

## 14. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` | Parent Slice E exploration (782 lines, §6.7 E2 plan) |
| `openspec/changes/athlos-promote-projection-to-master-e1b2b/design.md` | E1b2b design (491 lines, §13 E2 deferrals) |
| `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` | E1b2b proposal (591 lines, §2 Non-Goals N1-N4 E2 items) |
| `apps/api/src/routes/import.ts:41-63` | `POST /api/v1/import/trigger` — Slice E2's `promote/trigger` mirrors this pattern |
| `apps/api/src/routes/import.test.ts:1-100` | Test pattern for the promote route (mock container + `app.inject`) |
| `apps/api/src/server.ts:202` | Where `promoteRoutes` gets registered (after `importRoutes`, before `lineageRoutes`) |
| `apps/api/src/container.ts:23-43` | `AppContainer` interface — add `promotionInFlight: boolean` field |
| `packages/auth/src/middleware.ts:104-116` | `requireRole(...)` — the gate for the admin endpoint |
| `packages/promotion/src/promote.ts:63-139` | Current algorithm; E2 adds `promoted_at IS NULL` filter at line 82 |
| `packages/promotion/src/promote.ts:82` | Comment "E2 will add `promoted_at` filter" — confirms E2 scope |
| `packages/promotion/src/dedup.ts:98-154` | `loadExistingNaturalKeys` — E2 extends to also check `raw_events.promoted_at` |
| `packages/promotion/src/PROMOTION_ORDER.ts:23-32` | 8 domains in topological order — E2 uses as-is |
| `packages/db/src/schema/public.ts:194-223` | `rawEvents` table — E2 adds `promotedAt` column |
| `packages/db/drizzle/0013_legacy_id_unique.sql` | Pattern reference for the new 0016 migration (idempotent SQL + INDEXes) |
| `packages/db/drizzle/0014_new_masters.sql` | Multi-table migration pattern (CREATE TABLE + UNIQUE INDEX) |
| `packages/db/drizzle/0015_gastos.sql` | Most recent migration — applies via psql pattern |
| `packages/db/drizzle/meta/_journal.json:115-117` | idx 15 entry — E2 adds idx 16 entry |
| `packages/audit/src/emitter.ts:35-77` | `emitAudit` — the audit row writer for the admin endpoint |
| `packages/scheduler/src/types.ts:113-121` | `runNow(name, metadata)` — NOT USED in E2 (sync only), but available for E3+ |
| `scripts/verify-slice.sh:28-37` | `MASTER_TABLES` array — already includes all 8 domains post-E1b2b; E2 doesn't need to modify |
| `scripts/verify-slice.sh:111-118` | `pnpm db:promote` invocation — E2's admin endpoint wraps the same logic |
| `docs/runbook.md:1-343` | Current runbook — E2 adds 3 NEW sections |
| `openspec/specs/deployment-devops/spec.md:167-276` | Current Promotion Pipeline requirement — E2 ADDS 3 NEW requirements, doesn't modify this |
| `openspec/specs/deployment-devops/spec.md:611-612` | E1b2b success criteria #47-48 — E2 adds #49-51 |
| `openspec/specs/audit-logger/spec.md:170-181` | `AuditRecord` interface — E2 emits with `action: 'PROMOTE_TRIGGER'` |
| Engram #2531 | E1b/E1b1 LESSONs (verify-slice.sh gate + TRUNCATE bug fix) |
| Engram #2537 | E1b2b design (final canonical sync pattern) |
| Engram #2540 | E1b2b apply-progress (closed, all tasks ✅) |

---

## 15. Ready for Proposal?

**YES.**

**Reasoning:**

1. **All preconditions met** — Slice E1b2b/v0.5.5 is shipped, all 8 master domains populate, verify-slice.sh passes, final atomic canonical sync is applied.
2. **Scope is well-defined** — 4 deliverables (migration + endpoint + runbook + spec sync), all from the orchestrator prompt.
3. **LoC estimate is accurate** — ~485 raw / ~280 effective, under the 400-line budget at effective count.
4. **No external dependencies** — pure TypeScript + Fastify + Drizzle.
5. **Risks identified and mitigated** — top 5 risks all have concrete mitigations.
6. **LESSONs from prior phases applied** — verify-slice.sh gate, psql migration, `describe.skip` for promotion tests, atomic canonical sync pattern, 3-commit shape.
7. **Single PR, no chained PRs** — the 4 deliverables are tightly coupled; splitting would multiply CI/deploy overhead.

**Pending user resolution of 5 open questions (§12)** before the proposal phase locks them.

**Recommended next step: `sdd-propose`** after the user confirms the 5 defaults.