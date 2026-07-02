# Design: athlos-async-scheduler

**Change**: `athlos-async-scheduler` (E-Future, v0.5.7 → v0.5.8 MINOR) | **Phase**: design | **Date**: 2026-06-26 | **Scope**: 4b — wireup + 3 admin endpoints (~395 LoC raw, ~240 effective)

## Technical Approach

Wires `@athlos/scheduler` (shipped v0.5.7) to run `promoteAll(db)` on `PROMOTION_CRON` (default `0 */6 * * *`, **UTC** — node-cron default; user-locked). Handler reuses `container.promotionInFlight` so sync `POST /api/v1/promote/trigger` (E2) and scheduled tick never overlap. Adds 3 admin endpoints under `/api/v1/scheduler/jobs` for manual trigger / status / enable-disable. Adds `JobScheduler.setEnabled(name, enabled): void` to the interface — BullMQ E5+ implements same method, zero call-site change. **No DB migration**: `job_runs` (migration 0003) covers run history; in-memory `JobDefinition[]` is source of truth.

## Architecture Decisions

| # | Decision | Choice | Alt rejected | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Handler shape | `makeScheduledPromotionHandler(db, container): JobHandler` factory | inline in `register.ts`; pass container to all factories | Matches `makeDriftDetectionHandler(db)`; only promotion needs container |
| D2 | `enabled` persistence | In-memory only, reset at boot | new migration 0020 `scheduler_jobs` | Single instance (R1); `enabled:true` is `schedule()` default so restart self-heals |
| D3 | Admin route file | NEW `apps/api/src/routes/admin/scheduler.ts` | extend `admin/jobs.ts` | Keeps read-only views separate from mutating surface; drops stale "Reserved for PR 7" comment |
| D4 | `setEnabled` signature | sync `void`, no DB | async + persist; admin re-register | Mirrors `schedule()` (sync void); persistence adds no cross-instance value under R1 |
| D5 | Endpoint registration | `app.register(schedulerRoutes)` after line 181 in `server.ts` | new `admin/index.ts` barrel | Matches existing `adminJobsRoutes` pattern; no barrel exists today |

## Data Flow

```
BOOT  buildScheduler({db,env,logger,container}) → schedule('scheduled-promotion',PROMOTION_CRON,handler)
        → server.ts: app.decorate('scheduler') → index.ts: scheduler.start() after listen

EVERY 6h  node-cron → execute(def,'scheduler') → handler:
          if (container.promotionInFlight) throw → scheduler retries 30s/120s/600s → dead-letter @3
          else flag=true → promoteAll(db) → recordFinish('succeeded',metadata) → flag=false

ADMIN (requireRole('ADMIN'))
  POST   /scheduler/jobs/:name/run-now + rate-limit 1/min/operator → runNow(name) + audit
  GET    /scheduler/jobs               → listRuns(db,{limit:20})
  GET    /scheduler/jobs/:name         → list() + listRuns({jobName,limit:5}) + getJobHealth
  PATCH  /scheduler/jobs/:name {enabled} → zod → setEnabled(name,enabled) + audit
```

## File Changes

**NEW (4)**: `apps/api/src/jobs/scheduled-promotion.ts` (35 LoC handler factory), `apps/api/src/jobs/__tests__/scheduled-promotion.test.ts` (80 LoC, 3 cases), `apps/api/src/routes/admin/scheduler.ts` (100 LoC, 3 endpoints), `apps/api/src/routes/admin/__tests__/scheduler.test.ts` (150 LoC, 5 cases).

**MODIFIED (14, ~290 LoC)**: `packages/scheduler/{types,scheduler,scheduler.test,index}` (+105: `setEnabled` interface+impl+3 tests); `packages/config/src/schema.ts` (+1: `PROMOTION_CRON`); `apps/api/src/jobs/{register,index}.ts` (+21: wireup + re-export); `apps/api/src/server.ts` (+3: pass container + register routes); `apps/api/src/routes/admin/jobs.ts` (-3: drop stale comment); `scripts/verify-slice.sh` (+30: Step 8); `docker-entrypoint.sh` + `docker-compose.yml` + `.env.production.example` (+5: wire env var); `docs/runbook.md` (+20: N11 RESOLVED + Async Promotion section); `openspec/specs/{deployment-devops,scheduler-jobs}/spec.md` (+115: atomic sync, commit 2).

