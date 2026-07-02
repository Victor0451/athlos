# Proposal: athlos-async-scheduler

**Change**: `athlos-async-scheduler` (Slice E-Future)
**Phase**: propose
**Version bump**: v0.5.7 → v0.5.8 (MINOR — new feature)
**Author**: sdd-propose sub-agent
**Date**: 2026-06-26

## Intent

Wire `@athlos/scheduler` to automatically run `promoteAll(db)` on a cron (`PROMOTION_CRON`, default every 6h) and expose 3 admin endpoints (`POST /run-now`, `GET /jobs`, `PATCH /:name/enabled`) — so raw_events land in the master tables without manual operator intervention.

## Scope (concrete)

### New files (4)

| File | ~LoC | Purpose |
|------|----:|---------|
| `apps/api/src/jobs/scheduled-promotion.ts` | 35 | `makeScheduledPromotionHandler(db, container)` — wraps `promoteAll`, reads `promotionInFlight` flag, returns `{totals, durationMs, domains[]}` |
| `apps/api/src/routes/admin/scheduler.ts` | 70 | 3 endpoints: `POST /run-now` (admin), `GET /jobs` (list with last runs), `PATCH /:name/enabled` (toggle) |
| `apps/api/src/jobs/__tests__/scheduled-promotion.test.ts` | 50 | 3 handler test cases |
| `apps/api/src/routes/admin/__tests__/scheduler.test.ts` | 80 | 5 endpoint test cases (200/404/403 for each) |

### Modified files (14)

