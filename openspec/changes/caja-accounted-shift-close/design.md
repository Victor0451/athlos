# Accounted personal Caja: source records and computed close

## Review outcome sought

This design replaces the prior proposed declared-handoff and shortage-transfer model. The user approved this revised proposal/design for small-unit implementation planning. No source implementation, tests, commands, infrastructure changes, or commits are authorized until the ask-on-risk delivery decision and overlap coordination are resolved.

A close transfer is **computed by the server**, not declared by an operator:

```text
pre-transfer CASH = opening CASH + CASH income − CASH expense
```

The existing physical-count, variance, and reason safeguards stay in place as independent reconciliation evidence. They neither supply a second editable transfer amount nor change the server-computed `Valores a Depositar` outflow.

## Quick path

1. An OPERADOR may enter Treasury/Caja and open one personal shift with immutable CASH-only opening cents even without an active shift. Collections payment actions alone require the operator's own active shift. Another operator may open concurrently; a non-destructive duplicate preflight identifies an operator's earlier OPEN shift before the operator-specific uniqueness guard, rather than any per-desk uniqueness, resolves a race.
2. A full Collections payment creates its linked production income exactly once and exposes it by CASH, DEBIT, CREDIT, or TRANSFER. Manual income and expense are distinct sources.
3. **Proposed first-version limit:** every manual source has an active imputable account, description, positive exact-cent amount, exactly one payment method, and at most one optional supporting record. It is paid in full by that method; this does not retroactively classify historical records.
4. The close preview is informational. Submit locks the shift and recomputes CASH authoritatively, accepts no client transfer amount, and records the existing CASH-only physical count/variance/reason reconciliation independently.
5. Positive computed CASH atomically creates one immutable dedicated `CLOSE_TRANSFER` logical outflow to `Valores a Depositar`; zero creates none; a final negative result blocks close and requires refetch. The operator's close action is sufficient.

Example: 30,000 CASH income, 5,000 CASH expense, and 4,000 TRANSFER expense gives `30,000 − 5,000 = 25,000` computed CASH. Close creates one 25,000 `Valores a Depositar` outflow. The TRANSFER expense remains non-cash and does not reduce physical CASH.

## Scope and explicit exclusions

Extend the current settlement and Caja lifecycle; do not create a second payment engine. Preserve authoritative full-payment selection/allocation, expired-shift recovery, append-only financial history, and existing physical reconciliation behavior.

Out of scope: double-entry GL, chart CRUD, treasury acceptance, bank-deposit confirmation, bank-ledger integration, debit-reversal privileges, tax automation/validation, fiscal issuance/integration, external access, CTACTE, automatic carryover, and generic financial-history mutation.

## Account chart and production attribution

The review-sized first unit is limited to seed plus read/search of a read-only hierarchical `plan_cuentas` catalog. It seeds the complete hierarchy supplied in the account-catalog input with stable code, name, parent, root category, active/imputable flags, and deterministic code/name search; it does not deliver close, shift, settlement, or supporting-record infrastructure. Parent links, not code formatting, define hierarchy. `Cuotas sociales` under `4.1 Ingresos Operativos` and `Valores a Depositar` are active imputable accounts.

Every NEW source—automatic production, manual income, manual expense, and dedicated close transfer—retains immutable account code/name/path snapshots. Legacy records remain readable and are never silently remapped. All dues-payment production binds to `Cuotas sociales` in the authoritative settlement transaction. A different NEW production origin must have its own explicit approved account binding; if unsupported, its transaction fails atomically rather than creating an unclassified source. Historical unclassified records remain historical only and are not remapped.

Account selection for manual income and expense accepts an active imputable leaf under any root category. This is account attribution for a source record, not journal posting.

## Source and payment-method contract

### Automatic Collections production

A completed full Collections payment creates one linked production source in its owning shift, within the settlement/allocation transaction. It cannot be re-entered manually, replayed into a second source, or double-count opening. Detail/history exposes the source link, payment identifier, account snapshot, and totals by the receipt methods:

| Display/payment method | Meaning | Effect on physical CASH |
| --- | --- | --- |
| CASH | Cash receipt | Increases it |
| DEBIT | Debit-card receipt | None |
| CREDIT | Credit-card receipt | None |
| TRANSFER | Transfer receipt | None |

Manual income remains separately identifiable from automatic production even when it uses the same payment method.

### Proposed first-version manual-source methods

**Proposed for final design approval:** a manual source is valid only with all of: account, nonblank description, positive exact-cent amount, and one mandatory payment method. The complete source amount is assigned to that one method; splitting and more than one optional supporting record are first-version exclusions, not retroactive assertions about history. Payment-method persistence is validated text, not a database enum.

| Manual method | Income | Expense | Effect on computed physical CASH |
| --- | --- | --- | --- |
| CASH | allowed; cash received | allowed; cash paid | + income / − expense |
| DEBIT | allowed; payment-card receipt | allowed; payment-card expense | non-cash |
| CREDIT | allowed; credit-card receipt | allowed; credit-card expense | non-cash |
| TRANSFER | allowed; transfer received | allowed; transfer-paid expense | non-cash |
| BANK_DEBIT | **not allowed** | allowed; debit directly charged to a bank account | non-cash |

**DEBIT** is a payment-card method and **BANK_DEBIT** is a distinct validated manual-expense text value, never a synonym for DEBIT. BANK_DEBIT does not query, reconcile, or post any bank ledger and is never an income method.

## Computed close and independent reconciliation

The close command accepts the existing physical count data and, when the count differs from expected CASH, the existing required reason. It accepts **no** `declared_handoff_cash_cents`, custody-handoff boolean/declaration, or caller transfer amount. A successful operator close needs no second approval.

Within one transaction:

1. Authorize the actor and idempotency key, lock the shift and operational writers, and recompute CASH from opening plus only CASH income minus only CASH expense. Opening is a separate immutable CASH-only exact-cent shift value, never production. The movement list may show close transfers, but the operational pre-transfer recomputation excludes them.
2. Preserve a CASH-only exact-cent physical count/variance/reason record according to the existing reconciliation guard. New UI/API requests reject non-cash keys; completed historical replay/history remains readable unchanged. Counted cash and variance are history/reconciliation facts, not inputs to the transfer calculation.
3. If computed CASH is negative, reject normal and expired-recovery close with opening/income/expense breakdown and no override; the client must refetch rather than rely on a stale preview.
4. If computed CASH is zero, persist the close and no transfer.
5. If computed CASH is positive, insert exactly one immutable dedicated `CLOSE_TRANSFER` with a stable ID, immutable account snapshot, and unique close/shift correlation to `Valores a Depositar` for the computed amount, then persist close/audit atomically. Logical operating CASH becomes zero.

The transfer is neither an operating expense nor a bank-deposit confirmation. Its stable ID, snapshots, and amount appear in the close read DTO and immutable history/movement list. A count shortage or surplus remains explicit with its reason; it does not create an adjustment, expense, variance account, second transfer amount, or assertion about physical delivery. Close replay with equivalent request identity returns the original close/transfer and never creates another one. A changed replay conflicts. Closed history is immutable; any future correction is an authorized append-only correlated compensation, not an operator reversal or reopening. Existing finance reversal behavior remains unchanged; this design grants no new operator reversal.

## Authorization, concurrency, and integrity

