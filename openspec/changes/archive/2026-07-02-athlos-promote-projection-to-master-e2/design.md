# Design: athlos-promote-projection-to-master-e2

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e2` |
| **Date** | 2026-06-25 |
| **Phase** | Design |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for tasks |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` (411L) · `openspec/changes/athlos-promote-projection-to-master-e2/proposal.md` (801L) · `openspec/changes/explore-athlos-promote-projection-to-master-e2/exploration.md` (990L) |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1, commit `bc6aa60`) · `e1b1` (v0.5.2/v0.5.3, commit `4a29571`) · `e1b2a` (v0.5.4, commit `b8d8e43`) · **`e1b2b` (v0.5.5, commit `36ac630`, FINAL atomic sync applied in `e753528`)** |
| **Sister slice (THIS, LAST)** | **`athlos-promote-projection-to-master-e2` (v0.5.6) — closes Slice E permanently** (admin API + `promoted_at` audit + runbook + 3 NEW additive canonical-spec requirements). **No further sub-slices planned after E2.** |
| **Target release** | v0.5.5 → **v0.5.6** (PATCH — additive: 1 NEW column `raw_events.promoted_at`, 1 NEW endpoint `POST /api/v1/promote/trigger`, 1 NEW endpoint `GET /api/v1/promote/status`, 1 NEW runbook section, 3 NEW additive canonical-spec requirements; no breaking changes) |
| **B1b LESSONs embedded** | #1 (HIGHEST) atomic sync — 3 NEW requirements APPENDED, **NO modifications to existing Promotion Pipeline requirement at canonical lines 167-276** (per E1b2b FINAL sync) · #2 separate release commit (`chore(release): v0.5.6`) · #3 cherry-pick reorder · #4 merge-before-delete |
| **E1b1/E1b2a/E1b2b LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `061be50` extended to 8 master tables — already includes `tesoreria.gastos` in `MASTER_TABLES`); migration via `psql` NOT `drizzle-kit migrate` (E1b1 LESSON); existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug fix); E2 admin endpoint tests use Fastify `app.inject` mock-container pattern (mirrors `import.test.ts`) |