## Interfaces / Contracts

Only one NEW contract: `JobScheduler.setEnabled(jobName: string, enabled: boolean): void` — idempotent, throws on unknown name, `false` stops cron task (entry.task=null) while keeping `runNow` callable, `true` re-creates via private `startTask(name, def)`. No DB persistence (D2).

Handler signature: `makeScheduledPromotionHandler(db: Db, container: AppContainer): JobHandler` — reads/writes `container.promotionInFlight` (gate vs E2 sync trigger), returns `{status:'succeeded', metadata:{totals,durationMs,domains}}`, throws on error so scheduler applies existing 30s/120s/600s retry → dead-letter @ 3.

Endpoint contracts:
- `POST /api/v1/scheduler/jobs/:name/run-now` → `200{jobRunId,status}` | `404 JOB_NOT_FOUND` | `403` | `429` (rate-limit 1/min per `operator.sub`)
- `GET  /api/v1/scheduler/jobs` → `200{items:JobRunDTO[≤20]}`
- `GET  /api/v1/scheduler/jobs/:name` → `200{name,cronExpr,...,lastRuns[≤5]}` | `404`
- `PATCH /api/v1/scheduler/jobs/:name` body `{enabled:boolean}` → `200|400|404|403`

## Testing Strategy

| Layer | Cases | How |
|-------|------:|-----|
| Unit | 3 | handler — happy / `promotionInFlight` guard / error → vitest + scheduler standin DB + `vi.mock('@athlos/promotion')` |
| Unit | 3 | `setEnabled` — toggle / unknown throws / idempotent re-toggle → vitest; spy `startTask` |
| Integration | 5 | 3 endpoints + 401/403/429 → vitest + Fastify `.inject()` |
| E2E | 5 | `verify-slice.sh` Step 8: (a) health shows `scheduled-promotion` `scheduled:true`; (b) `POST .../run-now` → 200 + audit row; (c) `PATCH {enabled:false}` → 200, health `scheduled:false`; (d) `PATCH {enabled:true}` → re-creates task; (e) non-ADMIN 403, unknown job 404 |

**Total**: 16 cases (TASK-001..TASK-012). RED-GREEN-REFACTOR per task.

## Migration / Rollout

**No data migration.** `job_runs` (migration 0003) covers run history; `JobDefinition[]` (in-memory, rebuilt at boot) is source of truth.

**Rollout**: (1) merge feat commit (handler + endpoints + interface); (2) merge docs/spec sync (atomic append — additive only, B1b LESSON #1); (3) merge `chore(release): v0.5.8` (19 `package.json` + `CHANGELOG.md`); (4) `docker compose pull && up -d` (env-driven); (5) verify first scheduled tick lands a `job_runs` row within 6h (or `POST /run-now` for instant check).

**Rollback**: `git revert` feat. Scheduler v0.5.7 interface still works without `setEnabled` (additive; no existing callers).

## Open Questions

None. All 9 user-locked + 5 inherited decisions resolved (scope 4b, cadence `0 */6 * * *`, UTC, retry 30s/120s/600s, dead-letter, concurrency via `promotionInFlight`, in-process scheduler, audit `PROMOTE_TRIGGER`, `setEnabled` interface addition).

## Risks

- **R1** `promotionInFlight` process-local — 2 instances overlap → runbook single-instance note; E5+ BullMQ + Postgres advisory lock.
- **R2** SIGTERM during 60-90s promotion > 30s graceful → handler respects `ctx.signal`; verify-slice covers.
- **R3** 6h cron → no-op runs when master populated → handler returns `totals:{inserted:0}`; visible via `GET /jobs`.
- **R4** `setEnabled` re-create race between `task.stop()` and `startTask()` re-creation → idempotent re-toggle test; BullMQ E5+ avoids this.
- **R5** Stale comment removal `admin/jobs.ts:146-149` easy to regress → tied to new file's existence in same feat commit.