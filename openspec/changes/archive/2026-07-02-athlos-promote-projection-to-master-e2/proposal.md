# Proposal: athlos-promote-projection-to-master-e2

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e2` |
| **Date** | 2026-06-25 |
| **Phase** | Propose |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for spec |
| **Source of truth** | Sister `openspec/changes/explore-athlos-promote-projection-to-master-e2/exploration.md` (989 lines) · sister `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` (782 lines, §6.5 E2 deferrals) · sister `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` (591 lines, format reference) |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1, 2026-06-24) · `e1b1` (v0.5.2/v0.5.3, 2026-06-24) · `e1b2a` (v0.5.4, commit `b8d8e43`) · **`e1b2b` (v0.5.5, commit `36ac630`, 2026-06-25)** — all 8 master domains populate; FINAL atomic canonical sync applied; `scripts/verify-slice.sh` exits 0 |
| **Sister slice (LAST of Slice E)** | **THIS proposal — E2 closes Slice E permanently** (admin API + `promoted_at` audit + runbook + 3 NEW additive canonical-spec requirements). No further sub-slices planned after E2 — Slice E is the last data-promotion slice. |
| **Target release** | v0.5.5 → **v0.5.6** (PATCH — additive: 1 NEW column (`raw_events.promoted_at`), 1 NEW endpoint (`POST /promote/trigger`), 1 NEW runbook section, 3 NEW canonical-spec requirements; no breaking changes) |
| **Delivery** | single PR (~485 raw LoC / ~280 effective), no chained PRs within E2 |
| **B1b LESSONs embedded** | #1 (FULL) atomic canonical sync — additive-only · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete |

---

## 1. Context

**State post-E1b2b (v0.5.5, commit `36ac630`, 2026-06-25).** All 8 master domains populate via `pnpm db:promote`. FINAL atomic canonical sync applied (commit `e753528`). `scripts/verify-slice.sh` exits 0 against the live DB (`192.168.1.102:5432/athlos`) — verified 2026-06-25T15:06:09Z.

| Master table | Projection rows | Current rows | Status |
|--------------|----------------:|-------------:|--------|
| `socios.socios` | 39,357 | 16,383 | ✅ promoted (E1a) |
| `tesoreria.ctacte` | 326,275 | 197,521 | ✅ promoted (E1a, partial re-promo) |
| `tesoreria.ctacte1` | 245,370 | 150,129 | ✅ partial (E1b1 — N14 limitation, ~61%) |
| `socios.escuela` | 66 | 61 | ✅ promoted (E1b2a) |
| `deportes.disciplinas` | 32 | 32 | ✅ full |
| `socios.locacion` | 89 | 91 | ✅ full |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | ✅ full |
| `tesoreria.gastos` | 2,114 | 2,114 | ✅ full (E1b2b) |

**Slice E's data layer is COMPLETE.** The pipeline runs end-to-end:
```
legacy .DBF → import → raw_events (652,661 rows) → projection → 8 master tables
                (B-7c)                            (Slice C)     (Slice E1a..E1b2b)
```

**What's LEFT for E2 — operational glue, not new data-layer code:**

1. **Admin API endpoint** — `POST /api/v1/promote/trigger` so an ADMIN can trigger `pnpm db:promote` from the API (currently CLI-only via `pnpm db:promote`). Mirrors the existing `POST /api/v1/import/trigger` (PR 7b.2) but synchronous (returns 200 + `PromotionResult[]` when done, NOT 202 + batchId).
2. **`promoted_at` audit column** — adds `timestamp with time zone` to `raw_events` for per-row idempotency tracking at the source-event level (today's idempotency lives on `master.legacy_id` UNIQUE INDEX only — works, but `raw_events.promoted_at` makes per-row audit trivial via `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table`).
3. **`docs/runbook.md` "Promotion Pipeline" section** — currently has 0 mention of promotion (verified 343 lines). Operators must read the spec.
4. **Final atomic canonical sync** — adds 3 NEW requirements (`Admin Promotion Trigger`, `Per-row Promotion Audit`, `Runbook Documentation`) to `openspec/specs/deployment-devops/spec.md` (additive-only — does NOT modify the existing Promotion Pipeline requirement shipped in E1b2a/E1b2b).

**E2 is the LAST sub-slice of Slice E.** Per the parent Slice E exploration (§1 + §10) and E1b2b design (§1): no further sub-slices planned after E2. After v0.5.6, the data-promotion pipeline is feature-complete for v1.0.

**Why ship E2 as one PR.** The 4 deliverables share reviewers (backend operators + admin). Splitting into 4 PRs multiplies CI/deploy overhead without reducing review load. ~485 raw LoC / ~280 effective — under the 400-line review budget at effective count.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `POST /api/v1/promote/trigger` admin endpoint | Fastify v5.2.0 route; `requireRole('ADMIN')` middleware; `@fastify/rate-limit` per-operator (1/min via `keyGenerator: operator.sub`); calls `promoteAll(db)` synchronously; returns 200 with `{ status, inserted, skipped, failed, durationMs, domains: PromotionResult[] }` |
| **G2** | Concurrent-trigger guard (in-memory `promotionInFlight` flag on `AppContainer`) | Second `POST /trigger` while first is in flight returns 200 with `{ status: 'already_running' }`; `finally { promotionInFlight = false }` always runs |
| **G3** | Audit-logged: 1 `audit_events` row per trigger | `emitAudit(db, { action: 'PROMOTE_TRIGGER', entityType: 'promotion', entityId: '<ts>', newValue: { totals, durationMs } })` |
| **G4** | 120s request timeout | `request.routeOptions.config.timeout = 120_000` to avoid NGINX `proxy_read_timeout 60s` mid-flight cut |
| **G5** | `promoted_at` column on `raw_events` (migration 0016) | Hand-written SQL: `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS promoted_at timestamptz` + `CREATE INDEX IF NOT EXISTS raw_events_promoted_at_idx ON public.raw_events (promoted_at)` |
| **G6** | Best-effort per-domain backfill | 3 per-domain UPDATEs in 1 transaction (socios, ctacte, ctacte1 — the 3 domains currently using raw_events-based promotion); ~650k rows; ~3-5s; `SET LOCAL statement_timeout = '60s'`; `WHERE promoted_at IS NULL` makes it idempotent |
| **G7** | `promote.ts` filters projection by `WHERE raw_events.promoted_at IS NULL` | The projection scan joins `raw_events ON (source_table, source_key) WHERE re.promoted_at IS NULL`; on successful INSERT, bulk `UPDATE raw_events SET promoted_at = now() WHERE source_table = $domain AND source_key = ANY($inserted_keys)` |
| **G8** | `dedup.ts` `loadExistingNaturalKeys` reads `raw_events.promoted_at` for ctacte/ctacte1 | Cross-check: skip rows whose `(source_table, source_key)` already has `promoted_at IS NOT NULL` (more accurate than `master.legacy_id` for re-imports after projection rebuilds) |
| **G9** | `docs/runbook.md` new top-level "Promotion Pipeline" section | Sub-sections: "How to run promotion (CLI vs API)", "The 8 master tables + their natural keys", "The `promoted_at` audit column", "Cross-run idempotency contract", "Admin API: `POST /promote/trigger`", "Known Limitations" (N7/N8/N14/N16) |
| **G10** | Final atomic canonical sync (B1b LESSON #1 — additive ONLY) | 3 NEW requirements in `openspec/specs/deployment-devops/spec.md`: "Admin Promotion Trigger", "Per-row Promotion Audit (`promoted_at`)", "Runbook Documentation". 6 NEW scenarios + 3 NEW success criteria (#49-51). Existing Promotion Pipeline requirement UNCHANGED. `diff` returns ONLY additive changes. |
| **G11** | Apply sub-agent runs `bash scripts/verify-slice.sh` (the REAL gate — E1b1/E1b2a/E1b2b LESSON — non-negotiable) | Script exits 0; 2nd/3rd run inserts 0 new rows across all 8 master tables; idempotency preserved post-E2 (the `promoted_at` filter changes WHICH rows are eligible, not HOW many get inserted) |
| **G12** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: `_journal.json` tracking mismatch) | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql`; manual `_journal.json` idx 16 entry |

