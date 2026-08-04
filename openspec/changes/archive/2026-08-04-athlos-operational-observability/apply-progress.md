# Apply Progress: athlos-operational-observability

## Status

Phases 1–4 / Work Units 1–4 are complete. Work Unit 3 was committed as `473ea7f` (`feat(dashboard): consume operational snapshot`). Work Unit 4 was committed as `2a7a6e3` (`feat(scheduler): render dynamic safe job status`) on `feat/operational-observability-04-scheduler-ui`; PR #205 merged into the integration branch at `270f8d1`, and issue #204 is closed. Final SDD verification is next.

## Delivery

- Delivery strategy: `auto-chain`
- Chain strategy: `feature-branch-chain`
- Four slices: API safety, snapshot API, dashboard, and dynamic safe scheduler UI.
- PR 1 size exception: maintainer-approved at 475 changed lines for completed Work Unit 1 only.
- Work Unit 3 delivery: branch `feat/operational-observability-03-dashboard`, commit `473ea7f` (`feat(dashboard): consume operational snapshot`).
- Work Unit 3 source/test diff: 300 changed lines (212 additions, 88 deletions), within the 400-line budget.
- Work Unit 4 delivery: branch `feat/operational-observability-04-scheduler-ui`, commit `2a7a6e3` (`feat(scheduler): render dynamic safe job status`).
- Work Unit 4 source/test diff: 352 changed lines (207 additions, 145 deletions), within the 400-line budget.
- Work Unit 4 integration: PR #205 merged at `270f8d1`; issue #204 closed.
- PR boundary: one registry-backed ADMIN scheduler list query, projected run DTOs, and safe status/reason rendering on scheduler list/detail.
- Out of scope: dashboard and API/backend changes.

## Task Progress

