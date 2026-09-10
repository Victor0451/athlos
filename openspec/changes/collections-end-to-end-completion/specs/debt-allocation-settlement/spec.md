# Delta for Debt Allocation Settlement

## ADDED Requirements

### Requirement: Atomic Single-Tender CashDesk Settlement

Each `ABONAR CUOTA` payment operation MUST use exactly one tender from `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER` and MUST require an open CashDesk shift for every supported tender. The operation MUST commit the settlement, server-derived full-outstanding allocations, and one CashDesk `SETTLEMENT` tender fact in a single database transaction. `CASH` MUST contribute to the shift's expected physical cash balance. `DEBIT`, `CREDIT`, and `TRANSFER` MUST be non-physical shift and Treasury tender facts and MUST NOT affect expected physical cash balance. A validation or transactional failure MUST leave no partial Collections, shift, or Treasury state.

#### Scenario: CASH requires an open shift and contributes physical cash

- GIVEN selected obligations are eligible and a CashDesk shift is open
- WHEN an authorized operator pays them using `CASH`
- THEN the settlement, full-outstanding allocations, and one physical CashDesk `SETTLEMENT` tender MUST commit together
- AND the tender amount MUST contribute to expected physical cash balance

#### Scenario: DEBIT requires an open shift and remains non-physical

- GIVEN selected obligations are eligible and a CashDesk shift is open
- WHEN an authorized operator pays them using `DEBIT`
- THEN one non-physical `DEBIT` shift and Treasury tender fact MUST commit with the settlement and allocations
- AND expected physical cash balance MUST remain unchanged

#### Scenario: CREDIT requires an open shift and remains non-physical

- GIVEN selected obligations are eligible and a CashDesk shift is open
- WHEN an authorized operator pays them using `CREDIT`
- THEN one non-physical `CREDIT` shift and Treasury tender fact MUST commit with the settlement and allocations
- AND expected physical cash balance MUST remain unchanged

#### Scenario: TRANSFER requires an open shift and remains non-physical

- GIVEN selected obligations are eligible and a CashDesk shift is open
- WHEN an authorized operator pays them using `TRANSFER`
- THEN one non-physical `TRANSFER` shift and Treasury tender fact MUST commit with the settlement and allocations
- AND expected physical cash balance MUST remain unchanged

#### Scenario: Any tender without an open shift is rejected

- GIVEN no CashDesk shift is open
- WHEN an operator attempts `ABONAR CUOTA` with `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`
- THEN the operation MUST be rejected without settlement, allocation, shift, or Treasury tender mutation

#### Scenario: Multiple or unsupported tenders are rejected

- GIVEN an operator supplies multiple tenders or a tender outside `CASH`, `DEBIT`, `CREDIT`, and `TRANSFER`
- WHEN payment is submitted
- THEN the operation MUST be rejected without settlement, allocation, shift, or Treasury mutation

#### Scenario: Transaction failure rolls back all financial facts

- GIVEN a valid full-outstanding payment reaches the transaction boundary
- WHEN settlement, allocation, shift, or tender persistence fails
- THEN the entire operation MUST roll back
- AND neither Collections nor CashDesk MUST retain partial financial truth

### Requirement: Separate Collections Treatment Operations

Payment, accepted community work, agreement, and condonation MUST remain separate atomic operations even when presented in one workflow. Existing agreement and accepted community-work feature gates and authorization requirements MUST remain required. An agreement MUST NOT reduce debt. Accepted community-work effects MUST occur only through the existing gated supported operation. Condonation effects MUST occur only through an approved condonation execution, and a request or rejection MUST NOT be represented as payment or settlement.

#### Scenario: Agreement preserves outstanding debt

- GIVEN an obligation has an outstanding balance
- AND the existing agreement feature gates authorize the agreement action
- WHEN an agreement is created or revised
- THEN the balance, payment history, settlement history, and CashDesk records MUST remain unchanged

#### Scenario: Community work remains feature-gated

