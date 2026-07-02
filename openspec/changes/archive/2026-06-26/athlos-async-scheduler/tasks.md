# Tasks: athlos-async-scheduler (FINALIZED)

**Change**: `athlos-async-scheduler`
**Phase**: tasks (finalized by sdd-tasks executor)
**Version bump**: v0.5.7 → v0.5.8 (MINOR — new feature)
**Date**: 2026-06-26
**Artifact store**: both (engram + openspec)

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Raw LoC (new + modified) | ~395 |
| Effective LoC (excl. tests + migrations + bumps) | ~250 |
| New files | 4 |
| Modified files | 14 |
| Test cases | 16 |
| Chained PRs recommended | **NO** |
| 400-line budget risk | **LOW** (just under) |

```
Decision needed before apply: NO
Chained PRs recommended: NO
Chain strategy: pending
400-line budget risk: LOW
```

**Rationale**: Single PR under 400-line budget. 16 test cases fit naturally within TDD commits. No migration needed (verified in design phase). `packages/scheduler` v0.5.7 already exists; no new package deps.

---

## Dependency Graph

```
TASK-001 (handler test signature)
  └─> TASK-002 (handler impl)

TASK-002 (handler impl)
TASK-003 (PROMOTION_CRON env var)
  └─> TASK-004 (wireup: register.ts + server.ts)

TASK-004 (scheduler.start)
  └─> TASK-005 (POST /run-now test)
  └─> TASK-007 (GET /jobs test)
  └─> TASK-009 (PATCH /:name/enabled test)

TASK-005 (POST /run-now test)
  └─> TASK-006 (POST /run-now impl)

TASK-007 (GET /jobs test)
  └─> TASK-008 (GET /jobs impl)

TASK-009 (PATCH /:name/enabled test)
  └─> TASK-011 (setEnabled interface — consumed by impl)
        └─> TASK-010 (PATCH /:name/enabled impl)

TASK-006, TASK-008, TASK-010
TASK-011 (setEnabled interface)
  └─> TASK-012 (verify-slice Step 8)
```

---

## Work Unit Commits (B1b LESSON #2 — 3 commits)

| Commit | Type | Tasks | Content |
|--------|------|-------|---------|
| Commit 1 | `feat` | TASK-001..TASK-012 | All code + tests + verify-slice Step 8 |
| Commit 2 | `docs` | TASK-013 | Atomic canonical spec sync (ADDITIVE-only deltas) |
| Commit 3 | `chore` | TASK-014 | 19× package.json bumps + CHANGELOG.md |

> Commit 2 and 3 are NOOPs at the tasks level — orchestrator handles them post-apply.
> "TASK-013" and "TASK-014" are orchestrator-managed commits, not executor tasks.

---

## Phase 1: Foundation (handler + config + wireup)

---

### TASK-001 [TDD-RED] — scheduled-promotion JobHandler signature

**File**: `apps/api/src/jobs/__tests__/scheduled-promotion.test.ts` (NEW)
**LoC**: ~50
**Dependencies**: none
**Commit**: 1 (feat)

**Action**:
1. Create `apps/api/src/jobs/__tests__/scheduled-promotion.test.ts` with 3 failing test cases:
   - Case 1: `makeScheduledPromotionHandler` happy-path → returns `{ status: 'succeeded', metadata: { totals, durationMs, domains } }`
   - Case 2: `container.promotionInFlight = true` → handler throws `Error('promotion already in flight')`
   - Case 3: `promoteAll(db)` throws → handler propagates error
2. Import `makeScheduledPromotionHandler` from `../scheduled-promotion` (won't compile — file doesn't exist yet)
3. Use `test-standins/db.ts` pattern from `packages/scheduler/src/test-standins/`

**Verification**: `pnpm --filter @athlos/api test:run scheduled-promotion.test.ts` — exits non-zero with clear test failures