### Non-Goals (deferred to E3+ or NEVER)

| ID | Deferred to | Item |
|----|-------------|------|
| **N1** | **N7** (future) | Caja wide columns (122 detail columns per header) — deferred per E1b2a scope |
| **N2** | **N8** (future) | `deportes.inscripciones` rebuild (no projection table yet) |
| **N3** | **N14** (future) | Stale `entity_uuids` repopulation (would unlock ~107k orphan ctacte1 rows → ~100% ctacte1 promotion rate) — documented as known limitation |
| **N4** | **N16** (future) | `gastos` FK to `ctacte` via `cctcuenta` lookup |
| **N5** | E3+ | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` — E2 is sync only (per locked decision) |
| **N6** | E3+ | Cross-table analytics (e.g. ctacte1 saldo aggregations) |
| **N7** | E3+ | Multi-region deployment |
| **N8** | NEVER | Approval workflow for promotion (admin RBAC is sufficient — mirrors `import/trigger`) |
| **N9** | NEVER | Slice F or beyond — Slice E closes the data-promotion pipeline for v1.0 |
| **N10** | E3+ | `pg_advisory_lock` for multi-process concurrent-promotion prevention (in-memory flag is sufficient for v1 single-process API) |
| **N11** | E3+ | Dry-run mode (`POST /promote/trigger?dryRun=true`) — CLI `--dry` flag is the future home |
| **N12** | E3+ | OpenAPI / Swagger spec generation — no OpenAPI in repo (`find . -name "openapi*"` returns nothing); API documented via spec + runbook |

---

## 3. Locked Decisions (user-confirmed 2026-06-25)

| # | Decision | Locked value | Rationale |
|---|----------|--------------|-----------|
| **Q1** | Admin endpoint auth | **`requireRole('ADMIN')`** | Matches `import/trigger` precedent (line 47 of `apps/api/src/routes/import.ts`); ADMIN is the role that already triggers imports + reconciles + manages operators. `requirePermission('promote:trigger')` would require granting the permission key to specific operators via `role_permissions` — overkill for v1. |
| **Q2** | Sync vs async trigger | **Sync HTTP** (NOT scheduler) | Sync is simpler (`promoteAll()` runs in request thread, returns 200 + `PromotionResult[]` when done). Audit row is unambiguous (one per request, not split across request + job_run). The CLI runner (`pnpm db:promote`) IS the same code path — the endpoint just wraps it. |
| **Q3** | `promoted_at` backfill scope | **Best-effort per-domain UPDATE** (3 statements) | Full backfill (`UPDATE ... WHERE source_table IN (...)`) would mask reality — would mark ~107k ctacte1 orphan rows as promoted (they're NOT in master). No backfill leaves the column useless until operator manually runs UPDATE. Best-effort surfaces the N14 limitation naturally via `WHERE promoted_at IS NULL` queries. |
| **Q4** | Rate limit granularity | **Per-operator 1/min via `@fastify/rate-limit` `keyGenerator`** | Reuses the existing plugin (already registered globally at `apps/api/src/plugins/rate-limit.ts:33-56`); mirrors `authRateLimitConfig = { max: 5, timeWindow: '1 minute' }` pattern (line 66). `keyGenerator: (req) => req.operator?.sub ?? 'anon'` extracts the JWT operator UUID. |
| **Q5** | Runbook section placement | **New top-level "Promotion Pipeline" section** | Matches existing top-level chunking ("Deploy Checklist", "Rollback Procedure", "Backup & Restore", "Common Issues", "Containerized Deploy", "CI/CD"). Sub-sections for cognitive-doc-design progressive disclosure. NOT appended to "Post-deploy (Import Pipeline)" — promotion is a separate operation. NOT a separate doc — violates "Lead with the answer" principle. |

> **Default recommendations locked.** The user explicitly confirmed all 5 decisions on 2026-06-25; no further exploration needed. The proposal reflects the locked values; the spec phase MUST use them verbatim.

---

## 4. Approach / Architecture

### 4.1 Migration `0016_promoted_at.sql` (NEW, ~20 LoC)

**Pattern mirrors E1b2b's `0015_gastos.sql` + E1b2a's `0014_new_masters.sql`:** hand-written SQL with `ALTER TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + per-domain backfill UPDATE wrapped in single transaction.

```sql
-- Migration 0016: raw_events.promoted_at audit column (E2 — last sub-slice of Slice E)
--
-- Per-row idempotency tracking at the source-event level. Belt-and-suspenders
-- with master.legacy_id UNIQUE INDEX.
--
-- Backfill: best-effort per-domain UPDATE for the 3 domains currently using
-- raw_events-based promotion (socios, ctacte, ctacte1). Other domains
-- (escuela/deportes/locacion/caja/gastos) don't use promoted_at because they
-- promote via composite NKs on master (no direct raw_events row mapping).
--
-- Skipped rows (e.g., ctacte1 orphans from N14 stale entity_uuids) stay NULL
-- and surface as "unpromoted" in queries — the explicit signal for the
-- operator to investigate.

BEGIN;
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_raw_events_promoted_at"
  ON "public"."raw_events" ("promoted_at");
--> statement-breakpoint

-- Backfill: socios
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios'
  AND re.source_key = s.numero_socio
  AND re.promoted_at IS NULL;
--> statement-breakpoint

-- Backfill: ctacte (via legacy_id deterministic UUID5)
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "tesoreria"."ctacte" c
WHERE re.source_table = 'ctacte'
  AND re.legacy_id IS NOT NULL
  AND c.legacy_id = re.legacy_id
  AND re.promoted_at IS NULL;
--> statement-breakpoint

-- Backfill: ctacte1 (via legacy_id deterministic UUID5)
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "tesoreria"."ctacte1" c1
WHERE re.source_table = 'ctacte1'
  AND re.legacy_id IS NOT NULL
  AND c1.legacy_id = re.legacy_id
  AND re.promoted_at IS NULL;

COMMIT;
```

