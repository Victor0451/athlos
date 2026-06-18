# Design: Athlos — Import Pipeline Completion

## Technical Approach

Close the 6 implementation tasks (`TASK-055..060`) for the import pipeline that the archived `athlos-foundation` change left as a write-only vacuum. The work is 5 new packages (`@athlos/lineage`, `@athlos/projection`, `@athlos/drift`, `@athlos/freshness`, `@athlos/audit`), 1 new data-plane table (`entity_uuids`) + 2 cache/snapshot tables (`drift_snapshots`, `domain_freshness`) + 1 permissions table (`role_permissions`), 4 stub-job body swaps, and 5 HTTP routes. Delivered as 2 stacked sub-PRs (7b.1 data plane, 7b.2 route + audit plane) so neither slice exceeds the 400-line review budget.

The 7 product/architecture decisions (Engram obs #2050 + OI-1 B / OI-2 A) are locked in — see the Decision Matrix at the bottom of this document for the canonical list.

## Architecture Decisions (table-format per skill rule)

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| UUID storage | **Separate `entity_uuids` table** (composite PK on `(source_table, source_key)`) | Denormalize UUID column on each projection table | Projections don't exist yet (built in this change), so a denorm column would require 11 schema changes. Separate table also keeps the lineage chain queryable for entities that have no projection (paramet, plancue, usuario). |
| Drift write path | **Drift writes DIRECTLY to `audit_events`** (Drizzle insert) | Drift → `@athlos/audit` `emitAudit` API | Spec delta requires `operator_id: null` for system events. `@athlos/audit` middleware is the operator-attributed path. Two distinct write paths, documented in code comments. |
| Drift recipient filter | **`role_permissions` join**, not role enum | Extend `operators.role` enum with `DATA_STEWARD` | OI-1 B: keep enum narrow; add a separate permissions table. Avoids breaking every role-based check across the codebase. |
| `drift_snapshots` cache | **One row per `(source_table, source_key, entity_uuid)`** | Single `last_hash` per table | Spec delta requires per-entity detection (lineage-tracker UUID is the key). Per-table snapshot would lose the "which record drifted" signal. |
| `freshness` cache | **`domain_freshness` table, refreshed every 60s** by the `freshness-refresh` cron | Recompute on every `GET /api/v1/freshness` call | The endpoint is read-heavy (UI polls it). 60s refresh keeps the read path O(1). The `age_display` is computed at query time, not stored. |
| Cancel semantics | **Server-side `DELETE` while `status='queued'`** (OOB 409 once started) | Cancel-after-start (rollback a partial run) | Tied to Decision 5 (confirm-and-wait modal). Imported batches can't be undone mid-run without a separate revert path. |
| Audit `fp`-wrap enforcement | **CI grep on `packages/audit/src/middleware.ts`** | eslint rule | The `fp()` call is a literal, grep-able: `grep -E "fp\(.*'athlos-audit'"`. Carries the PR 3a lesson. |
| Idempotency window | **10s bucket via `floor(Date.now()/10_000)`** | Sliding window | Spec delta mandates 10s. Bucket is deterministic; sliding window requires storing per-event timestamps + a TTL. |

## §1 — UUID Lifecycle

### Generation

UUIDs are generated at the moment a legacy record is **first appended** to `raw_events`. The lookup-or-create pattern runs inside the import pipeline's `insertRawEvent`:

```ts
// packages/import/src/pipeline.ts (TASK-053 extension)
async function getOrCreateEntityUuid(
  db: Db, sourceTable: string, sourceKey: string,
): Promise<string> {
  const [existing] = await db
    .select({ entityUuid: entityUuids.entityUuid })
    .from(entityUuids)
    .where(and(
      eq(entityUuids.sourceTable, sourceTable),
      eq(entityUuids.sourceKey, sourceKey),
    ))
    .limit(1)
  if (existing) return existing.entityUuid
  const uuid = crypto.randomUUID()
  await db.insert(entityUuids)
    .values({ sourceTable, sourceKey, entityUuid: uuid })
    .onConflictDoNothing({ target: [entityUuids.sourceTable, entityUuids.sourceKey] })
  // Re-read on conflict (a concurrent insert won).
  const [row] = await db.select({ entityUuid: entityUuids.entityUuid })
    .from(entityUuids)
    .where(and(eq(entityUuids.sourceTable, sourceTable), eq(entityUuids.sourceKey, sourceKey)))
    .limit(1)
  return row?.entityUuid ?? uuid
}
```

The UUID is computed **once per `(source_table, source_key)`** (not once per `raw_events` row). Re-imports with the same key but different `content_hash` insert a new `raw_events` row but reuse the existing UUID — this is the spec's "Re-import reuses UUID" scenario.

### Schema

```ts
// packages/db/src/schema/public.ts (append)
export const entityUuids = pgTable(
  'entity_uuids',
  {
    sourceTable: varchar('source_table', { length: 32 }).notNull(),
    sourceKey:   varchar('source_key',   { length: 64 }).notNull(),
    entityUuid:  uuid('entity_uuid').notNull().unique(),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.sourceTable, t.sourceKey] }) }),
)
export type EntityUuid = typeof entityUuids.$inferSelect
```

> **Open issue** (see §11): the spec's prose says "in the `entity_id` column" of `raw_events`, but the orchestrator's brief explicitly directs a separate `entity_uuids` table. Surfaced in Implementation Risks.

### Migration

```sql
-- packages/db/drizzle/0007_entity_uuids.sql
CREATE TABLE "entity_uuids" (
  "source_table" varchar(32) NOT NULL,
  "source_key"   varchar(64) NOT NULL,
  "entity_uuid"  uuid NOT NULL UNIQUE,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source_table", "source_key")
);
```

### Propagation

- **Lineage** — `queryLineage(uuid)` looks up `entity_uuids.entity_uuid` for the metadata, then joins `raw_events` ordered by `imported_at ASC` to return the chain.
- **Projection** — `rebuildProjection("ctacte")` keys the projection on `entity_uuid`; the projection's PK is `entity_uuid` (not the legacy key). The `computeSaldo(socioEntityId: UUID)` arg is the UUID.
- **Drift** — `drift_snapshots` PK is `(entity_uuid)`, keyed against `raw_events.content_hash` for the same `(source_table, source_key)` resolved through `entity_uuids`.
- **Audit** — `audit_events.entity_id` is the UUID. The middleware resolves the entity's UUID from the request's path param via a route-helper `resolveEntityUuid(fastify, params)`.

## §2 — Projection Rebuild Strategy

### Domain → projection table map

```ts
// packages/projection/src/rebuild.ts
export const DOMAIN_PROJECTION_TABLE: Record<Domain, string> = {
  socios:    'socios.socios_projection',
  ctacte:    'tesoreria.ctacte_projection',
  ctacte1:   'tesoreria.ctacte1_projection',
  contable:  'contabilidad.contable_projection',
  contabl1:  'contabilidad.contabl1_projection',
  catastros: 'socios.catastros_projection',
  escuela:   'socios.escuela_projection',
  deportes:  'deportes.deportes_projection',
  locacion:  'socios.locacion_projection',
  caja:      'tesoreria.caja_projection',
  gastos:    'tesoreria.gastos_projection',
}
export type Domain = keyof typeof DOMAIN_PROJECTION_TABLE
```

> **Decision** (not in spec): 11 domains, not 14. The 3 missing (`paramet`, `plancue`, `usuario`) are config/operator-reference tables; they have no projection. The spec's "rebuildProjection is per-domain" requirement still holds — these 3 simply have no rebuild target. Surfaced in Open Questions.

Unknown domain → `BusinessError(VALIDATION, …)` (no `NOT_FOUND` — the call is shape-validated by the map).

### Truncate-then-replay

```ts
// packages/projection/src/rebuild.ts
export async function rebuildProjection(
  db: Db, domain: Domain, opts: { batchSize?: number } = {},
): Promise<{ rowCount: number; durationMs: number }> {
  const table = DOMAIN_PROJECTION_TABLE[domain]
  if (!table) throw BusinessError(ErrorCode.VALIDATION, `Unknown domain: ${String(domain)}`, { domain })
  const t0 = Date.now()
  return await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE TABLE ${table}`))   // schema-qualified, no SQL injection
    // Replay in raw_events.imported_at ASC so out-of-order arrivals
    // converge to the same end state.
    const cursor = await tx.execute(sql`
      INSERT INTO ${sql.raw(table)} (id, source_table, source_key, payload, imported_at)
      SELECT e.entity_uuid, r.source_table, r.source_key, r.payload, r.imported_at
      FROM raw_events r
      JOIN entity_uuids e
        ON e.source_table = r.source_table AND e.source_key = r.source_key
      WHERE r.source_table = ${domain}
      ORDER BY r.imported_at ASC
    `)
    return { rowCount: Number(cursor.rowCount ?? 0), durationMs: Date.now() - t0 }
  })
}
```

### Concurrency

`InProcessScheduler` enforces a single in-flight job per name (`runningJobs: Set<string>`). The `reconciliation` job runs `rebuildAll()` (loops over 11 domains), so a second `scheduled-import` tick during a `reconciliation` is blocked by the same-name guard. **Cross-job** concurrency (e.g. `drift-detection` during a `reconciliation`) is not blocked — the `drift_snapshots.last_hash` is the previous-completed value, so a mid-rebuild read sees a slightly stale hash and reports one false drift. This is acceptable: the next `drift-detection` tick (5 min later) reconciles. Documented; not enforced with a lock.

### Idempotency

`rebuildProjection` is deterministic: same `raw_events` content → same end state. Test: rebuild twice → `computeSaldo(uuid)` returns identical values for every UUID in the projection. Implemented via `REPLACE INTO` semantics (truncate is atomic inside the transaction).

### `computeSaldo(socioEntityId)`

```ts
// packages/projection/src/saldo.ts
export interface SaldoResult {
  socioEntityId: string   // UUID
  debe:  number           // Σ positive CTACTE amounts
  haber: number           // Σ negative CTACTE amounts (positive number)
  saldo: number           // debe - haber
  as_of: string           // ISO8601, the time of the query
}
export async function computeSaldo(db: Db, socioEntityId: string): Promise<SaldoResult> {
  const [row] = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN (r.payload->>'monto')::numeric > 0
                        THEN (r.payload->>'monto')::numeric ELSE 0 END), 0) AS debe,
      COALESCE(SUM(CASE WHEN (r.payload->>'monto')::numeric < 0
                        THEN -(r.payload->>'monto')::numeric ELSE 0 END), 0) AS haber
    FROM raw_events r
    JOIN entity_uuids e
      ON e.source_table = r.source_table AND e.source_key = r.source_key
    WHERE r.source_table = 'ctacte'
      AND EXISTS (
        SELECT 1 FROM raw_events r2
        JOIN entity_uuids e2
          ON e2.source_table = r2.source_table AND e2.source_key = r2.source_key
        WHERE e2.entity_uuid = ${socioEntityId}::uuid
          AND r2.source_table = 'socios'
          AND r2.payload->>'numero_socio' = e.source_key_join
      )
  `)
  // The EXISTS subselect resolves the socio's legacy key, then filters
  // CTACTE rows whose legacy key belongs to the same socio. (A foreign
  // key on `entity_uuid` is added in the projection migration; until
  // then this join is the cross-domain glue.)
  const debe  = Number(row?.debe  ?? 0)
  const haber = Number(row?.haber ?? 0)
  return { socioEntityId, debe, haber, saldo: debe - haber, as_of: new Date().toISOString() }
}
```

