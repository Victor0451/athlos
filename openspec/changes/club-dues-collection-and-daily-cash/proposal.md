# Proposal: Club Dues Collection and Daily Cash

## Intent
Create a native, auditable dues domain that explains member debt, settlement, and actual cash independently of legacy `ctacte`.

## Outcomes and Scope

### In Scope
- Effective-dated base and additive sport pricing with configurable full-month, daily-prorated, or next-period assessment.
- Immutable obligations snapshotting pricing, eligibility, benefits, reasons, and inputs.
- Native debt, explicit allocations, monetary collection, community-work settlement, benefits, and agreements.
- Multiple desks/shifts, separated tenders, expenses, immutable closes, discrepancies, and compensations.
- Optional, one-way compatibility projection to `ctacte`; existing manual-ledger behavior remains unchanged.

### First Slice
Versioned base/sport pricing and idempotent monthly generation into native obligations only. No `ctacte` projection or downstream settlement workflow.

### Non-Goals
- Replacing or removing existing `ctacte` workflows.
- Automatic late fees, forced allocation, or historical recomputation.
- Reusing legacy `tesoreria.caja_movimiento` as reconciliation truth.

## Capabilities

### New Capabilities
- `dues-pricing-assessment`: Versioned pricing and immutable obligation generation.
- `debt-allocation-settlement`: Debt, explicit allocations, and cash/non-cash settlement.
- `member-benefits-agreements`: Versioned benefits and debt agreements.
- `cash-desk-operations`: Desk shifts, tenders, expenses, reconciliation, and immutable close.
- `ctacte-compatibility`: Optional audited projection without source-of-truth authority.

### Modified Capabilities
- `audit-logger`: Add financial lifecycle actions and evidence metadata.
- `tesoreria-gastos`: Protect expenses included in closed periods through compensating entries.

## Approach and Invariants
Build staged aggregates around a native obligation ledger. Financial and non-cash settlements remain distinct and reduce debt only through explicit allocation. Assessments retain configuration snapshots. Closed periods are immutable. Overrides, valuations, approvals, reschedules, reversals, discrepancies, and projections are auditable exceptions.

Use least-privilege roles and desk/shift responsibility. Minimize exposure of debt, family, agreement, work-evidence, and authorization data; retain append-only actor/time/reason evidence.

## Rollout Strategy
Deliver sub-400-line slices: (1) pricing/assessment, (2) benefits, (3) collection/allocation, (4) agreements/community work, (5) cash/expenses/close, (6) optional `ctacte` compatibility. Feature-gate each capability.

## Affected Areas
| Area | Impact |
|---|---|
| `packages/db/src/schema/tesoreria.ts`, forward migrations | New native financial records |
| `apps/api/src/modules/`, `apps/api/src/routes/` | New authorized commands and queries |
| `apps/web/src/` | Staged treasury workspaces |
| `packages/audit/src/emitter.ts` | New audited actions |

## Risks and Rollback
- **High:** divergence or duplicate assessment. Use snapshots, constraints, idempotency, and reconciliation.
- **High:** scope/review overload. Enforce staged slices and ask before any budget exception.
- **Medium:** sensitive evidence exposure. Enforce authorization and minimal responses.

Rollback disables the feature gate; preserve records and use forward compensating migrations/entries. Never delete financial history.

## Dependencies and Success Criteria
- Active sport-enrollment lifecycle, audit/idempotency primitives, and expense records.
- [ ] Native dues operate with `ctacte` disabled.
- [ ] Historical debt and closes remain stable after rule changes.
- [ ] Cash and non-cash settlements reconcile separately with explicit allocation and audit.