**Rollback**: `git checkout apps/api/src/jobs/__tests__/scheduled-promotion.test.ts`

---

### TASK-002 [TDD-GREEN] — Implement scheduled-promotion Handler

**File**: `apps/api/src/jobs/scheduled-promotion.ts` (NEW, ~35 LoC)
**Also**: `apps/api/src/jobs/index.ts` (+1 LoC export)
**LoC**: ~36
**Dependencies**: TASK-001
**Commit**: 1 (feat)

**Action**:
1. Create `apps/api/src/jobs/scheduled-promotion.ts` with `makeScheduledPromotionHandler(db, container): JobHandler` factory
2. Mirror drift-detection handler pattern (`apps/api/src/jobs/drift-detection.ts:13-39`): check `container.promotionInFlight` → throw if true; else set flag → call `promoteAll(db)` → return `{ status: 'succeeded', metadata: { totals, durationMs, domains } }`
3. Export from `apps/api/src/jobs/index.ts`: `export { makeScheduledPromotionHandler } from './scheduled-promotion'`
4. Run `pnpm --filter @athlos/api test:run scheduled-promotion.test.ts` — all 3 cases pass

**Verification**: `pnpm --filter @athlos/api test:run scheduled-promotion.test.ts` exits zero; `pnpm --filter @athlos/api typecheck` passes

**Rollback**: `git checkout apps/api/src/jobs/`

---

### TASK-003 — Wire PROMOTION_CRON env var

**File**: `packages/config/src/schema.ts` (MODIFIED)
**LoC**: ~1
**Dependencies**: none
**Commit**: 1 (feat)

**Action**:
1. Add `PROMOTION_CRON: z.string().default('0 */6 * * *')` to `envSchema` in `packages/config/src/schema.ts`
2. Verify `validateCronExpression(env.PROMOTION_CRON)` passes at boot (already imported in `register.ts`)

**Verification**: `pnpm --filter @athlos/config typecheck` passes

**Rollback**: `git checkout packages/config/src/schema.ts`

---

### TASK-004 — Start scheduler worker in server.ts

**Files**: `apps/api/src/jobs/register.ts` (+15 LoC), `apps/api/src/server.ts` (+2 LoC)
**LoC**: ~17
**Dependencies**: TASK-002, TASK-003
**Commit**: 1 (feat)

**Action**:
1. In `apps/api/src/jobs/register.ts`: add `{ name: 'PROMOTION_CRON', expr: env.PROMOTION_CRON }` to `cronExprs` validation list (+1 LoC)
2. In `apps/api/src/jobs/register.ts`: after `scheduled-import` registration, add:
   ```ts
   scheduler.schedule(
     'scheduled-promotion',
     env.PROMOTION_CRON,
     makeScheduledPromotionHandler(db, container)
   )
   ```
   Timezone: UTC (node-cron default — do NOT pass `{timezone}` option)
3. In `apps/api/src/server.ts`: pass `container` to `buildScheduler({ db, env, logger, container })` (+2 LoC)
4. After `app.listen()`, call `app.scheduler.start()` to register all node-cron tasks

**Verification**: `pnpm --filter @athlos/api typecheck` passes; `pnpm --filter @athlos/api test:run` passes

**Rollback**: `git checkout apps/api/src/jobs/register.ts apps/api/src/server.ts`

---

## Phase 2: Admin Endpoints (3 routes + setEnabled interface)

---

### TASK-005 [TDD-RED] — POST /run-now test

**File**: `apps/api/src/routes/admin/__tests__/scheduler.test.ts` (NEW, part 1)
**LoC**: ~30
**Dependencies**: TASK-004
**Commit**: 1 (feat)

**Action**:
1. Create `apps/api/src/routes/admin/__tests__/scheduler.test.ts` — 5 failing cases:
   - ADMIN POST valid job → 200 with `{ jobRunId, status }` + `audit_events` row (`action: 'PROMOTE_TRIGGER'`)
   - POST unknown job → 404 `{ error: 'JOB_NOT_FOUND' }`
   - POST without ADMIN role → 403
   - 2nd POST within 60s from same operator → 429 with `Retry-After` header
   - POST without JWT → 401