> **Open issue** (see §11): the cross-domain join is the most fragile part of this design. The `entity_uuid` foreign key between `socios_projection` and `ctacte_projection` lands in a follow-up migration. sdd-tasks should break this into a smaller AC.

## §3 — Drift Detection Algorithm

### `drift_snapshots` schema

```ts
// packages/db/src/schema/public.ts (append)
export const driftSnapshots = pgTable(
  'drift_snapshots',
  {
    entityUuid:  uuid('entity_uuid').primaryKey(),    // FK → entity_uuids.entity_uuid
    domain:      varchar('domain', { length: 32 }).notNull(),
    lastHash:    varchar('last_hash', { length: 64 }).notNull(),
    lastEventId: uuid('last_event_id').notNull(),     // raw_events.id at time of snapshot
    snapshotAt:  timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
)
export type DriftSnapshot = typeof driftSnapshots.$inferSelect
```

```sql
-- packages/db/drizzle/0008_drift_snapshots.sql
CREATE TABLE "drift_snapshots" (
  "entity_uuid"  uuid PRIMARY KEY,
  "domain"       varchar(32) NOT NULL,
  "last_hash"    varchar(64) NOT NULL,
  "last_event_id" uuid NOT NULL,
  "snapshot_at"  timestamptz NOT NULL DEFAULT now()
);
```

### Detection flow

