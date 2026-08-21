# Proposal: Native Collections Web

## Intent and Goals

Operators cannot use the native dues backend end-to-end or explain balances without legacy CTACTE. Deliver the first usable Web slice: Collections navigation, pricing, monthly generation, debt explanation, explicit monetary allocation, and append-only reversal.

## Scope

### In Scope
- Capability-gated `/collections` navigation and typed dues client; server roles remain authoritative.
- ADMIN pricing; ADMIN/TESORERO generation, debt, settlement, and reversal journeys.
- Minimal authorized read DTOs for components, benefits, outstanding amounts, settlement/allocation links, and reversal eligibility; reuse Socios lookup.
- Stable idempotency keys across ambiguous retries; refresh-and-review handling for balance races.

### Non-Goals
- Cash shift/close/reconciliation; benefits or family administration; agreements/community work; full arrears dashboard; Padrones.
- CTACTE UI, projection, or dual-write; projection remains disabled.
- Backend ledger redesign, implicit allocation, mutation/deletion of financial history, or new authorization semantics.

## Capabilities

### New Capabilities
- `native-collections-web`: Accessible operator workspace and complete first-slice journey.

### Modified Capabilities
- `web-frontend`: Add capability-aware Collections navigation and route protection.
- `dues-pricing-assessment`: Expose pricing/generation through safe Web contracts.
- `debt-allocation-settlement`: Add explanatory read contracts and Web settlement/reversal behavior.

## Operator and UI Outcomes

Operators can understand original versus outstanding debt, components, benefits, allocations, and reversals before acting. The UI MUST provide loading, empty, not-found, conflict, unavailable, replayed, and success states; labelled controls; semantic landmarks; keyboard dialogs; visible focus; non-color cues; announcements; and responsive views. Confirmations MUST distinguish native settlement from cash reconciliation and never suggest automatic allocation.

## Approach, Dependencies, and Rollout

Reuse verified `club-dues-collection-and-daily-cash` commands and the native ledger. Add only evidence-backed reads without raw audit/authorization evidence. Keep flags off until API, Web, accessibility, responsive, and role-denial coverage passes; then enable a pilot.

Auto-chain forecast under the 400-line review budget: (1) capability/navigation/contracts, (2) pricing/generation, (3) debt explanation/read DTOs, (4) settlement/allocation/reversal. Each slice requires independent verification and rollback by capability disablement.

## Risks and Mitigations

- **High — misleading financial detail:** stop at summary if safe source fields are unavailable; never infer history.
- **High — duplicate or stale action:** preserve idempotency keys and require refresh after conflicts.
- **Medium — client authorization drift:** hide affordances for clarity, but trust server enforcement only.

## Acceptance Direction

- [ ] Authorized operators complete the full slice with CTACTE projection disabled and absent.
- [ ] Partial/multi-obligation allocations reconcile exactly; over-allocation and races are blocked intelligibly.
- [ ] Reversal preserves the original allocation and records reasoned compensation.
- [ ] Automated checks cover role boundaries, retries, accessibility, and narrow/mobile layouts.

## Proposal Question Round

Spec review should confirm that existing Socios lookup is sufficient and that the minimal debt DTO excludes sensitive evidence while retaining complete explanation and reversal selection.