2. Use `Fastify.inject()` with proper `Authorization: Bearer <token>` headers

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` — exits non-zero

**Rollback**: `git checkout apps/api/src/routes/admin/__tests__/scheduler.test.ts`

---

### TASK-006 [TDD-GREEN] — Implement POST /run-now endpoint

**File**: `apps/api/src/routes/admin/scheduler.ts` (NEW, ~25 LoC)
**LoC**: ~25
**Dependencies**: TASK-005
**Commit**: 1 (feat)

**Action**:
1. Create `apps/api/src/routes/admin/scheduler.ts` with `POST /:name/run-now` route
2. Apply `@fastify/rate-limit`: `keyGenerator: request.operator.sub`, `max: 1`, `timeWindow: '60 seconds'`
3. Call `server.scheduler.runNow(name)`; insert `audit_events` row with `action: 'PROMOTE_TRIGGER'`
4. Return `200 { jobRunId, status }`
5. Register route: `app.register(schedulerRoutes)` in `server.ts` after line 181

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` passes; `pnpm --filter @athlos/api typecheck` passes

**Rollback**: `git checkout apps/api/src/routes/admin/scheduler.ts apps/api/src/server.ts`

---

### TASK-007 [TDD-RED] — GET /jobs test

**File**: `apps/api/src/routes/admin/__tests__/scheduler.test.ts` (NEW, part 2)
**LoC**: ~20 (追加 to existing test file)
**Dependencies**: TASK-004
**Commit**: 1 (feat)

**Action**:
1. Add 3 failing cases to `scheduler.test.ts`:
   - ADMIN GET `/scheduler/jobs` → 200 with last 20 `job_runs` rows, ordered `started_at DESC`
   - Response DTO shape: `{ jobName, status, startedAt, finishedAt, durationMs, attempt, errorMessage?, totals? }`
   - Non-ADMIN → 403

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` — exits non-zero

**Rollback**: `git checkout apps/api/src/routes/admin/__tests__/scheduler.test.ts`

---

### TASK-008 [TDD-GREEN] — Implement GET /jobs endpoint

**File**: `apps/api/src/routes/admin/scheduler.ts` (追加 ~20 LoC)
**LoC**: ~20
**Dependencies**: TASK-007
**Commit**: 1 (feat)

**Action**:
1. Add `GET /` route in `scheduler.ts`
2. Query `job_runs` via `listRuns(container.db, { limit: 20 })` ordered by `started_at DESC`
3. Map rows to DTO shape

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` passes

**Rollback**: `git checkout apps/api/src/routes/admin/scheduler.ts`

---

### TASK-009 [TDD-RED] — PATCH /:name/enabled test

**File**: `apps/api/src/routes/admin/__tests__/scheduler.test.ts` (NEW, part 3)
**LoC**: ~30 (追加 to existing test file)
**Dependencies**: TASK-004
**Commit**: 1 (feat)