- OPERADOR opens, reads, writes, and closes only its own shift. ADMIN retains existing cross-shift authority; TESORERO retains existing finance visibility and recovery behavior without widened writes.
- A non-destructive duplicate preflight identifies an operator's existing OPEN shift before opening; an operator-specific partial unique OPEN-shift constraint, rather than any per-desk OPEN uniqueness, remains the opening race arbiter. Different operators may share a desk label; the same operator cannot have two OPEN shifts.
- Treasury/Caja entry and shift opening are available to an OPERADOR without an active shift. Collections payment access for OPERADOR requires an active own shift and permits only the existing full-payment flow. Do not expose negotiations, condonation, approval, generic tender recapture, or new operator reversals.
- Settlement creation/allocation/production/source link and audit occur together. Replays and concurrent attempts return the existing result or fail without duplicate production.
- All source writers and close share shift locking. A source either commits before close and is included, or loses to close and rolls back.
- Monetary inputs and sums use exact cents and supported numeric bounds. Reject fractions, unsafe values, malformed amounts, and overflow; never round or truncate.

## Supporting records

**Proposed first-version limit:** a manual source may have one optional internal or external supporting record; this does not retroactively constrain existing historical records. External transcription retains printed type, issuer/recipient identity, references (as text preserving leading zeroes), date, original-currency total, letter, and legend where applicable. Internal evidence is unnumbered. NC/ND references a prior invoice/equivalent record. Additive tax components must sum exactly to document total when supplied; IVA Contenido and other contained taxes are informational and non-additive. This records existing evidence only and never issues, validates, calculates, or adds a payment.

## API and Spanish UI contract

- Shift detail shows opening; automatic production with source links and CASH/DEBIT/CREDIT/TRANSFER totals; separate manual income and expense; the immutable close transfer in the movement list/history; and non-cash methods without treating them as physical cash.
- Manual forms require account, description, amount, and one method for both `Ingreso manual` and `Egreso manual`. The proposed matrix permits CASH/DEBIT/CREDIT/TRANSFER for income and CASH/DEBIT/CREDIT/TRANSFER/BANK_DEBIT for expense. Labels distinguish `Tarjeta de débito` from `Débito bancario`; BANK_DEBIT is expense-only validated text, not a bank integration.
- Close review is informational and labels `Efectivo esperado antes de rendir`, `Efectivo contado`, `Diferencia de recuento`, `Motivo de diferencia` and `Transferencia lógica a Valores a Depositar`. Submit locks/recomputes on the server and refetches after a negative final result. It does not render or submit an editable handoff field, custody declaration, treasurer approval, or client-selected transfer amount.
- Historical readers display absent new metadata as absent, never invented zeroes. Account catalog exposes GET/search only, with no CRUD.

## Specification-only verification matrix

Future implementation must run strict-TDD evidence; none is run in this planning phase.

| Scenario | Required observation |
| --- | --- |
| Mixed methods | 30,000 CASH income − 5,000 CASH expense − 4,000 TRANSFER expense closes with one 25,000 CASH `Valores a Depositar` transfer; the transfer expense remains outside physical CASH. |
| Automatic production | One completed Collections payment appears once with its source link and CASH/DEBIT/CREDIT/TRANSFER breakdown; a replay/concurrent attempt does not duplicate it. |
| Manual symmetry | Manual income and expense each reject missing method or split-method payment; each accepts one valid method and an account/description. |
| Debit distinction | The proposed matrix accepts DEBIT payment-card receipt/expense and expense-only BANK_DEBIT as distinct validated text values; neither non-cash case reduces physical CASH or implies bank integration. |
| Close recalculation | A preview is informational; a forged client transfer/handoff value is ignored or rejected, submit locks/recomputes, and a negative final result blocks/refetches. |
| No opening double count | Opening contributes once to CASH expectation and never appears as Collections/production income. |
| Close boundaries | Positive creates one transfer, zero none, negative blocks; an equivalent close replay creates neither a second close nor transfer. |
| Independent variance | Count mismatch with a reason remains visible while the transfer still equals computed CASH; missing required variance reason is rejected. |
| Concurrency | Same operator can open one shift; different operators can be open concurrently; source/close contention is atomic. |

## Remaining delivery gate

The user approved this revised design/proposal and the small-unit plan. Resolve ask-on-risk delivery sizing and overlap ownership before apply; that approval does not authorize implementation or a size exception. QA001 remains a live hold and cannot be cleared by planned tests.