```ts
// packages/drift/src/detect.ts
export interface DriftReport {
  domain: string | null         // null when scanning all
  scanned: number
  driftCount: number
  drifts: Array<{ entityUuid: string; oldHash: string; newHash: string; lastImportedAt: Date }>
}
export async function detect(db: Db, opts: { domain?: Domain } = {}): Promise<DriftReport> {
  // For each (source_table, source_key) in raw_events, compare
  // MAX(content_hash) against the matching drift_snapshots.last_hash.
  // The `raw_events.content_hash` is per-row, so we collapse to one
  // hash per (source_table, source_key) using DISTINCT ON.
  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.source_table, r.source_key)
             r.source_table, r.source_key, r.content_hash, r.imported_at,
             e.entity_uuid
      FROM raw_events r
      JOIN entity_uuids e
        ON e.source_table = r.source_table AND e.source_key = r.source_key
      WHERE r.source_table = ${opts.domain ?? sql`(SELECT DISTINCT source_table FROM raw_events)`}
      ORDER BY r.source_table, r.source_key, r.imported_at DESC
    )
    SELECT l.entity_uuid, l.source_table, l.content_hash AS new_hash, l.imported_at,
           s.last_hash AS old_hash
    FROM latest l
    LEFT JOIN drift_snapshots s ON s.entity_uuid = l.entity_uuid
    WHERE s.last_hash IS DISTINCT FROM l.content_hash
  `)
  // ... build report
}
```

### Direct write to `audit_events`

```ts
// packages/drift/src/alert.ts
export async function emitDriftAlert(db: Db, report: DriftReport, ctx: {
  jobRunId: string
}): Promise<{ audited: true; notificationDispatched: boolean }> {
  if (report.driftCount === 0) return { audited: true, notificationDispatched: false }
  // SYSTEM EVENT — no operator. Direct Drizzle insert; NEVER call
  // @athlos/audit here. The two paths are deliberately separate
  // (see audit-logger delta "Direct Audit Write Path for System
  // Events").
  await db.insert(auditEvents).values({
    operatorId: null,
    action: 'DRIFT_DETECTED',
    entityType: 'domain',
    entityId: report.domain ?? 'all',
    oldValue: null,
    newValue: null,
    sourceIp: null,                          // system events have no IP
    metadata: { driftCount: report.driftCount, sample: report.drifts.slice(0, 5) },
    idempotencyKey: null,                    // system events don't dedup
  })
  // Fan out to DATA_STEWARD via the dispatcher. The dispatcher's
  // resolveDrift() now filters on role_permissions (see §9).
  void sendNotification({
    type: 'drift_alert',
    eventId: `${ctx.jobRunId}:${report.domain ?? 'all'}`,
    metadata: {
      domain: report.domain ?? 'all',
      count: report.driftCount,
      affectedKeys: report.drifts.map(d => d.entityUuid).slice(0, 5),
    },
  })
  return { audited: true, notificationDispatched: true }
}
```

### DATA_STEWARD fanout

The dispatcher's existing `resolveDrift()` currently filters by `operators.role = 'A'` (ADMIN). OI-1 B requires a new filter:

```ts
// packages/notifications/src/dispatcher.ts (modify resolveDrift)
// Replace fetchAdmins() with fetchDataStewards():
private async fetchDataStewards(): Promise<ResolvedRecipient[]> {
  const rows = await this.db
    .select({
      id: operators.id, username: operators.username,
      role: operators.role, isActive: operators.isActive,
      hasPermission: sql<boolean>`EXISTS(
        SELECT 1 FROM role_permissions rp
        WHERE rp.operator_id = ${operators.id}
          AND rp.permission_key = 'data_steward'
      )`.as('has_permission'),
    })
    .from(operators)
    .where(sql`EXISTS(
      SELECT 1 FROM role_permissions rp
      WHERE rp.operator_id = ${operators.id} AND rp.permission_key = 'data_steward'
    )`)
  return rows.filter(r => r.isActive && r.hasPermission)
    .map(r => ({ operatorId: r.id, email: null, phone: null,
                  role: charToRole(r.role), username: r.username }))
}
```

Test cases (from the notifications delta): steward1 + steward2 receive; admin1 + admin2 do NOT; no DATA_STEWARD row → still audited, no email.

## §4 — Freshness Status Mapping

### `DOMAIN_THRESHOLDS` constant

```ts
// packages/freshness/src/thresholds.ts
import type { Domain } from '@athlos/projection'   // shared type
export const DOMAIN_THRESHOLDS: Record<Domain, { staleAfter: string /* ISO 8601 duration */ }> = {
  socios:    { staleAfter: 'PT1H' },  // 1 hour
  ctacte:    { staleAfter: 'PT1H' },
  ctacte1:   { staleAfter: 'PT1H' },
  contable:  { staleAfter: 'P1D'  },  // 1 day
  contabl1:  { staleAfter: 'P1D'  },
  catastros: { staleAfter: 'P1D'  },
  escuela:   { staleAfter: 'P1D'  },
  deportes:  { staleAfter: 'PT12H'},  // 12h
  locacion:  { staleAfter: 'P1D'  },
  caja:      { staleAfter: 'PT30M'},  // 30 min (cash is critical)
  gastos:    { staleAfter: 'PT12H'},
}
```

> **Decision** (not in spec): `P1D`/`PT1H` etc. as ISO 8601 strings, parsed at module load with `Temporal.Duration.from()` or a 6-line manual parser. Avoids a runtime dep on `Temporal` polyfill. Missing threshold → `BusinessError(CONFIG_MISSING)` (not `'unknown'` — the spec delta explicitly forbids silent fallback).

### Status reducer

```ts
// packages/freshness/src/api.ts
export type DomainFreshnessStatus = 'current' | 'stale' | 'unknown'
export interface DomainFreshness {
  domain: Domain
  lastImportAt: string | null      // ISO
  recordCount: number
  status: DomainFreshnessStatus
  ageDisplay: string               // Spanish: "hace 5 min"
}
function ageToStatus(ageMs: number | null, thresholdMs: number): DomainFreshnessStatus {
  if (ageMs === null) return 'unknown'
  if (ageMs < thresholdMs) return 'current'
  if (ageMs > thresholdMs * 1.5) return 'stale'
  return 'current'  // within 1.5× threshold — warn-only
}
function ageDisplay(ageMs: number | null): string {
  if (ageMs === null) return 'nunca'
  const m = Math.floor(ageMs / 60_000)
  if (m < 1)    return 'hace menos de 1 min'
  if (m < 60)   return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24)   return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}
