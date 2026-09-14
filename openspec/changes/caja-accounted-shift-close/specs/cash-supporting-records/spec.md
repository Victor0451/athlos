# Cash Supporting Records Specification

## Purpose

Record optional supporting-document metadata and account-linked manual Caja sources without issuing, validating, or calculating fiscal documents.

## Requirements

### Requirement: Account-Linked Manual Sources With One Mandatory Method

**Proposed first-version limit:** the system MUST record each manual Caja income or expense as an account-linked source record with immutable account code/name/path snapshots, a description, positive exact-cent amount, and exactly one mandatory payment method. The full source amount MUST use that one method; split-method manual sources are out of scope. Each such source MAY have one optional supporting document. These proposed first-version limits MUST NOT retroactively classify or constrain historical records. The record MUST NOT constitute full double-entry general-ledger accounting or trigger an additional payment.

The proposed method matrix is: manual income permits `CASH`, `DEBIT`, `CREDIT`, and `TRANSFER`; manual expense permits `CASH`, `DEBIT`, `CREDIT`, `TRANSFER`, and `BANK_DEBIT`. For CASH, expected physical CASH changes by the manual source direction: income increases it and expense decreases it. DEBIT, CREDIT, TRANSFER, and BANK_DEBIT are non-cash for this calculation. DEBIT means a payment-card method; BANK_DEBIT is a distinct validated manual-expense method and MUST NOT be displayed or persisted as DEBIT.

#### Scenario: Manual expense without a document

- GIVEN an operator records a manual CASH expense with an eligible account, description, and payment method
- WHEN no supporting-document metadata is supplied
- THEN the system SHALL record the expense source
- AND it SHALL NOT require a fiscal document

#### Scenario: Missing payment method is rejected symmetrically

- GIVEN an operator prepares either a manual income or a manual expense with an account and description
- WHEN the payment method is absent or more than one method is supplied
- THEN the system MUST reject the source

#### Scenario: Bank debit does not reduce physical cash

- GIVEN an operator records a manual BANK_DEBIT expense
- WHEN expected physical CASH is calculated
- THEN that expense SHALL remain non-cash
- AND it MUST NOT be represented as a debit-card receipt or reduce expected CASH

### Requirement: BANK_DEBIT Representation Compatibility

The system MUST persist payment methods as validated text, not as a database enum, and MUST represent BANK_DEBIT separately from DEBIT. `BANK_DEBIT` MUST be accepted only for a manual expense and MUST remain unambiguously presented as `Débito bancario`. It MUST NOT overload or reinterpret an existing DEBIT value, accept BANK_DEBIT for income, or imply bank-ledger integration.

#### Scenario: Debit card receipt remains distinct

- GIVEN a linked Collections receipt has payment method DEBIT
- WHEN a user views production and a manual BANK_DEBIT expense
- THEN the system SHALL label the receipt as debit card and the expense as bank debit
- AND it SHALL not imply bank-ledger integration for either record

### Requirement: External Supporting-Document Transcription

For an already-issued external supporting document, the system MUST allow recording and displaying its printed type, issuer identity, point of sale, document number, letter, legend, issue date, original-currency total, and printed recipient identity when present. Point-of-sale and document-number values MUST be treated as text and preserve leading zeroes. The system MUST NOT impose an invented universal length, uniqueness, issuance, or fiscal-validity rule.

#### Scenario: Leading-zero document reference is retained

- GIVEN an external document shows point of sale `00001` and number `00000042`
- WHEN its metadata is recorded
- THEN the stored and displayed references SHALL remain `00001` and `00000042`

### Requirement: Supporting-Document Types and Correlation

The system MUST support recorded external categories Factura A, B, C, E, M, and T; credit and debit notes; Recibo A, B, C, and X; Remito R and X; and Ticket. An external credit or debit note MUST reference one or more previously issued invoices or equivalent documents. The system MUST retain historical M metadata without recommending M issuance or implementing retention behavior. Receipts and remitos MUST NOT be presented as invoice substitutes.

#### Scenario: Credit note requires a prior-document reference

- GIVEN an operator records an external credit note
- WHEN no prior invoice or equivalent-document reference is supplied
- THEN the system MUST block saving the record

### Requirement: Internal Supporting Evidence

The system MUST allow an internal supporting record without a document number and MUST distinguish it from an externally issued fiscal document. The system MUST NOT invent fiscal numbering, issuance, or validation rules for internal records.

#### Scenario: Internal unnumbered record

- GIVEN an operator records internal supporting evidence for a manual movement
- WHEN no document number is supplied
- THEN the system SHALL retain it as internal evidence
- AND it SHALL not be displayed as an invoice substitute

### Requirement: Optional Tax-Breakdown Transcription

The system MAY record printed taxable-net, exempt, non-taxable, multiple VAT rate-and-amount, IVA or IIBB perception, and named-tax amounts as additive transcription. A component's explicit semantic classification—not equality or inequality of amounts—MUST determine whether it is additive or contained. When explicitly additive tax amounts are supplied, their sum MUST equal the recorded document total or saving MUST be blocked. A printed contained tax, including `IVA Contenido` or an indirect contained tax, MUST be informational only: it MUST NOT be added to the total again or require an invented net amount. The system MUST NOT calculate, infer, emit, or validate taxes or create extra payments from tax metadata.

#### Scenario: Additive tax mismatch is rejected

- GIVEN an external document total of 1000 and entered additive tax components totaling 900
- WHEN the operator saves the supporting record
- THEN the system MUST reject the record

#### Scenario: Contained IVA does not increase the total

- GIVEN a document total of 1000 includes a printed `IVA Contenido` amount of 210
- WHEN the operator records that informational amount
- THEN the recorded total SHALL remain 1000
- AND no additional payment or fabricated net amount SHALL be created

#### Scenario: Tax semantics are not inferred from matching amounts

- GIVEN an additive component and a contained component happen to have equal amounts
- WHEN the operator records their printed semantic classifications
- THEN the system SHALL apply additive reconciliation only to the additive component
- AND it MUST NOT classify either component from amount equality
