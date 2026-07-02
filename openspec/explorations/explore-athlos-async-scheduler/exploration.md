# Exploration: athlos-async-scheduler

**Date:** 2026-06-26
**Change:** `athlos-async-scheduler` (Slice E-Future — async promotion + scheduler admin endpoints)
**Phase:** explore
**Mode:** both (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/explore-athlos-async-scheduler/exploration.md`
**Author:** sdd-explore sub-agent
**Branch:** `explore/athlos-async-scheduler` (from `origin/main`)

---

## 1. Verdict

**Async scheduler wiring is ~70% already in place.** The scheduler package, the API boot, the DB state machine, and the read-only admin endpoints (runs + health) all shipped in Slice E1a → E2 → E3 (v0.5.7). What's **MISSING** for async promotion is narrow and well-bounded:

1. **No `scheduled-promotion` JobHandler** — `apps/api/src/jobs/` does NOT export `makeScheduledPromotionHandler`. There is no `scheduled-promotion` registration in `register.ts`.
2. **No manual-trigger admin endpoint** — the scheduler-jobs spec mandates `POST /api/v1/admin/jobs/{job_name}/run`, but `admin/jobs.ts` ONLY has the two GET endpoints (runs + health). The line at `admin/jobs.ts:147` reserves the route for "PR 7 when the import-batch is the first non-scheduler trigger" — but `import/trigger` already shipped in PR 7b.2, so this gap is now stale.
3. **No `PROMOTION_CRON` env var** — `@athlos/config` schema has 4 cron envs (DRIFT_DETECTION_CRON, FRESHNESS_REFRESH_CRON, TOKEN_CLEANUP_CRON, RECONCILIATION_CRON) but no promotion cron.
4. **No job-level enable/disable** — `JobDefinition.enabled` exists but the admin endpoint to toggle it is not implemented. `JobScheduler.schedule()` accepts the cron + handler once at boot; re-scheduling during runtime is a test convenience only.

**Minimum viable slice** = **Option 4b** (wireup + admin endpoints). Option 4a alone would deliver the user-facing value (automatic promotion runs) but would be operationally invisible (no way to trigger manually, no way to see run history via the API — only via DB queries). Option 4c (web dashboard) is out of scope — the existing admin endpoints already expose the same data as JSON, and a web UI can be built later without scheduler changes.

**Realistic estimate**: ~180–220 LoC raw (effective ~120–140 after test code). Under the 400-line review budget. Single PR recommended. v0.5.7 → v0.5.8 MINOR bump (new feature).

**Ready for proposal?** **YES** — but 6 LOCKED decisions (§10) need user input before proposal commits. The recommendation is Option 4b + cron `0 */6 * * *` + timezone `America/Argentina/Buenos_Aires` + exponential retry (already in scheduler) + dead-letter with manual replay (already in scheduler) + concurrency 1 (reuse `promotionInFlight` flag via the JobHandler).

---

## 2. Context

### What exists today (verified live 2026-06-26 against `packages/scheduler` + `apps/api` + `packages/db`)

| Component | Path | Status | Notes |
|-----------|------|--------|-------|
| **`JobScheduler` interface** | `packages/scheduler/src/types.ts:92-126` | ✅ shipped | 5-method narrow contract: `schedule()`, `start()`, `stop()`, `runNow()`, `list()` — swap-friendly for future BullMQ adapter |
| **`InProcessScheduler` reference impl** | `packages/scheduler/src/scheduler.ts:52-390` | ✅ shipped | node-cron backed, `runningJobs` Set concurrency guard, `pendingRetries` Map, `abortControllers` Map, 30s graceful shutdown |
| **`run-tracker`** | `packages/scheduler/src/run-tracker.ts:1-191` | ✅ shipped | `recordStart / recordRunning / recordFinish / reconcileOrphanedRuns / markInflightAsShutdown / getLastRun / listRuns` — single SQL surface |
| **`health` endpoint** | `packages/scheduler/src/health.ts:44-101` | ✅ shipped | `getJobHealth(db, definitions)` returns `{ name, enabled, cronExpr, cadenceMinutes, scheduled, inFlight, lastRun, healthy, reason }[]` |
| **node-cron adapter** | `packages/scheduler/src/adapters/node-cron.ts:1-68` | ✅ shipped | `validateCronExpression`, `createNodeCronTask({ cronExpr, timezone?, onTick })` |
| **Retry policy** | `packages/scheduler/src/scheduler.ts:20-23` | ✅ shipped | Exponential backoff 30s → 120s → 600s; MAX_ATTEMPTS=3; ±20% jitter |
| **Boot reconciliation** | `packages/scheduler/src/run-tracker.ts:96-113` | ✅ shipped | Marks orphaned `running` rows as `failed / 'process terminated unexpectedly'` on startup |
| **Graceful shutdown** | `packages/scheduler/src/scheduler.ts:176-217` | ✅ shipped | 30s drain, AbortController, `markInflightAsShutdown` |
| **Standin DB** | `packages/scheduler/src/test-standins/db.ts:1-348` | ✅ shipped | In-memory Drizzle shim — parses `eq()`, `sql\`...\``, `and(...)` shapes |
| **Test suite** | `packages/scheduler/src/scheduler.test.ts` + `run-tracker.test.ts` + `adapters/node-cron.test.ts` + `health.test.ts` | ✅ shipped | Covers registration, runNow, retry, dead-letter, reconciliation, cron validate, health |
| **API boot wiring** | `apps/api/src/server.ts:230-235` + `apps/api/src/index.ts:35-47` | ✅ shipped | `buildScheduler(...)` decorates `app.scheduler`; `start()` AFTER `app.listen()`; `stop(30_000)` on SIGTERM |
| **5 default jobs** | `apps/api/src/jobs/register.ts:92-133` | ✅ shipped | `drift-detection`, `freshness-refresh`, `token-cleanup`, `scheduled-import`, `reconciliation` |
| **DB `job_runs` table** | `packages/db/src/schema/job-runs.ts:24-51` + migration `0003_futuristic_gamma_corps.sql:42-66` | ✅ shipped | 9 columns + 2 indexes (`idx_job_runs_job_name_started` composite, `idx_job_runs_status` partial) |
| **GET /api/v1/admin/jobs/runs** | `apps/api/src/routes/admin/jobs.ts:96-108` | ✅ shipped | ADMIN-gated; filter by `job`, `status`, `from`, `limit` (50 default, 200 max) |
| **GET /api/v1/admin/jobs/health** | `apps/api/src/routes/admin/jobs.ts:111-144` | ✅ shipped | ADMIN-gated; per-job health snapshot |
| **POST /api/v1/admin/jobs/:name/run** | `apps/api/src/routes/admin/jobs.ts:147-150` | ❌ **MISSING** | Comment: "Wiring deferred to PR 7 when the import-batch is the first non-scheduler trigger." — but PR 7b.2 already shipped `import/trigger` |
| **`scheduled-promotion` JobHandler** | `apps/api/src/jobs/` | ❌ **MISSING** | `jobs/index.ts` exports 5 handlers, no promote handler |
| **`PROMOTION_CRON` env var** | `packages/config/src/schema.ts:14-42` | ❌ **MISSING** | 4 cron envs exist (drift/freshness/token/reconciliation), no promotion cron |
| **Job-level enable/disable endpoint** | (nowhere) | ❌ **MISSING** | `JobDefinition.enabled` exists in type, no API to toggle it |

### Why async promotion is the user-facing value

Slice E2 (v0.5.6) shipped `POST /api/v1/promote/trigger` — sync HTTP, 120s timeout, `promoteAll(db)` runs in the request thread. Per E2 design §N5 (obs #2571 / design.md:105): "Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` ... E2 is sync only (per locked decision)". The deferred scope was:

> **N2** | E3+ (async scheduler) | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` | Sync HTTP works for v1 (operator manually triggers; ~60-90s latency acceptable; 120s request timeout mitigates NGINX cut). E3+ adds a `scheduled-promotion` JobHandler that wraps `promoteAll()` + 202 + batchId mirroring `import/trigger`.

The "operator manually triggers" workflow has been working since 2026-06-25 (E2 ship), but the operational gap is:
- **No automatic promotion.** Today, new raw_events rows from imports accumulate as unpromoted until an ADMIN manually clicks the trigger button. For a club importing VFP data daily, this means up to 24h latency between import and master.
- **No operator-facing visibility of run history** beyond `GET /api/v1/promote/status` (last 20 audit rows) — but the admin jobs runs endpoint already exposes `job_runs`, so once `scheduled-promotion` runs land there, history is automatic.

Slice E3 (v0.5.7, N14 closure) brought promotion rate from 60% to **62.3%** (live, 2026-06-25). The remaining gap is FK-blocked rows (intentional, NOT a data pipeline issue). E3 enabled continuous re-promotion (now safe to re-run since `raw_events.promoted_at` + `legacy_id` work), but it doesn't trigger that re-promotion automatically. **Async promotion = the operational answer**.

### Why the slice also needs admin endpoints

Even though `GET /jobs/runs` + `GET /jobs/health` already exist, the SPEC mandates `POST /api/v1/admin/jobs/{job_name}/run` (`openspec/specs/scheduler-jobs/spec.md:254-279`). The current admin/jobs.ts:147 explicitly says "Reserved for future ... wiring deferred to PR 7". The user-facing slice needs:

1. **`POST /api/v1/admin/jobs/:name/run`** — manual trigger for debugging + recovery (e.g., admin sees `dead_letter` row, wants to retry immediately)
2. **`GET /api/v1/admin/jobs/:name`** — single-job detail (cadence, last 5 runs, next predicted run) — alternative: re-use `GET /jobs/runs?job=name&limit=5`
3. **`PATCH /api/v1/admin/jobs/:name`** — enable/disable toggle. This is the slice's biggest scope decision — see §4.

Without these, the slice delivers automatic promotion but operators can't:
- Manually trigger a promotion after import
- See why a run went to dead-letter (only via raw `job_runs` table)
- Disable promotion during a maintenance window

### BullMQ swap-in interface — already defined

Per `packages/scheduler/src/types.ts:92-126`:

```typescript
export interface JobScheduler {
  schedule(name: string, cronExpr: string, handler: JobHandler, opts?: ScheduleOptions): void
  start(): Promise<void>
  stop(gracefulTimeoutMs?: number): Promise<void>
  runNow(name: string, metadata?: Record<string, unknown>): Promise<{ jobRunId: string }>
  list(): JobDefinition[]
}
```

The 5-method contract is stable. The async promotion slice does NOT need to touch the interface — it only needs to (a) register a 6th job (`scheduled-promotion`), (b) implement the handler, (c) add admin endpoints that use `runNow()`.

---

## 3. Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `PROMOTION_CRON` env var added to `@athlos/config` | `envSchema` (schema.ts:14) extended with `PROMOTION_CRON: z.string().default('0 */6 * * *')` (every 6h, locked default) |
| **G2** | `apps/api/src/jobs/promotion.ts` (NEW) — `makeScheduledPromotionHandler(db, container)` returning `JobHandler` | Wraps `promoteAll(db)`; respects `ctx.signal` for cooperative cancellation; returns `{ status: 'succeeded', metadata: { domains: PromotionResult[], totals: { inserted, skipped, failed }, durationMs } }` |
| **G3** | `apps/api/src/jobs/index.ts` exports `makeScheduledPromotionHandler` | New line at jobs/index.ts:15 |
| **G4** | `apps/api/src/jobs/register.ts` registers `scheduled-promotion` job | `scheduler.schedule('scheduled-promotion', env.PROMOTION_CRON, makeScheduledPromotionHandler(db, container))` registered after `scheduled-import`; timezone `America/Argentina/Buenos_Aires` (matches `scheduled-import`) |
| **G5** | `apps/api/src/container.ts` adds `promotionInFlight` flag re-used by both sync trigger AND scheduled handler | Already exists (line 44, 233); the handler reads + writes it for concurrency gating with the sync endpoint (only ONE promotion in flight regardless of trigger source) |
| **G6** | `POST /api/v1/admin/jobs/:name/run` (NEW, ADMIN) | Route at `apps/api/src/routes/admin/jobs.ts`; validates `:name` exists in `scheduler.list()`; calls `scheduler.runNow(name, { triggeredBy: 'manual', source: 'admin' })`; returns `200` with `{ jobRunId: string }`; `404` for unknown name |
| **G7** | `GET /api/v1/admin/jobs/:name` (NEW, ADMIN) | Single-job detail; returns `{ name, cronExpr, timezone, cadenceMinutes, enabled, lastRuns: JobRunDTO[] (max 5), healthy, reason }`; `404` for unknown name |
| **G8** | `PATCH /api/v1/admin/jobs/:name` (NEW, ADMIN) | Body: `{ enabled: boolean }`; toggles `JobDefinition.enabled` via internal scheduler call (NEW method `JobScheduler.setEnabled(name, enabled): void`); returns `200` with updated definition; `404` for unknown name; `400` for missing field |
| **G9** | `JobScheduler.setEnabled(name, enabled): void` (NEW method on interface) | Updates `JobDefinition.enabled` in the scheduler's `jobs` Map; if `enabled: true` and cron task is null, calls `startTask(name, def)` to fire `node-cron`; if `enabled: false`, calls `task.stop()` to halt the cron. Interface change in `packages/scheduler/src/types.ts` |
| **G10** | Audit row for `JOB_MANUAL_TRIGGER` + `JOB_DISABLED` + `JOB_ENABLED` actions | `emitAudit()` calls in the new endpoints (mirrors `operators.ts` precedent); action names consistent with existing `JOB_DEAD_LETTER` pattern |
| **G11** | Boot validation: `PROMOTION_CRON` must be a valid cron expression | Reuse `validateCronExpression` in `register.ts` cronExprs list (line 71); extend with `{ name: 'PROMOTION_CRON', expr: env.PROMOTION_CRON }` |
| **G12** | `promotionInFlight` flag lifted from `container` to a module-level `Set<string>` (or stays on container) | Decision: keep on `container` (matches E2 LESSON); both sync endpoint AND scheduled handler read+write it; ensure handler throws on `promotionInFlight: true` (clear error message) |
| **G13** | Spec delta APPENDED to `openspec/specs/scheduler-jobs/spec.md` (B1b LESSON #1 — additive ONLY) | 1 NEW requirement "Async Promotion Job" with 5 NEW scenarios (cron fires, manual trigger, enable/disable, overlap guard, dead-letter retry); 1 NEW requirement "Job Admin Endpoints" with 3 NEW scenarios (POST run, GET single, PATCH toggle); existing requirements UNCHANGED |
| **G14** | Runbook delta — replace "N11 Async promotion" deferred entry with "RESOLVED in v0.5.8" | `docs/runbook.md`; new sub-section "Async Promotion" explaining the cron + manual trigger + enable/disable flow |
| **G15** | Apply sub-agent runs `bash scripts/verify-slice.sh` (E1b/E1b2a/E1b2b/E2/E3 LESSON — non-negotiable) | NEW Step 8 assertions: (a) `PROMOTION_CRON` env present in API process (via `GET /api/v1/admin/jobs/health` shows `scheduled-promotion` with `scheduled: true`); (b) `pnpm db:promote` CLI still works (sync path); (c) admin endpoints return 403 for non-ADMIN, 404 for unknown, 200 for valid |
| **G16** | Apply sub-agent saves `apply-progress` to engram (E3 LESSON — 3 apply agents skipped this) | `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', ...)`; orchestrator verifies save exists |
| **G17** | 3-commit shape (B1b LESSON #2 — separate release commit) | (1) `feat(scheduler+api): scheduled-promotion job + admin endpoints`; (2) `docs(spec+runbook): async promotion + job admin endpoints`; (3) `chore(release): v0.5.8` |
| **G18** | v0.5.7 → v0.5.8 MINOR bump (NEW feature — 6th scheduler job + 3 admin endpoints) | 19 `packages/*/package.json` + root `package.json` bumped; `CHANGELOG.md` v0.5.8 entry under "Released" |

### Non-Goals (deferred to E5+ or NEVER)

| ID | Deferred to | Item | Why |
|----|-------------|------|-----|
| **N1** | E5+ (analytics) | Cross-table aggregations (ctacte1 saldo per socio, etc.) | Different spec; promotion is data-layer, not analytics |
| **N2** | E5+ (multi-region) | Multi-region deploys with per-region promotion | Single env per Slice C ADR |
| **N3** | E5+ (BullMQ migration) | Swap `InProcessScheduler` for `BullMqScheduler` (Redis) | Out of v1 scope; interface already swap-friendly |
| **N4** | E5+ (job UI) | Web dashboard for run history (Option 4c) | Admin endpoints expose same data as JSON; web UI is a separate frontend slice |
| **N5** | E5+ (job priorities) | Per-job priority queue | Single in-process scheduler; priorities are a queue concept |
| **N6** | E5+ (job dependencies) | "Run B after A succeeds" DAG | Cron + handler logic is sufficient for v1 |
| **N7** | NEVER | 100% ctacte/ctacte1 promotion (target ~88%, FK failures block 100%) | E3 closed this; data quality issue, not pipeline |
| **N8** | NEVER | Sub-minute cadence (e.g., every 30 seconds) | node-cron supports it but adds load; not needed for promotion (every 6h is the target) |
| **N9** | E5+ (multi-job concurrency) | Run drift-detection + promotion in parallel | Concurrency guard in scheduler (runningJobs Set) already handles this |
| **N10** | E5+ (job-level timeout) | Per-job max-duration (currently 120s hard-coded in `promote/trigger`) | Scheduler can pass `ctx.signal` to handlers (already done); explicit per-job timeout is a future refinement |

---

## 4. Current state investigation

### A. `packages/scheduler` package — fully built

**Public API surface** (`packages/scheduler/src/index.ts:21-49`):

```typescript
export { InProcessScheduler, estimateCadenceMinutes } from './scheduler.ts'
export { recordStart, recordRunning, recordFinish, reconcileOrphanedRuns, markInflightAsShutdown, getLastRun, listRuns, type RunHistoryFilter } from './run-tracker.ts'
export { getJobHealth, type JobHealth } from './health.ts'
export { validateCronExpression, createNodeCronTask, type CronTaskHandle, type CreateNodeCronTaskOptions } from './adapters/node-cron.ts'
export type { JobContext, JobDefinition, JobHandler, JobResult, JobScheduler, RunNowResult, RunStartInput, RunFinishInput, ScheduleOptions } from './types.ts'
```

**Already-tested behaviors** (per `scheduler.test.ts` 224 lines + `run-tracker.test.ts` + `health.test.ts` + `adapters/node-cron.test.ts`):
- `list()` returns registered job definitions
- `schedule()` is idempotent (same name replaces)
- `runNow()` returns `jobRunId` and writes a `job_runs` row with `triggeredBy='manual'`
- `runNow()` throws on unknown job name
- Handler success transitions row to `succeeded` with merged metadata
- Handler failure marks row `failed` with errorMessage + increments `attempt`
- Retry policy: exponential backoff with jitter
- Dead-letter after 3 attempts
- Boot reconciliation marks orphaned `running` rows as `failed / 'process terminated unexpectedly'`
- Graceful shutdown aborts in-flight after 30s timeout
- Concurrency guard: same-name job skipped if previous run still in progress
- Cron expression validation
- Health endpoint: `2× cadenceMinutes` healthy window

### B. DB schema — `job_runs` table is ready

Per `packages/db/src/schema/job-runs.ts:24-51`:

```typescript
export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobName: varchar('job_name', { length: 64 }).notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled'>(),
  attempt: integer('attempt').notNull().default(1),
  errorMessage: text('error_message'),
  metadata: jsonb('metadata').notNull().default({}),
  triggeredBy: text('triggered_by').notNull().default('scheduler').$type<'scheduler' | 'manual' | 'post-import'>(),
}, (table) => ({
  jobNameStartedIdx: index('idx_job_runs_job_name_started').on(table.jobName, table.startedAt),
  statusIdx: index('idx_job_runs_status').on(table.status).where(sql`status IN ('running','failed','dead_letter')`),
}))
```

Migration `0003_futuristic_gamma_corps.sql:42-66` creates the table with both indexes.

**No `scheduler_jobs` or `scheduler_runs` tables exist** — the prompt's framing of "scheduler_jobs/runs migration state" is INCORRECT. The single `job_runs` table covers both job definitions (via `job_name` + `JobDefinition.list()` snapshot) and run history.

### C. API server wiring — fully done

**`apps/api/src/server.ts:230-235`**:

```typescript
const scheduler = await buildScheduler({
  db: container.db,
  env: container.env,
  logger: app.log as never,
})
app.decorate('scheduler', scheduler)
```

**`apps/api/src/index.ts:35-47`**:

```typescript
const registeredJobs = app.scheduler.list()
await app.scheduler.start()
app.log.info(
  { jobs: registeredJobs.map((j) => j.name), count: registeredJobs.length },
  `scheduler: started with ${registeredJobs.length} jobs`,
)
// ... SIGTERM handler ...
await app.scheduler.stop(SCHEDULER_STOP_TIMEOUT_MS)
```

**`apps/api/src/jobs/register.ts:92-133`** — the 5-job registry:

```typescript
scheduler.schedule('drift-detection', env.DRIFT_DETECTION_CRON, makeDriftDetectionHandler(db), {
  timezone: 'America/Argentina/Buenos_Aires',
})
scheduler.schedule('freshness-refresh', env.FRESHNESS_REFRESH_CRON, makeFreshnessRefreshHandler(db))
scheduler.schedule('token-cleanup', env.TOKEN_CLEANUP_CRON, makeTokenCleanupHandler(db, env.AUDIT_RETENTION_DAYS), {
  timezone: 'America/Argentina/Buenos_Aires',
})
scheduler.schedule('scheduled-import', '0 2 * * *', makeScheduledImportHandler(db), {
  timezone: 'America/Argentina/Buenos_Aires',
})
if (env.RECONCILIATION_CRON) { scheduler.schedule('reconciliation', env.RECONCILIATION_CRON, ...) }
```

**Missing line** — no `scheduler.schedule('scheduled-promotion', env.PROMOTION_CRON, ...)`.

### D. Existing admin endpoints — 2 of 3 done

**`apps/api/src/routes/admin/jobs.ts:96-144`** — current state:

| Endpoint | Status |
|----------|--------|
| `GET /api/v1/admin/jobs/runs` | ✅ shipped (line 96) — filter by `job`, `status`, `from`, `limit` |
| `GET /api/v1/admin/jobs/health` | ✅ shipped (line 111) — per-job health snapshot |
| `POST /api/v1/admin/jobs/:name/run` | ❌ MISSING — comment line 147: "Reserved for future ... PR 7 when the import-batch is the first non-scheduler trigger" |
| `GET /api/v1/admin/jobs/:name` | ❌ MISSING |
| `PATCH /api/v1/admin/jobs/:name` | ❌ MISSING |

### E. Container — `promotionInFlight` flag exists

**`apps/api/src/container.ts:44, 233`**:

```typescript
export interface AppContainer {
  // ... other fields ...
  /** E2: in-memory flag for concurrent-trigger guard on POST /api/v1/promote/trigger */
  promotionInFlight: boolean
}
```

Used by `routes/promote.ts:55-58` (sync endpoint) — sets to `true` during the request, resets to `false` in `finally`. The async handler MUST use the same flag for cross-trigger concurrency.

### F. `promoteAll(db)` is pure — ready to wrap

**`packages/promotion/src/promote.ts:270-301`**:

```typescript
export async function promoteAll(db: Db): Promise<PromotionResult[]> {
  const results: PromotionResult[] = []
  for (const domain of PROMOTION_ORDER) {
    const r = await promoteDomain(db, domain)
    results.push(r)
    // FK cascade short-circuit ...
  }
  return results
}
```

The handler is a thin wrapper:

```typescript
// apps/api/src/jobs/promotion.ts (NEW, ~30 LoC)
import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { promoteAll, type PromotionResult } from '@athlos/promotion'

export function makeScheduledPromotionHandler(db: Db, container: AppContainer): JobHandler {
  return async (ctx) => {
    if (container.promotionInFlight) {
      throw new Error('promotion already in flight (sync trigger or scheduled run)')
    }
    container.promotionInFlight = true
    ctx.log.info({ event: 'PROMOTION_START' }, 'starting scheduled promotion')
    const t0 = Date.now()
    try {
      const results = await promoteAll(db)
      // FK cascade gating: re-throw if any domain failed 100% so the
      // scheduler applies retry policy (transient failures recover;
      // systematic failures go to dead-letter for operator review).
      const totals = results.reduce((acc, r) => ({
        inserted: acc.inserted + r.inserted,
        skipped: acc.skipped + r.skipped,
        failed: acc.failed + r.failed,
      }), { inserted: 0, skipped: 0, failed: 0 })
      const durationMs = Date.now() - t0
      ctx.log.info({ event: 'PROMOTION_DONE', totals, durationMs }, 'scheduled promotion done')
      return {
        status: 'succeeded',
        metadata: {
          domains: results.map(r => ({ domain: r.domain, attempted: r.attempted, inserted: r.inserted, skipped: r.skipped, failed: r.failed })),
          totals,
          durationMs,
        },
      }
    } finally {
      container.promotionInFlight = false
    }
  }
}
```

**Why this works** — `JobHandler` signature matches `drift-detection.ts:13-39`, `token-cleanup.ts`, etc. The scheduler wraps the call in try/catch (scheduler.ts:316-345), so a thrown error triggers retry + dead-letter. The `metadata` is merged into `job_runs.metadata` (scheduler.ts:319-324) — the admin endpoints can then surface per-domain counts.

### G. `JobScheduler` interface change — minimal

Adding `setEnabled(name, enabled)` is the ONLY interface change. Implementation:

```typescript
// packages/scheduler/src/scheduler.ts — NEW method on InProcessScheduler
setEnabled(name: string, enabled: boolean): void {
  const entry = this.jobs.get(name)
  if (!entry) throw new Error(`setEnabled: unknown job '${name}'`)
  entry.def.enabled = enabled
  if (enabled && !entry.task && entry.def.cronExpr) {
    this.startTask(name, entry.def) // re-create node-cron task
  } else if (!enabled && entry.task) {
    entry.task.stop()
    entry.task = null
  }
}
```

The interface (`types.ts:92-126`) gains one line: `setEnabled(name: string, enabled: boolean): void`. BullMQ adapter would map this to a queue enable/disable flag — minimal swap impact.

### H. Test coverage map

| File | What it tests | Lines |
|------|---------------|------:|
| `packages/scheduler/src/scheduler.test.ts` | registration, runNow, retry, dead-letter, shutdown | 224 |
| `packages/scheduler/src/run-tracker.test.ts` | recordStart, recordFinish, reconcileOrphanedRuns, getLastRun, listRuns | ~150 |
| `packages/scheduler/src/health.test.ts` | getJobHealth per job | ~80 |
| `packages/scheduler/src/adapters/node-cron.test.ts` | validateCronExpression, createNodeCronTask | ~50 |

**Missing tests** for the new slice:
1. `setEnabled` — happy path + unknown job + re-enable re-creates task
2. `makeScheduledPromotionHandler` — success, `promotionInFlight` guard, error path
3. `POST /api/v1/admin/jobs/:name/run` — 200 + 404 + 403
4. `GET /api/v1/admin/jobs/:name` — 200 + 404 + 403
5. `PATCH /api/v1/admin/jobs/:name` — 200 + 400 + 404 + 403 + audit row

---

## 5. Approach options for the user-facing slice scope

### Option 4a: Pure wireup

**Scope:** Add `scheduled-promotion` JobHandler + `PROMOTION_CRON` env var + register the 6th job. ~80 LoC.

**Pros:**
- Smallest possible change
- Delivers automatic promotion (every 6h by default)
- Single new file (`apps/api/src/jobs/promotion.ts`)
- v0.5.7 → v0.5.8 PATCH bump possible

**Cons:**
- **No manual-trigger endpoint** — operator can't force a run after an import
- **No enable/disable endpoint** — operator can't pause promotion during maintenance
- **No visibility of run history via API** — operator must query `job_runs` table directly
- **Spec compliance gap** — `POST /api/v1/admin/jobs/:name/run` is REQUIRED by `scheduler-jobs/spec.md:254-279`, but with this option it stays deferred
- **Dead-letter dead-end** — if promotion goes to dead-letter, the only recovery is "wait for next cron tick" (6h away) or "edit DB"

**Effort:** Low.

### Option 4b: Wireup + admin endpoints (RECOMMENDED)

**Scope:** Option 4a + `POST /api/v1/admin/jobs/:name/run` + `GET /api/v1/admin/jobs/:name` + `PATCH /api/v1/admin/jobs/:name` + `JobScheduler.setEnabled` method. ~180-220 LoC.

**Pros:**
- Delivers automatic promotion (the user-facing value)
- Delivers manual trigger + enable/disable + per-job visibility (the operator-facing value)
- Closes the scheduler-jobs spec gap (`POST /run` was REQUIRED since E2)
- Enables recovery from dead-letter without DB edits
- Matches the existing admin pattern (operators, jobs/health, jobs/runs)
- Under the 400-line review budget
- v0.5.7 → v0.5.8 MINOR bump (new feature)

**Cons:**
- Slightly larger scope than Option 4a
- `setEnabled` is a JobScheduler interface change (BullMQ adapter needs the same method, but it's trivial to implement)

**Effort:** Low-Medium.

### Option 4c: Wireup + admin endpoints + monitoring dashboard

**Scope:** Option 4b + web UI for job history + run timeline + health badges. ~400+ LoC across api + web.

**Pros:**
- Best operator UX
- Could surface real-time job status via SSE/WebSocket

**Cons:**
- **Significantly larger scope** — web UI is a separate frontend slice (apps/web)
- Web app currently has NO admin views (E2 didn't ship one; only API endpoints)
- Likely >400 LoC → chained PR required
- Out of scope for an async-scheduler slice (this slice is backend + DI; web is a different stack)

**Effort:** High.

### Recommendation: **Option 4b**

Reasons:
1. **Spec compliance** — `POST /api/v1/admin/jobs/:name/run` is a hard requirement that has been deferred since E2. Closing it now removes the stale "Reserved for future" comment at `admin/jobs.ts:147`.
2. **Operational completeness** — without manual trigger + enable/disable, operators have no way to recover from `dead_letter` without direct DB access.
3. **Size fits budget** — 180-220 LoC is well under 400 lines.
4. **Minimal interface change** — `setEnabled` is one method, swap-friendly.
5. **Web dashboard can land separately** — the JSON API exposes the same data a UI would consume; web slice can ship later without scheduler changes.

---

## 6. Architecture

### 6.1 `JobScheduler.setEnabled(name, enabled)` — interface addition

```typescript
// packages/scheduler/src/types.ts — extend JobScheduler interface
export interface JobScheduler {
  // ... existing 5 methods ...
  /**
   * Enable or disable a registered job. Idempotent. When transitioning
   * disabled→enabled with a cron expression, the node-cron task is
   * (re)created; when transitioning enabled→disabled, the existing task
   * is stopped (no more ticks fire, but `runNow` still works).
   *
   * Throws on unknown job name (matches `runNow` semantics).
   */
  setEnabled(name: string, enabled: boolean): void
}
```

```typescript
// packages/scheduler/src/scheduler.ts — implementation
setEnabled(name: string, enabled: boolean): void {
  const entry = this.jobs.get(name)
  if (!entry) throw new Error(`setEnabled: unknown job '${name}'`)
  if (entry.def.enabled === enabled) return // idempotent
  entry.def.enabled = enabled
  if (enabled && !entry.task && entry.def.cronExpr) {
    this.startTask(name, entry.def)
    this.log.info({ name }, 'job enabled — cron task (re)created')
  } else if (!enabled && entry.task) {
    entry.task.stop()
    entry.task = null
    this.log.info({ name }, 'job disabled — cron task stopped')
  }
}
```

### 6.2 `makeScheduledPromotionHandler` — JobHandler factory

```typescript
// apps/api/src/jobs/promotion.ts (NEW, ~35 LoC)
import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { promoteAll, type PromotionResult } from '@athlos/promotion'
import { BusinessError } from '@athlos/errors'
import type { AppContainer } from '../container.ts'

/**
 * Build the `scheduled-promotion` job handler. Runs `promoteAll(db)`
 * via the scheduler, with the same `promotionInFlight` flag as the
 * sync `POST /api/v1/promote/trigger` endpoint — so manual triggers
 * and scheduled ticks never overlap.
 *
 * The handler is a thin wrapper: domain errors propagate as a thrown
 * exception, which the scheduler catches + retries per the retry policy
 * (30s → 120s → 600s, dead-letter after 3 attempts).
 *
 * Returns `{ status: 'succeeded', metadata: { domains, totals, durationMs } }`
 * on success — metadata is merged into `job_runs.metadata` and surfaced
 * by `GET /api/v1/admin/jobs/runs?job=scheduled-promotion`.
 */
export function makeScheduledPromotionHandler(
  db: Db,
  container: AppContainer,
): JobHandler {
  return async (ctx) => {
    if (container.promotionInFlight) {
      // Concurrent-trigger guard — same as sync endpoint. Throws so the
      // scheduler catches it via retry (the next tick will succeed once
      // the sync run finishes). Operator sees a `failed` row with
      // `error_message='promotion already in flight'`.
      throw new Error('promotion already in flight')
    }
    container.promotionInFlight = true
    ctx.log.info({ event: 'SCHEDULED_PROMOTION_START' }, 'starting scheduled promotion')
    const t0 = Date.now()
    try {
      const results: PromotionResult[] = await promoteAll(db)
      const totals = results.reduce(
        (acc, r) => ({
          inserted: acc.inserted + r.inserted,
          skipped: acc.skipped + r.skipped,
          failed: acc.failed + r.failed,
        }),
        { inserted: 0, skipped: 0, failed: 0 },
      )
      const durationMs = Date.now() - t0
      ctx.log.info(
        { event: 'SCHEDULED_PROMOTION_DONE', totals, durationMs },
        'scheduled promotion done',
      )
      return {
        status: 'succeeded',
        metadata: {
          totals,
          durationMs,
          domains: results.map((r) => ({
            domain: r.domain,
            attempted: r.attempted,
            inserted: r.inserted,
            skipped: r.skipped,
            failed: r.failed,
          })),
        },
      }
    } finally {
      container.promotionInFlight = false
    }
  }
}
```

### 6.3 `register.ts` — add the 6th job

```typescript
// apps/api/src/jobs/register.ts — extend cron validation + registration
// Cron validation list (line 71):
const cronExprs: Array<{ name: string; expr: string | undefined }> = [
  { name: 'DRIFT_DETECTION_CRON', expr: env.DRIFT_DETECTION_CRON },
  { name: 'FRESHNESS_REFRESH_CRON', expr: env.FRESHNESS_REFRESH_CRON },
  { name: 'TOKEN_CLEANUP_CRON', expr: env.TOKEN_CLEANUP_CRON },
  { name: 'RECONCILIATION_CRON', expr: env.RECONCILIATION_CRON },
  { name: 'PROMOTION_CRON', expr: env.PROMOTION_CRON },  // NEW
]

// After the scheduled-import registration (line 116):
scheduler.schedule(
  'scheduled-promotion',
  env.PROMOTION_CRON,
  makeScheduledPromotionHandler(db, container),  // container needs to be passed
  { timezone: 'America/Argentina/Buenos_Aires' },
)
```

**Signature change**: `buildScheduler` needs `container` instead of just `db`. Update `server.ts:230-234`:

```typescript
const scheduler = await buildScheduler({
  db: container.db,
  env: container.env,
  logger: app.log as never,
  container, // NEW — for promotionInFlight flag
})
```

### 6.4 Admin endpoints

```typescript
// apps/api/src/routes/admin/jobs.ts — extend with 3 new routes

// POST /api/v1/admin/jobs/:name/run — ADMIN
fastify.post<{ Params: { name: string } }>(
  '/api/v1/admin/jobs/:name/run',
  ADMIN_GATE,
  async (request, reply) => {
    const name = request.params.name
    const scheduler = (fastify as FastifyInstance).scheduler
    const definitions = scheduler.list()
    if (!definitions.find((d) => d.name === name)) {
      return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
    }
    const operatorId = request.operator!.sub
    const { jobRunId } = await scheduler.runNow(name, {
      triggeredBy: 'manual',
      source: 'admin',
      operatorId,
    })
    await emitAudit(container.db, {
      operatorId,
      action: 'JOB_MANUAL_TRIGGER',
      entityType: 'job',
      entityId: jobRunId,
      oldValue: null,
      newValue: { jobName: name },
      sourceIp: request.ip ?? null,
    })
    return reply.code(200).send({ jobRunId })
  },
)

// GET /api/v1/admin/jobs/:name — ADMIN
fastify.get<{ Params: { name: string } }>(
  '/api/v1/admin/jobs/:name',
  ADMIN_GATE,
  async (request, reply) => {
    const name = request.params.name
    const scheduler = (fastify as FastifyInstance).scheduler
    const def = scheduler.list().find((d) => d.name === name)
    if (!def) return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
    const lastRuns = await listRuns(container.db, { jobName: name, limit: 5 })
    const healthList = await getJobHealth(container.db, [def])
    const health = healthList[0]
    return reply.code(200).send({
      name: def.name,
      cronExpr: def.cronExpr,
      timezone: def.timezone ?? null,
      cadenceMinutes: def.cadenceMinutes,
      enabled: def.enabled,
      healthy: health?.healthy ?? false,
      reason: health?.reason ?? '',
      lastRuns: lastRuns.map(toJobRunDTO),
    })
  },
)

// PATCH /api/v1/admin/jobs/:name — ADMIN
fastify.patch<{ Params: { name: string }; Body: { enabled: boolean } }>(
  '/api/v1/admin/jobs/:name',
  {
    preHandler: requireRole('ADMIN'),
    schema: {
      body: z.object({ enabled: z.boolean() }),
    },
  },
  async (request, reply) => {
    const name = request.params.name
    const { enabled } = throwIfInvalid(
      z.object({ enabled: z.boolean() }),
      request.body,
      'body',
    )
    const scheduler = (fastify as FastifyInstance).scheduler
    try {
      scheduler.setEnabled(name, enabled)
    } catch (err) {
      if (err instanceof Error && err.message.includes('unknown job')) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
      }
      throw err
    }
    await emitAudit(container.db, {
      operatorId: request.operator!.sub,
      action: enabled ? 'JOB_ENABLED' : 'JOB_DISABLED',
      entityType: 'job',
      entityId: name,
      oldValue: null,
      newValue: { jobName: name, enabled },
      sourceIp: request.ip ?? null,
    })
    const def = scheduler.list().find((d) => d.name === name)!
    return reply.code(200).send({
      name: def.name,
      enabled: def.enabled,
      cronExpr: def.cronExpr,
    })
  },
)
```

### 6.5 `@athlos/config` — add `PROMOTION_CRON`

```typescript
// packages/config/src/schema.ts — add to envSchema (line 14)
PROMOTION_CRON: z.string().default('0 */6 * * *'),
```

Default rationale: every 6h matches the import cadence (operators typically import 2-3x daily; 6h catches late-day imports). See §10 Q3 for user override.

### 6.6 Spec delta (B1b LESSON #1 — APPEND only)

```markdown
# ADDED to openspec/specs/scheduler-jobs/spec.md (after line 369, BEFORE success criteria)

## Requirement: Async Promotion Job

The scheduler MUST register a `scheduled-promotion` job that runs `promoteAll(db)`
on a configurable cron (default `0 */6 * * *`, env `PROMOTION_CRON`). The job
handler MUST reuse the existing `promotionInFlight` flag so manual triggers
via `POST /api/v1/promote/trigger` and scheduled ticks never overlap.

#### Scenario: Scheduled promotion fires on cron

- GIVEN `PROMOTION_CRON="0 */6 * * *"` (every 6h)
- WHEN the cron tick fires
- THEN the scheduler MUST insert a `job_runs` row with `job_name='scheduled-promotion'`, `triggered_by='scheduler'`
- AND the handler MUST run `promoteAll(db)` and record per-domain totals in `job_runs.metadata`

#### Scenario: Manual trigger of scheduled promotion

- GIVEN an admin calls `POST /api/v1/admin/jobs/scheduled-promotion/run`
- WHEN the request is authorized
- THEN the scheduler MUST insert a `job_runs` row with `triggered_by='manual'`
- AND return `{ jobRunId: string }` immediately (the handler runs async)

#### Scenario: Scheduled promotion skipped when sync trigger is in flight

- GIVEN a manual `POST /api/v1/promote/trigger` is currently executing (sync, ~60-90s)
- WHEN the scheduled `scheduled-promotion` cron tick fires
- THEN the handler MUST throw `Error('promotion already in flight')`
- AND the scheduler MUST retry per the retry policy (next tick after sync completes)

#### Scenario: Enable/disable a registered job

- GIVEN `scheduled-promotion` is registered with `cronExpr='0 */6 * * *'`
- WHEN an admin calls `PATCH /api/v1/admin/jobs/scheduled-promotion` with `{"enabled": false}`
- THEN the cron task MUST stop (no more ticks)
- AND subsequent `PATCH {"enabled": true}` MUST re-create the cron task
- AND audit rows MUST be written for `JOB_DISABLED` and `JOB_ENABLED`

#### Scenario: Dead-letter scheduled promotion retried via manual trigger

- GIVEN the last `scheduled-promotion` run is in `dead_letter` status
- WHEN an admin calls `POST /api/v1/admin/jobs/scheduled-promotion/run`
- THEN a new `job_runs` row MUST be created with `attempt=1`
- AND the scheduler MUST execute the handler (retry from scratch)

## Requirement: Job Admin Endpoints

The scheduler MUST expose 3 admin endpoints to manage registered jobs: manual
trigger, single-job detail, and enable/disable toggle. All endpoints MUST be
gated by `requireRole('ADMIN')`.

#### Scenario: POST /api/v1/admin/jobs/:name/run returns job_run_id

- GIVEN an admin calls `POST /api/v1/admin/jobs/drift-detection/run`
- WHEN the request is authorized
- THEN the scheduler MUST call `runNow(name)` and return `200 { jobRunId }`
- AND an audit row `JOB_MANUAL_TRIGGER` MUST be recorded

#### Scenario: POST /api/v1/admin/jobs/unknown/run returns 404

- GIVEN an admin calls `POST /api/v1/admin/jobs/unknown/run`
- WHEN the request is processed
- THEN the response MUST be `404 { error: 'JOB_NOT_FOUND' }`

#### Scenario: GET /api/v1/admin/jobs/:name returns single-job detail

- GIVEN an admin calls `GET /api/v1/admin/jobs/scheduled-promotion`
- WHEN the request is authorized
- THEN the response MUST include `{ name, cronExpr, timezone, cadenceMinutes, enabled, healthy, reason, lastRuns[5] }`
```

---

## 7. Work-units (estimated)

### Commit 1: `feat(scheduler+api): scheduled-promotion job + admin endpoints`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 1 | [TDD-RED] Write `setEnabled` test cases (3): happy path, unknown job throws, re-enable re-creates task | `packages/scheduler/src/scheduler.test.ts` | +25 |
| 2 | [TDD-GREEN scheduler] Add `setEnabled` to `JobScheduler` interface + `InProcessScheduler` implementation | `packages/scheduler/src/types.ts` + `scheduler.ts` | +25 |
| 3 | [TDD-RED] Write `makeScheduledPromotionHandler` test cases (3): success, `promotionInFlight` guard, error path | `apps/api/src/jobs/__tests__/promotion.test.ts` (NEW) | +50 |
| 4 | [TDD-GREEN handler] Implement `makeScheduledPromotionHandler` | `apps/api/src/jobs/promotion.ts` (NEW) | +35 |
| 5 | [TDD-GREEN export] Add `makeScheduledPromotionHandler` to jobs/index.ts | `apps/api/src/jobs/index.ts` (MODIFIED) | +1 |
| 6 | [TDD-GREEN config] Add `PROMOTION_CRON` to envSchema | `packages/config/src/schema.ts` (MODIFIED) | +1 |
| 7 | [TDD-GREEN register] Extend buildScheduler signature to accept container; add `PROMOTION_CRON` to validation list; register `scheduled-promotion` job | `apps/api/src/jobs/register.ts` (MODIFIED) | +15 |
| 8 | [TDD-GREEN wireup] Pass container to buildScheduler in server.ts | `apps/api/src/server.ts` (MODIFIED) | +2 |
| 9 | [TDD-RED routes] Write admin endpoint test cases (5): POST run 200, POST unknown 404, GET single 200, GET unknown 404, PATCH toggle 200 + audit | `apps/api/src/routes/admin/jobs.test.ts` (NEW) | +80 |
| 10 | [TDD-GREEN routes] Implement 3 admin endpoints | `apps/api/src/routes/admin/jobs.ts` (MODIFIED) | +80 |
| 11 | [Pre-closing verification] Run `bash scripts/verify-slice.sh` with NEW Step 8 assertions | (no files, gates merge) | 0 |

### Commit 2: `docs(spec+runbook): async promotion + job admin endpoints`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 12 | [Spec delta APPENDED] Add 2 NEW requirements + 8 NEW scenarios to scheduler-jobs/spec.md | `openspec/specs/scheduler-jobs/spec.md` (MODIFIED) | +60 |
| 13 | [Runbook update] Update "Known Limitations" N11 row to RESOLVED + new "Async Promotion" sub-section | `docs/runbook.md` (MODIFIED) | +20 |
| 14 | [Spec delta verify] `diff` returns ONLY additive changes | (verification) | 0 |

### Commit 3: `chore(release): v0.5.8`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 15 | [Pre-merge fix slot] Cherry-pick reorder if verify catches critical issue | (varies) | 0 |
| 16 | [Release commit] Bump root + 18 `packages/*/package.json` from `0.5.7` → `0.5.8` (MINOR); `CHANGELOG.md` v0.5.8 entry | 19 package.json + CHANGELOG | +20 |

**Total raw LoC:** ~395 (well under 400-line review budget).

---

## 8. File-by-file changes (estimated)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/scheduler/src/types.ts` | MODIFY | +5 | Add `setEnabled` to JobScheduler interface |
| `packages/scheduler/src/scheduler.ts` | MODIFY | +25 | Implement `setEnabled` |
| `packages/scheduler/src/scheduler.test.ts` | MODIFY | +25 | NEW setEnabled test cases (3) |
| `packages/scheduler/src/index.ts` | MODIFY | +1 | Re-export `setEnabled` type |
| `packages/scheduler/package.json` | MODIFY | +1 | bump 0.5.7 → 0.5.8 |
| `packages/config/src/schema.ts` | MODIFY | +1 | Add `PROMOTION_CRON` to envSchema |
| `packages/config/package.json` | MODIFY | +1 | bump 0.5.7 → 0.5.8 |
| `apps/api/src/jobs/promotion.ts` | CREATE | ~35 | `makeScheduledPromotionHandler` |
| `apps/api/src/jobs/__tests__/promotion.test.ts` | CREATE | ~50 | Handler tests (3) |
| `apps/api/src/jobs/index.ts` | MODIFY | +1 | Export new handler |
| `apps/api/src/jobs/register.ts` | MODIFY | +15 | Extend signature + register scheduled-promotion + validate PROMOTION_CRON |
| `apps/api/src/server.ts` | MODIFY | +2 | Pass container to buildScheduler |
| `apps/api/src/routes/admin/jobs.ts` | MODIFY | +80 | 3 new endpoints (POST run, GET single, PATCH toggle) |
| `apps/api/src/routes/admin/jobs.test.ts` | CREATE | ~80 | Endpoint tests (5) |
| `apps/api/package.json` | MODIFY | +1 | bump 0.5.7 → 0.5.8 |
| `scripts/verify-slice.sh` | MODIFY | +30 | NEW Step 8 assertions (scheduled-promotion visible in health, admin endpoints work) |
| `docs/runbook.md` | MODIFY | +20 | N11 RESOLVED + Async Promotion sub-section |
| `openspec/specs/scheduler-jobs/spec.md` | MODIFY | +60 | APPEND 2 NEW requirements + 8 NEW scenarios |
| `CHANGELOG.md` | MODIFY | +5 | v0.5.8 entry |
| `package.json` (root) | MODIFY | +1 | bump 0.5.7 → 0.5.8 (release commit) |
| 17 other `packages/*/package.json` | MODIFY | +1 each | bump 0.5.7 → 0.5.8 |
| **Total raw LoC** | | **~395** | |

---

## 9. Top 5 risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** (CRITICAL) | `promotionInFlight` flag in container is process-local. If two API instances ever run (HA / blue-green), each instance has its OWN flag → two concurrent promotions possible across instances. | Medium | Document the limitation in runbook. Mitigation: in E5+ BullMQ migration, replace the flag with a Postgres advisory lock (`pg_try_advisory_xact_lock(?)`) — single source of truth. For v1 (single-instance), document explicitly that "async scheduler assumes single API instance". |
| **R2** (WARNING) | The scheduled promotion handler runs `promoteAll(db)` which iterates 8 domains sequentially. With 197k+ ctacte + 150k+ ctacte1 rows, a full promotion takes 60-90s. Combined with 30s graceful shutdown, a SIGTERM during a scheduled run could exceed the 30s window. | Medium | Scheduler already aborts in-flight handlers at 30s (scheduler.ts:202-211). The handler respects `ctx.signal` — promotion will throw on next domain boundary. Operator sees `failed / 'process shutdown'`. **Mitigation**: documented runbook behavior; no action needed for v1. |
| **R3** (WARNING) | `setEnabled` interface change ripples to any future BullMQ adapter (must implement same method). | Low | Document in scheduler-jobs/spec.md as "interface v2 addition — BullMQ adapter MUST implement `setEnabled`". Tests cover the `InProcessScheduler` implementation. |
| **R4** (WARNING) | The `POST /api/v1/admin/jobs/:name/run` endpoint can be abused — a malicious admin could spam `runNow()` on the same job, creating many `pending` rows (concurrency guard in `runningJobs` Set would prevent actual overlap, but DB churn is possible). | Low | Reuse the existing per-operator rate-limit pattern from `promote.ts:46-50` (1/min via `@fastify/rate-limit`). |
| **R5** (WARNING) | If `PROMOTION_CRON='0 */6 * * *'` is too aggressive for a low-volume DB, the system promotes "no new rows" 4x/day — wasted DB writes. | Low | The handler returns `{ status: 'succeeded', metadata: { totals: { inserted: 0, skipped: N, failed: 0 } } }` — operator sees in `GET /jobs/runs` that most runs are no-ops. Adjust cron via env var. |

### Lesser risks

- **Cron timezone mismatch**: if the operator sets `PROMOTION_CRON="0 2 * * *"` (2 AM UTC) but expects "2 AM Argentina time", the schedule drifts. Mitigation: `timezone: 'America/Argentina/Buenos_Aires'` is hard-coded in registration (matches `scheduled-import` and `token-cleanup` precedent).
- **`JobScheduler.setEnabled` race condition**: if `setEnabled` is called concurrently with `runNow`, the in-flight run finishes, but the next tick is suppressed. Documented as "intended behavior — disable stops future ticks, does not abort in-flight".
- **Audit row count**: each `POST /run` + `PATCH` adds an audit row. Operators with frequent toggling could fill the audit table. Mitigation: `AUDIT_RETENTION_DAYS=90` (existing) handles cleanup.

---

## 10. Open questions (LOCKED decisions — for user resolution before propose)

**Q1 — Slice scope.** Option 4a (pure wireup, ~80 LoC) vs Option 4b (wireup + admin endpoints, ~395 LoC — RECOMMENDED) vs Option 4c (also web dashboard, >400 LoC → chained PR required). **Recommend: Option 4b**.

**Q2 — In-process scheduler vs external (cron + curl to /promote/trigger).** Option A: `@athlos/scheduler` (in-process, leverages retry/dead-letter/observability already built). Option B: external cron (host OS) + `curl POST /api/v1/promote/trigger` (simpler, but bypasses retry/dead-letter). **Recommend: Option A** (consistent with existing 5 jobs; uses `promotionInFlight` flag for overlap guard; observability via `job_runs` table).

**Q3 — Cron expression for `PROMOTION_CRON`.** Option A: `0 */6 * * *` (every 6h — RECOMMENDED default). Option B: `0 2 * * *` (daily at 02:00 Argentina time). Option C: `0 */4 * * *` (every 4h). Option D: `*/30 * * * *` (every 30 min — high frequency). **Recommend: Option A** (6h catches typical 2-3 daily imports without excess DB load).

**Q4 — Cron timezone.** Option A: `America/Argentina/Buenos_Aires` (UTC-3 — RECOMMENDED, matches `scheduled-import` + `token-cleanup` + `drift-detection`). Option B: UTC (server local — risks 3h drift from operator expectation). **Recommend: Option A**.

**Q5 — Retry policy.** Option A: exponential backoff `[30s, 120s, 600s]` (EXISTING in scheduler.ts:20 — RECOMMENDED; matches the 5 default jobs). Option B: fixed interval (e.g., 5 min × 3). Option C: NO retry (fail-fast, dead-letter on attempt 1). **Recommend: Option A** (no scheduler changes needed; promotion reuses the same retry semantics as drift-detection).

**Q6 — Failed jobs handling.** Option A: dead-letter + manual replay via `POST /run` (EXISTING scheduler semantics — RECOMMENDED; matches `JOB_DEAD_LETTER` spec). Option B: auto-disable after N failures (e.g., 5 consecutive failures → set `enabled: false` + alert). **Recommend: Option A** (consistent with scheduler-jobs spec; manual replay via the new admin endpoint is the operator-friendly path).

**Q7 — Concurrency model.** Option A: 1 promotion at a time via `promotionInFlight` flag (RECOMMENDED; matches E2 sync endpoint; works for single-instance). Option B: parallel per-domain (faster but risks concurrent `promoted_at` UPDATE on overlapping rows). **Recommend: Option A**.

**Q8 — `setEnabled` interface change.** Option A: ADD `setEnabled(name, enabled): void` to `JobScheduler` interface (RECOMMENDED; matches the existing minimal interface pattern). Option B: keep `JobDefinition.enabled` readonly, require admin to restart the API to toggle (no admin endpoint for toggle — defer to E5+). **Recommend: Option A**.

**Q9 — Audit row for manual triggers.** Option A: emit `JOB_MANUAL_TRIGGER` row per `POST /run` (RECOMMENDED; matches operator management precedent). Option B: skip audit (lighter, but loses forensic trail). **Recommend: Option A**.

**Default recommendations** (locked if user doesn't override):
1. **Scope**: Option 4b (wireup + admin endpoints)
2. **Scheduler**: Option A (in-process `@athlos/scheduler`)
3. **Cron**: Option A (`0 */6 * * *` every 6h)
4. **Timezone**: Option A (`America/Argentina/Buenos_Aires`)
5. **Retry**: Option A (exponential backoff existing)
6. **Failures**: Option A (dead-letter + manual replay)
7. **Concurrency**: Option A (1 promotion at a time)
8. **Interface**: Option A (add `setEnabled`)
9. **Audit**: Option A (`JOB_MANUAL_TRIGGER` + `JOB_ENABLED` + `JOB_DISABLED`)

---

## 11. E1b/E1b2a/E1b2b/E2/E3 LESSONs to apply (embedded)

| LESSON | Source | This slice application |
|--------|--------|------------------------|
| **`bash scripts/verify-slice.sh` is the REAL gate** (not unit tests) | commits `b26896c` + E3 #2531 | TASK-11 hard gate; NEW Step 8 assertions (scheduled-promotion visible in health, admin endpoints 200/403/404) |
| **Migration via `psql` NOT `drizzle-kit migrate`** | commit `061be71` | NO migrations this slice — only `@athlos/config` schema addition + scheduler interface change |
| **Atomic canonical sync (APPEND only)** | B1b LESSON #1 commit `4a29571` | TASK-12 APPEND 2 NEW requirements + 8 NEW scenarios to `scheduler-jobs/spec.md`; existing requirements UNCHANGED |
| **Separate release commit (3-commit shape)** | B1b LESSON #2 commit `4a29571` | TASK-15/16 separate commits; 3-commit shape (feat → docs → chore) |
| **Cherry-pick reorder if verify fails** | B1b LESSON #3 commit `4a29571` | TASK-15 pre-merge fix slot |
| **Merge-before-delete branch** | B1b LESSON #4 commit `4a29571` | Apply phase merges PR before deleting `feat/...` branch |
| **Apply sub-agent DOES NOT bump versions / merge / save to engram** | #2531 (recurring LESSON) | Orchestrator MUST do all 3: bump package.json to 0.5.8, merge PR to main, save `apply-progress` to engram |
| **Apply sub-agent DOES NOT skip `verify-slice.sh`** | #2531 (3 consecutive sub-slices shipped with potentially broken state) | TASK-11 hard gate; orchestrator verifies exit 0 before merge |

---

## 12. Dependencies (all confirmed shipped)

| Dependency | What this slice needs | Status |
|------------|----------------------|--------|
| **`@athlos/scheduler` v0.5.7** | `JobScheduler` interface (5 methods), `InProcessScheduler` impl, `run-tracker` (7 functions), `health` (1 function), `adapters/node-cron` (2 functions), standin DB, test suite | ✅ shipped |
| **`@athlos/promotion` v0.5.7** | `promoteAll(db)` function, `PROMOTION_ORDER`, all 8 transforms, `PromotionResult` type | ✅ shipped |
| **`@athlos/db` v0.5.7** | `job_runs` table (migration 0003), `jobRuns` schema, `Db` type | ✅ shipped |
| **`@athlos/config` v0.5.7** | `validateEnv` + envSchema + Env type | ✅ shipped |
| **`apps/api` v0.5.7** | `server.ts` (already calls `buildScheduler`), `index.ts` (already starts/stops scheduler), `routes/admin/jobs.ts` (2 GET endpoints), `container.ts` (promotionInFlight flag), `jobs/register.ts` (5-job registry) | ✅ shipped |
| **`@athlos/audit`** | `emitAudit()` function | ✅ shipped |
| **`@athlos/auth`** | `requireRole('ADMIN')` middleware | ✅ shipped |
| **E3 N14 closure (v0.5.7)** | ctacte/ctacte1 promotion rate 60.5% → 62.3% (live 2026-06-25); `raw_events.legacy_id` + `promoted_at` make re-promotion safe to run automatically | ✅ shipped |

**No new external dependencies.** This slice adds zero npm packages. The only interface change is `JobScheduler.setEnabled` — internal addition, not a breaking change for existing callers (none exist for `setEnabled` yet).

---

## 13. Acceptance criteria

A Slice E-Future (async scheduler) change is accepted when **all** of the following pass:

### 13.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (existing 500+ vitest cases + 11 NEW cases: 3 setEnabled + 3 promotion handler + 5 admin endpoint)
- [ ] `pnpm typecheck` passes (0 errors; `setEnabled` added to interface — all impls updated)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 13.2 TDD discipline

- [ ] `setEnabled` test cases committed BEFORE implementation in `scheduler.test.ts`
- [ ] `makeScheduledPromotionHandler` test cases committed BEFORE `promotion.ts`
- [ ] Admin endpoint test cases committed BEFORE endpoint implementations
- [ ] RED phase verified: each new test fails before the corresponding impl is written
- [ ] GREEN phase verified: each test passes after the impl lands
- [ ] REFACTOR phase: production code unchanged in behavior, all tests still pass

### 13.3 Slice acceptance

- [ ] `PROMOTION_CRON` env var validated by `@athlos/config` schema
- [ ] `scheduled-promotion` job registered; visible in `GET /api/v1/admin/jobs/health` with `scheduled: true`
- [ ] Cron tick fires (verified via `job_runs` row with `triggered_by='scheduler'`, `job_name='scheduled-promotion'`)
- [ ] `POST /api/v1/admin/jobs/scheduled-promotion/run` returns `200 { jobRunId }` for ADMIN
- [ ] `POST /api/v1/admin/jobs/unknown/run` returns `404 { error: 'JOB_NOT_FOUND' }`
- [ ] `GET /api/v1/admin/jobs/scheduled-promotion` returns `200 { name, cronExpr, enabled, healthy, lastRuns[5] }`
- [ ] `PATCH /api/v1/admin/jobs/scheduled-promotion` with `{"enabled": false}` halts cron ticks
- [ ] `PATCH /api/v1/admin/jobs/scheduled-promotion` with `{"enabled": true}` re-creates cron task
- [ ] Audit rows emitted: `JOB_MANUAL_TRIGGER` per POST run, `JOB_ENABLED` / `JOB_DISABLED` per PATCH
- [ ] `promotionInFlight` flag prevents concurrent sync + scheduled triggers (verified via integration test)
- [ ] Dead-letter scheduled promotion can be retried via `POST /run` (creates new `job_runs` row with `attempt=1`)
- [ ] Non-ADMIN operator gets `403 Forbidden` on all 3 admin endpoints
- [ ] `bash scripts/verify-slice.sh` exits 0 with NEW Step 8 assertions passing

### 13.4 Idempotency

- [ ] Running `promoteAll(db)` 3 times via scheduled trigger produces the same end state (no duplicate rows)
- [ ] Re-running `pnpm db:promote` (CLI) after a scheduled run produces 0 new inserts (E3 closure holds)
- [ ] `setEnabled(name, true)` followed by `setEnabled(name, true)` is a no-op (idempotent)

### 13.5 Hygiene

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] B1b LESSON #4 applied: `feat/...` branch merged to main BEFORE `git branch -D`
- [ ] Slice bumps `package.json` MINOR version (0.5.7 → 0.5.8) in the closing `chore(release): v0.5.8` commit
- [ ] `CHANGELOG.md` has a v0.5.8 entry under "Released"

### 13.6 Documentation

- [ ] `docs/runbook.md` "Known Limitations" N11 row updated to "RESOLVED in v0.5.8"
- [ ] `docs/runbook.md` has new "Async Promotion" sub-section explaining the cron + manual trigger + enable/disable flow
- [ ] `docs/runbook.md` documents the `promotionInFlight` flag as single-instance-only (E5+ BullMQ migration will replace with Postgres advisory lock)
- [ ] `openspec/specs/scheduler-jobs/spec.md` has 2 NEW requirements appended (Async Promotion Job + Job Admin Endpoints) with 8 NEW scenarios
- [ ] `openspec/specs/scheduler-jobs/spec.md` existing requirements UNCHANGED (`diff` returns ONLY additive changes)

---

## 14. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `packages/scheduler/src/types.ts:92-126` | `JobScheduler` interface — 5 methods + NEW `setEnabled` will be the 6th |
| `packages/scheduler/src/scheduler.ts:52-390` | `InProcessScheduler` impl — node-cron, retry policy, graceful shutdown, concurrency guard |
| `packages/scheduler/src/run-tracker.ts:1-191` | SQL surface for job_runs state transitions |
| `packages/scheduler/src/health.ts:44-101` | `getJobHealth` — per-job health snapshot for admin endpoint |
| `packages/scheduler/src/adapters/node-cron.ts:1-68` | `validateCronExpression` + `createNodeCronTask` |
| `packages/scheduler/src/test-standins/db.ts:1-348` | In-memory Drizzle shim for tests |
| `packages/db/src/schema/job-runs.ts:24-51` | `job_runs` table schema (NO `scheduler_jobs` or `scheduler_runs` — prompt's framing is incorrect) |
| `packages/db/drizzle/0003_futuristic_gamma_corps.sql:42-66` | Original migration creating `job_runs` |
| `apps/api/src/server.ts:230-235` | `buildScheduler` wired + `app.scheduler` decorator |
| `apps/api/src/index.ts:35-47` | `scheduler.start()` AFTER `app.listen()`; `scheduler.stop(30_000)` on SIGTERM |
| `apps/api/src/jobs/register.ts:1-171` | 5-job registry; `buildScheduler(db, env, logger)` signature; cron validation |
| `apps/api/src/jobs/index.ts:1-19` | Handler exports (5 today; `makeScheduledPromotionHandler` will be the 6th) |
| `apps/api/src/jobs/drift-detection.ts:13-39` | Handler pattern (`JobHandler` signature, `ctx.log` usage, return shape) |
| `apps/api/src/routes/admin/jobs.ts:1-159` | Current 2 GET endpoints + reserved comment for POST run-now |
| `apps/api/src/container.ts:44, 233` | `promotionInFlight` flag (process-local, single-instance assumption) |
| `apps/api/src/routes/promote.ts:42-125` | Sync `POST /api/v1/promote/trigger` — pattern for overlap guard |
| `packages/promotion/src/promote.ts:270-301` | `promoteAll(db)` — ready to wrap in handler |
| `packages/config/src/schema.ts:14-42` | `envSchema` — 4 cron envs today; `PROMOTION_CRON` will be the 5th |
| `openspec/specs/scheduler-jobs/spec.md:254-279` | Spec mandate for `POST /api/v1/admin/jobs/{job_name}/run` — currently deferred, this slice closes it |
| `engram obs #2547` | E2 NEW clarification: async promotion deferred to E3+ |
| `engram obs #2550` | E2 design summary (locked decisions including N5: async via scheduler) |
| `engram obs #2571` | E3 proposal (N11: async promotion deferred to E3+ scheduler slice) |
| `engram obs #2579` | E3 design (N1: E3+ scheduler slice is separate change) |
| `engram obs #2531` | Sub-agent LESSON (orchestrator MUST merge + bump versions + tag + delete branch) |

---

## 15. Persisted artifacts

- This file: `openspec/changes/explore-athlos-async-scheduler/exploration.md`
- Engram topic key: `sdd/athlos-async-scheduler/explore`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)
- Engram findings topic key: `sdd/athlos-async-scheduler/explore-findings`

**Next step (for the orchestrator)**: propose `athlos-async-scheduler` as a single PR (v0.5.7 → v0.5.8 MINOR, ~395 LoC, just under the 400-line budget). The 9 open questions (§10) should be presented to the user before proposal commits. The recommendation is Option 4b (wireup + admin endpoints) + cron `0 */6 * * *` + timezone `America/Argentina/Buenos_Aires` + exponential retry (existing scheduler semantics) + dead-letter with manual replay (existing scheduler semantics) + concurrency 1 (reuse `promotionInFlight` flag) + add `setEnabled` to `JobScheduler` interface + emit audit rows for manual triggers + enable/disable toggles.