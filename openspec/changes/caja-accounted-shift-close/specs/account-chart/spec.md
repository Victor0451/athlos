# Account Chart Specification

## Purpose

Provide a stable, searchable account catalog for account-linked Caja source records without introducing general-ledger accounting or chart administration.

## Requirements

### Requirement: Seeded Accounting Chart

The system MUST seed and expose for read/search the complete hierarchy supplied in the account-catalog input, with Assets, Liabilities, Equity, Income, and Expenses as its roots. Parent links, not code formatting, MUST define that hierarchy. Leaf accounts MUST be identifiable as active/imputable; chart administration and full general-ledger behavior are out of scope. This review-sized first unit is chart seed/read/search only and MUST NOT add close, shift, settlement, or supporting-record infrastructure.

#### Scenario: Seeded roots are available

- GIVEN the chart is initialized
- WHEN an authorized user views the catalog
- THEN Assets, Liabilities, Equity, Income, and Expenses SHALL be available as root groups
- AND no chart CRUD action SHALL be required or implied

### Requirement: Approved Dues Production Account

The chart MUST contain the active imputable leaves `Cuotas sociales` under `4.1 Ingresos Operativos` and `Valores a Depositar`. Authoritative dues-payment production MUST bind to `Cuotas sociales`. A different NEW production origin MUST have its own explicit approved binding; if it does not, its transaction MUST fail atomically and MUST NOT silently use `Cuotas sociales`, `Ventas de Servicios`, or an unclassified NEW source. Existing historical unclassified records MUST remain historical only and MUST NOT be remapped.

#### Scenario: Dues production uses its approved account

- GIVEN a completed dues payment produces an automatic Caja income source
- WHEN the source is persisted
- THEN its immutable account snapshot SHALL identify `4.1` / `Cuotas sociales`
- AND the source SHALL retain its payment-source link

#### Scenario: New other origin has no approved binding

- GIVEN a NEW production origin other than dues has no explicit approved account binding
- WHEN it attempts to create an automatic source
- THEN the system MUST fail the transaction atomically
- AND it MUST NOT assign `Cuotas sociales`, `Ventas de Servicios`, or an unclassified NEW source

#### Scenario: Historical unclassified origin remains historical

- GIVEN a historical source is already unclassified
- WHEN it is read after this change
- THEN the system SHALL preserve its historical classification
- AND it MUST NOT remap it to a new account

### Requirement: Searchable Valid Movement Accounts

The system MUST allow catalog filtering by account code, name, or group. Every NEW account-linked Caja source MUST retain an immutable account code/name/path snapshot and select an active, imputable leaf account; active imputable leaves under Assets and Liabilities MUST be eligible just as those under the other groups are. The system MUST reject a group, non-imputable account, or inactive account as a movement account. Legacy records remain readable and are never silently remapped.

#### Scenario: Asset leaf is selected by group search

- GIVEN an active imputable leaf account under Assets
- WHEN an operator filters the catalog by its group and selects that leaf for a Caja movement
- THEN the system SHALL accept the account

#### Scenario: Inactive group is not a movement account

- GIVEN a matching account is inactive or is a non-leaf group
- WHEN an operator attempts to use it for a Caja movement
- THEN the system MUST reject the movement
