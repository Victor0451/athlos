# Apply Progress: athlos-operational-observability

## Status

Phase 1 / Work Unit 1 is complete. The prior dependency blocker was resolved with the restored frozen-lockfile install; no production, live, deployment, finance, or mutation access was used.

## Delivery

- Delivery strategy: `auto-chain`
- Chain strategy: `feature-branch-chain`
- Four slices: API safety, snapshot API, dashboard, and dynamic safe scheduler UI.
- Work Unit 1: completed on child branch `feat/operational-observability-01-api-safety` at commit `942a042`.
- Work Unit 1 source/test diff: 475 lines total: 327 additions and 148 deletions.
- Work Unit 1 size exception: maintainer-approved; it applies only to Work Unit 1. Later slices retain the 400-line budget.
- Integration branch: `feat/operational-observability`; it is the only branch that will ultimately target `main`.
- Current work unit: PR 2 — Snapshot API
- Completed Work Unit 1 boundary: shared safe scheduler-run projection, dynamic scheduler read contracts, and bounded attention query only.
- Out of scope: snapshot API, dashboard, and scheduler UI slices.

## Task Progress

- [x] 1.1 RED: projector behavior tests
- [x] 1.2 GREEN: shared safe scheduler-run projector and route adoption
- [x] 1.3 RED: bounded attention tests
- [x] 1.4 GREEN: bounded attention query and dynamic job reads
- [x] 1.5 REFACTOR/CHECK: focused verification

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `apps/api/src/routes/admin/scheduler-run-projector.test.ts` | Unit | N/A (new) | ✅ Import failed because projector did not exist | ✅ 9/9 passed | ✅ failure, process, attention, and non-attention cases | ➖ None needed |
| 1.2 | `apps/api/src/routes/admin/jobs.test.ts`, `apps/api/src/routes/admin/__tests__/scheduler.test.ts` | HTTP integration | ✅ 28/28 + 1 skipped | ✅ Route tests exposed absent projection | ✅ 38/38 + 1 skipped | ✅ raw failure and scheduler-list paths | ✅ Shared projector removed duplicate raw DTOs |
| 1.3 | `packages/scheduler/src/run-tracker.test.ts` | Unit | ✅ 14/14 | ✅ `listAttentionRuns` was undefined | ✅ 16/16 passed | ✅ four statuses, ordering, and cap | ➖ None needed |
| 1.4 | `packages/scheduler/src/run-tracker.test.ts` | Unit/HTTP integration | ✅ 14/14 | ✅ Covered by 1.3 query contract | ✅ 16/16 passed | ✅ bounded query and seven-value route filter | ✅ Exported safe query and updated standin SQL semantics |
| 1.5 | Focused Unit 1 suite | Unit/HTTP integration | N/A | N/A | ✅ API 38/38 + 1 skipped; scheduler 16/16; both typechecks passed | N/A | ✅ No fixed/raw DTO remains in modified admin routes |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command and exact result | `pnpm --filter @athlos/api exec vitest run src/routes/admin/scheduler-run-projector.test.ts src/routes/admin/jobs.test.ts src/routes/admin/__tests__/scheduler.test.ts` — exit 0, 3 files, 38 passed, 1 skipped. `pnpm --filter @athlos/scheduler exec vitest run src/run-tracker.test.ts` — exit 0, 1 file, 16 passed. |
| Runtime harness command/scenario and exact result | Fastify `app.inject` route contracts in the API focused suite — exit 0; verified ADMIN scheduler reads project failures and omit raw error content. N/A for external runtime: this work unit has no external boundary. |
| Rollback boundary | Revert the projector plus its adoption in `apps/api/src/routes/admin/{jobs,scheduler}.ts`; independently revert `listAttentionRuns` and its scheduler standin support. No unrelated behavior is removed. |

## Checks

- `pnpm --filter @athlos/api typecheck` — exit 0.
- `pnpm --filter @athlos/scheduler typecheck` — exit 0.
- `pnpm --filter @athlos/api test:run -- ...` is not suitable as a focused runner because its package script ignores forwarded paths and runs the full suite; it exposes pre-existing PostgreSQL credential failures. Focused Vitest commands above isolate this work unit.

## Remaining Work

Phase 2 tasks 2.1–2.5 remain pending. Work Unit 1 was completed and committed as `942a042` on `feat/operational-observability-01-api-safety`.
