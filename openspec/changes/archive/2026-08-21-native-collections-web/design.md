# Design: Native Collections Web

## Technical Approach

Add a capability-gated `/collections` workspace inside `(authed)` and a typed Web adapter over existing dues routes. Fastify gates and dues services remain authorization authorities. Extend only the safe debt read model; keep all mutations on verified native-ledger paths. Never import or invoke CTACTE or cash flows.

## Architecture Decisions

| Decision | Tradeoff | Choice and rationale |
|---|---|---|
| Workspace | One page is simpler but couples journeys. | Compose pricing, generation, and member-debt sections in a thin `/collections` container; dialogs own settlement/reversal review and child components stay presentational. |
| Gates | Client gating improves clarity but cannot authorize. | Pass `collectionsEnabled` through `FeatureConfigProvider`; filter navigation and guard direct rendering by ADMIN/TESORERO. Existing API flags, role gates, and service authorization remain final. Pricing is ADMIN-only. |
| Contracts | Sharing internals risks exposing evidence. | Map explicit snake_case, integer-cent wire types in `apps/web/src/lib/api/dues.ts`; extend `getDebt` only with evidence-backed fields. |
| Retry | Memory loses keys; storing drafts exposes data. | Store only `{operatorId, action, draftFingerprint, key}`. Reuse after ambiguous failure; clear after success or abandonment. Changed drafts receive new keys; server claims remain authoritative. |
| Conflicts | Automatic resubmission may use stale balances. | On 409, disable confirmation, refetch, retain the draft, mark changes, and require review with a new key. |
| Reversal | Mutation would erase history. | Require a non-empty trimmed reason and append exactly one `COMPENSATION` linked to the original allocation. Never update/delete the original. Transactional `dues_allocations_compensation_unique` enforcement rejects duplicate and concurrent reversals as 409 conflicts. |

## Data Flow and Contracts

```text
flag/role → Collections container → typed client → Fastify gate → dues transaction
Socios search → selected Socio → debt DTO → review dialog
409 → refetch and retain draft → explicit review/reconfirmation
```

`DebtDetailDTO` allow-lists identifiers, currency, total debt, and obligation period, original/outstanding cents, components, benefits, allocation/settlement links, status, and reversal eligibility. It excludes raw audit/authorization evidence and unrelated member data. Mutation results distinguish `created|replayed`; generation also represents zero obligations. Settlement requests require a positive total and unique explicit allocations. Reversal accepts settlement/allocation IDs and the required reason only, then appends the linked compensation.

## File Changes

| File | Action |
|---|---|
| `apps/web/src/app/(authed)/collections/page.tsx` | Create query/mutation container and state transitions. |
| `apps/web/src/components/collections/*` | Create pure panels, cards, editors, confirmations, and responsive history; reuse `Modal`/status primitives, never CTACTE components. |
| `apps/web/src/lib/api/dues.ts`, `collections-idempotency.ts` | Create typed contracts and key lifecycle; reuse `listSocios`. |
| `apps/web/src/lib/{features.tsx,navigation.ts}`, `components/AppShell.tsx`, `(authed)/layout.tsx` | Add flag/role navigation and direct-route guards. |
| `apps/api/src/modules/dues/{allocations.ts,settlements.ts}`, `routes/dues.ts` | Extend safe reads and replay outcomes without changing audit authority. |

## Accessibility and Responsive Design

Use labelled inputs, landmarks/headings, visible focus, non-color cues, announced status/alerts, and keyboard-operable focus-restoring dialogs. Below `md`, tables become labelled cards retaining every amount and action without horizontal clipping.

## UI State Matrix

| Journey | Empty / not-found / unavailable | Conflict / error | Success / replay | Retention |
|---|---|---|---|---|
| Pricing | Empty list; unavailable service | Overlap conflict or announced error | Created/revoked and refreshed | Keep all fields on conflict/error; clear only on success |
| Generation | Zero obligations; unavailable service | Period/key conflict or error | Created or visibly replayed | Keep period until success |
| Debt | No obligations; unknown Socio; unavailable safe detail | Announced load error, no inferred history | Explanation loaded | Keep Socio for retry |
| Allocation | No eligible debt; missing obligation; unavailable service | Stale/racing balance requires refresh-review; recoverable error | Created or visibly replayed | Keep explicit draft on conflict/error |
| Reversal | No eligible history; missing allocation; unavailable service | Duplicate/concurrent 409 refreshes history; recoverable error | Compensation appended or visibly replayed | Keep reason/selection on conflict/error |

Every journey also has an operation-specific loading state with submission disabled.

## Testing Strategy

API route/service/Postgres tests cover flags, role denial, DTO allow-list, generation outcomes, retry fingerprints, exact/racing allocations, mandatory reversal reason, compensating-only append behavior, and duplicate/concurrent reversal rejection. Vitest/RTL covers every matrix cell, explicitly empty, not-found, unavailable, pricing conflict/error/success, retained pricing input, loading, announcements, focus, and refresh-review. Playwright covers ADMIN/TESORERO success, projection-off requests, keyboard recovery, and narrow layouts.

## Rollout, Telemetry, and Audit

Keep both dues and Web flags off. Block enablement until API integration, role-denial, accessibility, and responsive checks all pass; only then start a role-limited pilot and later general finance access. Disable the Web flag to roll back; no ledger rollback. Existing sanitized HTTP telemetry and transactional mutation audits remain authoritative; reads expose no authorization evidence.

## Autonomous Delivery Slices

Keep each chained PR at ≤400 authored changed lines with tests: (1) gates/contracts/retry; (2) pricing/generation; (3) Socios/debt detail; (4) allocation/conflict/reversal. Each slice remains flag-disabled, independently testable, and revertible.

## Open Questions

None.