> **E2 IS THE LAST SUB-SLICE OF SLICE E.** Per the parent Slice E exploration (§1 + §10) and E1b2b design (§1, §11): **no further sub-slices planned after E2**. After v0.5.6, the data-promotion pipeline is **feature-complete for v1.0**. Slice F or beyond is NOT planned — E2 permanently closes Slice E. The next reviewable work post-E2 will be in **E3+** (post-MVP — see §3 non-goals: `raw_events.legacy_id` column for ctacte/ctacte1 backfill, async scheduler, dry-run, OpenAPI).
>
> **5 LOCKED DECISIONS (user-confirmed 2026-06-25).**
>
> | # | Decision | Locked value |
> |---|----------|--------------|
> | Q1 | Admin endpoint auth | `requireRole('ADMIN')` (matches `import/trigger` precedent at `apps/api/src/routes/import.ts:47`) |
> | Q2 | Sync vs async trigger | **Sync HTTP** (NOT scheduler) — `promoteAll(db)` runs in request thread, returns 200 with `{ status, results, totals, durationMs }` |
> | Q3 | `promoted_at` backfill scope | **Best-effort `socios`-only UPDATE** (NEW clarification, 2026-06-25 — ctacte/ctacte1 backfill deferred to E3+; requires `raw_events.legacy_id` column which doesn't exist today; engram obs #2547) |
> | Q4 | Rate limit granularity | Per-operator 1/min via `@fastify/rate-limit` `keyGenerator: req.operator?.sub` |
> | Q5 | Runbook section placement | New top-level "Promotion Pipeline" section between "Containerized Deploy" and "CI/CD" |

---

## 1. Context

### What E1a + E1b1 + E1b2a + E1b2b shipped (Slice E data layer, COMPLETE)

| Slice | Version | Scope | Status |
|-------|--------:|-------|--------|
| **E1a** | v0.5.1 | `packages/promotion/` skeleton + transforms for `socios`, `ctacte`, `ctacte1` | ✅ shipped 2026-06-24 |
| **E1b1** | v0.5.2/v0.5.3 | Migration `0013_legacy_id_unique.sql` (cctcuenta + legacy_id columns + UNIQUE INDEXes) + wire `ctacte1` via `cctcuenta` backfill | ✅ shipped 2026-06-24 |
| **E1b2a** | v0.5.4 | Migration `0014_new_masters.sql` (4 NEW tables: escuela, disciplinas legacy_id, locacion, caja_movimiento) + 4 NEW transforms + PROMOTION_ORDER extended to 7 domains | ✅ shipped 2026-06-25 (commit `b8d8e43`) |
| **E1b2b** | v0.5.5 | Migration `0015_gastos.sql` + `transformGastos` + PROMOTION_ORDER extended to 8 domains + **FINAL atomic canonical sync** + `scripts/verify-slice.sh` already extended to 8 tables (commit `304f37a`/`061be50`) | ✅ shipped 2026-06-25 (commit `36ac630`) |

After E1b2b (v0.5.5), **all 8 master domains** populate via `pnpm db:promote`. Per live verification 2026-06-25 against `192.168.1.102:5432/athlos`:

| Master table | Projection rows | Current rows | Status |
|--------------|----------------:|-------------:|--------|
| `socios.socios` | 39,357 | 16,383 | ✅ promoted (E1a) — re-promote fills ~22,974 pre-E1a orphans |
| `tesoreria.ctacte` | 326,275 | 197,521 | ✅ promoted (E1a) — partial; N14 stale `entity_uuids` |
| `tesoreria.ctacte1` | 245,370 | 150,129 | ✅ partial (E1b1 — ~61%, N14 limitation) |
| `socios.escuela` | 66 | 61 | ✅ promoted (E1b2a) — re-promote fills 5 missing |
| `deportes.disciplinas` | 32 | 32 | ✅ full |
| `socios.locacion` | 89 | 91 | ✅ full (+2 from re-promote) |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | ✅ full (+4 from re-promote) |
| `tesoreria.gastos` | 2,114 | 2,114 | ✅ full (E1b2b) |

**`bash scripts/verify-slice.sh` exits 0** (verified 2026-06-25T15:06:09Z against `192.168.1.102:5432/athlos`). TRUE idempotency: 2nd run inserts 0 new rows across all 8 master tables.

### What E2 ships (LAST sub-slice of Slice E)

**Slice E's data layer is COMPLETE.** What operators need now is **operational glue**, not new data-layer code. E2 ships 4 distinct deliverables:

| Deliverable | What | Where |
|-------------|------|-------|
| **D1. Admin API** | `POST /api/v1/promote/trigger` (ADMIN, sync HTTP, per-operator 1/min rate limit) + `GET /api/v1/promote/status` (ADMIN, last 20 runs) | `apps/api/src/routes/promote.ts` (NEW, ~150L) + `promote.test.ts` (NEW, ~120L) + `server.ts` (MODIFIED) + `container.ts` (MODIFIED) |
| **D2. `promoted_at` audit** | New `raw_events.promoted_at timestamptz` column + `idx_raw_events_promoted_at` + best-effort `socios`-only backfill (NEW clarification, Q3 narrowed) + `promote.ts` filter by `promoted_at IS NULL` + bulk UPDATE on success + `dedup.ts` cross-check for ctacte/ctacte1 | `0016_promoted_at.sql` (NEW) + `public.ts` schema (MODIFIED) + `promote.ts` (MODIFIED, +30L) + `dedup.ts` (MODIFIED, +15L) |
| **D3. Runbook** | New top-level "Promotion Pipeline" section in `docs/runbook.md` with 6 sub-sections (CLI vs API, 8 master tables + NKs, `promoted_at` audit, Cross-run idempotency, Admin API, Known Limitations) | `docs/runbook.md` (MODIFIED, +90L) |
| **D4. Final atomic sync** | 3 NEW additive requirements to canonical spec (B1b LESSON #1, HIGHEST) — existing Promotion Pipeline requirement at canonical lines 167-276 **UNCHANGED** | `openspec/specs/deployment-devops/spec.md` (MODIFIED, +~80L) |

**E2 is the LAST sub-slice of Slice E.** Per the parent Slice E exploration (§1 + §10) and E1b2b design (§1, §11): **no further sub-slices planned after E2**. After v0.5.6, the data-promotion pipeline is **feature-complete for v1.0**. Slice F or beyond is NOT planned (E2 closes Slice E permanently).

### Why E2 ships as one PR (single PR, no chained PRs)

The 4 deliverables share reviewers (backend operators + admin). Splitting them into multiple PRs would multiply CI/deploy overhead without reducing review load. The 4 deliverables are tightly coupled (the admin endpoint depends on `promoteAll` knowing about `promoted_at`; the runbook documents the new endpoint; the spec sync captures both). **Single PR = single review cycle = ~485 raw LoC / ~280 effective = fast close of Slice E.** The verify-slice.sh gate ensures the smoke test runs end-to-end before merge (E1b1/E1b2a/E1b2b LESSON — non-negotiable per commit `b26896c` introducing the gate).

This design modifies the existing `deployment-devops` capability by **appending 3 NEW requirements** to the end of the canonical spec. No existing requirement is modified, removed, or rewritten (B1b LESSON #1 — HIGHEST — additive only). The `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` SHALL be purely additive (no removals, no rewrites of prior Slice E scenarios).

---

## 2. Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `POST /api/v1/promote/trigger` admin endpoint | Fastify v5.2.0 route (`apps/api/src/routes/promote.ts`); `requireRole('ADMIN')` middleware (matches `import/trigger` precedent at `apps/api/src/routes/import.ts:47`); `@fastify/rate-limit` per-operator (1/min via `keyGenerator: req.operator?.sub`); calls `promoteAll(db)` synchronously in request thread; returns 200 with `{ status, inserted, skipped, failed, durationMs, domains: PromotionResult[] }` |
| **G2** | `GET /api/v1/promote/status` companion endpoint | ADMIN-only; returns last 20 `audit_events` rows where `action = 'PROMOTE_TRIGGER'`, ordered by `created_at DESC`; mirrors `GET /api/v1/import/status` shape |
| **G3** | Concurrent-trigger guard (in-memory `promotionInFlight` flag on `AppContainer`) | Second `POST /trigger` while first is in flight returns 200 with `{ status: 'already_running' }`; `finally { promotionInFlight = false }` ALWAYS runs (guaranteed even on exception or timeout) |
| **G4** | Audit-logged: 1 `audit_events` row per successful trigger | `emitAudit(db, { action: 'PROMOTE_TRIGGER', entityType: 'promotion', entityId: 'promotion-<ts>', newValue: { domain, totals, durationMs } })` (10s bucket dedup handles double-clicks) |
| **G5** | 120s request timeout | `request.routeOptions.config.timeout = 120_000` to avoid NGINX `proxy_read_timeout 60s` mid-flight cut for full `domain: 'all'` promotions (~60-90s on live DB); the `finally` block still runs on timeout so the in-memory flag resets |
| **G6** | `promoted_at` column on `raw_events` (migration 0016) | Hand-written SQL: `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS promoted_at timestamptz` + `CREATE INDEX IF NOT EXISTS raw_events_promoted_at_idx ON public.raw_events (promoted_at)` — applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON) |
| **G7** | Best-effort `socios`-only backfill (NEW clarification, Q3 narrowed) | 1 UPDATE statement in single transaction: `UPDATE raw_events re SET promoted_at = now() FROM socios.socios s WHERE re.source_table = 'socios' AND re.source_key = s.numero_socio AND re.promoted_at IS NULL` — yields ~16,383 backfilled rows. **ctacte/ctacte1 backfill deferred to E3+** (requires `raw_events.legacy_id` column which doesn't exist today) |
| **G8** | `promote.ts` filters projection by `WHERE raw_events.promoted_at IS NULL` | The projection scan query gets a JOIN clause `JOIN public.raw_events re ON re.source_table = $domain AND re.source_key = pe.source_key AND re.promoted_at IS NULL` — replaces the comment at `packages/promotion/src/promote.ts:82` that says "E2 will add `promoted_at` filter" |
| **G9** | Bulk UPDATE `promoted_at = now()` after successful INSERT | After `insertMasterBatch` returns for a domain, execute `UPDATE public.raw_events SET promoted_at = now() WHERE source_table = $domain AND source_key = ANY($insertedKeys::varchar[])` — stamps all successfully-inserted source_keys atomically |
| **G10** | `dedup.ts` cross-check for ctacte/ctacte1 | `loadExistingNaturalKeys` reads `raw_events.promoted_at IS NOT NULL` for ctacte/ctacte1 in addition to `master.legacy_id` UNIQUE INDEX — belt-and-suspenders defense |
| **G11** | `docs/runbook.md` new top-level "Promotion Pipeline" section | 6 sub-sections between "Containerized Deploy" (line 237) and "CI/CD" (line 297): (a) How to run promotion (CLI vs API), (b) The 8 master tables + their natural keys, (c) The `promoted_at` audit column, (d) Cross-run idempotency contract, (e) Admin API: `POST /promote/trigger`, (f) Known Limitations (N7/N8/N14/N16) |
| **G12** | Final atomic canonical sync (B1b LESSON #1, HIGHEST) | 3 NEW requirements APPENDED to `openspec/specs/deployment-devops/spec.md`: "Admin Promotion Trigger" (7 scenarios), "Per-row Promotion Audit (`promoted_at`)" (6 scenarios), "Runbook Documentation" (5 scenarios). 13 NEW scenarios + 3 NEW success criteria (#49-51). Existing Promotion Pipeline requirement at lines 167-276 **UNCHANGED**. Existing `tesoreria.gastos` requirement at lines 280-315 **UNCHANGED**. `diff` returns ONLY additive changes. |
| **G13** | Apply sub-agent runs `bash scripts/verify-slice.sh` (E1b1/E1b2a/E1b2b LESSON — non-negotiable) | Script exits 0; 2nd/3rd run inserts 0 new rows across all 8 master tables; idempotency preserved post-E2 (the `promoted_at` filter changes WHICH rows are eligible, not HOW many get inserted — migration 0016 adds a column + index + backfill but does NOT change master row counts) |
| **G14** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON) | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql`; manual `_journal.json` idx 16 entry (next sequential after E1b2b's idx 15) |
| **G15** | Existing tests stay green + 6 NEW admin endpoint tests pass | Existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug; 6 NEW vitest cases in `apps/api/src/routes/promote.test.ts` use Fastify `app.inject` + mock container pattern (mirrors `import.test.ts`) — NO real DB write |

---

## 3. Non-goals (deferred to E3+ or NEVER)

| ID | Deferred to | Item | Why |
|----|-------------|------|-----|
| **N1** | E3+ | **`raw_events.legacy_id` column** + ctacte/ctacte1 backfill of `promoted_at` | The `raw_events` table does NOT have a `legacy_id` column today (verified via `\d public.raw_events` 2026-06-25). Backfilling ctacte/ctacte1 via `(source_table, source_key)` JOIN through `master.legacy_id` would be wrong because `raw_events.source_key` for ctacte is the VFP key, NOT the socio carnet. **NEW clarification (engram obs #2547)**: E2 ships with `socios`-only backfill; ctacte/ctacte1 documented as TODO E3+ in the runbook "Known Limitations" + spec success criteria. |
| **N2** | E3+ | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` | Sync HTTP works for v1 (operator manually triggers; ~60-90s latency acceptable; 120s request timeout mitigates NGINX cut). E3+ adds a `scheduled-promotion` JobHandler that wraps `promoteAll()` + 202 + batchId mirroring `import/trigger`. |
| **N3** | E3+ | `pg_advisory_lock` for multi-process concurrent-promotion prevention | In-memory `promotionInFlight` flag is sufficient for v1 single-process API. Advisory lock is hardening for multi-process deploys. |
| **N4** | E3+ | Dry-run mode (`POST /promote/trigger?dryRun=true`) | CLI `--dry` flag is the future home; v1 single API surface keeps it simple. |
| **N5** | E3+ | OpenAPI / Swagger spec generation | No OpenAPI in repo (`find . -name "openapi*"` returns nothing); API documented via spec + runbook. |
| **N6** | E3+ | Cross-table analytics (e.g. ctacte1 saldo aggregations) | Out of scope for promotion pipeline; analytics is a separate spec. |
| **N7** | E3+ | Multi-region deployment | Single env per Slice C ADR; staging promotion is a separate slice. |
| **N8** | E3+ | Per-socio bulk promotion (partial re-promotion by socio) | Per-domain only in v1. |
| **N9** | E3+ | Scheduler-cron-triggered promotion | Manual-only per E1b §3 ("user wants manual review before promotion lands"); auto-promotion is post-MVP. |
| **N10** | NEVER | Approval workflow for promotion | ADMIN RBAC is sufficient (mirrors `POST /api/v1/import/trigger` precedent). Permission keys are for cross-role delegation (like `data_steward`). |
| **N11** | **NEVER** | Slice F or beyond | Slice E closes the data-promotion pipeline for v1.0. **E2 is the FINAL sub-slice.** |
| **N12** | future (N7) | Caja detail columns (CAJCONCEP1..20, CAJIMPOR1..20 — 122 wide columns) | Header-only is sufficient for v1.0; deferred per E1b2a scope. |
| **N13** | future (N8) | `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table exists yet. |
| **N14** | future (N14) | Stale `entity_uuids` repopulation | Would unlock ~107k orphan ctacte1 rows → ~100% ctacte1 promotion rate; documented as known limitation in runbook "Known Limitations" section. |
| **N15** | future (N16) | `gastos` FK to `ctacte` via `cctcuenta` lookup | Flat ledger in v1 (scope correction #C7 from E1b2b: `GASCTAPRIN` is accounting-plan code, NOT socio carnet). |

> **NOTE on E1b2a's version drift correction**: as of `main` post-merge `061be50` (E1b2b), **all** `package.json` files show `"version": "0.5.5"` (root + 18 packages). E1b2b's release commit corrected the version drift accumulated across E1b1 + E1b2a. **E2 has no version drift to correct** — TASK-012 (release commit) just bumps all from `0.5.5` → `0.5.6`.

---

## 4. Architecture

### 4.1 Admin API endpoint (`apps/api/src/routes/promote.ts`, NEW, ~150 LoC)

**Stack: Fastify v5.2.0** (verified `apps/api/package.json:42`). The endpoint is **sync HTTP** (NOT scheduler). The CLI runner (`pnpm db:promote`) IS the same code path — the endpoint just wraps it with auth + rate limit + audit emission.

**File**: `apps/api/src/routes/promote.ts`

```typescript
/**
 * Promotion routes (E2 — Slice E closure):
 *   POST /api/v1/promote/trigger   — ADMIN: trigger a full or per-domain promotion (sync HTTP)
 *   GET  /api/v1/promote/status    — ADMIN: last 20 promotion runs (read-only)
 *
 * Mirrors apps/api/src/routes/import.ts:1-100 but SYNCHRONOUSLY (returns 200
 * + PromotionResult[] when done, NOT 202 + batchId). The CLI runner
 * (pnpm db:promote) IS the same code path — this endpoint just wraps it with
 * auth + per-operator rate limit + audit emission.
 *
 * 120s request timeout to avoid NGINX `proxy_read_timeout 60s` mid-flight
 * cut for full `domain: 'all'` promotions (~570k rows, ~60-90s on live DB).
 *
 * Per-operator rate limit (1/min) via @fastify/rate-limit's `keyGenerator`
 * extracting JWT `operator.sub` — mirrors the auth route's
 * `authRateLimitConfig = { max: 5, timeWindow: '1 minute' }` pattern from
 * apps/api/src/plugins/rate-limit.ts:64.
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid, BusinessError, ErrorCode } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { emitAudit } from '@athlos/audit'
import { and, desc, eq } from 'drizzle-orm'
import { auditEvents } from '@athlos/db/schema'
import { promoteAll, promoteDomain, type Domain, type PromotionResult } from '@athlos/promotion'
import { PROMOTION_ORDER } from '@athlos/promotion'
import type { AppContainer } from '../container.ts'

const triggerBodySchema = z.object({
  domain: z
    .enum([
      'all', 'socios', 'escuela', 'deportes', 'locacion',
      'caja', 'gastos', 'ctacte', 'ctacte1',
    ])
    .default('all'),
})

const promoteRateLimitConfig = {
  max: 1,
  timeWindow: '1 minute',
  keyGenerator: (req: { operator?: { sub: string } }) =>
    req.operator?.sub ?? 'anonymous',
}

export const promoteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // POST /api/v1/promote/trigger — ADMIN only, per-operator rate-limited (1/min)
  fastify.post<{ Body: z.infer<typeof triggerBodySchema> }>(
    '/api/v1/promote/trigger',
    {
      preHandler: requireRole('ADMIN'),
      config: { rateLimit: promoteRateLimitConfig, timeout: 120_000 },
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
        // Build the domain list per body.domain
        const domains: Domain[] = body.domain === 'all'
          ? [...PROMOTION_ORDER]
          : [body.domain as Domain]

        // Run promotion synchronously in the request thread
        const results: PromotionResult[] = []
        for (const domain of domains) {
          results.push(await promoteDomain(container.db, domain))
        }

        // Aggregate totals
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

        // Audit row (1 per trigger — 10s bucket dedup handles double-clicks)
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
        // ALWAYS reset the flag — even on timeout, exception, or 500
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

**Register in `apps/api/src/server.ts`** (after `importRoutes` at line 202, before `lineageRoutes` at line 213):

```typescript
// 16c. Promotion routes (E2 — Slice E closure):
//      POST /api/v1/promote/trigger (ADMIN), GET /api/v1/promote/status (ADMIN)
//      Mirrors importRoutes but SYNCHRONOUSLY (returns 200, not 202).
//      120s request timeout via per-route config; per-operator rate limit
//      via @fastify/rate-limit's keyGenerator extracting request.operator.sub.
import { promoteRoutes } from './routes/promote.ts'
// ... after `await app.register(importRoutes)` (line ~202) ...
await app.register(promoteRoutes)
```

**Add `promotionInFlight` to `AppContainer` interface** (`apps/api/src/container.ts`):

```typescript
// In packages/api/src/container.ts AppContainer interface (~line 60):
export interface AppContainer {
  // ... existing fields (db, pool, legacyDb, etc.) ...
  /** E2: in-memory flag for concurrent-trigger guard on POST /api/v1/promote/trigger */
  promotionInFlight: boolean
  // ... existing fields ...
}

// In buildContainer() return object:
promotionInFlight: false,
```

**Why `apps/api/src/container.ts`** not `packages/db` or `packages/promotion`: the flag is API-process-local (NOT persisted to DB, NOT shared across processes). E3+ replaces it with `pg_advisory_lock` for multi-process hardening. For v1 single-process API, the in-memory flag is sufficient.

### 4.2 `promoted_at` audit column (Migration 0016, NEW, ~20 LoC)

**File**: `packages/db/drizzle/0016_promoted_at.sql` (NEW, hand-written — E1b1 LESSON: NOT `drizzle-kit migrate`)

```sql
-- Migration 0016: raw_events.promoted_at audit column (E2 — LAST sub-slice of Slice E)
--
-- Per-row idempotency tracking at the source-event level.
-- Belt-and-suspenders with master.legacy_id UNIQUE INDEX.
--
-- Backfill scope (NEW clarification 2026-06-25, engram obs #2547):
--   **socios ONLY in v1.** ctacte/ctacte1 backfill is deferred to E3+ because
--   raw_events does NOT have a legacy_id column today (verified via
--   \d public.raw_events). The JOIN through (source_table, source_key) =
--   (ctacte.cctcuenta, raw_events.source_key) is wrong because
--   raw_events.source_key for ctacte is the VFP key, NOT the socio carnet.
--
--   When E3+ adds raw_events.legacy_id, the migration should ALSO backfill
--   ctacte via:
--     UPDATE raw_events re SET promoted_at = now()
--     FROM tesoreria.ctacte c
--     WHERE re.source_table = 'ctacte'
--       AND re.legacy_id IS NOT NULL
--       AND c.legacy_id = re.legacy_id
--       AND re.promoted_at IS NULL;
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
--   WHERE promoted_at IS NULL on the backfill. Re-running is a no-op.

BEGIN;
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "raw_events_promoted_at_idx"
  ON "public"."raw_events" ("promoted_at");
--> statement-breakpoint

-- Backfill: socios ONLY in v1 (NEW clarification, Q3 narrowed).
-- Yields ~16,383 backfilled rows (matches live socios.socios master count).
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios'
  AND re.source_key = s.numero_socio
  AND re.promoted_at IS NULL;

COMMIT;
```

**Applied via `psql`** (E1b1 LESSON — `_journal.json` tracking mismatch with hand-written SQL):

```bash
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0016_promoted_at.sql
```

**`_journal.json` manual update** (add entry for idx 16, next sequential after E1b2b's idx 15):

```json
{
  "idx": 16,
  "version": "7",
  "when": 1782341000000,
  "tag": "0016_promoted_at",
  "breakpoints": true
}
```

**Drizzle schema update** (`packages/db/src/schema/public.ts`, +3L):

```typescript
// In packages/db/src/schema/public.ts (~line 194-223, rawEvents table):
export const rawEvents = publicSchema.table(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceTable: varchar('source_table', { length: 32 }).notNull(),
    sourceKey: varchar('source_key', { length: 64 }).notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    importBatch: uuid('import_batch').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    // NEW (E2): per-row promotion audit column. NULL = unpromoted; NOT NULL = promoted.
    promotedAt: timestamp('promoted_at', { withTimezone: true }),  // nullable; backfilled for socios in 0016
  },
  (table) => ({
    sourceKeyHashUnique: uniqueIndex('uq_raw_events_source_key_hash').on(
      table.sourceTable, table.sourceKey, table.contentHash,
    ),
    importBatchIdx: index('idx_raw_events_import_batch').on(table.importBatch),
    sourceKeyIdx: index('idx_raw_events_source_key').on(table.sourceTable, table.sourceKey),
    // NEW (E2): fast lookup for the per-row audit query
    promotedAtIdx: index('raw_events_promoted_at_idx').on(table.promotedAt),
  }),
)
```

**Note on the INDEX choice**: proposal.md §4.1 suggested a partial INDEX `WHERE promoted_at IS NOT NULL`, but the spec at line 152 explicitly accepts "plain btree — partial `WHERE promoted_at IS NOT NULL` is acceptable but NOT required". For v1, the plain btree INDEX is the simpler default — Drizzle's `index()` helper produces a plain btree. E3+ can switch to partial INDEX once the backfill covers more domains.

### 4.3 `promote.ts` algorithm update (MODIFIED, +30 LoC)

**File**: `packages/promotion/src/promote.ts`

```typescript
// In packages/promotion/src/promote.ts (~line 82, REPLACES the E2 hook comment):

// 2. Read all projection rows for this domain, FILTERED by raw_events.promoted_at IS NULL
const { schema: projSchema, table: projTableName } = PROJECTION_TABLE[domain]
const projectionRows =
  (
    await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
      `SELECT pe.source_key, pe.payload
       FROM "${projSchema}"."${projTableName}" pe
       JOIN public.raw_events re
         ON re.source_table = '${domain}'
        AND re.source_key = pe.source_key
        AND re.promoted_at IS NULL`,
    )
  ).rows ?? []
result.attempted = projectionRows.length

// ... (after the per-row transform loop, AFTER the flush() call):

// At the end of promoteDomain(), AFTER all batches have flushed,
// stamp promoted_at = now() for all successfully-inserted source_keys.
// This is a single bulk UPDATE per domain — atomic, fast (uses idx_raw_events_source_key).
if (insertedSourceKeys.length > 0) {
  await db.execute(
    `UPDATE public.raw_events
     SET promoted_at = now()
     WHERE source_table = '${domain}'
       AND source_key = ANY($1::varchar[])`,
    [insertedSourceKeys],
  )
}
```

**The `insertedSourceKeys` buffer**: a new local array in `promoteDomain()` that accumulates `pe.source_key` for each row that successfully flushes (i.e., `inserted` count returned by `insertMasterBatch`). On each `flush()`, append `insertedSourceKeys.push(...batchKeys)` for the rows that succeeded. After the loop, do the single bulk UPDATE.

**Defense in depth** (two layers of idempotency):
1. `promote.ts` filter (`WHERE re.promoted_at IS NULL`) — skips already-promoted source_keys at scan time (the primary E2 mechanism)
2. `master.legacy_id` UNIQUE INDEX + `ON CONFLICT DO NOTHING` — catches any duplicate that slips through (e.g., if the bulk UPDATE fails mid-flight, a re-run still won't double-insert)

Both layers must continue to work post-E2 — `bash scripts/verify-slice.sh` is the REAL gate that proves it (E1b1/E1b2a/E1b2b LESSON — non-negotiable).

### 4.4 `dedup.ts` cross-check (MODIFIED, +15 LoC)

**File**: `packages/promotion/src/dedup.ts`

For ctacte/ctacte1 ONLY (the other 6 domains use composite NK dedup at master level), `loadExistingNaturalKeys` ALSO reads `raw_events.promoted_at IS NOT NULL` as a secondary cross-check. This is the belt-and-suspenders with `master.legacy_id`:

```typescript
// In packages/promotion/src/dedup.ts (extend loadExistingNaturalKeys):

if (domain === 'ctacte') {
  // E1b1 layer: existing legacy_ids from master (primary dedup)
  const masterRows = await db
    .select({ legacyId: ctacte.legacyId })
    .from(ctacte)
    .where(isNotNull(ctacte.legacyId))
  const masterIds = new Set(
    masterRows.map((r) => r.legacyId).filter((id): id is string => id !== null),
  )

  // E2 layer (NEW): cross-check raw_events.promoted_at (more accurate for re-imports)
  const rawRows = await db.execute<{ source_key: string }>(
    `SELECT source_key FROM public.raw_events
     WHERE source_table = 'ctacte' AND promoted_at IS NOT NULL`,
  )
  const rawKeys = new Set((rawRows.rows ?? []).map((r) => r.source_key))

  // Union: a row is "existing" if EITHER layer says so
  const combined = new Set<string>([...masterIds, ...rawKeys])
  return combined
}

if (domain === 'ctacte1') {
  // Same pattern as ctacte
  // ...
}
```

**Why only ctacte/ctacte1** (and not all 8 domains): the other 6 domains (socios, escuela, deportes, locacion, caja, gastos) use composite NKs at the master level (5-tuple UNIQUE INDEX for ctacte/ctacte1/ctaJa/gastos, `numero_socio` UNIQUE for socios, `codigo` UNIQUE for escuela/deportes, composite for locacion). They don't need the `promoted_at` cross-check because the master-level UNIQUE INDEX is already the primary dedup. The `promoted_at IS NULL` filter on `promote.ts` (§4.3) covers them at scan time.

**Why cross-check for ctacte/ctacte1 specifically**: the migration 0016 backfill only covers `socios`. For ctacte/ctacte1, `promoted_at` stays NULL even for already-promoted rows (until E3+ backfills via `legacy_id`). The cross-check on `raw_events.promoted_at` for ctacte/ctacte1 is FUTURE-proofing — it activates as soon as the E3+ backfill lands. For v1, ctacte/ctacte1 still get idempotency via the master.legacy_id UNIQUE INDEX.

### 4.5 Runbook update (`docs/runbook.md`, MODIFIED, +90 LoC)

**Insertion point**: between "Containerized Deploy (Docker)" (line 237, ends ~line 295) and "CI/CD" (line 297). Matches the existing top-level chunking pattern.

```markdown
## Promotion Pipeline

Slice E (v0.5.5 + v0.5.6) wires the data-promotion pipeline: `legacy .DBF → import → raw_events → projection → 8 master tables`. This section covers how to run a promotion, the 8 domains + their natural keys, and the cross-run idempotency contract.

### How to run promotion (CLI vs API)

**CLI (full promotion, recommended for first run or maintenance windows):**

```bash
# Full promotion (8 domains, ~60-90s, ~613k rows)
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

E2 (v0.5.6) adds `raw_events.promoted_at timestamp with time zone` for per-row promotion tracking. Migration `0016_promoted_at.sql` adds the column + INDEX + best-effort `socios`-only backfill.

**Query per-row promotion status:**

```sql
SELECT source_table, count(*) AS total, count(promoted_at) AS promoted
FROM public.raw_events
GROUP BY source_table
ORDER BY source_table;
```

**Expected post-E2:**

| source_table | total | promoted | unpromoted |
|--------------|------:|---------:|-----------:|
| socios | 39,357 | ~16,383 | ~22,974 (pre-E1a manual entries without `legacy_id`) |
| ctacte | 326,275 | 0 (TODO E3+) | 326,275 |
| ctacte1 | 245,370 | 0 (TODO E3+) | 245,370 |
| caja, escuela, deportes, gastos, locacion | ~10,446 | 0 (use composite NK dedup at master) | ~10,446 |

> **Backfill limitation:** The 0016 migration backfills `promoted_at` for `socios` ONLY. ctacte/ctacte1 backfill requires `raw_events.legacy_id` (E3+).

### Cross-run idempotency contract

Re-running `pnpm db:promote` (CLI) or `POST /promote/trigger` (API) is a no-op. Three layers of defense:

1. **`master.legacy_id UNIQUE INDEX`** (all 8 domains) — catches duplicate INSERTs at the DB level (`ON CONFLICT DO NOTHING`).
2. **`raw_events.promoted_at IS NULL` filter** (E2) — projection scan joins `raw_events` and skips already-promoted rows (prevents unnecessary round-trips).
3. **`loadExistingNaturalKeys` cross-check** (E2, ctacte/ctacte1 only) — secondary dedup that activates when E3+ adds `raw_events.legacy_id`.

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
| **N7** | Caja wide columns (122 detail columns per header) | Caja_movimiento only has 4-tuple NK + fecha/hora/descripcion; detail lines deferred | N7 (future) |
| **N8** | `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table; no per-socio enrollment data | N8 (future) |
| **N14** | Stale `entity_uuids` (~107k ctacte1 orphans) | ctacte1 promotion rate stuck at ~61% (150,129 of 245,370) | N14 (future) — repopulate entity_uuids from raw_events |
| **N16** | `gastos` FK to `ctacte` via `cctcuenta` lookup | `gastos.cuenta` is accounting-plan code, not socio carnet; no FK constraint | N16 (future) |
```

### 4.6 Final atomic canonical sync (MODIFIED, +~80L)

**File**: `openspec/specs/deployment-devops/spec.md` (MODIFIED, APPEND ONLY — B1b LESSON #1, HIGHEST)

Append 3 NEW requirements AFTER the existing `tesoreria.gastos master table` requirement (which ends at line 315). The existing Promotion Pipeline requirement (lines 167-276) and the `tesoreria.gastos` requirement (lines 280-315) **MUST remain UNCHANGED**.

The spec delta at `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` (411 lines, already on disk) contains the full text of these 3 NEW requirements. Apply phase syncs them to the canonical spec by appending verbatim.

**3 NEW additive requirements:**

1. **Requirement: Admin Promotion Trigger** (NEW) — 7 scenarios (ADMIN 200, rate-limited 429, non-admin 403, unauth 401, concurrent `already_running`, failure 500, status 200)
2. **Requirement: Per-row Promotion Audit (`promoted_at` column)** (NEW) — 6 scenarios (migration applies + idempotent, socios backfill ~16,383 rows, filter works, bulk UPDATE stamps rows, cross-run idempotency, per-row audit query)
3. **Requirement: Runbook Documentation** (NEW) — 5 scenarios (CLI + API examples, 8 master tables + NKs, `promoted_at` audit, Admin API contract, Known Limitations)

**3 NEW success criteria (#49-51):**

1. `bash scripts/verify-slice.sh` exits 0 (PASS) post-E2 (8 domains + TRUE idempotency)
2. `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ status: 'completed', inserted: 0, skipped: ~613k, failed: ~10, durationMs, domains }` (idempotent re-run)
3. `SELECT count(*) FROM raw_events WHERE promoted_at IS NOT NULL` returns ~16,383 (socios backfill count); ctacte/ctacte1 = 0 (TODO E3+)

**Acceptance gate** (apply phase MUST verify):
```bash
diff -u \
  openspec/specs/deployment-devops/spec.md \
  openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md \
  | head -200