**Action**:
1. Add 4 failing cases to `scheduler.test.ts`:
   - ADMIN PATCH `{ enabled: false }` → 200 + `audit_events` row (`action: 'PROMOTE_TRIGGER'`, `metadata.enabled=false`)
   - PATCH unknown job → 404
   - PATCH missing `enabled` field → 400 (zod validation)
   - Non-ADMIN → 403

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` — exits non-zero

**Rollback**: `git checkout apps/api/src/routes/admin/__tests__/scheduler.test.ts`

---

### TASK-010 [TDD-GREEN] — Implement PATCH /:name/enabled endpoint

**File**: `apps/api/src/routes/admin/scheduler.ts` (追加 ~25 LoC)
**LoC**: ~25
**Dependencies**: TASK-009, TASK-011
**Commit**: 1 (feat)

**Action**:
1. Add `PATCH /:name` route in `scheduler.ts`
2. Validate body via `z.object({ enabled: z.boolean() })`
3. Call `server.scheduler.setEnabled(name, enabled)`
4. Emit 1 `audit_events` row with `action: 'PROMOTE_TRIGGER'` and `metadata.enabled`
5. Return 200 with updated job definition

**Verification**: `pnpm --filter @athlos/api test:run scheduler.test.ts` passes

**Rollback**: `git checkout apps/api/src/routes/admin/scheduler.ts`

---

### TASK-011 — Add JobScheduler.setEnabled() interface method

**Files**: `packages/scheduler/src/types.ts` (+5), `packages/scheduler/src/scheduler.ts` (+20), `packages/scheduler/src/scheduler.test.ts` (+25), `packages/scheduler/src/index.ts` (+1)
**LoC**: ~51
**Dependencies**: none (consumed by TASK-010)
**Commit**: 1 (feat)

**Action**:
1. In `types.ts`: add `setEnabled(name: string, enabled: boolean): void` to `JobScheduler` interface
2. In `scheduler.ts`: implement on `InProcessScheduler`:
   - Idempotent: if same state, no-op
   - `enabled: false` → stop node-cron task (`entry.task = null`)
   - `enabled: true` + no task → re-create via private `startTask(name, def)`
   - Unknown job → throw `Error('JOB_NOT_FOUND')`
3. In `scheduler.test.ts`: add 3 test cases:
   - Happy-path toggle: enabled→false→true
   - Unknown job throws
   - Idempotent re-toggle (false→false, true→true)
4. Re-export from `index.ts`

**Verification**: `pnpm --filter @athlos/scheduler test:run scheduler.test.ts` passes; `pnpm --filter @athlos/scheduler typecheck` passes

**Rollback**: `git checkout packages/scheduler/src/`

---

## Phase 3: Verification

---

### TASK-012 — verify-slice.sh Step 8

**File**: `scripts/verify-slice.sh` (追加 ~30 LoC)
**LoC**: ~30
**Dependencies**: TASK-004, TASK-006, TASK-008, TASK-010, TASK-011
**Commit**: 1 (feat)

**Action**:
1. Add Step 8 to `scripts/verify-slice.sh`:
   - `curl /api/v1/admin/jobs/health` → assert `scheduled-promotion` present with `scheduled: true`
   - `curl -X POST /api/v1/scheduler/jobs/scheduled-promotion/run-now` → assert 200 + `{ jobRunId, status }`
   - `curl /api/v1/scheduler/jobs/scheduled-promotion` → assert 200 + `lastRuns` array
   - `curl -X PATCH /api/v1/scheduler/jobs/scheduled-promotion -d '{ "enabled": false }'` → assert 200; `curl /admin/jobs/health` → `scheduled: false`
   - `curl -X PATCH /api/v1/scheduler/jobs/scheduled-promotion -d '{ "enabled": true }'` → assert 200; health shows `scheduled: true` again
   - Non-ADMIN operator → assert 403
   - Unknown job → assert 404

**Verification**: `bash scripts/verify-slice.sh` — Step 8 exits 0

**Rollback**: `git checkout scripts/verify-slice.sh`

---

## Phase 4: Orchestrator-Managed Commits (post-apply)

> These are NOT executor tasks. Documented here for completeness.

---

### TASK-013 — Atomic canonical spec sync [ORCHESTRATOR]

**Files**: `openspec/specs/deployment-devops/spec.md`, `openspec/specs/scheduler-jobs/spec.md`
**LoC**: ~115
**Dependencies**: TASK-012 (apply complete)
**Commit**: 2 (docs)

**Action** (orchestrator):
1. Diff `openspec/changes/athlos-async-scheduler/specs/deployment-devops/spec.md` → APPEND new requirements to canonical `openspec/specs/deployment-devops/spec.md`
2. Diff `openspec/changes/athlos-async-scheduler/specs/scheduler-jobs/spec.md` → APPEND new requirements to canonical `openspec/specs/scheduler-jobs/spec.md`
3. All changes are ADDITIVE-ONLY (B1b LESSON #1) — no existing requirements modified
4. Update runbook `docs/runbook.md`: mark N11 RESOLVED + add "Async Promotion" sub-section

**Verification**: `git diff openspec/specs/` shows only additive deltas

---

### TASK-014 — Release v0.5.8 [ORCHESTRATOR]

**Files**: root `package.json`, 19× `packages/*/package.json`, `CHANGELOG.md`
**LoC**: ~20
**Dependencies**: TASK-013
**Commit**: 3 (chore)

**Action** (orchestrator):
1. Bump all `packages/*/package.json` version from `0.5.7` → `0.5.8` (NOT `apps/web`)
2. Bump root `package.json` version from `0.5.7` → `0.5.8`
3. Add `CHANGELOG.md` entry for v0.5.8:
   ```md
   ## [0.5.8] — 2026-06-26
   ### Added
   - `@athlos/scheduler`: `JobScheduler.setEnabled(name, enabled)` interface method
   - `apps/api`: Scheduled async promotion job (`promoteAll`) running every 6h via `PROMOTION_CRON`
   - `apps/api`: 3 admin endpoints under `/api/v1/scheduler/jobs` (run-now, list, enable/disable)
   ```

**Verification**: `git diff --stat` shows exactly 20 files changed with version bumps only

---

## LoC Budget Summary

| Bucket | LoC |
|--------|----:|
| Handler + tests (TASK-001, TASK-002) | ~86 |
| Config + wireup (TASK-003, TASK-004) | ~18 |
| Admin endpoints + tests (TASK-005..TASK-010) | ~150 |
| setEnabled interface (TASK-011) | ~51 |
| verify-slice Step 8 (TASK-012) | ~30 |
| **Subtotal raw** | **~395** |
| Less: tests counted as raw | ~155 |
| **Effective (impl + config + interface)** | **~250** |

Under 400-line review budget (per session `review_budget_lines: 400`).

---

## Decision Flow

```
1. git checkout -b feat/athlos-async-scheduler
2. Apply Commit 1 (TASK-001..TASK-012):
   - pnpm --filter @athlos/api typecheck
   - pnpm --filter @athlos/api test:run
   - pnpm --filter @athlos/scheduler test:run
   - bash scripts/verify-slice.sh (Step 8 passes)
