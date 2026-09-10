# Cash Desk Operations Specification

## Purpose

Define daily cash custody and reconciliation. This is a subsequent slice, not part of the first slice.

## Requirements

### Requirement: Desk Shifts and Tenders

The system MUST authorize desk opening and closing by assigned shift responsibility. The club timezone is `America/Argentina/Jujuy`. A shift MUST persist an immutable `businessDate` derived from its opening instant in that timezone; closing after midnight retains the opening `businessDate`. It MUST record monetary income and expenses by tender and keep non-cash debt settlement out of cash income. Sensitive cash commands and evidence MUST observe least privilege and minimized responses.

Cash movements MUST be included only when their occurrence timestamp is within the inclusive interval `[openedAt, closedAt]`. The close operation captures `closedAt` once, then totals movements with `openedAt <= occurredAt <= closedAt`; no later movement may alter the snapshot. A shift MUST close no later than 24 hours after opening.

#### Scenario: Community work is excluded from cash

- GIVEN approved community work settles debt
- WHEN desk totals are calculated
- THEN no tender income MUST be created for that settlement

### Requirement: Immutable Reconciliation and Close

The system MUST calculate expected versus counted tender totals. A discrepancy MUST require an authorized justification. A closed period MUST be immutable; adjustments after close MUST use reasoned compensating entries and MUST be idempotent.

#### Scenario: Close with discrepancy

- GIVEN counted cash differs from expected cash
- WHEN an authorized operator closes the shift with a justification
- THEN the immutable close MUST retain expected, counted, discrepancy, actor, time, and reason

### Requirement: Business-Date Expense Inclusion

An expense MAY enter a shift only when its accounting date equals the shift's immutable `businessDate`. An included gasto becomes immutable immediately, even while its shift is OPEN, and database-atomic guards MUST reject application and direct-SQL update, delete, or anular attempts. Corrections MUST be reasoned compensations with an explicit idempotency key and persisted request fingerprint; same-key replays return the original result and a payload mismatch conflicts.

### Requirement: Database Source and Lifecycle Invariants

The database MUST enforce one-way `OPEN` → `CLOSED` lifecycle, append-only closed movements, manual tender source absence, monetary-settlement source validity, and gasto source linkage. Direct SQL reopening or adding a movement to a closed shift MUST fail.

An expired shift MUST reject new movements. ADMIN and TESORERO MAY force-close an expired shift only with a non-empty reason; ordinary operators MUST be rejected. A force close MUST be an immutable, idempotent close result with durable privacy-safe audit evidence. Direct SQL `INSERT status='CLOSED'` without a lifecycle close MUST fail.
