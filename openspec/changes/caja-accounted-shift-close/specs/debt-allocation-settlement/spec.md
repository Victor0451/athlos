# Delta for Debt Allocation Settlement

## ADDED Requirements

### Requirement: Operator Full-Payment Collections Boundary

The new OPERADOR Collections payment journey MUST permit payment only in the operator's own active personal Caja shift and MUST accept only a full payment for the selected obligation. It MUST reject partial payment, overpayment, and payment without the operator's active own shift. This restriction applies only to Collections payment: it MUST NOT prevent Treasury/Caja entry or shift opening without an active shift. This boundary MUST NOT restrict or alter already-supported ADMIN or TESORERO monetary settlement, explicit-allocation, reversal, or negotiation workflows, and MUST grant no new operator reversal. Supporting-document and tax metadata MUST NOT create an additional payment or allocation.

#### Scenario: Operator records a full payment in own shift

- GIVEN an OPERADOR has an active personal shift and a selected obligation has outstanding debt of 1000
- WHEN the OPERADOR submits the authoritative full payment through the new Collections journey
- THEN the system SHALL accept the payment for that shift subject to existing settlement safety

#### Scenario: Operator partial payment is rejected

- GIVEN an OPERADOR has an active personal shift and a selected obligation has outstanding debt of 1000
- WHEN the OPERADOR submits a payment of 500 through the new Collections journey
- THEN the system MUST reject the payment
- AND no settlement or allocation SHALL be created

#### Scenario: Existing finance settlement remains available

- GIVEN an ADMIN or TESORERO uses an already-supported monetary settlement journey
- WHEN they submit a valid explicit allocation permitted by the existing capability
- THEN the system SHALL preserve that journey's existing behavior

### Requirement: Linked Automatic Dues Production

A completed dues full payment MUST atomically create or retain exactly one linked automatic Caja income source in the owning shift. The source MUST preserve the receipt payment method as CASH, DEBIT, CREDIT, or TRANSFER; retain immutable account code/name/path snapshots; bind to active imputable `Cuotas sociales`; and be shown separately from manual income. Replays and concurrent commands MUST return or reject without creating a second settlement, allocation, or automatic source.

#### Scenario: Payment replay preserves one source

- GIVEN a completed dues payment already has its linked automatic source in an operator's shift
- WHEN the payment command is replayed
- THEN the system SHALL return the existing payment/source result
- AND it MUST NOT create a second source or change the shift's production totals