- [x] 1.1 RED: projector behavior tests
- [x] 1.2 GREEN: shared safe scheduler-run projector and route adoption
- [x] 1.3 RED: bounded attention tests
- [x] 1.4 GREEN: bounded attention query and dynamic job reads
- [x] 1.5 REFACTOR/CHECK: focused verification
- [x] 2.1 RED: pin readiness 200/503 public bodies
- [x] 2.2 GREEN: extract and reuse `probeReadiness` without contract drift
- [x] 2.3 RED: snapshot authorization, isolation, registry, bound, camelCase, and leakage tests
- [x] 2.4 GREEN: operational snapshot service, ADMIN route, and server registration
- [x] 2.5 REFACTOR/CHECK: focused verification, typecheck, and formatting
- [x] 3.1 RED: snapshot query, polling, partial state, readiness, and attention-cap tests
- [x] 3.2 GREEN: typed snapshot client and one ADMIN dashboard query
- [x] 3.3 REFACTOR/CHECK: dashboard fan-out removal, scoped checks, and commit `473ea7f` on `feat/operational-observability-03-dashboard`
- [x] 4.1 RED: dynamic registry jobs, cancelled/review states, safe projected text, and OPERADOR suppression
- [x] 4.2 GREEN: projected scheduler DTOs, dynamic list query, and complete status rendering
- [x] 4.3 REFACTOR/CHECK: fixed six-job assumptions removed; scoped tests, web typecheck, Prettier, and diff check passed; commit `2a7a6e3` created on `feat/operational-observability-04-scheduler-ui` within the 400-line budget; PR #205 merged at `270f8d1` and issue #204 closed

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `apps/api/src/routes/admin/scheduler-run-projector.test.ts` | Unit | N/A (new) | ✅ Projector module missing | ✅ 9/9 passed | ✅ taxonomy, process codes, attention and non-attention | ➖ None needed |
| 1.2 | `apps/api/src/routes/admin/jobs.test.ts`, `apps/api/src/routes/admin/__tests__/scheduler.test.ts` | HTTP integration | ✅ 28/28 + 1 skipped | ✅ Route test exposed absent projection | ✅ 38/38 + 1 skipped | ✅ raw failure and scheduler paths | ✅ Shared projector removed duplicated DTOs |
| 1.3 | `packages/scheduler/src/run-tracker.test.ts` | Unit | ✅ 14/14 | ✅ `listAttentionRuns` undefined | ✅ 16/16 passed | ✅ statuses, ordering, cap | ➖ None needed |
| 1.4 | `packages/scheduler/src/run-tracker.test.ts` | Unit/HTTP integration | ✅ 14/14 | ✅ Covered by task 1.3 query contract | ✅ 16/16 passed | ✅ bounded query and closed status filter | ✅ Exported query and taught standin its SQL semantics |
| 1.5 | Focused Unit 1 suite | Unit/HTTP integration | N/A | N/A | ✅ API 38/38 + 1 skipped; scheduler 16/16; both typechecks passed | N/A | ✅ No fixed/raw DTO remains in modified routes |
| 2.1 | `apps/api/src/routes/health.test.ts` | HTTP integration | ✅ Existing health suite | ✅ Exact public 200/503 body assertions added before extraction | ✅ 11/11 passed after extraction | ✅ healthy, missing-relation, DB failure, timeout | ✅ Extracted probe preserves route mapping |
| 2.2 | `apps/api/src/routes/health.test.ts` | HTTP integration | ✅ 11/11 | ✅ Approval coverage from 2.1 | ✅ 11/11 passed | ✅ schema and DB outcomes retained | ✅ Shared `probeReadiness` removes duplicated probe logic |
| 2.3 | `apps/api/src/routes/admin/operations.test.ts` | Unit/HTTP integration | N/A (new) | ✅ Absent route returned 404 for ADMIN and OPERADOR | ✅ 3/3 passed | ✅ independent rejection, canonical unknown freshness, 11-to-10 cap, dynamic runtime registry | ✅ Formatting rerun green |
| 2.4 | `apps/api/src/routes/admin/operations.test.ts` | HTTP integration | ✅ 3/3 | ✅ Route contract from 2.3 | ✅ 3/3 passed | ✅ ADMIN 200 and OPERADOR 403 with no disclosure | ✅ Service owns allSettled envelopes; route owns transport/auth |
| 2.5 | Focused Unit 2 suite | Unit/HTTP integration | ✅ 14/14 | N/A | ✅ 14/14 and API typecheck passed | N/A | ✅ Prettier applied and reverified |
| 3.1 | `apps/web/src/app/(authed)/dashboard/page.test.tsx`, `apps/web/src/lib/api/operations.test.ts` | Component/API client | ✅ 6/6 dashboard baseline | ✅ Snapshot query assertion failed (0 calls); client module missing | ✅ 9/9 passed | ✅ mount/poll plus available/partial envelopes and 11-to-10 cap | ✅ Fake timer cleanup and legacy client documentation aligned |
| 3.2 | `apps/web/src/app/(authed)/dashboard/page.test.tsx`, `apps/web/src/lib/api/operations.test.ts` | Component/API client | ✅ 6/6 dashboard baseline | ✅ Absent client and dashboard fan-out failed new contracts | ✅ 9/9 passed | ✅ typed endpoint plus ADMIN data, non-ADMIN suppression, safe bounded attention | ✅ One `useQuery` owns all dashboard operational data |
| 3.3 | Focused Unit 3 suite | Component/API client | ✅ 9/9 | N/A | ✅ 9/9 and web typecheck passed | N/A | ✅ Scoped Prettier and diff checks passed |
| 4.1 | `apps/web/src/{app/(authed)/admin/scheduler/page.test.tsx,components/scheduler/{JobCard,RunList}.test.tsx}` | Component/API client | ✅ 54/54 focused baseline | ✅ Dynamic registry, cancelled/review labels, and projected-message tests failed against fixed/raw UI | ✅ 34/34 targeted tests passed | ✅ Runtime job plus cancelled/review safe-message cases | ✅ Shared exhaustive status mapper extracted |
| 4.2 | Same focused scheduler component/page tests | Component/API client | ✅ 54/54 focused baseline | ✅ Covered by task 4.1 contracts | ✅ 58/58 focused suite passed | ✅ All mapped status paths are closed in `SchedulerRunStatus` | ✅ One registry health query replaces fixed job queries; mutation detail controls preserved |
| 4.3 | Focused Unit 4 suite | Component/API client | ✅ 58/58 | N/A | ✅ 58/58 and web typecheck passed | N/A | ✅ Scoped Prettier and `git diff --check` passed; committed as `2a7a6e3` within the 400-line budget |

## Work Unit 1 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/api exec vitest run src/routes/admin/scheduler-run-projector.test.ts src/routes/admin/jobs.test.ts src/routes/admin/__tests__/scheduler.test.ts` — exit 0, 3 files, 38 passed, 1 skipped. `pnpm --filter @athlos/scheduler exec vitest run src/run-tracker.test.ts` — exit 0, 1 file, 16 passed. |
| Runtime harness command/scenario and exact result | Fastify `app.inject` route contracts in the API focused suite — exit 0; verified ADMIN scheduler reads project failures and omit raw error content. N/A for external runtime: this work unit has no external boundary. |
| Rollback boundary | Revert the projector plus its adoption in `apps/api/src/routes/admin/{jobs,scheduler}.ts`; independently revert `listAttentionRuns` and its scheduler standin support. No unrelated behavior is removed. |