```

### Cache table

```sql
-- packages/db/drizzle/0009_domain_freshness.sql
CREATE TABLE "domain_freshness" (
  "domain"        varchar(32) PRIMARY KEY,
  "last_import_at" timestamptz,
  "record_count"  integer NOT NULL DEFAULT 0,
  "refreshed_at"  timestamptz NOT NULL DEFAULT now()
);
```

The `freshness-refresh` job (cron `*/1 * * * *` = 60s) recomputes per domain by reading `MAX(raw_events.imported_at)` + `COUNT(*)` from `raw_events WHERE source_table = ?`. The `getFreshness` route reads from the cache + computes `status` + `ageDisplay` on the fly.

## §5 — Audit Middleware Architecture

### `auditPlugin` — fp-wrapped

```ts
// packages/audit/src/middleware.ts
import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { emitAudit } from './emitter.ts'
declare module 'fastify' {
  interface FastifyRequest { auditCtx?: { entityType: string; entityId: string; action: string } }
}

const auditPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    if (!request.operator) return                       // anonymous — no audit
    const ctx = parseAuditContext(request)              // route-level helper, see below
    if (ctx) request.auditCtx = ctx
  })
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auditCtx || !request.operator) return
    if (reply.statusCode < 200 || reply.statusCode >= 300) return
    const oldValue = await snapshotOldValue(fastify, request)  // reads pre-mutation state
    await emitAudit(fastify.container.db, {
      operatorId: request.operator.sub,
      action:     request.auditCtx.action,
      entityType: request.auditCtx.entityType,
      entityId:   request.auditCtx.entityId,
      oldValue, newValue: reply.payload,
      sourceIp:   request.ip ?? null,
      payload:    request.body,
    })
  })
}
// CRITICAL: fp() wrap. The 95% bug class (PR 3a / Engram #1990) is an
// unwrapped plugin. CI grep below enforces this.
export const auditPlugin = fp(auditPlugin, { name: 'athlos-audit' })
```

### CI guard

```bash
# apps/api/scripts/ci-check-audit-fp.sh (wired in pnpm test:ci)
test "$(grep -cE "fp\(auditPlugin,\s*\{\s*name:\s*'athlos-audit'" \
  packages/audit/src/middleware.ts)" = "1" || \
  { echo "auditPlugin MUST be fp()-wrapped with name 'athlos-audit'"; exit 1; }
```

Plus an integration test (from the spec delta "Protected mutation produces exactly 1 audit row"): register `auditPlugin` via `app.register(auditPlugin)`, register a PATCH route with `requireAuth()`, PATCH with a valid JWT, assert exactly 1 row in `audit_events` with `operator_id = <sub>`.

### `emitAudit` — 10s idempotency window

```ts
// packages/audit/src/emitter.ts
import { createHash } from 'node:crypto'
export interface AuditRecord {
  operatorId: string | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  sourceIp: string | null
  payload: unknown             // canonical JSON for hashing
}
export async function emitAudit(db: Db, r: AuditRecord): Promise<
  | { inserted: true; id: string }
  | { inserted: false; deduped: true }
> {
  const bucket = Math.floor(Date.now() / 10_000)
  const key = createHash('sha256')
    .update(`${r.operatorId ?? ''}|${r.action}|${r.entityId}|${JSON.stringify(r.payload)}|${bucket}`)
    .digest('hex')
  // SELECT-1 then INSERT. Race window: a concurrent insert with the
  // same key will violate the partial unique index. We catch the 23505
  // and return deduped.
  const [existing] = await db.select({ id: auditEvents.id })
    .from(auditEvents).where(eq(auditEvents.idempotencyKey, key)).limit(1)
  if (existing) return { inserted: false, deduped: true }
  try {
    const [row] = await db.insert(auditEvents).values({
      operatorId: r.operatorId, action: r.action,
      entityType: r.entityType, entityId: r.entityId,
      oldValue: r.oldValue as any, newValue: r.newValue as any,
      sourceIp: r.sourceIp, idempotencyKey: key,
    }).returning({ id: auditEvents.id })
    return { inserted: true, id: row!.id }
  } catch (e: any) {
    if (e?.code === '23505') return { inserted: false, deduped: true }
    throw e
  }
}
```

### Two write paths (documented in code)

```
                            ┌──────────┐
  HTTP request ────────────►│ auth     │──► request.operator
                            │ plugin   │
                            └──────────┘
                                 │
                                 ▼
                            ┌──────────┐
                            │  audit   │── onResponse ──► emitAudit(db, rec)
                            │  plugin  │   (operator ctx)
                            └──────────┘
                                 │
                                 ▼
                            ┌──────────┐
                            │ audit_   │  ← ONE row, operator_id set
                            │ events   │
                            └──────────┘
                                   ▲
                            ┌──────────┐
  drift cron ──►  drift     │ direct   │── emitDriftAlert() inserts directly
  scheduled-import ─►       │ insert   │   (operator_id NULL)
  scheduled jobs ─►         │          │
                            └──────────┘
```

## §6 — Route Surface

All routes registered in `apps/api/src/server.ts` AFTER `auditPlugin` (so the hooks apply) and AFTER `authPlugin` (so `request.operator` is set).

### `POST /api/v1/import/trigger` (ADMIN)

```ts
// apps/api/src/routes/import.ts
const triggerBodySchema = z.object({
  domain: z.enum(['all', ...Object.keys(DOMAIN_PROJECTION_TABLE) as [string, ...string[]]).default('all'),
})
fastify.post('/api/v1/import/trigger',
  { preHandler: requireRole('ADMIN') },
  async (request, reply) => {
    const body = throwIfInvalid(triggerBodySchema, request.body, 'body')
    const { jobRunId } = await fastify.scheduler.runNow('scheduled-import', {
      triggeredBy: 'manual', domain: body.domain,
    })
    // Idempotency: re-triggering with same body within 5s returns same id.
    // Implementation: SELECT job_runs WHERE job_name='scheduled-import'
    // AND triggered_by='manual' AND scheduled_at > now() - 5s
    return reply.code(202).send({
      batchId: jobRunId,
      status: 'queued',
      estimatedTables: body.domain === 'all' ? 14 : 1,
    })
  })
```

### `DELETE /api/v1/import/trigger/:batchId` (ADMIN) — TASK-060a

```ts
fastify.delete<{ Params: { batchId: string } }>(
  '/api/v1/import/trigger/:batchId',
  { preHandler: requireRole('ADMIN') },
  async (request, reply) => {
    const { batchId } = throwIfInvalid(z.object({ batchId: idSchema }), request.params, 'params')
    // The `job_runs` row holds the queue state. The actual import
    // handler transitions `running` to `pending` at execution; cancel
    // is only valid while still `pending`.
    const [run] = await fastify.container.db.select()
      .from(jobRuns)
      .where(and(eq(jobRuns.id, batchId), eq(jobRuns.jobName, 'scheduled-import')))
      .limit(1)
    if (!run) return reply.code(404).send({ code: 'NOT_FOUND' })
    if (run.status === 'running') {
      return reply.code(409).send({ code: 'IMPORT_ALREADY_STARTED',
        message: 'import is already running; cannot cancel' })
    }
    if (run.status === 'cancelled') {
      return reply.code(200).send({ batchId, status: 'cancelled' })  // idempotent
    }
    await fastify.container.db.update(jobRuns)
      .set({ status: 'cancelled', finishedAt: new Date(),
             errorMessage: 'cancelled by admin' })
      .where(eq(jobRuns.id, batchId))
    return reply.code(200).send({ batchId, status: 'cancelled' })
  })
```

> **Note**: `cancelled` is a new `job_runs.status` enum value. The Drizzle table uses `text` + `$type<...>()` — the union widens to `... | 'cancelled'`. No migration needed.

### `GET /api/v1/import/status` (ADMIN)

Returns last 20 `job_runs` for `job_name='scheduled-import'`, each with `domain` from `metadata`.

### `GET /api/v1/import/status/:batchId` (ADMIN)

Single run, with live `progress` (from `metadata.imported_tables / 14`).

### `GET /api/v1/lineage/:entityId` (any auth)

```ts
fastify.get<{ Params: { entityId: string } }>('/api/v1/lineage/:entityId',
  { preHandler: requireAuth() },
  async (request, reply) => {
    const { entityId } = throwIfInvalid(z.object({ entityId: idSchema }), request.params, 'params')
    const result = await queryLineage(fastify.container.db, entityId)
    if (!result) return reply.code(404).send({ code: 'NOT_FOUND' })
    return reply.code(200).send(result)
  })
```

### `GET /api/v1/drift` (ADMIN OR `data_steward`)

```ts
const ADMIN_OR_STEWARD = { preHandler: [
  requireRole('ADMIN'),                                 // ADMIN passes
  requirePermission('data_steward'),                    // OR has data_steward
] }   // route-audit: at least one preHandler has the marker → passes
fastify.get('/api/v1/drift', { preHandler: ADMIN_OR_STEWARD }, async (req, reply) => {
  const report = await detect(fastify.container.db, {})
  return reply.code(200).send(report)
})
```

### `GET /api/v1/freshness` (any auth)

```ts
fastify.get('/api/v1/freshness', { preHandler: requireAuth() },
  async (_req, reply) => reply.code(200).send({ items: await getFreshness(fastify.container.db) }))
```

### `GET /api/v1/audit?operator=&entity=&from=&to=&page=` (ADMIN OR `data_steward`)

```ts
const querySchema = z.object({
  operator: z.string().uuid().optional(),
  entity:   z.string().uuid().optional(),
  from:     z.string().datetime().optional(),
  to:       z.string().datetime().optional(),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(500).default(100),
})
fastify.get('/api/v1/audit',
  { preHandler: [requireRole('ADMIN'), requirePermission('data_steward')] },
  async (request, reply) => {
    const q = throwIfInvalid(querySchema, request.query, 'query')
    const result = await queryAudit(fastify.container.db, q)
    return reply.code(200).send({ items: result.items, total: result.total, page: q.page, limit: q.limit })
  })
```

## §7 — DI Wiring

### `apps/api/src/container.ts` — add 5 services + 1 repo

```ts
// apps/api/src/container.ts (append)
import { makeLineageService } from '@athlos/lineage'
import { makeProjectionService } from '@athlos/projection'
import { makeDriftService } from '@athlos/drift'
import { makeFreshnessService } from '@athlos/freshness'
import { makeAuditService } from '@athlos/audit'
import { makePermissionsRepo } from '@athlos/db/repositories/permissions'
export interface AppContainer {
  // ... existing
  lineageService:    ReturnType<typeof makeLineageService>
  projectionService: ReturnType<typeof makeProjectionService>
  driftService:      ReturnType<typeof makeDriftService>
  freshnessService:  ReturnType<typeof makeFreshnessService>
  auditService:      ReturnType<typeof makeAuditService>
  permissionsRepo:   ReturnType<typeof makePermissionsRepo>
}
export function buildContainer(config: ContainerConfig): AppContainer {
  // ... existing body
  return {
    // ... existing fields
    lineageService:    makeLineageService(db),
    projectionService: makeProjectionService(db),
    driftService:      makeDriftService(db),
    freshnessService:  makeFreshnessService(db),
    auditService:      makeAuditService(db),
    permissionsRepo:   makePermissionsRepo(db),
  }
}
```

> **Standalone-implementable** (lesson from Engram #2037 — sub-agent platform failure): each service factory takes only `db`, no cross-package deps. If a sub-agent session fails, the orchestrator can launch sdd-apply directly per package.

### `apps/api/src/server.ts` — register `auditPlugin` BEFORE routes

```ts
// apps/api/src/server.ts (insert between line 154 authPlugin and 157 authRoutes)
await app.register(auditPlugin)                  // fp-wrapped; exposes hooks to parent scope

// All 5 new routes registered AFTER auditPlugin + authPlugin
await app.register(importRoutes,  { container: app.container })
await app.register(lineageRoutes, { container: app.container })
await app.register(driftRoutes,   { container: app.container })
await app.register(freshnessRoutes,{ container: app.container })
await app.register(auditRoutes,   { container: app.container })
```

### Scheduler (PR 6a) — 4 jobs already wired by name; bodies swapped in this change

No registration changes needed in `apps/api/src/jobs/register.ts` — the 4 job names are already in the `buildScheduler` call. The implementation sub-agent (`sdd-apply`) modifies the body of the 4 handler factories.

## §8 — Job Body Swap Mapping

### `drift-detection` (PR 7b.1)

```ts
// apps/api/src/jobs/drift-detection.ts
import { makeDriftService } from '@athlos/drift'
export function makeDriftDetectionHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'DRIFT_DETECTION_START' }, 'starting drift detection')
    const service = makeDriftService(db)
    const reports = await service.detectAll()                  // all domains
    const affectedDomains = reports.filter(r => r.driftCount > 0).map(r => r.domain!)
    for (const report of reports) {
      if (report.driftCount > 0) {
        await service.emitDriftAlert(report, { jobRunId: ctx.jobRunId })
      }
    }
    return { status: 'succeeded', metadata: {
      drift_count: reports.reduce((a, r) => a + r.driftCount, 0),
      domains: affectedDomains,
    }}
  }
}
```

Cron: `DRIFT_DETECTION_CRON='*/5 * * * *'` (5 min). Existing cron env var unchanged.

### `freshness-refresh` (PR 7b.1)

```ts
// apps/api/src/jobs/freshness-refresh.ts
import { makeFreshnessService } from '@athlos/freshness'
export function makeFreshnessRefreshHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'FRESHNESS_REFRESH_START' }, 'refreshing per-domain freshness')
    const service = makeFreshnessService(db)
    const refreshed = await service.refreshAll()               // writes into domain_freshness
    return { status: 'succeeded', metadata: {
      refreshed_domains: refreshed.map(r => r.domain),
      scope: ctx.metadata['domain'] ?? 'all',
    }}
  }
}
```

Cron: `FRESHNESS_REFRESH_CRON='*/1 * * * *'` (60s). Existing env var.

### `scheduled-import` (PR 7b.1)

```ts
// apps/api/src/jobs/scheduled-import.ts
import { runImport } from '@athlos/import'
import { makeProjectionService } from '@athlos/projection'
import { makeFreshnessService } from '@athlos/freshness'
export function makeScheduledImportHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'SCHEDULED_IMPORT_START' }, 'starting scheduled import')
    const batch = await runImport(db, {
      trigger: 'scheduled',
      batchId: ctx.jobRunId,             // align batchId with jobRunId for cancel lookup
    })
    // Post-import side effects
    if (batch.status === 'succeeded') {
      const projectionSvc = makeProjectionService(db)
      const freshnessSvc = makeFreshnessService(db)
      for (const table of batch.totals ? Object.keys(DOMAIN_PROJECTION_TABLE) : []) {
        await projectionSvc.rebuild(table as Domain)
      }
      await freshnessSvc.refreshAll()
    }
    return { status: 'succeeded', metadata: {
      imported_tables: batch.totals.read,
      inserted: batch.totals.inserted,
      skipped: batch.totals.skipped,
      failed: batch.totals.failed,
    }}
  }
}
```

Cron: `'0 2 * * *'` (02:00 Argentina TZ). Existing.

### `reconciliation` (PR 7b.2)

```ts
// apps/api/src/jobs/reconciliation.ts
import { makeProjectionService } from '@athlos/projection'
import { makeDriftService } from '@athlos/drift'
export function makeReconciliationHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'RECONCILIATION_START' }, 'starting reconciliation')
    const projectionSvc = makeProjectionService(db)
    const driftSvc = makeDriftService(db)
    const rebuildResult = await projectionSvc.rebuildAll()     // all 11 domains
    const driftReport    = await driftSvc.detectAll()
    return { status: 'succeeded', metadata: {
      mismatched_domains: rebuildResult.mismatchedDomains.length,
      domains_checked: rebuildResult.domainsChecked,
      drift_count: driftReport.reduce((a, r) => a + r.driftCount, 0),
    }}
  }
}
```

Cron: `RECONCILIATION_CRON` env var (default unset; the `'0 0 31 2 *'` Feb-31 sentinel handles the unset case from PR 6a). Existing.

## §9 — DATA_STEWARD Permission Wiring (OI-1 B)

### Schema

```ts
// packages/db/src/schema/operators.ts (append)
import { primaryKey, text } from 'drizzle-orm/pg-core'
export const rolePermissions = pgTable(
  'role_permissions',
  {
    operatorId:    uuid('operator_id').notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    grantedAt:     timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy:     uuid('granted_by').references(() => operators.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.operatorId, t.permissionKey] }) }),
)
export type RolePermission = typeof rolePermissions.$inferSelect
```

```sql
-- packages/db/drizzle/0010_role_permissions.sql
CREATE TABLE "role_permissions" (
  "operator_id"    uuid NOT NULL REFERENCES "operators"("id") ON DELETE CASCADE,
  "permission_key" text NOT NULL,
  "granted_at"     timestamptz NOT NULL DEFAULT now(),
  "granted_by"     uuid REFERENCES "operators"("id"),
  PRIMARY KEY ("operator_id", "permission_key")
);
```

### Repo

```ts
// packages/db/src/repositories/permissions.ts
export interface PermissionsRepo {
  hasPermission(operatorId: string, key: string): Promise<boolean>
  grant(operatorId: string, key: string, grantedBy: string | null): Promise<void>
  revoke(operatorId: string, key: string): Promise<void>
}
export function makePermissionsRepo(db: Db): PermissionsRepo {
  return {
    async hasPermission(operatorId, key) {
      const [row] = await db.select({ x: sql`1` })
        .from(rolePermissions)
        .where(and(eq(rolePermissions.operatorId, operatorId),
                   eq(rolePermissions.permissionKey, key)))
        .limit(1)
      return !!row
    },
    async grant(operatorId, key, grantedBy) {
      await db.insert(rolePermissions)
        .values({ operatorId, permissionKey: key, grantedBy })
        .onConflictDoNothing()
    },
    async revoke(operatorId, key) {
      await db.delete(rolePermissions)
        .where(and(eq(rolePermissions.operatorId, operatorId),
                   eq(rolePermissions.permissionKey, key)))
    },
  }
}
```

### `requirePermission('data_steward')` gate factory

```ts
// packages/auth/src/middleware.ts (append)
import type { PermissionsRepo } from '@athlos/db/repositories/permissions'
export function requirePermission(perm: string): preHandlerHookHandler {
  return markGate(async (request) => {
    if (!request.operator) throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    // The token's permissions object is a STARTING set; the table is
    // the source of truth for live grants (admin can grant mid-session).
    if (request.operator.permissions[perm as keyof JWTPayload['permissions']]) return
    // Fall back to the DB check
    const repo: PermissionsRepo = (request.server as any).container.permissionsRepo
    if (await repo.hasPermission(request.operator.sub, perm)) return
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, `Missing permission: ${perm}`)
  }, 'permission')
}
```

> **Note**: the current `requirePermission` signature is `keyof JWTPayload['permissions']` (only `can_reprint`, `can_anulate`). This change widens it to `string` so `data_steward` and future keys compile. The `permissions` JWT field still holds the booleans for those two; DB lookup is the escape hatch for arbitrary keys.

### Seed

No default grants. After migration, `SELECT COUNT(*) FROM role_permissions` = 0. An admin must explicitly grant via an internal endpoint (out of scope for this change — PR 7b.2 admin endpoint is the natural home, but the spec doesn't mandate it; deferred to PR 7c or beyond).

### Notification fanout filter

The dispatcher's `resolveDrift()` switches to `fetchDataStewards()` (see §3 code). Test cases (notifications delta): steward1+steward2 receive email+in_app; admin1+admin2 receive nothing; zero DATA_STEWARDs → audit row written, zero emails, zero in_app.

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/lineage/src/{query,verify,index}.ts` | Create | queryLineage, verifyHash (~110L) |
| `packages/projection/src/{rebuild,saldo,index}.ts` | Create | DOMAIN_PROJECTION_TABLE, rebuild, computeSaldo (~220L) |
| `packages/drift/src/{detect,alert,index}.ts` | Create | detect, emitDriftAlert (~120L) |
| `packages/freshness/src/{api,thresholds,index}.ts` | Create | getFreshness, age→status, DOMAIN_THRESHOLDS (~110L) |
| `packages/audit/src/{middleware,emitter,query,index}.ts` | Create | auditPlugin (fp-wrapped), emitAudit, queryAudit (~180L) |
| `packages/db/src/schema/public.ts` | Modify | + `entityUuids`, `driftSnapshots`, `domainFreshness` |
| `packages/db/src/schema/operators.ts` | Modify | + `rolePermissions` |
| `packages/db/src/schema/index.ts` | Modify | Re-export 4 new tables + types |
| `packages/db/src/repositories/permissions.ts` | Create | `makePermissionsRepo` (~40L) |
| `packages/db/drizzle/{0007..0010}_*.sql` | Create | 4 migrations |
| `packages/notifications/src/dispatcher.ts` | Modify | `resolveDrift` → `fetchDataStewards` |
| `packages/auth/src/middleware.ts` | Modify | `requirePermission(string)` widened |
| `apps/api/src/container.ts` | Modify | + 5 services + permissionsRepo |
| `apps/api/src/server.ts` | Modify | + auditPlugin + 5 routes |
| `apps/api/src/routes/{import,lineage,drift,freshness,audit}.ts` | Create | 5 routes (~220L) |
| `apps/api/src/jobs/{drift-detection,freshness-refresh,scheduled-import,reconciliation}.ts` | Modify | Stub → real body (~80L delta) |
| `apps/api/scripts/ci-check-audit-fp.sh` | Create | CI grep for `fp(auditPlugin, { name: 'athlos-audit' })` |
| `packages/*/src/*.test.ts` (co-located) | Create | Strict TDD — RED first per TASK AC |

