# Accounted Personal Shifts Specification

## Purpose

Account for each operator's personal Caja shift from linked Collections production and manual sources through a server-computed close, while preserving recovery, authorization, physical reconciliation, and immutable financial history.

## Requirements

### Requirement: Personal Shift Ownership and Concurrent Operation

The system MUST make Caja shifts personal to an operator and MUST permit different operators to have concurrent open shifts, including where they share a desk label. An OPERADOR MUST be able to enter Treasury/Caja and open a shift without an active shift. Before opening, a non-destructive duplicate preflight MUST identify any prior OPEN personal shift; an operator-specific OPEN uniqueness constraint, replacing any per-desk OPEN uniqueness, MUST remain the race arbiter. An operator with any prior open personal shift MUST be blocked from opening another shift until that shift is closed or regularized through the existing expired-shift recovery. The system MUST NOT carry a prior shift's balance into a new shift automatically.

#### Scenario: Different operators open concurrently

- GIVEN operator A has an open personal shift
- WHEN operator B opens a personal shift
- THEN the system SHALL open B's shift
- AND A's shift SHALL remain distinct and open

#### Scenario: Prior personal shift blocks reopening

- GIVEN an operator has an earlier open personal shift
- WHEN that operator attempts to open another shift
- THEN the system MUST block the opening
- AND it SHALL identify the existing shift or applicable expired-shift recovery

### Requirement: Shift Authorization Boundaries

An OPERADOR MUST access only that operator's own personal Caja shift and its permitted Collections payment actions. Treasury/Caja entry and opening are available without an active shift; Collections payment actions alone require that operator's own active shift. An OPERADOR MUST NOT read, alter, close, or act on another operator's shift and MUST NOT approve a negotiation or receive a new reversal action. Existing ADMIN and TESORERO permissions, finance reversal behavior, and expired-shift recovery behavior MUST be preserved.

#### Scenario: Operator is denied a foreign shift

- GIVEN operator A and operator B each have a personal shift
- WHEN operator A requests an action on B's shift
- THEN the server MUST deny the action

### Requirement: Single-Production Collections Capture

The system MUST include an authoritative completed Collections full payment in its owning personal shift exactly once without recapturing payment input. Its automatic income MUST retain a source link and identify its CASH, DEBIT, CREDIT, or TRANSFER receipt method. Manual income MUST remain distinct. Replayed or concurrent processing MUST NOT duplicate the payment, its source, or its shift production. Opening cash MUST NOT be counted as Collections production.

#### Scenario: Replayed payment is not duplicated

- GIVEN a completed full Collections payment is already included in an operator's shift
- WHEN the same payment is replayed or re-read
- THEN the system SHALL show the original linked inclusion
- AND it MUST NOT add a second production or tender

### Requirement: Cash Expectation and Tender Separation

Before the closing transfer, expected CASH MUST be computed server-side as opening CASH plus CASH income minus CASH expenses. The operational pre-transfer recomputation MUST exclude a closing transfer even though that transfer is shown in the movement list. CASH, DEBIT, CREDIT, and TRANSFER production totals MUST remain separately identifiable. Non-CASH income and expenses MUST NOT change expected physical CASH. Opening MUST contribute once and MUST NOT be represented as production income.

#### Scenario: Mixed methods leave non-cash expense outside expected cash

- GIVEN a shift has CASH income of 30000, CASH expense of 5000, and TRANSFER expense of 4000
- WHEN expected CASH is calculated
- THEN expected CASH SHALL be 25000
- AND the TRANSFER expense SHALL remain visible outside physical CASH

### Requirement: Accountable Positive, Zero, and Negative Close

A close preview is informational only. On submit the system MUST lock and recompute pre-transfer expected CASH server-side; it MUST NOT accept a client transfer amount. If the final value is negative, it MUST block close with its opening, CASH-income, and CASH-expense breakdown, require refetch, and permit no override. When pre-transfer expected CASH is zero, the system MUST create no closing transfer. When it is positive, the system MUST atomically record exactly one immutable dedicated `CLOSE_TRANSFER` outflow to active imputable `Valores a Depositar` for the server-computed expected CASH, leaving the shift's logical operating CASH balance at zero. The transfer MUST have a stable ID, immutable account snapshot, and a unique close/shift correlation; its snapshot and amount MUST appear in the close read DTO and immutable history/movement list. The operator close action is sufficient: the close MUST NOT require or accept a separate declared-handoff amount, custody declaration, or treasurer confirmation. This outflow MUST NOT be recorded as an operating expense or as bank-deposit confirmation.

#### Scenario: Positive close transfers computed cash

- GIVEN a shift has CASH income of 30000, CASH expense of 5000, and TRANSFER expense of 4000
- WHEN its operator closes the shift
- THEN the system MUST record exactly one `Valores a Depositar` outflow of 25000
- AND the shift's logical operating CASH balance SHALL be zero

#### Scenario: Zero close has no transfer

- GIVEN a shift has pre-transfer expected CASH of zero
- WHEN its operator closes the shift
- THEN the system SHALL create no `Valores a Depositar` transfer

#### Scenario: Negative close is blocked

- GIVEN a shift has pre-transfer expected CASH below zero
- WHEN its operator attempts to close it
- THEN the system MUST reject the close with its CASH breakdown
- AND it MUST NOT offer an override

### Requirement: Physical Count Variance Is Independent of Close Transfer

The opening amount and physical count MUST be CASH-only exact-cent values. New UI/API requests MUST reject non-cash keys, fractional values, unsafe values, malformed amounts, and overflow; completed historical replay/history MUST remain readable unchanged. The system MUST preserve existing physical count, variance, and reason safeguards as independent reconciliation records. A required count mismatch reason MUST remain required. Counted CASH and its variance MUST NOT set, alter, or create a separate closing transfer amount; the closing outflow always equals the server-computed expected CASH. The system MUST NOT silently represent missing cash as physically handed over or bank-deposited, create an adjustment or expense for the variance, or invent a variance account.

#### Scenario: Short physical count remains explicit without changing transfer

- GIVEN a shift has expected CASH of 1000 and an operator records physical count of 900 with a variance reason
- WHEN the operator closes the shift
- THEN the system SHALL preserve the 100 shortage and its reason as reconciliation history
- AND the closing transfer SHALL remain the computed 1000
- AND the system SHALL not claim the missing 100 was physically handed over or bank-deposited

### Requirement: Atomic, Idempotent, and Immutable Close History

A close request MUST be atomic: if any required close record, existing reconciliation record, or required positive closing transfer cannot be persisted, none of that request's financial state may persist. A repeated equivalent completed close request MUST return the original close result without a second transfer, close, or audit event; reuse of its request identity with materially different data MUST be rejected. Closed shifts MUST remain immutable. Any reversal MUST be an append-only, correlated compensating reversal that preserves the original close and transfer history.

#### Scenario: Failed close rolls back

- GIVEN a positive close cannot persist its required `Valores a Depositar` outflow
- WHEN the close request fails
- THEN no close, transfer, or partial close audit state SHALL persist

#### Scenario: Equivalent close replay is idempotent

- GIVEN a close request has completed successfully
- WHEN the operator repeats the same request identity and equivalent close data
- THEN the system SHALL return the original close result
- AND it MUST NOT create another close or closing transfer