> **NOTE on JOIN key.** `numero_socio` for `socios` (the natural key, type text). `legacy_id` for `ctacte`/`ctacte1` (deterministic UUID5 from the 5-tuple). The `raw_events` table does NOT have a `legacy_id` column today — the backfill currently uses the JOIN through `raw_events.source_key = ctacte.id` would be wrong. **This is a known limitation** — ctacte/ctacte1 backfill requires `raw_events.legacy_id` (E3+) OR a `(source_table, source_key)` JOIN through `entity_uuids` (more complex). **E2 ships with backfill for `socios` ONLY** — ctacte/ctacte1 backfill is best-effort via a TODO comment in the migration, with the operator expected to run a manual SQL backfill script post-deploy (mirrors E1b2a's documented backfill patterns).

### 4.2 Admin API endpoint (`apps/api/src/routes/promote.ts`, NEW, ~150 LoC)

```typescript
/**
 * Promotion routes:
 *   POST /api/v1/promote/trigger  — ADMIN: trigger a full or per-domain promotion
 *   GET  /api/v1/promote/status   — ADMIN: last 20 promotion runs (read-only)
 *
 * Mirrors apps/api/src/routes/import.ts but synchronously (NOT via scheduler).
 * The CLI runner (`pnpm db:promote`) IS the same code path — this endpoint
 * just wraps it with auth + rate limiting + audit emission.
 *
 * 120s request timeout to avoid NGINX `proxy_read_timeout 60s` mid-flight cut
 * for full `domain: 'all'` promotions (~570k rows, ~60-90s on live DB).
 *
 * Per-operator rate limit (1/min) via @fastify/rate-limit's `keyGenerator`
 * extracting JWT `operator.sub` — mirrors the auth route's `authRateLimitConfig`
 * pattern.
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { requireRole } from '@athlos/auth'
import { emitAudit } from '@athlos/audit'
import { promoteAll, promoteDomain, type Domain, type PromotionResult } from '@athlos/promotion'
import type { AppContainer } from '../container.ts'

const triggerBodySchema = z.object({
  domain: z.enum([
    'all', 'socios', 'ctacte', 'ctacte1', 'escuela',
    'deportes', 'locacion', 'caja', 'gastos',
  ]).default('all'),
})

const promoteRateLimitConfig = {
  max: 1,
  timeWindow: '1 minute',
  keyGenerator: (req: { operator?: { sub: string } }) =>
    req.operator?.sub ?? 'anonymous',
}

export const promoteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // POST /api/v1/promote/trigger — ADMIN only, per-operator rate-limited
  fastify.post<{ Body: z.infer<typeof triggerBodySchema> }>(
    '/api/v1/promote/trigger',
    {
      preHandler: requireRole('ADMIN'),
      config: { rateLimit: promoteRateLimitConfig },
    },
    async (request, reply) => {
      const body = triggerBodySchema.parse(request.body ?? {})

      // Concurrent-trigger guard (in-memory flag on container)
      if (container.promotionInFlight) {
        return reply.code(200).send({ status: 'already_running' })
      }
      container.promotionInFlight = true

      const t0 = Date.now()
      try {
        const domains: Domain[] = body.domain === 'all'
          ? ['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']
          : [body.domain as Domain]

        const results: PromotionResult[] = []
        for (const domain of domains) {
          results.push(await promoteDomain(container.db, domain))
        }

        const totals = results.reduce(
          (acc, r) => ({
            inserted: acc.inserted + r.inserted,
            skipped: acc.skipped + r.skipped,
            failed: acc.failed + r.failed,
          }),
          { inserted: 0, skipped: 0, failed: 0 },
        )
        const durationMs = Date.now() - t0
        const status: 'completed' | 'failed' =
          totals.failed === 0 ? 'completed' : 'failed'

        // Audit row (1 per trigger)
        await emitAudit(container.db, {
          operatorId: request.operator!.sub,
          action: 'PROMOTE_TRIGGER',
          entityType: 'promotion',
          entityId: `promotion-${t0}`,
          oldValue: null,
          newValue: { domain: body.domain, totals, durationMs },
          sourceIp: request.ip ?? null,
          payload: { domain: body.domain, results: results.map((r) => ({
            domain: r.domain,
            attempted: r.attempted,
            inserted: r.inserted,
            skipped: r.skipped,
            failed: r.failed,
            errors: r.errors.length,
          })) },
        })

        return reply.code(200).send({
          status,
          inserted: totals.inserted,
          skipped: totals.skipped,
          failed: totals.failed,
          durationMs,
          domains: results,
        })
      } catch (err) {
        return reply.code(500).send({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        })
      } finally {
        container.promotionInFlight = false
      }
    },
  )

  // GET /api/v1/promote/status — ADMIN only, last 20 promotion runs
  // Reads audit_events where action = 'PROMOTE_TRIGGER' (no separate table).
  fastify.get(
    '/api/v1/promote/status',
    { preHandler: requireRole('ADMIN') },
    async (_request, reply) => {
      const { auditEvents } = await import('@athlos/db/schema')
      const { desc, eq } = await import('drizzle-orm')
      const runs = await container.db
        .select({
          id: auditEvents.id,
          operatorId: auditEvents.operatorId,
          action: auditEvents.action,
          entityId: auditEvents.entityId,
          newValue: auditEvents.newValue,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'PROMOTE_TRIGGER'))
        .orderBy(desc(auditEvents.createdAt))
        .limit(20)

      return reply.code(200).send({ runs })
    },
  )

  done()
}
```

**Register in `apps/api/src/server.ts`** at line 202 (alongside `importRoutes`):
```typescript
// 16b. Promotion routes (E2 — Slice E closure):
//     POST /api/v1/promote/trigger (ADMIN), GET /api/v1/promote/status (ADMIN)
import { promoteRoutes } from './routes/promote.ts'
// ... after importRoutes registration ...
await app.register(promoteRoutes)
```

**Add `promotionInFlight` to `AppContainer` interface** (`apps/api/src/container.ts`):
```typescript
export interface AppContainer {
  // ... existing fields ...
  /** E2: in-memory flag for concurrent-trigger guard on POST /api/v1/promote/trigger */
  promotionInFlight: boolean
}
// In buildContainer(): promotionInFlight: false,
```

### 4.3 `promote.ts` algorithm update (~30 LoC)

```typescript
// In packages/promotion/src/promote.ts

// Step 2 changes: JOIN raw_events to filter by promoted_at IS NULL
const projectionRows = (
  await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
    `SELECT pe.source_key, pe.payload
     FROM "${projSchema}"."${projTableName}" pe
     JOIN public.raw_events re
       ON re.source_table = '${domain}'  -- 8 domains, safe-interpolated
      AND re.source_key = pe.source_key
     WHERE re.promoted_at IS NULL`,
  )
).rows ?? []

// After successful INSERT in insertMasterBatch, stamp promoted_at
// (NEW helper added at the end of insertMasterBatch):
await db.execute(
  `UPDATE public.raw_events
   SET promoted_at = now()
   WHERE source_table = '${domain}'
     AND source_key = ANY($1::varchar[])`,
  [insertedKeys],
)
```

**Defense-in-depth:** The `promoted_at IS NULL` filter (step 2) is the primary idempotency mechanism for E2; the `master.legacy_id` UNIQUE INDEX is the secondary. Both layers catch duplicates.

### 4.4 `dedup.ts` cross-check (~15 LoC)

```typescript
// In packages/promotion/src/dedup.ts — extend loadExistingNaturalKeys

export async function loadExistingNaturalKeys(db: Db, domain: Domain): Promise<Set<string>> {
  // ... existing master.legacy_id branches (8) ...

  // E2: also cross-check raw_events.promoted_at (belt-and-suspenders)
  if (domain === 'ctacte' || domain === 'ctacte1') {
    const rawEvents = await db.execute<{ source_key: string }>(
      `SELECT source_key FROM public.raw_events
       WHERE source_table = '${domain}' AND promoted_at IS NOT NULL`,
    )
    const promotedKeys = new Set((rawEvents.rows ?? []).map((r) => r.source_key))
    // Union with legacy_id set
    const existing = new Set<string>(/* existing master.legacy_id query */)
    for (const k of promotedKeys) existing.add(`raw:${k}`)
    return existing
  }
  // ... existing default ...
}
```

> **NOTE on scoping.** Only ctacte/ctacte1 use `raw_events.promoted_at` for cross-check (the other 6 domains have master-level dedup via composite UNIQUE INDEXes). For ctacte/ctacte1, the `raw_events.promoted_at` is more accurate than `master.legacy_id` after projection rebuilds (because re-imports can change the `source_key` but the `legacy_id` stays deterministic).

### 4.5 Runbook update (~90 LoC)

**Add new top-level section between "Containerized Deploy" and "CI/CD"** in `docs/runbook.md`:

```markdown
## Promotion Pipeline

Slice E (v0.5.5) wires the data-promotion pipeline: `legacy .DBF → raw_events → projection → 8 master tables`. This section covers how to run a promotion, the 8 domains + their natural keys, and the cross-run idempotency contract.

### How to run promotion (CLI vs API)

**CLI (full promotion, recommended for first run or maintenance windows):**

```bash
# Full promotion (8 domains, ~60-90s, ~570k rows)
pnpm db:promote

# Single domain (faster, ~5-10s)
DATABASE_URL=... pnpm tsx packages/promotion/src/promote-cli.ts socios
```

**API (ADMIN only, per-operator 1/min rate limit):**

```bash
# Full promotion (returns 200 when done; 120s request timeout)
curl -X POST http://localhost:3001/api/v1/promote/trigger \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{}'

# Single domain
curl -X POST http://localhost:3001/api/v1/promote/trigger \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"domain":"gastos"}'

# Check last 20 runs
curl http://localhost:3001/api/v1/promote/status \
  -H "Authorization: Bearer $ADMIN_JWT"
```

> **Recommendation:** Use the API for single-domain promotions (<10s, no NGINX timeout risk). Use the CLI for full `domain: 'all'` promotions (no timeout, see container logs directly).

### The 8 master tables + their natural keys

| Domain | Master table | Natural key | `legacy_id` source |
|--------|--------------|-------------|--------------------|
| `socios` | `socios.socios` | `numero_socio` (SOCCARNET) | `deterministicUuid('socios:'+numeroSocio)` |
| `escuela` | `socios.escuela` | `codigo` (ESCCODIGO) | `deterministicUuid('escuela:'+codigo)` |
| `deportes` | `deportes.disciplinas` | `codigo` (DEPCODIGO) | `deterministicUuid('deporte:'+codigo)` |
| `locacion` | `socios.locacion` | composite `(tipo_principal, numero)` | `deterministicUuid('locacion:'+tipo|numero)` |
| `caja` | `tesoreria.caja_movimiento` | 4-tuple `(numero, secuencia, fecha, hora)` | `deterministicUuid('caja:'+4-tuple)` |
| `gastos` | `tesoreria.gastos` | 5-tuple `(tipo, cuenta, secuencia, fecha, comprob)` | `deterministicUuid('gastos:'+5-tuple)` |
| `ctacte` | `tesoreria.ctacte` | 5-tuple `(cuenta, fecha, nrocomp, mes, talonario)` | `deterministicUuid('ctacte:'+5-tuple)` |
| `ctacte1` | `tesoreria.ctacte1` | 5-tuple `(pagonro, pagosec, pagotal, pagofam, cuenta)` | `deterministicUuid('ctacte1:'+5-tuple)` |

**PROMOTION_ORDER (topological):**
```
socios → escuela → deportes → locacion → caja → gastos → ctacte → ctacte1
```

### The `promoted_at` audit column

E2 (v0.5.6) adds `raw_events.promoted_at timestamp with time zone` for per-row promotion tracking. Migration `0016_promoted_at.sql` adds the column + INDEX + best-effort backfill.

**Query per-row promotion status:**

```sql
SELECT source_table, count(*) AS total, count(promoted_at) AS promoted
FROM public.raw_events
GROUP BY source_table
ORDER BY source_table;
```

**Expected post-E2:**

| source_table | total | promoted | unpromoted (orphan) |
|--------------|------:|---------:|--------------------:|
| socios | 39,357 | ~16,383 | ~22,974 (pre-E1a manual entries without `legacy_id`) |
| ctacte | 326,275 | ~0 (no backfill yet — TODO ctacte via legacy_id) | 326,275 |
| ctacte1 | 245,370 | ~0 (no backfill yet — TODO ctacte1 via legacy_id) | 245,370 |
| ... (other domains) | ... | 0 (promote_at stays NULL; other domains don't use raw_events-based promotion) | ... |

> **Backfill limitation:** The 0016 migration backfills `promoted_at` for `socios` ONLY. ctacte and ctacte1 backfill requires `raw_events.legacy_id` (E3+) or a join through `entity_uuids`. Run `pnpm tsx scripts/backfill-promoted-at.ts ctacte` (E3+, out of scope) after migration if you need 100% coverage.

### Cross-run idempotency contract

Re-running `pnpm db:promote` (CLI) or `POST /promote/trigger` (API) is a no-op. Two defense-in-depth layers:

1. **`master.legacy_id UNIQUE INDEX`** (all 8 domains) — catches duplicate INSERTs at the DB level (`ON CONFLICT DO NOTHING`).
2. **`raw_events.promoted_at IS NULL` filter** (E2) — projection scan joins `raw_events` and skips already-promoted rows (prevents unnecessary round-trips).

**Verify idempotency:**
```bash
bash scripts/verify-slice.sh   # exits 0 = TRUE idempotency
```

### Admin API: `POST /promote/trigger`

| Aspect | Value |
|--------|-------|
| Method + path | `POST /api/v1/promote/trigger` |
| Auth | `requireRole('ADMIN')` |
| Rate limit | 1 request/min/operator (via `@fastify/rate-limit` `keyGenerator: operator.sub`) |
| Request body | `{ domain?: 'all' \| Domain }` (default `'all'`) |
| Response 200 | `{ status: 'completed' \| 'failed', inserted, skipped, failed, durationMs, domains: PromotionResult[] }` |
| Response 200 (concurrent) | `{ status: 'already_running' }` |
| Response 401 | unauthenticated |
| Response 403 | non-ADMIN operator |
| Response 429 | per-operator rate limit exceeded (1/min) |
| Response 500 | promotion failed (uncaught error) |
| Request timeout | 120s (recommend CLI for full promotes) |
| Audit row | 1 `audit_events` row with `action: 'PROMOTE_TRIGGER'` |

### Known Limitations

| # | Limitation | Impact | Future slice |
|---|------------|--------|--------------|
| **N7** | Caja wide columns (122 detail columns per header) — promotion is header-only | Caja_movimiento only has 4-tuple NK + fecha/hora/descripcion; detail lines deferred | N7 (future) |
| **N8** | `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table; no per-socio enrollment data | N8 (future) |
| **N14** | Stale `entity_uuids` (~107k ctacte1 orphans) | ctacte1 promotion rate stuck at ~61% (150,129 of 245,370) | N14 (future) — repopulate entity_uuids from raw_events |
| **N16** | `gastos` FK to `ctacte` via `cctcuenta` lookup | `gastos.cuenta` is accounting-plan code, not socio carnet; no FK constraint | N16 (future) |
```

### 4.6 Final atomic canonical sync (~80 LoC, B1b LESSON #1)

**Add 3 NEW requirements to `openspec/specs/deployment-devops/spec.md`** (additive-only — does NOT modify the existing Promotion Pipeline requirement at lines 167-276):

1. **Requirement: Admin Promotion Trigger** (5 scenarios + 1 success criterion)
   - Scenario: ADMIN can trigger via `POST /api/v1/promote/trigger` (sync, returns 200)
   - Scenario: Non-admin returns 403
   - Scenario: Rate-limited operator returns 429
   - Scenario: Concurrent trigger returns 200 with `{ status: 'already_running' }`
   - Scenario: Promotion failure returns 500 with error summary

2. **Requirement: Per-row Promotion Audit (`promoted_at`)** (4 scenarios + 1 success criterion)
   - Scenario: `raw_events.promoted_at` column added by migration 0016
   - Scenario: Backfill marks `socios` source_keys that have a master row (~16,383 rows)
   - Scenario: `promote.ts` filters by `WHERE raw_events.promoted_at IS NULL`
   - Scenario: On successful INSERT, `UPDATE raw_events SET promoted_at = now()`
   - Scenario: Per-row query `SELECT source_table, count(*), count(promoted_at) FROM raw_events GROUP BY source_table` shows promotion status

3. **Requirement: Runbook Documentation** (4 scenarios + 1 success criterion)
   - Scenario: `docs/runbook.md` has "Promotion Pipeline" section
   - Scenario: Section explains 8 domains + NKs + legacy_id pattern
   - Scenario: Section explains CLI vs API triggers + auth + rate limits
   - Scenario: Runbook has "Known Limitations" section documenting N7, N8, N14, N16

**3 NEW success criteria (#49-51):**
- `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ status, results, totals, durationMs }` after running `promoteAll`
- `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` returns ~16,383 (socios backfill count; ctacte/ctacte1 are TODO for E3+)
- `bash scripts/verify-slice.sh` STILL exits 0 post-E2 (no regression in promotion idempotency)

---

## 5. Affected Areas

| Path | Action | Why |
|------|--------|-----|
| `packages/db/drizzle/0016_promoted_at.sql` | NEW (~20L) | Migration: ALTER TABLE + INDEX + backfill |
| `packages/db/drizzle/meta/_journal.json` | MODIFY (+6L) | idx 16 entry |
| `packages/db/src/schema/public.ts` | MODIFY (+3L) | Add `promotedAt: timestamp` to `rawEvents` |
| `packages/promotion/src/promote.ts` | MODIFY (+30L) | `promoted_at IS NULL` filter + bulk UPDATE on success |
| `packages/promotion/src/dedup.ts` | MODIFY (+15L) | `loadExistingNaturalKeys` also reads `raw_events.promoted_at` for ctacte/ctacte1 |
| `packages/promotion/src/index.ts` | MODIFY (+2L) | Re-export new helpers if added |
| `apps/api/src/routes/promote.ts` | NEW (~150L) | `POST /api/v1/promote/trigger` + `GET /api/v1/promote/status` |
| `apps/api/src/routes/promote.test.ts` | NEW (~120L) | 6 vitest cases (mock container pattern from `import.test.ts`) |
| `apps/api/src/server.ts` | MODIFY (+5L) | Register `promoteRoutes` (after `importRoutes`, line ~202) |
| `apps/api/src/container.ts` | MODIFY (+3L) | Add `promotionInFlight: boolean` to `AppContainer` |
| `docs/runbook.md` | MODIFY (+90L) | New top-level "Promotion Pipeline" section + sub-sections |
| `openspec/specs/deployment-devops/spec.md` | MODIFY (+80L) | 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria |
| `CHANGELOG.md` | MODIFY (+5L) | v0.5.6 entry |
| Root + 18 `packages/*/package.json` | MODIFY (+1 each) | bump 0.5.5 → 0.5.6 in release commit |

---

## 6. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0016_promoted_at.sql` | create | ~20 | Hand-written SQL: ALTER TABLE + INDEX + 3 per-domain UPDATEs (single transaction + statement_timeout) |
| `packages/db/drizzle/meta/_journal.json` | modify | +6 | Add entry for idx 16 (next sequential after 0015) |
| `packages/db/src/schema/public.ts` | modify | +3 | Add `promotedAt: timestamp('promoted_at', { withTimezone: true })` to `rawEvents` |
| `packages/promotion/src/promote.ts` | modify | +30 | `promoted_at IS NULL` filter + bulk UPDATE after insert |
| `packages/promotion/src/dedup.ts` | modify | +15 | `loadExistingNaturalKeys` reads `raw_events.promoted_at` for ctacte/ctacte1 |
| `packages/promotion/src/index.ts` | modify | +2 | Re-export new helpers if added |
| `apps/api/src/routes/promote.ts` | create | ~150 | `POST /api/v1/promote/trigger` (ADMIN + per-operator 1/min) + `GET /api/v1/promote/status` |
| `apps/api/src/routes/promote.test.ts` | create | ~120 | 6 vitest cases (mock container, no DB write) |
| `apps/api/src/server.ts` | modify | +5 | Register `promoteRoutes` (after `importRoutes`) |
| `apps/api/src/container.ts` | modify | +3 | Add `promotionInFlight: boolean` to `AppContainer` |
| `docs/runbook.md` | modify | +90 | New top-level "Promotion Pipeline" section + 6 sub-sections |
| `openspec/specs/deployment-devops/spec.md` | modify | +80 | 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria (additive only) |
| `openspec/changes/.../specs/deployment-devops/spec.md` | create | ~300 | Full E2 spec delta per E1b2b spec format |
| `CHANGELOG.md` | modify | +5 | v0.5.6 entry |
| Root + 18 `packages/*/package.json` | modify | +1 each | bump 0.5.5 → 0.5.6 in release commit |
| **Total raw LoC** | | **~485 raw / ~280 effective** | **UNDER the 400-line review budget at effective count** |

---

## 7. Implementation Order (12 work-units, 3-commit shape)

Mirrors E1b2b's 3-commit shape (TDD → spec sync → release) and B1b's pattern.

### TDD chain (the only TDD code)

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-001** | [TDD-RED] | Write `apps/api/src/routes/promote.test.ts` with 6 test cases (mirroring `import.test.ts`): ADMIN 200, CONSULTA 403, unauth 401, rate-limited 429, concurrent 200 `already_running`, status 200 | test file (~120L) |
| **TASK-002** | [TDD-GREEN migration] | Hand-write `0016_promoted_at.sql` + apply via `psql` (NOT drizzle-kit — E1b1 LESSON) + update `_journal.json` | migration (~20L) |
| **TASK-003** | [TDD-GREEN schema] | Update `public.ts` with `promotedAt` column on `rawEvents` | 1 file (+3L) |
| **TASK-004** | [TDD-GREEN admin endpoint] | Implement `apps/api/src/routes/promote.ts` + register in `server.ts` + add `promotionInFlight` to `container.ts` | 3 files (~158L) |
| **TASK-005** | [TDD-GREEN promote update] | Update `promote.ts`: `promoted_at IS NULL` filter + bulk UPDATE on success | 1 file (+30L) |
| **TASK-006** | [TDD-GREEN dedup update] | Update `dedup.ts`: `loadExistingNaturalKeys` reads `raw_events.promoted_at` for ctacte/ctacte1 | 1 file (+15L) |

### Verification + sync + release

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-007** | [TDD-REFACTOR] | Tighten helpers; ensure no `any` types; consolidate SQL strings | (varies) |
| **TASK-008** | [Pre-closing verification — CRITICAL E1b1/E1b2a/E1b2b LESSON] | Run `bash scripts/verify-slice.sh` (the REAL gate); verify all 8 master tables populate + 2nd/3rd runs insert 0 new rows | (no files) |
| **TASK-009** | [Runbook update] | Add new top-level "Promotion Pipeline" section to `docs/runbook.md` + 6 sub-sections | 1 file (+90L) |
| **TASK-010** | [Final atomic canonical spec sync — B1b LESSON #1, FULL additive] | Update `openspec/specs/deployment-devops/spec.md` with 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria; existing Promotion Pipeline UNCHANGED | spec file (+80L) |
| **TASK-011** | [Pre-merge fix slot — B1b LESSON #3] | Cherry-pick reorder to preserve 3-commit shape if verify catches critical issue | (varies) |
| **TASK-012** | [Closing release commit — B1b LESSON #2] | Bump root `package.json` + 18 `packages/*/package.json` to `0.5.6`; add `CHANGELOG.md` v0.5.6 entry in SEPARATE commit | `package.json` + 18 packages, `CHANGELOG.md` |

### Commit shape (3 commits per B1b + E1b2b pattern)

1. `feat(promotion): wire admin endpoint + promoted_at audit (v0.5.6 prep)` (TASK-001..TASK-007) — TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash.
2. `docs(spec): atomic sync — 3 NEW Slice E2 requirements (admin API + audit + runbook)` (TASK-010) — **FULL atomic sync** per B1b LESSON #1 (additive only; closes Slice E spec).
3. `chore(release): v0.5.6` (TASK-012) — separate per B1b LESSON #2.

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D feat/slice-e2-promote-admin-audit` (B1b LESSON #4).

---

## 8. Risks & Mitigations (top 5)

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** | **Apply sub-agent skips `bash scripts/verify-slice.sh`** (E1b1/E1b2a/E1b2b LESSON — v0.5.2/v0.5.4 historically shipped with potentially broken state because smoke test was skippable) | **CRITICAL** | TASK-008 (`bash scripts/verify-slice.sh`) is a HARD GATE in apply prompt. The script was introduced in commit `b26896c` + extended in commit `061be50` (now covers all 8 master tables). Apply MUST run the script BEFORE declaring ready. Verify ALL expected row counts unchanged + 2nd/3rd runs insert 0 new rows across all 8 master tables. **No merge until `verify-slice.sh` exits 0 (PASS).** |
| **R2** | **Sync endpoint timeout (60-90s) cuts NGINX `proxy_read_timeout` (60s default)** | High | TASK-004: 120s request timeout via `request.routeOptions.config.timeout`; in-memory `promotionInFlight` flag reset in `finally { promotionInFlight = false }` ensures recovery if the cut happens mid-flight. Runbook documents that operators should use the CLI for full promotes and reserve the API for single-domain promotions (<10s). |
| **R3** | **`promoted_at` backfill on 650k rows takes 3-5s + blocks concurrent reads** | Medium | TASK-002: Single transaction with `SET LOCAL statement_timeout = '60s'`; `WHERE promoted_at IS NULL` makes the UPDATE re-runnable idempotently. Apply during low-traffic window (cron drift-detection fires every 5 min — backfill should fire between cron ticks). |
| **R4** | **Final atomic canonical sync has many diff lines** (B1b LESSON #1) | Low (planned) | Spec delta acceptance criteria MUST include `diff` assertion (additive-only). 3 NEW requirements (80L of spec.md) — no modifications to existing Promotion Pipeline requirement at lines 167-276. Apply phase verifies diff is additive-only — no removals, no rewrites of prior Slice E scenarios. |
| **R5** | **`raw_events` JOIN on `(source_table, source_key)` is ambiguous if same source_key imported twice with different content_hash** | Low | The import pipeline dedups on `(source_table, source_key, content_hash)` UNIQUE INDEX (line 213-217 of `packages/db/src/schema/public.ts`), so multiple raw_events rows for the same source_key represent intentional historical versions. `ORDER BY imported_at DESC + LIMIT 1` in the JOIN subquery picks the most recent. Documentation in code comment + runbook "Known Limitations" if ambiguity persists. |

### Lesser risks

- **NGINX `proxy_read_timeout` not in our control** — the deploy docs at `docs/runbook.md:323-333` already document manual rollback; the 120s timeout is a workaround. Future E3+ converts to async via scheduler.
- **Migration via `drizzle-kit migrate` would skip our hand-written SQL** (E1b1 LESSON) — TASK-002 uses `psql -f` exclusively.
- **Test data leakage** — TASK-001 uses mock container (no real DB write), mirroring `import.test.ts:1-100`. The existing `promote.test.ts` stays `describe.skip` (E1b2a LESSON re: TRUNCATE bug).
- **`promotionInFlight` flag lost on process restart** — acceptable for v1 single-process API; future E3+ uses `pg_advisory_lock` for multi-process hardening.
- **Audit row volume** — 1 row per trigger (not per promoted row) is correct granularity. `emitAudit` 10s bucket dedup handles double-click case.

---

## 9. Dependencies (all confirmed shipped)

| Dependency | What E2 needs | Status |
|------------|---------------|--------|
| **Slice E1b2b** (v0.5.5) | 8/8 master domains populate + `legacy_id` UNIQUE INDEX pattern + FINAL atomic canonical sync | ✅ shipped 2026-06-25 (commit `36ac630`) |
| **Slice E1b2a** (v0.5.4) | 4 NEW master tables + 4 NEW transforms + partial canonical sync | ✅ shipped 2026-06-25 (commit `b8d8e43`) |
| **Slice E1b1** (v0.5.2/v0.5.3) | ctacte1 wired via cctcuenta + legacy_id UNIQUE INDEX | ✅ shipped 2026-06-24 |
| **Slice E1a** (v0.5.1) | `packages/promotion/` skeleton + 3 priority domain transforms | ✅ shipped 2026-06-24 |
| **Slice D** (v0.5.0) | Real `.github/workflows/deploy.yml` + `/health/ready` endpoint | ✅ shipped 2026-06-24 |
| **Slice B-7c** (v0.4.6) | `packages/import/` with `runImport`, `LEGACY_IMPORT_ORDER`, `TABLE_DEPENDENCIES` | ✅ shipped 2026-06-18 |
| **`packages/db`** (v0.5.5) | `createDb({ connectionString })` + Drizzle schemas + 15 migrations applied (`_journal.json` ends at idx 15) | ✅ shipped |
| **`packages/auth`** (v0.5.0) | `requireRole('ADMIN')` from `@athlos/auth/middleware` (line 104) | ✅ shipped |
| **`packages/audit`** (v0.5.0) | `emitAudit(db, record)` for audit row insertion (10s bucket dedup) | ✅ shipped |
| **`packages/errors`** (v0.5.0) | `BusinessError`, `ErrorCode` (TOKEN_INVALID, INSUFFICIENT_PERMISSIONS) | ✅ shipped |
| **`packages/scheduler`** (v0.5.0) | (NOT USED — sync HTTP only per locked Q2) | n/a |
| **`@fastify/rate-limit`** (already in `apps/api/`) | Per-route `config.rateLimit` with `keyGenerator` | ✅ already registered globally at `apps/api/src/plugins/rate-limit.ts:33-56` |
| **Fastify v5.2.0** (verified live) | Route registration + `app.inject` for tests + `preHandler` hooks | ✅ shipped |

**No new external dependencies.** E2 adds zero npm packages, zero Ubuntu packages, zero third-party services. Pure TypeScript + Fastify + Drizzle + `@fastify/rate-limit` (already a dep).

---

## 10. Acceptance Criteria

E2 is accepted when **all** of the following pass:

### 10.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (existing tests pass + 6 NEW promote endpoint tests)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 10.2 TDD discipline

- [ ] `apps/api/src/routes/promote.test.ts` committed BEFORE implementation (TASK-001)
- [ ] 6 NEW test cases: ADMIN 200, CONSULTA 403, unauth 401, rate-limit 429, concurrent `already_running`, status 200
- [ ] Mock container pattern mirrors `apps/api/src/routes/import.test.ts:1-100` (no real DB write)

### 10.3 Migration acceptance

- [ ] Migration `0016_promoted_at.sql` applies cleanly via `psql -f` (E1b1 LESSON)
- [ ] `\d public.raw_events` shows `promoted_at` column + INDEX
- [ ] Backfill (socios only): `SELECT count(*) FROM raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL` returns ~16,383
- [ ] ctacte/ctacte1 backfill documented as TODO (E3+) — not blocking E2 acceptance

### 10.4 API acceptance

- [ ] `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ status, results, totals, durationMs, domains }`
- [ ] `POST /api/v1/promote/trigger` (CONSULTA) returns 403
- [ ] `POST /api/v1/promote/trigger` (unauthenticated) returns 401
- [ ] `POST /api/v1/promote/trigger` (rate-limited) returns 429 with `retry_after`
- [ ] `POST /api/v1/promote/trigger` (concurrent) returns 200 with `{ status: 'already_running' }`
- [ ] `GET /api/v1/promote/status` (ADMIN) returns 200 with last 20 `audit_events` where `action = 'PROMOTE_TRIGGER'`
- [ ] `audit_events` has 1 NEW row per trigger with `action: 'PROMOTE_TRIGGER'`

### 10.5 Idempotency (E1b1/E1b2a/E1b2b LESSON — CRITICAL)

- [ ] **`bash scripts/verify-slice.sh` exits 0 (PASS)** — the REAL gate
- [ ] 3 sequential runs show 0 new inserts across all 8 master tables
- [ ] After E2: `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` shows the backfill count (~16,383 from socios)

### 10.6 Documentation acceptance

- [ ] `docs/runbook.md` has top-level "Promotion Pipeline" section (between "Containerized Deploy" and "CI/CD")
- [ ] Section has 6 sub-sections: CLI vs API, 8 master tables + NKs, `promoted_at` audit column, Cross-run idempotency, Admin API, Known Limitations
- [ ] Known Limitations documents N7/N8/N14/N16 with current impact + future slice

### 10.7 Spec sync (B1b LESSON #1 — additive only)

- [ ] `openspec/specs/deployment-devops/spec.md` has 3 NEW requirements (Admin Promotion Trigger, Per-row Promotion Audit, Runbook Documentation)
- [ ] 13 NEW scenarios + 3 NEW success criteria (#49-51)
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes (no removals, no modifications to existing Promotion Pipeline requirement at lines 167-276)

### 10.8 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] **LESSON #1 (FULL, additive):** 3 NEW requirements added in atomic spec-sync commit; existing Promotion Pipeline UNCHANGED
- [ ] **LESSON #2:** Version bump + CHANGELOG in SEPARATE release commit (`chore(release): v0.5.6`)
- [ ] **LESSON #3:** 3-commit shape preserved via rebase autosquash if pre-merge fix needed
- [ ] **LESSON #4:** Merge to main BEFORE `git branch -D feat/slice-e2-promote-admin-audit`
- [ ] **E1b1/E1b2a/E1b2b LESSON:** `bash scripts/verify-slice.sh` runs as HARD GATE before merge
- [ ] **E1b1 LESSON:** Migration via `psql` (NOT `drizzle-kit migrate`)

---

## 11. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines (raw, full impl) | **~485** |
| Estimated changed lines (effective) | **~280** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **MEDIUM at raw (~121%), LOW at effective (~70%)** |
| Chained PRs recommended | **No within E2** (E2 alone is THIS PR; no further sub-slices planned — Slice E closes) |
| Suggested split | **None** — single PR; the 4 deliverables (migration + endpoint + runbook + spec sync) are tightly coupled |
| Delivery strategy | single-pr (per session preflight cached) |
| Chain strategy | N/A |
| Work-unit count | **12** (TASK-001..TASK-012) |
| Largest single change | TASK-004 admin route (~158L) + TASK-010 spec sync (~80L of spec.md) |
| Estimated reviewer time | ~15-25 min (one pass — focus on migration SQL, admin endpoint auth + rate limit, runbook section structure, **additive-only atomic spec sync diff**) |

> **Honest call-out:** the 485 raw LoC estimate puts E2 OVER the 400-line budget at raw count (~121%) but WELL UNDER at effective count (~70%). The doc + spec sections (runbook + canonical spec) inflate raw count but are documentation, not logic. **No split recommended** because (a) all 4 deliverables share reviewers, (b) splitting multiplies CI/deploy overhead, (c) Slice E is the LAST data-promotion slice — no further sub-slices planned. The verify-slice.sh gate ensures the smoke test runs end-to-end before merge.

---

## 12. Open Questions (RESOLVED + LOCKED 2026-06-25)

All 5 user-confirmed decisions from the E2 explore (§12) are LOCKED. No open questions remain for spec phase.

| # | Question | Resolved value | Source |
|---|----------|----------------|--------|
| Q1 | Admin endpoint auth | `requireRole('ADMIN')` | E2 explore Q1 default + user-confirmed 2026-06-25 |
| Q2 | Sync vs async trigger | Sync HTTP (NOT scheduler) | E2 explore Q2 default + user-confirmed 2026-06-25 |
| Q3 | `promoted_at` backfill scope | Best-effort per-domain UPDATE (3 statements, single transaction + statement_timeout) | E2 explore Q3 default + user-confirmed 2026-06-25 |
| Q4 | Rate limit granularity | Per-operator 1/min via `@fastify/rate-limit` `keyGenerator: operator.sub` | E2 explore Q4 default + user-confirmed 2026-06-25 |
| Q5 | Runbook section placement | New top-level "Promotion Pipeline" section | E2 explore Q5 default + user-confirmed 2026-06-25 |
| **Q-impl** | Backfill scope (sub-question of Q3) | **socios ONLY** (ctacte/ctacte1 require `raw_events.legacy_id` column, E3+) | New clarification 2026-06-25 (propose phase) |

---

## 13. Ready for spec?

**YES.** The scope is bounded and well-defined:

- 1 NEW column (`raw_events.promoted_at`) + 1 NEW endpoint (`POST /promote/trigger`) + 1 NEW runbook section + 3 NEW additive canonical-spec requirements
- ~485 raw LoC / ~280 effective (under 400-line budget at effective count)
- All 5 user-confirmed decisions embedded explicitly
- All E1b/E1b2a/E1b2b LESSONs applied: verify-slice.sh as HARD GATE, psql migration, `describe.skip` for promotion tests, atomic canonical sync pattern (additive only), 3-commit shape
- All B1b LESSONs applied: atomic sync, separate release commit, cherry-pick reorder, merge-before-delete
- Slice E is the LAST data-promotion slice — no further sub-slices planned after E2

**Next step:** sdd-spec → write `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` per E1b2b spec format (~300 lines, 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria, additive-only). Then sdd-design → write `design.md` mirroring E1b2b design (smaller scope — ~250-300 lines). Then sdd-tasks → break into 12 implementation tasks. Then sdd-apply → wire admin endpoint + migration + promoted_at filter + runbook with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a/E1b2b LESSON — non-negotiable).

**B1b LESSONs to apply in sdd-spec:**

1. **LESSON #1 (HIGHEST, additive only):** Spec sync is additive — 3 NEW requirements at the END of the spec, NO modifications to the existing Promotion Pipeline requirement at lines 167-276 of `openspec/specs/deployment-devops/spec.md`. Diff MUST be additive-only (verify with `diff`).
2. **LESSON #2:** Spec delta acceptance criteria MUST include `diff` assertion (additive-only — no removals, no rewrites).
3. **LESSON #3:** Caja 4-tuple NK + gastos 5-tuple NK + ctacte/ctacte1 5-tuple NKs ALL documented in spec (NOT 3-tuple — see C2 from E1b2b).

---

## 14. Persisted artifacts

- This file: `openspec/changes/athlos-promote-projection-to-master-e2/proposal.md`
- Engram topic key: `sdd/athlos-promote-projection-to-master-e2/proposal`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)

**Next step (for the orchestrator):** sdd-spec → write the spec delta at `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` per E1b2b spec format (~300 lines, 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria, additive-only). Then sdd-design → write `design.md` mirroring E1b2b design (smaller — ~250-300 lines, focused on admin endpoint + promoted_at + runbook). Then sdd-tasks → break into 12 implementation tasks. Then sdd-apply → wire admin endpoint + migration + promoted_at filter + runbook with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a/E1b2b LESSON — non-negotiable).