## Testing Strategy (strict TDD per Engram obs #2047)

| Layer | What | How |
|-------|------|-----|
| Unit | `lineage.queryLineage` returns 5-field shape; `verifyHash` returns `match:true`/`false` | `packages/lineage/src/query.test.ts` using `aRawEvent().build()` fixtures + standin DB |
| Unit | `rebuildProjection("ctacte")` truncates+replays idempotently | `packages/projection/src/rebuild.test.ts` — pre-seed raw_events + entity_uuids, run twice, assert rowCount equal + identical rows |
| Unit | `computeSaldo(uuid)` shape + math | `packages/projection/src/saldo.test.ts` |
| Unit | `drift.detect({})` compares hashes; 0 drift → no alert | `packages/drift/src/detect.test.ts` |
| Unit | `drift.emitDriftAlert` writes 1 audit row (mock @athlos/audit to throw) + calls dispatcher | `packages/drift/src/alert.test.ts` |
| Unit | `freshness.getFreshness` maps age → status; missing threshold throws | `packages/freshness/src/api.test.ts` |
| Unit | `emitAudit` dedupes within 10s; different bucket → new row | `packages/audit/src/emitter.test.ts` — `vi.useFakeTimers()` + `vi.setSystemTime` |
| Unit | `permissionsRepo.hasPermission` true/false; grant idempotent | `packages/db/src/repositories/permissions.test.ts` |
| Integration | `auditPlugin` (registered via `app.register`) on a PATCH route → exactly 1 audit row | `apps/api/src/routes/audit.test.ts` (or `apps/api/src/server.test.ts` extension) — uses supertest + standin DB + real JWT |
| Integration | `POST /api/v1/import/trigger` (ADMIN → 202; CONSULTA → 403) | `apps/api/src/routes/import.test.ts` |
| Integration | `DELETE /api/v1/import/trigger/:batchId` (queued → 200; running → 409; unknown → 404) | same test file |
| Integration | End-to-end: import → rebuild → lineage query returns correct batch | 7b.1 integration test using a full Fastify app + standin DB |
| CI | `fp(auditPlugin, { name: 'athlos-audit' })` present | `apps/api/scripts/ci-check-audit-fp.sh` runs in `pnpm test:ci` |
| CI | No `audit-purge`/`audit-retention` job registered | `apps/api/scripts/ci-check-no-audit-purge.sh` greps `apps/api/src/jobs/` |

