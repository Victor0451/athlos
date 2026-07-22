# Tasks: Padrones Enrollment Lifecycle

## Review Workload Forecast
| Field | Value |
|---|---|
| Estimated changed lines | 1,780–2,180; 170–350/child |
| Suggested split | schema → primitives → receipts → lifecycle → routes → create → status |
| Chained PRs recommended | Yes |
| 400-line budget risk | High |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |
| Recommended first autonomous slice | PR1 schema/migration |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Approved. Tracker `feat/padrones-inscription-lifecycle`: draft → `main`. PRs: `📍` + tracker/parent/next. Evidence: exact RED failure; GREEN/REFACTOR/runtime result or N/A.

| PR → target | Command; runtime/rollback |
|---|---|
| 1: `feat/padrones-schema` → tracker | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/db exec vitest run src/schema/deportes.test.ts`; PG; retain `0036`; forward corrections. |
| 2: `feat/padrones-idempotency` → `feat/padrones-schema` | `pnpm --filter @athlos/api exec vitest run src/lib/idempotency.test.ts src/modules/socios/forms/ctacte-comprobante.test.ts`; N/A pure helper; delete helper/tests, revert CTACTE delegation/test deltas. |
| 3: `feat/padrones-receipts` → `feat/padrones-idempotency` | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/padrones/inscription-lifecycle.postgres.integration.test.ts`; two-PG race/retry; remove `inscription-repository.ts`/test additions. |
| 4: `feat/padrones-lifecycle` → `feat/padrones-receipts` | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5563/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/padrones/inscription-lifecycle.postgres.integration.test.ts`; atomic PG; delete service, revert only emitter/test additions. |
| 5: `feat/padrones-routes` → `feat/padrones-lifecycle` | `pnpm --filter @athlos/api exec vitest run src/routes/padrones.test.ts`; `app.inject`; remove mutations in `apps/api/src/routes/padrones.ts`/`apps/api/src/test-standins/db.ts`. |
| 6: `feat/padrones-create-ui` → `feat/padrones-routes` | `pnpm --filter @athlos/web exec vitest run src/lib/api/padrones.test.ts src/components/padrones/InscriptionCreateModal.test.tsx 'src/app/(authed)/padrones/page.test.tsx'`; TL create; delete modal/test, revert create transport/page/test additions only. |
| 7: `feat/padrones-status-ui` → `feat/padrones-create-ui` | `pnpm --filter @athlos/web exec vitest run src/components/padrones/InscriptionStatusActions.test.tsx src/components/padrones/PadronRow.test.tsx 'src/app/(authed)/padrones/[id]/page.test.tsx'`; TL status; delete action/test, revert status transport/row/page/test additions only. |

## PR1
- [x] 1.1 **RED** CHECK/normalize/unknown-abort/baja-backfill/log-redaction.
- [x] 1.2 **GREEN** `packages/db/src/schema/deportes.ts`, `packages/db/drizzle/0036_*.sql`: metadata/receipts/checks/backfill.
- [x] 1.3 **REFACTOR** Deduplicate fixtures.

## PR2
- [x] 2.1 **RED** Key bounds; SHA-256 `command|endpoint|payload` isolation.
- [x] 2.2 **GREEN** `apps/api/src/lib/idempotency.ts`; CTACTE delegates unchanged.
- [x] 2.3 **REFACTOR** Deduplicate serializer.

## PR3
- [ ] 3.1 **RED** Claim/rollback; `FOR UPDATE` visibility/replay/conflict/races.
- [ ] 3.2 **GREEN** Receipt engine: `apps/api/src/modules/padrones/inscription-repository.ts`.
- [ ] 3.3 **REFACTOR** Extract retry policy.

## PR4
- [ ] 4.1 **RED** Exactly-one audit on change; zero on failure/denial/replay/no-op; stale expected ignored at target, else CAS `409`/zero effects.
- [ ] 4.2 **GREEN** Service+emitter: actor/sourceIP/key/entity/before/after/identity; outcome/action/entity-ID logs exclude reason/key.
- [ ] 4.3 **REFACTOR** Deduplicate builders.

## PR5
- [ ] 5.1 **RED** DTO/key `400`; ADMIN/OPERADOR; auth/role zero persistence/audit.
- [ ] 5.2 **GREEN** `apps/api/src/routes/padrones.ts`, `apps/api/src/test-standins/db.ts`.
- [ ] 5.3 **REFACTOR** Share parsing; exclude PATCH/delete.

## PR6
- [ ] 6.1 **RED** Role/loading/status choice; announced retained failure; exact invalidation/no reload.
- [ ] 6.2 **GREEN** Create transport/modal plus existing Padrones-page trigger.
- [ ] 6.3 **REFACTOR** Extract mapping; preserve reads.

## PR7
- [ ] 7.1 **RED** Role/loading; distinct navigation/action; baja reason/date; retained failure; reactivate no selector; status/invalidation/no reload.
- [ ] 7.2 **GREEN** Status transport/actions; integrate separate controls into `PadronRow.tsx`/quoted pages.
- [ ] 7.3 **REFACTOR** Extract action state; preserve reads/exclusions.
