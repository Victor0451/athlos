# Tasks: Native Collections Web

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,050–1,450 authored lines total; 180–360 per slice |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Slice 1 → Slice 2 → Slice 3 → Slice 4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Gates/contracts/retry | Slice 1 | `pnpm --filter @athlos/web test:run -- collections` | Allowed/denied route | Flag, nav, route, client/key |
| 2 | Pricing/generation | Slice 2 | `pnpm --filter @athlos/api test:run -- dues-routes` | ADMIN price; replay | Panels and adapters |
| 3 | Socios/debt detail | Slice 3 | `pnpm --filter @athlos/api test:run -- settlements` | Narrow debt detail | DTO, read route, panel |
| 4 | Allocation/reversal | Slice 4 | `pnpm --filter @athlos/api test:run -- settlements` | Conflict and keyboard recovery | Mutation dialogs/client |

## Phase 1: Slice 1 — Gates, Contracts, Retry

- [x] 1.1 RED — Add `apps/web/src/**/collections*.test.tsx`: enabled/denied nav, direct denial, labelled landmarks, replay/key reuse. [web: nav/direct; native: replay/a11y]
- [x] 1.2 GREEN — Create `lib/api/dues.ts`, `collections-idempotency.ts`, page; wire `features.tsx`, `navigation.ts`, `AppShell.tsx`, layout guards. Verify 1.1; flags off; rollback these files/Web flag.
- [x] 1.3 REFACTOR — Extract status primitives; run Slice 1 command and allowed/denied, keyboard/focus Playwright. [native: rollout, recovery]

## Phase 2: Slice 2 — Pricing and Generation

- [x] 2.1 RED — Extend `dues-routes.test.ts` and Web tests: ADMIN pricing, retained overlap input, state matrix, generation created/replayed/zero/conflict. [pricing: overlap, non-ADMIN, retry]
- [x] 2.2 GREEN — Add `components/collections/` price/generation adapters and panels; retain fields and stable keys. Verify 2.1; flags off; rollback panels/adapters.
- [x] 2.3 REFACTOR — Run Slice 2 command and ADMIN/TESORERO, announced state, narrow-layout Playwright; assert no CTACTE request/control. [native: projection absent]

## Phase 3: Slice 3 — Socios Debt Explanation

- [x] 3.1 RED — Add `settlements*.test.ts` allow-list, unauthorized, unavailable/not-found; RTL no-debt/error and labelled cards. [debt: authorized/non-authorized; native: narrow]
- [x] 3.2 GREEN — Extend `allocations.ts`, `settlements.ts`, `routes/dues.ts` with safe DTO; build Socios-selected cards/history without inferred/audit data. Verify 3.1; flags off; rollback DTO/read/panel.
- [x] 3.3 REFACTOR — Run Slice 3 command and no-horizontal-loss Playwright; verify denial and responsive status focus. [native: a11y/responsive]

## Phase 4: Slice 4 — Allocation, Conflict, Reversal

- [x] 4.1 RED — Add service/route/Postgres tests: exact unique allocation, stale over-allocation, reason, compensation-only, concurrent duplicate; RTL refresh-review/focus. [debt: partial/race/reversed]
- [x] 4.2 GREEN — Add explicit allocation/reversal dialogs; on 409 retain draft, refetch, require review/new key; never offer cash/reconciliation. Verify 4.1; flags off; rollback dialogs/client, never ledger data.
- [x] 4.3 REFACTOR — Run Slice 4 command and settlement/reversal, replay, keyboard recovery, mobile-card Playwright; pilot only after every slice passes; Web flag rolls back. [native: cash/rollout]