Coverage gate: 322 → ≥420 tests (+98). All co-located (`*.test.ts` next to source).

## Review Workload Forecast

| Sub-slice | Code (new+modified) | Tests (new) | Risk | 400-line budget |
|-----------|---------------------|-------------|------|------------------|
| **PR 7b.1 — data plane** | ~550L (5 packages + 2 migrations + 3 job body swaps) | ~320L (lineage, projection, drift, freshness + integration) | **HIGH** (5 new packages, 11-row projection table, 2 migrations, cross-domain join in computeSaldo) | **OVER by ~150L** (code + tests = ~870L) |
| **PR 7b.2 — route + audit plane** | ~330L (audit pkg + 5 routes + 1 migration + 1 job body swap + CI script) | ~320L (audit middleware integration + 5 route tests + idempotency) | **MED** (auth-coupled, audit fp-wrap is the PR 3a bug class, route-audit will reject unprotected routes at boot) | **OVER by ~250L** (code + tests = ~650L) |

**Chained PRs recommended**: **YES** — both sub-slices individually exceed 400 lines. Recommend:

- **PR 7b.1** ships in TWO chained slices itself:
  - **7b.1a** — lineage + projection (3 packages? No — 2 packages + 1 migration + 1 job swap) ≈ 380L — within budget
  - **7b.1b** — drift + freshness (2 packages + 1 migration + 2 job swaps) ≈ 320L — within budget