## Work Unit 2 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/api exec vitest run src/routes/health.test.ts src/routes/admin/operations.test.ts` — exit 0, 2 files, 14 passed. |
| Runtime harness command/scenario and exact result | Fastify `app.inject` in `operations.test.ts` — exit 0; ADMIN receives the snapshot, OPERADOR receives 403 without signal disclosure, and a runtime-registered job is included. No external runtime harness was used because this work unit has no external boundary. |
| Rollback boundary | Revert `services/{readiness,operational-snapshot}.ts`, `routes/admin/operations.ts`, the `health.ts` delegation, and the `server.ts` registration; this removes Work Unit 2 without reverting Phase 1 safe projection/query behavior. |

## Work Unit 3 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/web exec vitest run 'src/lib/api/operations.test.ts' 'src/app/(authed)/dashboard/page.test.tsx'` — exit 0, 2 files, 9 passed. |
| Runtime harness command/scenario and exact result | React Testing Library with TanStack `QueryClientProvider` — exit 0; ADMIN calls one snapshot query on mount and at 30 seconds, independently renders partial envelopes, and caps 11 attention records at 10. No external runtime boundary exists because this is a mocked web client/API contract. |
| Rollback boundary | Revert `apps/web/src/lib/api/operations.{ts,test.ts}`, the dashboard page/test snapshot changes, and the health-client documentation update; this restores the prior dashboard fan-out without touching the snapshot API or scheduler UI. |

## Work Unit 4 Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/web exec vitest run 'src/components/scheduler/JobCard.test.tsx' 'src/components/scheduler/RunList.test.tsx' 'src/app/(authed)/admin/scheduler/page.test.tsx' 'src/app/(authed)/admin/scheduler/[name]/page.test.tsx' 'src/lib/api/scheduler.test.ts'` — exit 0, 5 files, 58 passed. |
| Runtime harness command/scenario and exact result | React Testing Library with `QueryClientProvider` — exit 0; ADMIN makes one registry-backed health query and renders a runtime job, OPERADOR renders the permission gate without a query, and list/detail components show projected reason messages for cancelled/review runs. No external runtime boundary exists because this is a mocked web client/API contract. |
| Rollback boundary | Revert `apps/web/src/lib/api/scheduler.ts`, `components/scheduler/{status,JobCard,RunList}.ts{x,}`, and the scheduler list page/tests; this restores the prior fixed list without touching API routes, dashboard, or mutation controls. |

## Checks

- Work Unit 1: `pnpm --filter @athlos/api typecheck` — exit 0.
- Work Unit 1: `pnpm --filter @athlos/scheduler typecheck` — exit 0.
- Work Unit 1: `pnpm --filter @athlos/api test:run -- ...` is not suitable as a focused runner because its package script ignores forwarded paths and runs the full suite; it exposes pre-existing PostgreSQL credential failures. Focused Vitest commands above isolate this work unit.
- `pnpm --filter @athlos/api exec vitest run src/routes/health.test.ts src/routes/admin/operations.test.ts` — exit 0, 14 passed.
- `pnpm --filter @athlos/api typecheck` — exit 0.
- `pnpm exec prettier --check` on all Unit 2 source/test files — exit 0.
- `git diff --check` — exit 0.
- Implementation source/test diff: 289 additions, 21 deletions, 310 changed lines; within the 400-line budget.
- Artifact-only bookkeeping: `openspec/changes/athlos-operational-observability/tasks.md` — 5 additions, 5 deletions, 10 changed lines; reported separately from implementation.
- `pnpm --filter @athlos/web exec vitest run 'src/lib/api/operations.test.ts' 'src/app/(authed)/dashboard/page.test.tsx'` — exit 0, 2 files, 9 passed.
- `pnpm --filter @athlos/web typecheck` — exit 0.
- `pnpm exec prettier --check` on Unit 3 source/test files — exit 0.
- Implementation source/test diff: 212 additions, 88 deletions, 300 changed lines; within the 400-line budget.
- Artifact-only bookkeeping: `openspec/changes/athlos-operational-observability/{tasks.md,apply-progress.md}` is reported separately from implementation.
- Work Unit 3 commit: `473ea7f` — `feat(dashboard): consume operational snapshot` on `feat/operational-observability-03-dashboard`.
- Work Unit 4: `pnpm --filter @athlos/web exec vitest run ...` — exit 0, 5 files, 58 passed.
- Work Unit 4: `pnpm --filter @athlos/web typecheck` — exit 0.
- Work Unit 4: `pnpm exec prettier --check` on 8 Unit 4 source/test files — exit 0.
- Work Unit 4: `git diff --check` — exit 0.
- Work Unit 4 implementation source/test diff: 207 additions, 145 deletions, 352 changed lines; within the 400-line chained-slice budget.
- Work Unit 4 commit: `2a7a6e3` — `feat(scheduler): render dynamic safe job status` on `feat/operational-observability-04-scheduler-ui`.
- Work Unit 4 integration: PR #205 merged into `feat/operational-observability` at `270f8d1`; issue #204 closed.

## Remaining Work

All 16 implementation tasks are complete. No migration was added and no external runtime harness was required. Final SDD verification is next.