| File | ΔLoC | Change |
|------|----:|--------|
| `packages/scheduler/src/types.ts` | +5 | Add `setEnabled(name, enabled): void` to `JobScheduler` interface |
| `packages/scheduler/src/scheduler.ts` | +20 | Implement `setEnabled` on `InProcessScheduler` (idempotent, starts/stops node-cron task) |
| `packages/scheduler/src/scheduler.test.ts` | +25 | 3 NEW test cases for `setEnabled` |
| `packages/scheduler/src/index.ts` | +1 | Re-export `setEnabled` type |
| `packages/config/src/index.ts` | +1 | `PROMOTION_CRON: z.string().default('0 */6 * * *')` |
| `apps/api/src/jobs/register.ts` | +15 | Validate `PROMOTION_CRON` via `validateCronExpression`; register job with UTC timezone |
| `apps/api/src/jobs/index.ts` | +1 | Export `makeScheduledPromotionHandler` |
| `apps/api/src/server.ts` | +2 | Pass `container` to `buildScheduler` (so handler can read `promotionInFlight`) |
| `apps/api/src/routes/admin/jobs.ts` | -3 | Remove stale "Reserved for PR 7" comment (line 147) |
| `apps/api/src/routes/admin/index.ts` | +3 | Register the new `scheduler` admin routes module |
| `apps/api/src/container.ts` | 0 | (no change — `promotionInFlight` already exists at line 44) |
| `scripts/verify-slice.sh` | +30 | NEW Step 8: assert `scheduled-promotion` visible in `/admin/jobs/health`, endpoints return 200/403/404 |
| `openspec/specs/scheduler-jobs/spec.md` | +60 | APPEND 2 NEW requirements + 8 NEW scenarios (ADDITIVE ONLY — B1b LESSON #1) |
| `CHANGELOG.md` + 19 `package.json` | +20 | Release commit only (3-commit shape per B1b LESSON #2) |

### Out of scope (deferred to E5+)

- BullMQ migration (interface preserved via `setEnabled` swap-friendly contract)
- Web dashboard for run history (admin endpoints already expose same JSON)
- Per-domain parallel promotion (concurrency = 1 via `promotionInFlight`)
- Sub-minute cadence (6h matches import cadence)
- Multi-region job routing

## Approach

**1. Handler.** `makeScheduledPromotionHandler` is a 30-line wrapper around `promoteAll(db)`. It checks `container.promotionInFlight` first; if the sync `POST /api/v1/promote/trigger` is running, it throws `Error('promotion already in flight')` — the scheduler catches and retries per the existing 30s/120s/600s backoff. The handler returns `{ status: 'succeeded', metadata: { totals: {inserted, skipped, failed}, durationMs, domains: [...] } }`; metadata is persisted to `job_runs.metadata` and surfaced by `GET /admin/jobs/health`. This mirrors the drift-detection handler pattern (`apps/api/src/jobs/drift-detection.ts:13-39`).

**2. Registration.** `@athlos/config` gains `PROMOTION_CRON` (default `0 */6 * * *`). `register.ts` validates it via `validateCronExpression` (already in `scheduler/adapters/node-cron.ts`) and registers `scheduled-promotion` with **UTC timezone** (node-cron default — user-locked decision overriding exploration's Argentina recommendation). `buildScheduler(db, env, logger)` signature gains a `container` parameter so the handler can read the `promotionInFlight` flag.

**3. Admin endpoints (new route file).** Three ADMIN-gated routes in `routes/admin/scheduler.ts`:
- `POST /api/v1/admin/scheduler/run-now` body `{jobName}` → calls `scheduler.runNow(name)` → returns `{jobRunId, status}`; emits 1 `audit_events` row with `action: 'PROMOTE_TRIGGER'` (matches E2 sync trigger pattern).
- `GET /api/v1/admin/scheduler/jobs` → returns last 20 rows from `job_runs` joined with `JobDefinition[]` → DTO includes `jobName, status, startedAt, finishedAt, durationMs, totals`.
- `PATCH /api/v1/admin/scheduler/jobs/:jobName/enabled` body `{enabled: boolean}` → calls `scheduler.setEnabled(name, enabled)` → emits `PROMOTE_TRIGGER` audit row with `metadata.enabled`.

All endpoints reuse `requireRole('ADMIN')` (already in `@athlos/auth`).

**4. Interface change.** `JobScheduler.setEnabled(jobName: string, enabled: boolean): void` is added in `packages/scheduler/src/types.ts:92-126`. Implementation in `scheduler.ts` is idempotent: if `enabled: true` and the node-cron task is null, re-create it; if `enabled: false`, stop the existing task but leave `runNow()` callable. The BullMQ adapter (E5+) maps this to a queue enable/disable flag — minimal swap impact.

**5. Spec delta.** B1b LESSON #1 — APPEND only. 2 NEW requirements (`Async Promotion Job`, `Job Admin Endpoints`) with 8 NEW scenarios. No existing requirements are modified.

## Spec impact (sdd-spec next phase)

### `openspec/specs/scheduler-jobs/spec.md` (MODIFIED — append only)

**NEW Requirement: Async Promotion Job** — scheduler MUST register `scheduled-promotion` running `promoteAll(db)` per `PROMOTION_CRON`, reusing `promotionInFlight`. Scenarios:
1. Scheduled cron fires → `job_runs` row with `triggered_by='scheduler'`
2. Manual `POST /run-now` → `triggered_by='manual'`, returns `{jobRunId}` immediately
3. Sync trigger in flight → scheduled tick throws + retries
4. `PATCH /enabled false` halts cron; `true` re-creates node-cron task
5. Dead-letter run retried via `POST /run-now` (new `attempt=1` row)

**NEW Requirement: Job Admin Endpoints** — 3 ADMIN routes. Scenarios:
1. `POST /run-now` returns 200 `{jobRunId, status}` + audit `PROMOTE_TRIGGER`
2. `POST /run-now` unknown job → 404 `JOB_NOT_FOUND`
3. `GET /jobs` returns last 20 runs (status, duration, totals)
4. `PATCH /enabled` 200 with updated definition
5. Non-ADMIN → 403; unauthenticated → 401

### `openspec/specs/deployment-devops/spec.md` (MODIFIED — append only)

**Existing Requirement: Promotion Pipeline** — add 1 NEW scenario: `pnpm db:promote` runs automatically every 6h via `PROMOTION_CRON` env var (in addition to CLI + sync admin trigger). No existing scenarios modified.

## Capabilities

### Modified Capabilities
- `scheduler-jobs`: NEW requirements for async promotion + admin endpoints (delta spec)
- `deployment-devops`: NEW scenario in Promotion Pipeline for scheduled trigger (delta spec)

### New Capabilities
- None (no new capability directories needed)

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | `promotionInFlight` is process-local — 2 API instances overlap | Document single-instance in runbook; E5+ BullMQ replaces with Postgres advisory lock |
| R2 | SIGTERM during 60-90s promotion exceeds 30s graceful window | Handler respects `ctx.signal` abort; verify-slice tests this |
| R3 | 6h cron → no-op runs when master fully populated | Handler returns totals; operator sees via `GET /jobs`; cron env-configurable |

## Dependencies

- `@athlos/scheduler` v0.5.7 ✅ (JobScheduler interface, InProcessScheduler, retry/dead-letter)
- `@athlos/promotion` v0.5.7 ✅ (`promoteAll(db)` pure)
- `@athlos/db` v0.5.7 ✅ (`job_runs` table, migration 0003)
- `@athlos/config` v0.5.7 ✅ (envSchema — add 1 line)
- `@athlos/audit` v0.5.7 ✅ (`emitAudit`)
- `@athlos/auth` v0.5.7 ✅ (`requireRole('ADMIN')`)
- E3 N14 closure ✅ (62.3% promotion rate — safe to re-run)

**No new npm packages. Zero migrations.**

## LoC budget

- **Raw LoC**: ~395 (target ≤ 400) ✓
- **Effective LoC**: ~250 (excludes tests + migrations + 19 package.json bumps)
- **Files**: 4 new + 14 modified

## Rollback plan

1. `git revert` the feat commit (drops new handler + admin routes + interface change)
2. Stop the API; `job_runs` rows from this slice are harmless (`triggered_by` distinguishes)
3. The doc commit and release commit are non-code — no rollback needed

Reverts cleanly: scheduler v0.5.7 still works without `setEnabled` (interface addition is forward-only). Re-running `pnpm db:promote` (CLI) restores the manual workflow.

## Success criteria

- [ ] `PROMOTION_CRON=0 */6 * * *` set → `pnpm db:promote` runs automatically every 6h (verified via `job_runs` row)
- [ ] `POST /api/v1/admin/scheduler/run-now {jobName:"scheduled-promotion"}` returns 200 with `{jobRunId, status}`
- [ ] `GET /api/v1/admin/scheduler/jobs` returns last 20 runs from `job_runs`
- [ ] `PATCH /api/v1/admin/scheduler/jobs/scheduled-promotion/enabled {enabled:false}` stops future cron runs; in-flight jobs complete
- [ ] `verify-slice.sh` Step 8 exits 0: cron visible in `/admin/jobs/health`, endpoints 200/403/404, audit row emitted
- [ ] Spec diff is ADDITIVE ONLY — no existing requirements modified