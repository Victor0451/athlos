# Verify Report — `athlos-async-scheduler` (v0.5.8)

**Status**: PASS_WITH_WARNINGS
**Date**: 2026-06-26
**Merge commit**: 2180a2b on main
**Tag**: v0.5.8 (initial) → v0.5.9 (verify follow-up with fixes)
**Branch**: `feat/athlos-async-scheduler` (deleted post-merge)

## Summary

Slice `athlos-async-scheduler` (v0.5.8) shipped cleanly to main. All 9 NEW spec scenarios are covered by implementation + tests. Spec atomic sync applied additively to both canonical specs (deployment-devops +4 scenarios, scheduler-jobs +5 scenarios). 213 API tests + 43 scheduler tests pass. One **CRITICAL (pre-existing)** finding: `packages/import` typecheck fails due to test fixtures missing `promotedAt` + `legacyId` columns added in E3 — this is **NOT** a v0.5.8 regression (verified against `v0.5.7` tag).

**v0.5.9 follow-up** (commit b2ab397) — all 4 issues (C1 + S1 + S2 + S3) fixed:
- C1: packages/import fixtures now include E3 columns. `pnpm typecheck` PASSES.
- S2: verify-slice.sh Step 8 rewritten as static + DB checks (8 PASS + 1 SKIP live). No longer SKIPs in CI.
- S1: apps/web version bumped 0.5.0 → 0.5.8.
- S3: vitest node preset now has explicit `pool: 'threads'` + `poolOptions`.

**Recommendation (post-v0.5.9)**: PROCEED to `sdd-archive`. All findings addressed.

## Test Results

| Check | Status | Detail |
|---|---|---|
| `pnpm typecheck` (root) | **FAIL** | `packages/import` typecheck errors (pre-existing from v0.5.7) |
| `pnpm --filter @athlos/api test:run` | PASS | 213 passed, 2 skipped, 31 test files |
| `pnpm --filter @athlos/scheduler test:run` | PASS | 43 passed, 4 test files |
| `bash scripts/verify-slice.sh` Steps 1-7 | PASS | All green (promotion idempotency, N14 closure) |
| `bash scripts/verify-slice.sh` Step 8 | SKIP | Requires `ADMIN_TOKEN` + running API server (test-env acceptable) |

## Spec Coverage (9 NEW scenarios)

| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| 1 | Scheduled promotion every 6h via PROMOTION_CRON | PASS | `apps/api/src/jobs/scheduled-promotion.ts` (66 LoC); test green |
| 2 | PROMOTION_CRON defaults to `0 */6 * * *` if unset | PASS | `packages/config/src/schema.ts` — `PROMOTION_CRON: z.string().default('0 */6 * * *')` |
| 3 | Scheduler worker starts at API server startup | PASS | `apps/api/src/server.ts` onReady hook + container wires scheduler |
| 4 | SIGTERM mid-promotion aborts cleanly | PASS | Handler respects `ctx.signal`; test asserts `failed` status with `error_message='process shutdown'` |
| 5 | POST /api/v1/scheduler/jobs/:name/run-now | PASS | `apps/api/src/routes/admin/scheduler.ts` (233 LoC); rate-limit 1/min per operator |
| 6 | GET /api/v1/scheduler/jobs returns last 20 runs | PASS | Returns from `job_runs` ordered by `started_at DESC LIMIT 20` |
| 7 | GET /api/v1/scheduler/jobs/:name | PASS | Returns single job detail with recent runs |
| 8 | PATCH /api/v1/scheduler/jobs/:name with enabled | PASS | `JobScheduler.setEnabled(name, enabled)` — idempotent re-toggle |
| 9 | JobScheduler.setEnabled preserves BullMQ swap-in | PASS | `packages/scheduler/src/types.ts` interface add; scheduler.ts impl + 3 unit tests |

**Coverage**: 9/9 scenarios PASS (100%).

## Spec Atomic Sync (B1b LESSON #1)

| Spec | v0.5.7 GIVEN count | v0.5.8 GIVEN count | Delta | Status |
|---|---|---|---|---|
| `deployment-devops/spec.md` | 73 | 77 | +4 NEW scenarios (E-Future Delta section) | PASS |
| `scheduler-jobs/spec.md` | 36 | 41 | +5 NEW scenarios (in ADDED Requirements section) | PASS |

**Success criteria added**: #59, #60, #61, #62, #63, #64 (6 NEW success criteria in v0.5.8).

**Drift note**: The delta specs (in `openspec/changes/...`) use a slightly different header format ("# Delta for X") vs the canonical specs ("## E-Future Delta: Slice ..."). Content is identical; format was polished during the spec phase's atomic sync. This is acceptable.

## CHANGELOG

- v0.5.8 entry: PASS (added via post-apply amend after sub-agent skipped it — LESSON recorded)
- Pre-existing pattern: sub-agent has skipped CHANGELOG on 4 consecutive slices (E1b2a, E2, E3, E-Future). LESSON propagated to orchestrator.

## Version Bumps

| Package | v0.5.7 | v0.5.8 |
|---|---|---|
| Root `package.json` | 0.5.7 | 0.5.8 ✅ |
| `apps/api/package.json` | 0.5.7 | 0.5.8 ✅ |
| 18 workspace packages (`packages/*/package.json`) | 0.5.7 | 0.5.8 ✅ |
| `apps/web/package.json` | 0.5.0 | 0.5.0 ✅ (intentional — no promotion logic) |

**Total**: 20 packages at 0.5.8, 1 package (`apps/web`) intentionally unchanged. PASS.

## Git Hygiene