3. Apply Commit 2 (TASK-013): atomic canonical spec sync
4. Apply Commit 3 (TASK-014): version bumps + CHANGELOG
5. git push --force-with-lease
6. Open PR → review → merge
7. Orchestrator: sdd-archive
```

**Session LESSON (carry)**: Apply sub-agents do NOT merge/bump/tag. Orchestrator handles commits 2 and 3 after all tasks pass verification.

---

## Out-of-Scope (deferred E5+)

- BullMQ adapter (interface preserved via `setEnabled` swap-friendly contract)
- Web dashboard for run history
- Per-domain parallel promotion
- Sub-minute cadence
- Multi-region job routing

---

## Risks (inherited from design)

| # | Risk | Mitigation |
|---|------|------------|
| R1 | `promotionInFlight` is process-local — 2 instances overlap | Document single-instance in runbook; E5+ BullMQ |
| R2 | SIGTERM during 60-90s promotion exceeds 30s graceful window | Handler respects `ctx.signal`; verify-slice covers |
| R3 | 6h cron → no-op runs when master populated | Handler returns `totals`; visible via `GET /jobs` |
| R4 | `setEnabled` re-create race | Idempotent re-toggle test covers |
| R5 | Stale comment removal `admin/jobs.ts` | Tied to same feat commit |