- GIVEN the existing accepted community-work feature gates are disabled or its authorization requirements are unmet
- WHEN an operator attempts accepted community-work treatment
- THEN the treatment MUST be unavailable or denied
- AND debt and financial history MUST remain unchanged

#### Scenario: Treatments do not share implicit effects

- GIVEN an operator selects a supported treatment for an obligation
- WHEN that treatment completes
- THEN only the selected treatment's authorized effects MUST occur
- AND no payment, community-work, agreement, or condonation operation MUST be inferred from another

### Requirement: Approved Full-Installment Condonation Execution

A condonation request MUST be financially eligible only when every selected obligation is open, in one currency, selected explicitly, and represented by its full outstanding-balance snapshot. Request creation and rejection MUST be financially inert. On explicit authorized approval, the system MUST revalidate every selected obligation against that snapshot and MUST atomically condone all selected full outstanding balances exactly once. A stale, paid, missing, mixed-currency, changed, or otherwise ineligible obligation MUST block the entire execution. Failure or concurrency MUST leave no partial condonation, settlement, allocation, or CashDesk fact.

#### Scenario: Eligible request remains inert until approval

- GIVEN all explicitly selected obligations are open in one currency at their full outstanding balances
- WHEN a scoped condonation request is created
- THEN debt and all financial ledgers MUST remain unchanged until explicit authorized approval executes

#### Scenario: Ineligible selection creates no effective request

- GIVEN a selection is empty, implicit, partial, paid, stale, mixed-currency, or otherwise ineligible
- WHEN condonation is requested
- THEN the request MUST be rejected as financially ineligible
- AND no debt or financial ledger MUST change

#### Scenario: Rejection is financially inert

- GIVEN a valid pending condonation request
- WHEN authorized Treasury rejects it
- THEN every selected obligation MUST retain its prior outstanding balance
- AND no settlement, allocation, condonation, or CashDesk fact MUST be created

#### Scenario: Approval revalidates and condones atomically once

- GIVEN a valid approved request whose complete selected-obligation snapshot still matches current outstanding balances
- WHEN approved condonation execution occurs
- THEN every selected full outstanding balance MUST be condoned in one atomic operation
- AND replay or concurrent execution MUST NOT condone any balance twice

#### Scenario: Stale balance blocks the entire approved execution

- GIVEN one selected obligation changed after request creation
- WHEN approved condonation execution revalidates the snapshot
- THEN the entire execution MUST be rejected as stale
- AND no selected obligation MUST be partially condoned
- AND a newly reviewed request MUST be required

#### Scenario: Approved execution failure is recoverable and exactly once

- GIVEN an approved request passes balance revalidation
- WHEN any financial persistence step fails
- THEN no selected obligation MUST remain partially condoned
- AND recovery MUST either complete the same approved execution once or report its committed prior outcome without duplicating it

## MODIFIED Requirements

### Requirement: Explicit Settlement Allocation

The system MUST allow ADMIN or TESORERO to explicitly select one or more open obligations in one currency for monetary payment and MUST allocate exactly each selected obligation's full outstanding amount. The server MUST derive those amounts. Manual amounts, partial allocation, implicit selection, empty selection, mixed currencies, already-paid selections, over-allocation, and stale or racing balances MUST be rejected without financial mutation. Conflicts MUST require refresh and review. This full-outstanding contract MUST supersede only conflicting partial/manual monetary allocation behavior; it MUST NOT alter the separate accepted community-work non-cash allocation contract or unrelated completed behavior.

(Previously: Operators submitted positive explicit allocation amounts, including partial multi-obligation settlements.)

#### Scenario: Full-outstanding multi-obligation payment

- GIVEN an authorized operator explicitly selects multiple open obligations in one currency
- WHEN the operator confirms payment without supplying allocation amounts
- THEN the server MUST allocate each selected obligation's full outstanding amount
- AND the payment total MUST equal the sum of those server-derived amounts

#### Scenario: Empty selection is rejected

- GIVEN an authorized operator submits payment with no selected obligation
- WHEN payment is submitted
- THEN the request MUST be rejected without settlement, allocation, shift, or tender mutation