# MUST show ONLY additive changes — no removals, no rewrites of
# existing Promotion Pipeline requirement at canonical lines 167-276
# or tesoreria.gastos requirement at canonical lines 280-315
```

---

## 5. Implementation details

### 5.1 Files to modify / create

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0016_promoted_at.sql` | CREATE | ~20 | Hand-written SQL: ALTER TABLE + INDEX + `socios`-only backfill UPDATE (single transaction + statement_timeout) |
| `packages/db/drizzle/meta/_journal.json` | MODIFY | +6 | Add entry for idx 16 (next sequential after 0015) |
| `packages/db/src/schema/public.ts` | MODIFY | +3 | Add `promotedAt: timestamp('promoted_at', { withTimezone: true })` to `rawEvents` + `promotedAtIdx` index |
| `packages/promotion/src/promote.ts` | MODIFY | +30 | `promoted_at IS NULL` filter (replaces comment at line 82) + bulk UPDATE on success + `insertedSourceKeys` buffer |
| `packages/promotion/src/dedup.ts` | MODIFY | +15 | `loadExistingNaturalKeys` for ctacte/ctacte1 ALSO reads `raw_events.promoted_at IS NOT NULL` (belt-and-suspenders) |
| `packages/promotion/src/index.ts` | MODIFY | +2 | Re-export `PROMOTION_ORDER` if not already exported (admin endpoint imports it) |
| `apps/api/src/routes/promote.ts` | CREATE | ~150 | `POST /api/v1/promote/trigger` (ADMIN + per-operator 1/min + 120s timeout) + `GET /api/v1/promote/status` (ADMIN) |
| `apps/api/src/routes/promote.test.ts` | CREATE | ~120 | 6 vitest cases (ADMIN 200, CONSULTA 403, unauth 401, rate-limit 429, concurrent `already_running`, status 200) mirroring `import.test.ts` mock-container pattern |
| `apps/api/src/server.ts` | MODIFY | +5 | Register `promoteRoutes` (after `importRoutes` line 202, before `lineageRoutes` line 213) |
| `apps/api/src/container.ts` | MODIFY | +3 | Add `promotionInFlight: boolean` to `AppContainer` interface + initialize `false` in `buildContainer` |
| `docs/runbook.md` | MODIFY | +90 | New top-level "Promotion Pipeline" section + 6 sub-sections |
| `openspec/specs/deployment-devops/spec.md` | MODIFY | +~80 | 3 NEW requirements APPENDED + 13 NEW scenarios + 3 NEW success criteria (#49-51); existing Promotion Pipeline UNCHANGED |
| `CHANGELOG.md` | MODIFY | +5 | v0.5.6 entry under Released |
| `package.json` (root) | MODIFY | +1 | bump 0.5.5 → 0.5.6 (in release commit only) |
| `packages/promotion/package.json` | MODIFY | +1 | bump 0.5.5 → 0.5.6 (in release commit only) |
| `packages/*/package.json` (16 other packages) | MODIFY | +1 each | bump 0.5.5 → 0.5.6 (in release commit only) |
| **Total raw LoC** | | **~485 raw / ~280 effective** | **Under the 400-line review budget at effective count** |

### 5.2 Migration order

1. **TASK-002 [TDD-GREEN migration]**: Hand-write `0016_promoted_at.sql` + apply via `psql` (NOT drizzle-kit — E1b1 LESSON) + update `_journal.json` with idx 16 entry. **MUST run BEFORE** the admin endpoint can be tested live (the endpoint expects `promoted_at` to exist).
2. **TASK-003 [TDD-GREEN schema]**: Update `public.ts` with `promotedAt` column + index.
3. **TASK-005 [TDD-GREEN promote update]**: Update `promote.ts` with `promoted_at IS NULL` filter + bulk UPDATE on success.

### 5.3 Test strategy (admin endpoint tests)

> **Per E1b2a LESSON re: TRUNCATE bug fix in commit `b26896c`**: E2 admin endpoint tests use Fastify `app.inject` + mock container (NO real DB write). The existing `promote.test.ts` stays `describe.skip` (no change). `scripts/verify-slice.sh` remains the REAL gate.

| Test | Endpoint | What it verifies |
|------|----------|------------------|
| **T-promote-1** | POST /api/v1/promote/trigger | ADMIN → 200 with `{ status: 'completed', inserted, skipped, failed, durationMs, domains: PromotionResult[] }` (mocked `promoteAll`) |
| **T-promote-2** | POST /api/v1/promote/trigger | CONSULTA → 403 via `requireRole('ADMIN')` middleware |
| **T-promote-3** | POST /api/v1/promote/trigger | Unauthenticated → 401 via `authPlugin` middleware chain |
| **T-promote-4** | POST /api/v1/promote/trigger | Rate-limited → 429 (mock container triggers rate-limit exceeded on second call within 1 min) |
| **T-promote-5** | POST /api/v1/promote/trigger | Concurrent → 200 with `{ status: 'already_running' }` when `container.promotionInFlight = true` |
| **T-promote-6** | GET /api/v1/promote/status | ADMIN → 200 with `{ runs: AuditEvent[] }` (mock `auditEvents` query) |

**Mock container pattern** (mirrors `apps/api/src/routes/import.test.ts:1-100`):

```typescript
// In apps/api/src/routes/promote.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { promoteRoutes } from './promote.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

// Mock @athlos/promotion so we don't hit real DB
vi.mock('@athlos/promotion', () => ({
  promoteAll: vi.fn().mockResolvedValue([
    { domain: 'socios', attempted: 100, inserted: 50, skipped: 50, failed: 0, errors: [], durationMs: 100 },
  ]),
  promoteDomain: vi.fn().mockImplementation((_db, domain) => ({
    domain, attempted: 100, inserted: 50, skipped: 50, failed: 0, errors: [], durationMs: 100,
  })),
  PROMOTION_ORDER: ['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1'],
}))

function makeAdminToken(sub = '00000000-0000-4000-8000-000000000001'): string { ... }
function makeConsultaToken(sub = '00000000-0000-4000-8000-000000000002'): string { ... }

const mockContainer = {
  db: { /* mock chain: select → from → where → orderBy → limit */ },
  promotionInFlight: false,
  env: mockEnv() as never,
} as unknown as AppContainer

async function buildApp(overrides?: Partial<AppContainer>): Promise<FastifyInstance> { ... }

describe('POST /api/v1/promote/trigger', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('returns 200 with PromotionResult[] for ADMIN', async () => { ... })
  it('returns 403 for CONSULTA role', async () => { ... })
  it('returns 401 for unauthenticated request', async () => { ... })
  it('returns 200 with { status: "already_running" } when promotionInFlight=true', async () => { ... })
  it('returns 429 when rate-limited (per-operator)', async () => { ... })
})

describe('GET /api/v1/promote/status', () => {
  it('returns 200 with last 20 promotion runs for ADMIN', async () => { ... })
})
```

**Why mock container, not real DB**: per E1b2a LESSON (TRUNCATE bug fix), promote tests can't run against real DB. The mock container pattern from `import.test.ts:1-100` is the established convention for route-level tests.

---

## 6. File-by-file changes (detailed)

### 6.1 `packages/db/drizzle/0016_promoted_at.sql` (NEW, ~20 LoC)

**Current state**: file does not exist.

**New state**: hand-written SQL per §4.2 (ALTER TABLE + INDEX + `socios`-only backfill UPDATE, all idempotent via `IF NOT EXISTS` + `WHERE promoted_at IS NULL`).

**Verification**:
```bash
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0016_promoted_at.sql
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "\d public.raw_events"  # verify promoted_at column + idx_raw_events_promoted_at index
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "SELECT count(*) FROM public.raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL;"
# expect ~16,383 (matches live socios.socios master count)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0016_promoted_at.sql  # re-run: must be no-op (idempotent)
```

### 6.2 `packages/db/drizzle/meta/_journal.json` (MODIFIED, +6 LoC)

**Current state**: ends at `idx: 15` (tag `0015_gastos`).

**New state**: append new entry for `idx: 16` (tag `0016_promoted_at`):

```json
{
  "idx": 16,
  "version": "7",
  "when": 1782341000000,
  "tag": "0016_promoted_at",
  "breakpoints": true
}
```

**Verification**:
```bash
cat packages/db/drizzle/meta/_journal.json | jq '.entries | length'  # should be 17 (16 entries 0-15 + 1 new = 17)
cat packages/db/drizzle/meta/_journal.json | jq '.entries[-1].tag'  # expect "0016_promoted_at"
```

### 6.3 `packages/db/src/schema/public.ts` (MODIFIED, +3 LoC)

**Current state**: `rawEvents` table has 7 columns (id, source_table, source_key, content_hash, payload, import_batch, imported_at) — verified via `\d public.raw_events` 2026-06-25. 4 INDEXes (pkey, idx_import_batch, idx_source_key, uq_source_key_hash).

**New state**: append `promotedAt: timestamp('promoted_at', { withTimezone: true })` to the column list (nullable, no default) + `promotedAtIdx` index to the indexes array.

**Verification**:
```bash
pnpm --filter @athlos/db typecheck  # ensure NewRawEvent type exports correctly
grep "promotedAt" packages/db/src/schema/public.ts  # expect ≥3 (column + index + type)
```

### 6.4 `packages/promotion/src/promote.ts` (MODIFIED, +30 LoC)

**Current state**: `promoteDomain` reads `*_projection` rows via `SELECT source_key, payload FROM "<schema>"."<table>"` (line 87-92, full scan). Comment at line 82: `// 2. Read all projection rows for this domain (full scan; E2 will add `promoted_at` filter)`. No `insertedSourceKeys` buffer.

**New state**:
1. Replace line 87-92 projection scan with JOIN clause (per §4.3)
2. Add `insertedSourceKeys: string[]` local array in `promoteDomain()`
3. On each `flush()`, append `insertedSourceKeys.push(...batchKeys)` for the rows that returned `inserted` count
4. After the per-row transform loop + final `flush()`, execute bulk UPDATE (per §4.3)

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 3 "JOIN public.raw_events" packages/promotion/src/promote.ts  # JOIN clause present
grep -A 3 "UPDATE public.raw_events" packages/promotion/src/promote.ts  # bulk UPDATE present
bash scripts/verify-slice.sh  # exits 0 = TRUE idempotency preserved
```

### 6.5 `packages/promotion/src/dedup.ts` (MODIFIED, +15 LoC)

**Current state**: `loadExistingNaturalKeys` reads `legacy_id` from each of the 8 master tables. For ctacte/ctacte1: `SELECT legacy_id FROM <master> WHERE legacy_id IS NOT NULL`.

**New state**: for `ctacte` and `ctacte1` ONLY, ADDITIONALLY read `SELECT source_key FROM public.raw_events WHERE source_table = $domain AND promoted_at IS NOT NULL` and union with the master.legacy_id set. The other 6 domains unchanged.

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 8 "domain === 'ctacte'" packages/promotion/src/dedup.ts  # both legacy_id + promoted_at reads
```

### 6.6 `packages/promotion/src/index.ts` (MODIFIED, +2 LoC)

**Current state**: re-exports `promoteAll`, `promoteDomain`, `PROMOTION_ORDER`, etc.

**New state**: ensure `PROMOTION_ORDER` is re-exported (the admin route at §4.1 imports it from `@athlos/promotion`). If already exported, no change.

**Verification**:
```bash
grep "PROMOTION_ORDER" packages/promotion/src/index.ts  # should be exported
pnpm --filter @athlos/promotion typecheck
```

### 6.7 `apps/api/src/routes/promote.ts` (NEW, ~150 LoC)

**Current state**: file does not exist.

**New state**: per §4.1 (POST /api/v1/promote/trigger + GET /api/v1/promote/status, ADMIN-only, per-operator 1/min rate limit, 120s timeout, audit emission).

**Verification**:
```bash
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api test:run  # 6 NEW tests pass; existing 468+ tests stay green
```

### 6.8 `apps/api/src/routes/promote.test.ts` (NEW, ~120 LoC)

**Current state**: file does not exist.

**New state**: 6 vitest cases per §5.3 (ADMIN 200, CONSULTA 403, unauth 401, rate-limit 429, concurrent `already_running`, status 200). Mock container pattern from `import.test.ts:1-100`.

**Verification**:
```bash
pnpm --filter @athlos/api test:run
# Expect: 6 NEW tests pass + all existing tests still green (existing promote.test.ts stays describe.skip)
```

### 6.9 `apps/api/src/server.ts` (MODIFIED, +5 LoC)

**Current state**: `importRoutes` registered at line ~202. `lineageRoutes` at line ~213.

**New state**: import `promoteRoutes` + register after `importRoutes` (line 202), before `lineageRoutes` (line 213).

**Verification**:
```bash
grep -n "promoteRoutes\|importRoutes\|lineageRoutes" apps/api/src/server.ts  # expect order: import → promote → lineage
pnpm --filter @athlos/api typecheck
```

### 6.10 `apps/api/src/container.ts` (MODIFIED, +3 LoC)

**Current state**: `AppContainer` interface has 11 fields (db, pool, legacyDb, whatsapp, email, clock, env, driftService, freshnessService, permissionsRepo, projectionService, auditPlugin). `buildContainer()` initializes all 12.

**New state**:
1. Add `promotionInFlight: boolean` field to `AppContainer` interface (with JSDoc explaining the E2 concurrent-trigger guard)
2. Add `promotionInFlight: false` to the `buildContainer()` return object

**Verification**:
```bash
grep "promotionInFlight" apps/api/src/container.ts  # expect 3 hits (interface + JSDoc + init)
pnpm --filter @athlos/api typecheck
```

### 6.11 `docs/runbook.md` (MODIFIED, +90 LoC)

**Current state**: 343 lines total. Last 2 sections are "Containerized Deploy (Docker)" (line 237) and "CI/CD" (line 297). Zero mention of promotion (`grep -c "promote\|PROMOTE" docs/runbook.md` returns 0).

**New state**: insert new "Promotion Pipeline" section between line 295 (end of Containerized Deploy) and line 297 (start of CI/CD). 6 sub-sections per §4.5.

**Verification**:
```bash
grep -n "^## " docs/runbook.md  # expect 7 sections (was 6; +1 for Promotion Pipeline)
grep -n "Promotion Pipeline\|promote/trigger\|promoted_at" docs/runbook.md  # expect ≥3 hits
wc -l docs/runbook.md  # expect ~433 (was 343)
```

### 6.12 `openspec/specs/deployment-devops/spec.md` (MODIFIED, +~80L, FINAL atomic sync)

**Current state**: 612 lines total. Promotion Pipeline requirement at lines 167-276. `tesoreria.gastos` requirement at lines 280-315. Success criteria end at #48 (post-E1b2b).

**New state** (FINAL atomic sync per B1b LESSON #1, HIGHEST):
1. **APPENDED** (NOT modifying) 3 NEW requirements AFTER the `tesoreria.gastos` requirement (line 315):
   - "Admin Promotion Trigger" (NEW) — 7 scenarios
   - "Per-row Promotion Audit (`promoted_at` column)" (NEW) — 6 scenarios
   - "Runbook Documentation" (NEW) — 5 scenarios
2. **APPENDED** 3 NEW success criteria (#49-51) at the end of the existing list
3. **NO modifications** to existing Promotion Pipeline requirement at lines 167-276 (per B1b LESSON #1)
4. **NO modifications** to existing `tesoreria.gastos` requirement at lines 280-315

**Verification**:
```bash
diff -u \
  openspec/specs/deployment-devops/spec.md \
  openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md \
  | head -200
# MUST show ONLY additive changes — no removals, no rewrites of existing
# Promotion Pipeline requirement at canonical lines 167-276 or
# tesoreria.gastos requirement at canonical lines 280-315
grep -c "### Requirement:" openspec/specs/deployment-devops/spec.md  # expect 14 (was 11; +3 NEW)
grep -c "^## Success Criteria" openspec/specs/deployment-devops/spec.md  # unchanged (1)
```

### 6.13 `CHANGELOG.md` (MODIFIED, +5 LoC, in release commit only)

**Current state**: last entry is `[0.5.5] — 2026-06-25` (E1b2b release).

**New state**: append 1 NEW entry:
- `[0.5.6] — 2026-06-25` — E2 closes Slice E permanently (admin API endpoint + `promoted_at` audit + runbook + final additive spec sync). Smoke test results: `bash scripts/verify-slice.sh` exits 0; `POST /api/v1/promote/trigger` returns 200 with `{ status: 'completed' }`.

**Verification**:
```bash
grep -c "0.5.6" CHANGELOG.md  # expect ≥1
grep -A 3 "## \[0.5.6\]" CHANGELOG.md
```

### 6.14 Version bumps (root + 18 packages, in release commit only)

**Current state**: all `package.json` files at `0.5.5` (post-E1b2b version drift correction; verified 2026-06-25 — root, promotion, and 16 other packages all show `"version": "0.5.5"`).

**New state**: bump all to `0.5.6`. Single coordinated commit.

**Verification**:
```bash
grep -r '"version"' packages/*/package.json package.json | grep -v 0.5.6
# expect 0 output (all packages at 0.5.6)
```

---

## 7. Work-units (in 3-commit shape per B1b LESSON)

### Commit 1: `feat(promotion+api): add admin promote trigger + promoted_at audit`

TDD chain collapses into 1 commit via squash (mirrors E1b2a + E1b2b pattern).

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-001** | [TDD-RED] | Write 6 NEW vitest cases in `apps/api/src/routes/promote.test.ts` (mock container, NO real DB write) — mirrors `import.test.ts:1-100`. Verify tests fail to compile (or fail) before implementation | test file (~120L) |
| **TASK-002** | [TDD-GREEN migration] | Hand-write `0016_promoted_at.sql` + apply via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON) + update `_journal.json` with idx 16 entry | migration (~20L), journal (+6L) |
| **TASK-003** | [TDD-GREEN schema] | Update `packages/db/src/schema/public.ts` with `promotedAt` column on `rawEvents` + `promotedAtIdx` index | 1 file (+3L) |
| **TASK-004** | [TDD-GREEN admin endpoint] | Implement `apps/api/src/routes/promote.ts` (POST + GET) + register in `server.ts` + add `promotionInFlight` to `container.ts` | 3 files (~158L) |
| **TASK-005** | [TDD-GREEN promote update] | Update `promote.ts`: replace projection scan at line 82 with `promoted_at IS NULL` JOIN filter + add `insertedSourceKeys` buffer + bulk UPDATE on success | 1 file (+30L) |
| **TASK-006** | [TDD-GREEN dedup update] | Update `dedup.ts`: `loadExistingNaturalKeys` for ctacte/ctacte1 ALSO reads `raw_events.promoted_at IS NOT NULL` (belt-and-suspenders) + re-export `PROMOTION_ORDER` from `index.ts` if not already exported | 2 files (+17L) |
| **TASK-007** | [TDD-REFACTOR] | Tighten helpers; ensure no `any` types; consolidate SQL strings; verify all imports consistent | (~0L net) |
| **TASK-008** | **[Pre-closing verification — CRITICAL E1b1/E1b2a/E1b2b LESSON]** | Run `bash scripts/verify-slice.sh` (the REAL gate); verify all 8 master tables populate + 2nd/3rd runs insert 0 new rows; verify `count(*) FROM raw_events WHERE promoted_at IS NOT NULL` shows ~16,383 (socios backfill); capture stdout for CHANGELOG smoke-test section | (no files, gates merge) |

### Commit 2: `docs(spec+runbook): final atomic sync closes Slice E`

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-009** | [Runbook update] | Add new top-level "Promotion Pipeline" section to `docs/runbook.md` (between "Containerized Deploy" and "CI/CD") + 6 sub-sections per §4.5 | 1 file (+90L) |
| **TASK-010** | **[FINAL atomic canonical spec sync — B1b LESSON #1, FULL additive only]** | APPEND 3 NEW requirements + 13 NEW scenarios + 3 NEW success criteria (#49-51) to `openspec/specs/deployment-devops/spec.md`; existing Promotion Pipeline (lines 167-276) + `tesoreria.gastos` (lines 280-315) **UNCHANGED**; verify with `diff` | spec file (+~80L) |

### Commit 3: `chore(release): v0.5.6`

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-011** | [Pre-merge fix slot — B1b LESSON #3] | Cherry-pick reorder to preserve 3-commit shape if verify catches critical issue | (varies) |
| **TASK-012** | [Closing release commit — B1b LESSON #2] | Bump root `package.json` + `packages/promotion/package.json` + 16 other `packages/*/package.json` from `0.5.5` → `0.5.6` (single coordinated commit; no version drift correction needed — E1b2b fixed it) + add `CHANGELOG.md` v0.5.6 entry | `package.json` + 18 packages, `CHANGELOG.md` |

**3-commit shape (B1b LESSON #2 + E1b2a/E1b2b pattern)**:

1. `feat(promotion+api): add admin promote trigger + promoted_at audit` — TASK-001..TASK-008 (TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash; includes TASK-008 verify-slice.sh gate as pre-merge check)
2. `docs(spec+runbook): final atomic sync closes Slice E` — TASK-009 + TASK-010 (runbook + FULL atomic spec sync per B1b LESSON #1)
3. `chore(release): v0.5.6` — TASK-012 (separate per B1b LESSON #2; version bump + CHANGELOG)

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D design/athlos-promote-projection-to-master-e2` (B1b LESSON #4).

---

## 8. Data Flow (Promotion Pipeline, post-E2)

```
                pnpm db:promote
                      │
                      ▼
         ┌──────────────────────────────┐
         │  promoteAll(db) — sequence   │
         │  PROMOTION_ORDER (8 domains) │
         └──────────────────────────────┘
                      │
                      ▼
              POST /api/v1/promote/trigger
              (ADMIN, per-operator 1/min,
               120s timeout)
                      │
                      ▼
         ┌──────────────────────────────┐
         │  container.promotionInFlight │
         │  = true; try {               │
         │    promoteDomain(domain)     │
         │    for each domain           │
         │  } finally {                 │
         │    promotionInFlight = false │
         │  }                           │
         └──────────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │ promoteDomain(socios)             │
    │ (1st of 8)                       │
    └─────────────────┬─────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 1. buildFkMap(db, 'socios')        │
   │    (O(1) per domain)               │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 2. SELECT source_key, payload      │
   │    FROM public."socios.socios_     │
   │        projection" pe              │ ←── NEW (E2)
   │    JOIN public.raw_events re       │
   │      ON re.source_table = 'socios' │
   │     AND re.source_key = pe.source_key│
   │     AND re.promoted_at IS NULL     │
   │    (uses idx_raw_events_source_key │
   │     for fast JOIN)                 │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 3. loadExistingNaturalKeys(db,     │
   │    'socios')                       │
   │    reads socios.numeroSocio        │
   │    (defense in depth #1)           │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 4. For each row:                   │
   │    - naturalKey('socios', payload) │
   │    - skip if existingKeys.has(key) │
   │    - transformSocio(payload)       │
   │    - buffer.push(masterRow)        │
   │    - flush every 1000 rows         │
   │    - insertedSourceKeys.push(key)  │ ←── NEW (E2)
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 5. db.insert(socios)               │
   │      .values(rows)                 │
   │      .onConflictDoNothing()        │
   │      .returning({id: socios.id})   │
   │                                   │
   │   Conflicts caught by:             │
   │   - socios_numero_socio_unique     │ ← defense #2
   │   - socios_legacy_id_unique        │ ← defense #3
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 6. UPDATE public.raw_events        │ ←── NEW (E2)
   │    SET promoted_at = now()         │
   │    WHERE source_table = 'socios'   │
   │      AND source_key =              │
   │          ANY($insertedKeys::varchar[])│
   │                                   │
   │   Stamps all 16,383 newly-promoted │
   │   raw_events rows in one bulk      │
   │   UPDATE                          │
   │   (uses idx_raw_events_source_key) │
   └───────────────────────────────────┘
                      │
                      ▼
              PromotionResult{
                domain: 'socios',
                attempted: 16383,
                inserted: 16383,
                skipped: 0,
                failed: 0,
                errors: [],
                durationMs: ~3000
              }

              (... repeated for 7 more domains ...)

                      │
                      ▼
              [{socios: ...}, {escuela: ...}, ..., {ctacte1: ...}]
              ↓
              emitAudit(action: 'PROMOTE_TRIGGER',
                        newValue: { totals, durationMs })
              ↓
              reply 200 with
                { status: 'completed', inserted, skipped, failed,
                  durationMs, domains: PromotionResult[] }
```

---

## 9. Top 5 risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1 (CRITICAL)** | Apply sub-agent skips `bash scripts/verify-slice.sh` (E1b1/E1b2a/E1b2b LESSON — v0.5.2 + v0.5.4 + v0.5.5 historically shipped with potentially broken state because smoke test was historically skippable). | **Critical** | **TASK-008 (`bash scripts/verify-slice.sh`) is a HARD GATE in apply prompt.** The script was introduced in commit `b26896c` and extended in commit `304f37a`/`061be50` to include `tesoreria.gastos` in `MASTER_TABLES`. Apply MUST run the script BEFORE declaring ready. Verify ALL expected row counts: escuela=66 + disciplinas=32 + locacion=89 + caja=8,145 + gastos=2,114 + ctacte=326,275 + ctacte1=150,129 + socios=16,383. **No merge until `verify-slice.sh` exits 0 (PASS).** |
| **R2 (WARNING)** | Sync endpoint timeout (60-90s) cuts NGINX `proxy_read_timeout` (60s default). | High | TASK-004: 120s request timeout via `request.routeOptions.config.timeout`; in-memory `promotionInFlight` flag reset in `finally { promotionInFlight = false }` ensures recovery if the cut happens mid-flight (timeout throws, `finally` runs, flag resets). Runbook documents that operators should use the CLI for full `domain: 'all'` promotions and reserve the API for single-domain promotions (<10s). |
| **R3 (WARNING)** | `promoted_at` backfill on 650k rows takes 3-5s + blocks concurrent reads. | Medium | TASK-002: Single transaction with `SET LOCAL statement_timeout = '60s'`; `WHERE promoted_at IS NULL` makes the UPDATE re-runnable idempotently. Apply during low-traffic window (cron drift-detection fires every 5 min — backfill should fire between cron ticks). **NEW clarification: backfill narrowed to `socios` ONLY in v1** — reduces update set to ~16,383 rows (~1s) instead of all 8 domains. |
| **R4 (SUGGESTION)** | Final atomic canonical sync has many diff lines (B1b LESSON #1, HIGHEST — closes Slice E). | Low (planned) | Spec delta acceptance criteria MUST include `diff` assertion (additive-only). 3 NEW requirements (~80L of spec.md) — no modifications to existing Promotion Pipeline requirement at lines 167-276 or `tesoreria.gastos` requirement at lines 280-315. Apply phase verifies diff is additive-only — no removals, no rewrites of prior Slice E scenarios. |
| **R5 (SUGGESTION)** | Migration 0016 must be applied via `psql` (NOT `drizzle-kit migrate` per E1b1 LESSON — `_journal.json` tracking mismatch). | Certain | TASK-002 apply step: `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql` (NOT `drizzle-kit migrate`). Manual `_journal.json` entry update after with idx 16. |

### Lesser risks

- **NGINX `proxy_read_timeout` not in our control** — the deploy docs at `docs/runbook.md` already document manual rollback; the 120s timeout is a workaround. Future E3+ converts to async via scheduler.
- **`raw_events.id` ↔ projection JOIN ambiguity** — projection tables lack a direct FK to `raw_events.id`; JOIN on `(source_table, source_key)` is the implicit FK. If same source_key imported twice with different content_hash, both raw_events rows match. The `promoted_at` filter marks both rows promoted; re-runs skip both via `promoted_at IS NULL`. Acceptable semantics.
- **`promotionInFlight` flag lost on process restart** — acceptable for v1 single-process API; future E3+ uses `pg_advisory_lock` for multi-process hardening.
- **Audit row volume** — 1 row per trigger (not per promoted row) is correct granularity. `emitAudit` 10s bucket dedup handles double-click case.
- **Test data leakage** — TASK-001 uses mock container (no real DB write), mirroring `import.test.ts:1-100`. The existing `promote.test.ts` stays `describe.skip` (E1b2a LESSON re: TRUNCATE bug). Safe.
- **Test data for the `promoteAt = now()` stamping** — covered by `bash scripts/verify-slice.sh` (3 sequential runs show 0 inserts on 2nd/3rd; the `promoted_at` filter is the primary mechanism; the `legacy_id` UNIQUE INDEX is the secondary).

---

## 10. Dependencies

| Dependency | What E2 needs | Status |
|------------|---------------|--------|
| **Slice E1b2b** (v0.5.5) | 8/8 master domains populate + `legacy_id` UNIQUE INDEX pattern + FINAL atomic canonical sync (additive-only, closed Slice E spec at canonical lines 167-315) | ✅ shipped 2026-06-25 (commit `36ac630`, sync applied in `e753528`) |
| **Slice E1b2a** (v0.5.4) | 4 NEW master tables + 4 NEW transforms + partial canonical sync | ✅ shipped 2026-06-25 (commit `b8d8e43`) |
| **Slice E1b1** (v0.5.2/v0.5.3) | ctacte1 wired via cctcuenta + legacy_id UNIQUE INDEX | ✅ shipped 2026-06-24 |
| **Slice E1a** (v0.5.1) | `packages/promotion/` skeleton + 3 priority domain transforms | ✅ shipped 2026-06-24 |
| **Slice D** (v0.5.0) | Real `.github/workflows/deploy.yml` + `/health/ready` endpoint | ✅ shipped 2026-06-24 |
| **Slice B-7c** (v0.4.6) | `packages/import/` with `runImport`, `LEGACY_IMPORT_ORDER`, `TABLE_DEPENDENCIES` | ✅ shipped 2026-06-18 |
| **`packages/db`** (v0.5.5) | `createDb({ connectionString })` + Drizzle schemas + 15 migrations applied (`_journal.json` ends at idx 15) | ✅ shipped |
| **`packages/auth`** (v0.5.5) | `requireRole('ADMIN')` from `@athlos/auth/middleware` (line 104) | ✅ shipped |
| **`packages/audit`** (v0.5.5) | `emitAudit(db, record)` for audit row insertion (10s bucket dedup) | ✅ shipped |
| **`packages/errors`** (v0.5.5) | `BusinessError`, `ErrorCode` (TOKEN_INVALID, INSUFFICIENT_PERMISSIONS) | ✅ shipped |
| **`packages/promotion`** (v0.5.5) | `promoteAll`, `promoteDomain`, `PROMOTION_ORDER`, `PROMOTION_ORDER` re-exports, all 8 transforms, all 8 `naturalKey` branches | ✅ shipped |
| **`@fastify/rate-limit`** (already in `apps/api/`) | Per-route `config.rateLimit` with `keyGenerator`; already registered globally at `apps/api/src/plugins/rate-limit.ts:33-56`; mirrors `authRateLimitConfig = { max: 5, timeWindow: '1 minute' }` pattern (line 64) | ✅ already registered |
| **Fastify v5.2.0** (verified live) | Route registration + `app.inject` for tests + `preHandler` hooks + per-route `config.timeout` | ✅ shipped |

**No new external dependencies.** E2 adds zero npm packages, zero Ubuntu packages, zero third-party services. Pure TypeScript + Fastify + Drizzle + `@fastify/rate-limit` (already a dep).

---

## 11. Open questions (all RESOLVED + LOCKED 2026-06-25)

All 5 user-confirmed decisions from the E2 explore (§12) are LOCKED. **No open questions remain for tasks phase.**

| # | Question | Resolved value | Source |
|---|----------|----------------|--------|
| **Q1** | Admin endpoint auth | `requireRole('ADMIN')` (NOT `requirePermission`) | E2 explore Q1 default + user-confirmed 2026-06-25 |
| **Q2** | Sync vs async trigger | **Sync HTTP** (NOT scheduler) | E2 explore Q2 default + user-confirmed 2026-06-25 |
| **Q3** | `promoted_at` backfill scope | Best-effort per-domain UPDATE; **narrowed to `socios` ONLY** (NEW clarification, 2026-06-25 — ctacte/ctacte1 require `raw_events.legacy_id` column, deferred E3+) | E2 explore Q3 default + user-confirmed 2026-06-25 + engram obs #2547 |
| **Q4** | Rate limit granularity | Per-operator 1/min via `@fastify/rate-limit` `keyGenerator: req.operator?.sub` | E2 explore Q4 default + user-confirmed 2026-06-25 |
| **Q5** | Runbook section placement | New top-level "Promotion Pipeline" section between "Containerized Deploy" and "CI/CD" | E2 explore Q5 default + user-confirmed 2026-06-25 |

**5 LOCKED decisions + 1 NEW clarification (backfill narrowed to socios).** E2 scope is fully bounded — no further open questions.

---

## 12. Ready for tasks?

**YES.** The scope is precisely bounded:

- **1 NEW column** (`raw_events.promoted_at`) + **1 NEW INDEX** (`idx_raw_events_promoted_at`) + **1 NEW migration** (`0016_promoted_at.sql`, idx 16) + **1 NEW endpoint** (`POST /api/v1/promote/trigger`, ADMIN, sync HTTP) + **1 NEW endpoint** (`GET /api/v1/promote/status`, ADMIN) + **1 NEW runbook section** ("Promotion Pipeline" + 6 sub-sections) + **3 NEW additive canonical-spec requirements** (13 NEW scenarios + 3 NEW success criteria #49-51)
- **~485 raw LoC / ~280 effective** (over the 400-line review budget at raw count ~121%, well under at effective ~70%; no split recommended — tightly coupled deliverables + Slice E is the LAST sub-slice — no further sub-slices planned)
- **All 5 user-confirmed decisions + 1 NEW clarification (backfill narrowed to `socios` only)** embedded explicitly
- **All E1b1/E1b2a/E1b2b LESSONs applied**: `bash scripts/verify-slice.sh` is HARD GATE (E1b1/E1b2a/E1b2b non-negotiable per commit `b26896c`), migration via `psql` (E1b1), existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug), 6 NEW admin endpoint tests use Fastify mock-container pattern (no destructive setup, mirrors `import.test.ts:1-100`)
- **All B1b LESSONs applied**: atomic canonical sync (additive only, B1b LESSON #1 HIGHEST — existing Promotion Pipeline UNCHANGED), separate release commit (B1b LESSON #2), cherry-pick reorder (B1b LESSON #3), merge-before-delete (B1b LESSON #4)
- **E2 is the LAST sub-slice of Slice E** — no further sub-slices planned after E2 (per parent Slice E exploration §1 + E1b2b design §1, §11). After v0.5.6, the data-promotion pipeline is **feature-complete for v1.0**. Slice F or beyond is **NEVER** planned.

**Next step:** sdd-tasks → break into 12 implementation tasks (TASK-001..TASK-012 per §7). Then sdd-apply → wire admin endpoint + migration + `promoted_at` filter + runbook + spec sync with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a/E1b2b LESSON — non-negotiable per commit `b26896c`). Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` (additive only, B1b LESSON #1) to close Slice E permanently.

**Apply-phase CRITICAL reminders (all in §6 + §7 + §9):**

1. **Additive-only atomic sync** (B1b LESSON #1, HIGHEST) — apply MUST verify `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes. No removals, no rewrites of prior Slice E scenarios. The existing Promotion Pipeline requirement (canonical lines 167-276) and `tesoreria.gastos` requirement (canonical lines 280-315) SHALL remain UNCHANGED.
2. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix). Migration 0016 adds a column + index + `socios`-only backfill but does NOT change master row counts; existing verify-slice.sh covers all 8 tables unchanged (commit `061be50`).
3. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch. Manual idx-16 `_journal.json` entry.
4. **`socios` backfill count verification** at apply time: `SELECT count(*) FROM raw_events WHERE source_table='socios' AND promoted_at IS NOT NULL` MUST equal ~16,383 (the live `socios.socios` master count). ctacte/ctacte1 backfill documented as TODO E3+ — NOT blocking E2 acceptance.
5. **3-commit shape preserved** per B1b LESSON: `feat(promotion+api)` → `docs(spec+runbook)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D design/athlos-promote-projection-to-master-e2` (B1b LESSON #4).
6. **E2 is the LAST sub-slice of Slice E** — `git branch -D design/...` is acceptable post-merge (B1b LESSON #4). No further atomic syncs planned. v1.0 data-promotion pipeline is feature-complete after E2 lands.

---

## 13. Reference files (for apply sub-agent)

| Path | What it tells us |
|------|------------------|
| `apps/api/src/routes/import.ts:1-100` | `POST /api/v1/import/trigger` + `GET /api/v1/import/status` precedent — E2 mirrors this but sync + `promotionInFlight` guard |
| `apps/api/src/routes/import.test.ts:1-100` | Mock container pattern + `app.inject` test pattern — E2 mirrors for `promote.test.ts` |
| `apps/api/src/plugins/rate-limit.ts:33-56` | `@fastify/rate-limit` global registration + `errorResponseBuilder` shape (429 response) |
| `apps/api/src/plugins/rate-limit.ts:64` | `authRateLimitConfig = { max: 5, timeWindow: '1 minute' }` — E2's `promoteRateLimitConfig` mirrors this |
| `apps/api/src/server.ts:202` | Where `importRoutes` is registered — E2's `promoteRoutes` goes AFTER this line, BEFORE `lineageRoutes` at line 213 |
| `apps/api/src/container.ts:60` | `AppContainer` interface — E2 adds `promotionInFlight: boolean` field |
| `apps/api/src/container.ts:175` | `buildContainer()` return object — E2 adds `promotionInFlight: false` |
| `packages/promotion/src/promote.ts:82` | Comment "E2 will add `promoted_at` filter" — confirms E2 scope; the filter replaces this comment |
| `packages/promotion/src/PROMOTION_ORDER.ts:23-32` | 8 domains in topological order — E2 re-exports this for the admin route |
| `packages/promotion/src/dedup.ts:98-154` | `loadExistingNaturalKeys` — E2 extends ctacte/ctacte1 to ALSO read `raw_events.promoted_at` |
| `packages/db/src/schema/public.ts:194-223` | `rawEvents` table — E2 adds `promotedAt` column + index |
| `packages/db/drizzle/0015_gastos.sql` | Most recent migration pattern — E2's 0016 mirrors this structure |
| `packages/db/drizzle/meta/_journal.json` | Last entry idx 15 (tag `0015_gastos`) — E2 adds idx 16 entry |
| `packages/audit/src/emitter.ts:35-77` | `emitAudit(db, record)` — E2 emits with `action: 'PROMOTE_TRIGGER'` |
| `packages/auth/src/middleware.ts:104-116` | `requireRole(...roles)` — the gate for the admin endpoint |
| `packages/auth/src/jwt.ts:17` | JWT `sub` field — `req.operator?.sub` is the rate-limit keyGenerator |
| `scripts/verify-slice.sh:28-37` | `MASTER_TABLES` array — already includes all 8 domains post-E1b2b (commit `304f37a`/`061be50`); E2 doesn't need to modify |
| `scripts/verify-slice.sh:111-118` | `pnpm db:promote` invocation — E2's admin endpoint wraps the same logic |
| `docs/runbook.md:237-297` | "Containerized Deploy" ends ~line 295; "CI/CD" starts line 297 — E2 inserts new section between them |
| `docs/runbook.md:1-343` | Current runbook — E2 adds +90L with new "Promotion Pipeline" section + 6 sub-sections |
| `openspec/specs/deployment-devops/spec.md:167-276` | Existing Promotion Pipeline requirement — E2 ADDS 3 NEW requirements, doesn't modify this |
| `openspec/specs/deployment-devops/spec.md:280-315` | Existing `tesoreria.gastos` requirement — E2 doesn't modify this either |
| `openspec/specs/deployment-devops/spec.md:611-612` | Success criteria end at #48 (post-E1b2b) — E2 adds #49-51 |
| `openspec/specs/audit-logger/spec.md:170-181` | `AuditRecord` interface — E2 emits with `action: 'PROMOTE_TRIGGER'` |
| Engram #2531 | E1b/E1b1 LESSONs (`verify-slice.sh` gate + TRUNCATE bug fix) |
| Engram #2537 | E1b2b design (final atomic sync pattern) |
| Engram #2547 | NEW clarification (E2 backfill narrowed to `socios` only) |
| Live DB: `192.168.1.102:5432/athlos` | Verify state pre/post-apply: `raw_events` (652,661 rows, no `promoted_at`); 8 master tables populated; verify-slice.sh exits 0 |

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e2/design.md` (this file)*
- *Engram topic `sdd/athlos-promote-projection-to-master-e2/design` (via `mem_save`)*