- **PR 7b.2** ships as a single slice (5 routes + audit pkg is tight but cohesive — splitting audit pkg from routes breaks the integration test)

**400-line budget risk**: **HIGH** for the 2-slice split. **MEDIUM** with the 3-slice chained split (7b.1a → 7b.1b → 7b.2).

**Decision needed before apply**: **YES** — orchestrator should ask the user:
1. Confirm 3-chained-PR strategy (7b.1a → 7b.1b → 7b.2) vs 2-PR (7b.1 → 7b.2 with `size:exception` on 7b.1).
2. Confirm stacked-to-main vs feature-branch-chain (per `sdd-phase-common.md` §E).
3. Confirm `entity_uuids` table approach vs `raw_events.entity_id` column (the spec's prose implies the column).

## Implementation Risks & Open Questions

| ID | Risk / Question | Severity | Mitigation / Decision |
|----|-----------------|----------|------------------------|
| R-101 | Sub-agent `session_message.seq` platform error (Engram #2037) | MED | The design is **standalone-implementable** (each package factory takes only `db`); orchestrator can launch sdd-apply directly per package if a sub-agent session fails. |
| R-102 | `entity_uuids` table vs `raw_events.entity_id` column (spec prose vs orchestrator brief) | LOW | Follow orchestrator brief: separate `entity_uuids` table. Document the deviation in code comment. The spec's "in the entity_id column" is reinterpreted as "the `entity_uuid` column of `entity_uuids`". |
| R-103 | `drift_snapshots` + `domain_freshness` + `role_permissions` tables don't exist yet | LOW | 3 migrations (0008, 0009, 0010) ship in this change. sdd-apply preflight verifies against the Drizzle schema diff. |
| R-104 | Audit middleware `fp`-wrap regression (PR 3a class, Engram #1990) | MED | `fp(auditPlugin, { name: 'athlos-audit' })` + CI grep + integration test (already in the audit-logger spec delta). The design REQUIRES this; the CI script is `apps/api/scripts/ci-check-audit-fp.sh`. |
| R-105 | 11-domain projection map (not 14) — 3 legacy tables (`paramet`, `plancue`, `usuario`) have no projection | LOW | Documented in §2. Add a test that confirms `rebuildProjection('paramet')` throws `BusinessError(VALIDATION)` — surfaces the "missing projection" gap loudly. |
| R-106 | `computeSaldo` cross-domain join (socios.key → ctacte.key) is fragile until a `ctacte_projection.socio_uuid` column lands | MED | The EXISTS subselect is correct but slow at 390K rows. Performance test in 7b.1 must benchmark; if >500ms, defer a `socio_uuid` denorm column to a follow-up migration. |
| R-107 | `requirePermission` signature widening from `keyof JWTPayload['permissions']` to `string` is a soft API break | LOW | Existing call sites use `requirePermission('can_reprint')` / `requirePermission('can_anulate')` — both are valid string literals. Type system widens cleanly. No caller change. |
| R-108 | DATA_STEWARD permission has no default grant (zero rows out of the box) | MED | Drift alerts ARE NOT received until an admin explicitly grants. Document in the runbook; surface in the PR description as a "deploy checklist" item. |
| R-109 | `cancelled` is a new `job_runs.status` value (the Drizzle enum widens via `$type<...>()` — no migration) | LOW | Verified against `packages/db/src/schema/job-runs.ts`: the column is `text` with `$type<...>()` — adding `'cancelled'` is type-only, no SQL change. |
| R-110 | `permissionsRepo` lives in `@athlos/db` but reads from `@athlos/auth` (via the gate) — circular import risk | MED | Repo is pure DB; gate is in `@athlos/auth`. The gate imports the repo TYPE (`PermissionsRepo`) from `@athlos/db/repositories/permissions`; the implementation is provided via DI. No runtime cycle. |
| R-111 | `drift.detect` `DISTINCT ON` query against `raw_events` (390K rows) may exceed 5s on first run | MED | Add a partial index on `raw_events(source_table, imported_at DESC)` in migration 0011 (deferred — not in this change). The freshness-refresh job's `MAX(imported_at)` is index-eligible already. |
| R-112 | UI design delta (`ui-design/spec.md`) is a stub — the confirm-and-wait modal is fully deferred to PR 8 | LOW | This change exposes the API contract only. The 30s cancel window is enforced server-side (the `DELETE` while `queued` rule); the client countdown is decoration. |
| R-113 | The spec delta for audit uses `idempotency_key` column UNIQUE constraint for dedup; the current `audit_events` schema has it as nullable text but no unique index | MED | Migration 0012 (added during this change): `CREATE UNIQUE INDEX uq_audit_events_idempotency_key ON audit_events(idempotency_key) WHERE idempotency_key IS NOT NULL;` The partial index keeps system events (NULL key) outside the constraint. |
| R-114 | `sendNotification` for drift is `void`-ed (fire-and-forget) — if the dispatcher throws, the alert is silently dropped | LOW | The dispatcher's `send()` is `async` + `try/catch` + audit-on-failure. The void return is documented; the drift package's `emitDriftAlert` only `void`s, never awaits, so the cron never blocks on notification. |

## Decision Matrix (locked — do NOT re-open)

| # | Decision | Value | Source |
|---|----------|-------|--------|
| 1 | Drift alert routing | DATA_STEWARD via `role_permissions(operator_id, permission_key)` table | Q1 + OI-1 B |
| 2 | Freshness thresholds | hard-code in `packages/freshness/src/thresholds.ts` as `DOMAIN_THRESHOLDS` | Q2 (default A) |
| 3 | Audit retention | indefinite, no purge job | Q3 (default A) |
| 4 | Lineage `entityId` | UUID generated at import, reused on re-imports | Q4 (default A) |
| 5 | Import UI | confirm-and-wait modal with 30s cancel (PR 8) | Q5 (default A) |
| 6 | DATA_STEWARD mechanism | `role_permissions(operator_id, permission_key)` table, `permission_key='data_steward'` | OI-1 B |
| 7 | Server-side cancel | TASK-060a: `DELETE /api/v1/import/trigger/:batchId` while `status='queued'` | OI-2 A |

## Next Step

Ready for `sdd-tasks`. The Review Workload Forecast shows chained PRs are strongly recommended (3 slices: 7b.1a → 7b.1b → 7b.2). The orchestrator should ask the user for the chain strategy and confirm the sub-slice boundaries before launching sdd-tasks.