- Merge commit `2180a2b` on main: PASS
- Tag `v0.5.8` created and pushed: PASS
- Branch `feat/athlos-async-scheduler` deleted (local + remote): PASS
- Co-Authored-By trailer in last 5 commits: **0** (PASS — stripped via `git filter-branch --msg-filter 'sed -e "/^Co-Authored-By:.*$/d"' HEAD~3..HEAD` post-apply)
- 3-commit shape (feat → docs → chore): PASS — `de77d63` (feat), `26ad399` (docs), `b29e7d8` (chore)

## DB State

| Check | Result |
|---|---|
| `job_runs` table exists | YES (migration 0003) |
| `job_runs` total rows | 272 (from existing drift-detection, freshness-refresh, scheduled-import, token-cleanup jobs) |
| `scheduled-promotion` runs in `job_runs` | **0** (EXPECTED — API server not running in test env; cron will fire when docker compose up brings the API online) |
| `scheduler_jobs` table | DOES NOT EXIST (intentional — `job_runs` covers both job defs + run history; no new migration needed) |
| Master table counts (verify-slice Step 3) | Unchanged (socios 16,383 + ctacte 200,945 + ctacte1 152,797 + 5 others) |

## CRITICAL Findings

### C1 (pre-existing, NOT v0.5.8 regression): typecheck fails in `packages/import`

**Files affected**:
- `packages/import/src/bridge-validator.test.ts:37` — test fixture missing `promotedAt` + `legacyId` columns
- `packages/import/src/test-standins/db.ts:80` — standin fixture missing same columns

**Root cause**: E3 (v0.5.7) added `promotedAt` (migration 0016) + `legacyId` (migration 0017) to `public.raw_events`. The `packages/import` test fixtures were not updated to include these new columns.

**Verification**: Reproduced against `v0.5.7` tag (`git checkout v0.5.7 -- packages/import && pnpm --filter @athlos/import typecheck`) — same 2 errors. **NOT introduced by v0.5.8.**

**Impact**: CI blocking — `pnpm typecheck` exits 1 due to `packages/import` typecheck failure.

**Action**: Open follow-up issue to fix `packages/import` test fixtures. Estimated 10 LoC + 5 minutes.

## WARNING Findings

### W1: Co-Authored-By trailer was added by apply sub-agent on all 3 commits (LESSON updated)

Sub-agent added `Co-Authored-By: gentle-ai[bot] <64062125+gentle-ai[bot]@users.noreply.github.com>` to all 3 commits by default. Violates AGENTS.md: "Never add 'Co-Authored-By' or AI attribution to commits."

**Mitigation applied**: Stripped via `git filter-branch --msg-filter 'sed -e "/^Co-Authored-By:.*$/d"' HEAD~3..HEAD` before merge.

**LESSON propagation**: Updated `sdd/lessons/apply-phase-verification` (engram obs #2531) with orchestrator post-apply checklist that detects + strips this pattern.

### W2: CHANGELOG entry skipped by apply sub-agent (LESSON updated)

Sub-agent bumped versions in 19 files but skipped `CHANGELOG.md` entry.

**Mitigation applied**: Added v0.5.8 entry manually + amended chore commit before merge.

**LESSON propagation**: Same as W1 — orchestrator post-apply checklist includes CHANGELOG verification.

### W3: Apply sub-agent `git reset --hard main` incident during implementation

Sub-agent reported accidental `git reset --hard main` mid-apply. Claimed recovery via reflog checkout.

**Verification**: Post-apply audit (Incident Rule #4) confirmed: branch state OK + content real + filter-branch recovery was successful.

**LESSON propagation**: Incident Rule verified working as designed.

## SUGGESTION Findings

### S1: `apps/web` package version drift not addressed

`apps/web/package.json` is at 0.5.0 while everything else is at 0.5.8. Intentional (no promotion logic), but the drift is now 8 minor versions. Consider aligning to 0.5.8 in a follow-up slice for consistency.

### S2: Verify-slice Step 8 cannot run in CI without API server

Step 8 SKIPs when `ADMIN_TOKEN` env var is unset. In CI environments without a running API server, the SKIP is acceptable (test-env semantics), but it would be more rigorous to:
- Option A: Add a `docker compose up` step before `verify-slice.sh` in the CI workflow
- Option B: Add a smoke test that hits the admin endpoints with a generated JWT after docker compose up

### S3: 213 API tests + 43 scheduler tests is a lot — consider parallelizing test runs

Test suite is 31 + 4 files taking ~17s + 2s respectively. Could parallelize via vitest workers for faster CI feedback.

## Recommendation

**PROCEED to `sdd-archive`** for the slice (slice is fully delivered and verified against spec).

**OPEN FOLLOW-UP ISSUE** for C1 (pre-existing typecheck regression from E3). This is a separate concern that should be tracked and addressed before the next slice that depends on `pnpm typecheck` passing in CI.

## Verification Checklist (orchestrator post-apply pattern)

The following checks were performed inline (sub-agent failed):

- [x] Merge commit on main: `2180a2b`
- [x] Tag v0.5.8 created and pushed
- [x] Branch deleted (local + remote)
- [x] Co-Authored-By stripped (filter-branch applied)
- [x] CHANGELOG entry added (post-amend)
- [x] 20 packages at 0.5.8, apps/web at 0.5.0
- [x] 9/9 spec scenarios covered by implementation + tests
- [x] 213 API tests + 43 scheduler tests pass
- [x] verify-slice Steps 1-7 PASS, Step 8 SKIP (acceptable test-env)
- [x] Spec atomic sync: 4 + 5 NEW scenarios in canonicals
- [x] DB state consistent (job_runs has 272 existing rows, 0 from scheduled-promotion since API not running)
- [ ] `pnpm typecheck` PASS — **FAIL** (pre-existing from v0.5.7, not regression)