#### Scenario: Implicit selection is rejected

- GIVEN a payment request supplies a member, total, period range, or other selector without explicit obligation identities
- WHEN payment is submitted
- THEN the server MUST NOT infer which obligations to allocate
- AND the request MUST be rejected without financial mutation

#### Scenario: Partial or manual amount is rejected

- GIVEN an operator supplies an amount below or different from a selected obligation's full outstanding amount
- WHEN payment is submitted
- THEN the request MUST be rejected without settlement, allocation, shift, or tender mutation

#### Scenario: Over-allocation attempt is rejected

- GIVEN a request supplies a total or allocation amount greater than any selected obligation's current outstanding balance or greater than the server-derived total
- WHEN payment is submitted
- THEN the entire request MUST be rejected
- AND no selected obligation MUST be partially or excessively settled

#### Scenario: Paid or mixed-currency selection is rejected

- GIVEN a selection contains an already-paid obligation or mixed currencies
- WHEN payment is submitted
- THEN the request MUST be rejected without financial mutation

#### Scenario: Concurrent submission consumes a selected balance

- GIVEN two payment submissions include the same open obligation
- WHEN one submission commits first
- THEN the other submission MUST be rejected as a stale-balance conflict
- AND it MUST create no settlement, allocation, shift, or tender fact
- AND refresh and review MUST be required

### Requirement: Append-Only Reversal

The system MUST allow ADMIN or TESORERO to select an original posted payment operation, review its settlement, all allocations, tender, and amount, and submit a non-empty reason. Reversal MUST create one compensating operation bound to that exact original payment and MUST atomically restore every affected obligation and reverse the matching CashDesk `SETTLEMENT` tender. Edit, delete, allocation reselection, partial reversal, duplicate reversal, and direct ledger mutation MUST be prohibited.

(Previously: Reversal selected one posted allocation and created a compensating reversal without an explicit whole-operation CashDesk contract.)

#### Scenario: Exact operation is reversed

- GIVEN an unreversed payment has one settlement, one or more allocations, and one CashDesk tender
- WHEN an authorized operator reverses it with a reason
- THEN one compensating reversal MUST restore the exact allocated amounts and reverse the exact tender
- AND Collections and CashDesk MUST remain consistent

#### Scenario: Reversal replay is exact and idempotent

- GIVEN the original payment was already reversed
- WHEN the same reversal request is replayed or another reversal is attempted concurrently
- THEN the original reversal result MUST be returned or an already-reversed conflict MUST be reported
- AND no second restoration or tender reversal MUST occur

#### Scenario: Reversal transaction fails

- GIVEN an eligible original payment is selected
- WHEN any Collections or CashDesk reversal write fails
- THEN the complete reversal MUST roll back
- AND the original payment MUST remain consistently posted in both domains

### Requirement: Settlement Boundary Preservation

The Collections capability MUST reuse CashDesk only for the supported `SETTLEMENT` tender and exact reversal records and MUST NOT link dues settlements or allocations to `CTActe`, manage cash-shift opening or closing, create a parallel Treasury ledger, or perform implicit reconciliation. Every `ABONAR CUOTA` tender MUST still require the existing open shift. Agreement and other treatment content MUST remain non-financial until an explicitly supported, feature-gated operation validates and commits its own effect.

(Previously: Collections prohibited all Treasury cash or tender handling and preserved only the earlier monetary allocation behavior.)

#### Scenario: Supported tender does not enable CTActe or cash management

- GIVEN a payment commits a CashDesk `SETTLEMENT` tender against an existing open shift
- WHEN the operator reviews the result
- THEN no `CTActe` projection, cash-shift opening or closing control, or parallel reconciliation fact MUST be created

#### Scenario: Unfulfilled agreement action does not settle debt

- GIVEN an agreement describes a future action
- WHEN no supported financial operation has been recorded
- THEN the obligation's debt MUST remain unchanged
- AND no CashDesk or `CTActe` side effect MUST occur
