# Proposal: Accounted personal shift close

## Intent and approval state

Explain each operator's personal Caja from Collections production and manual sources through a server-computed close, without payment recapture. The user approved this revised proposal and design for small-unit implementation planning. Source implementation, tests, commands, and commits remain unauthorized until the ask-on-risk delivery decision and overlap coordination are resolved.

## Confirmed operating model

1. A Caja is personal to its operator. An OPERADOR may enter Treasury/Caja and open a shift without an active shift; only the Collections payment workspace requires that operator's own active shift. Different operators may operate concurrently. The same operator's prior OPEN Caja blocks another opening, never carries its balance forward, and is detected by a non-destructive duplicate preflight before the operator-specific OPEN uniqueness guard, rather than any per-desk uniqueness, resolves an opening race.
2. Collections full payments automatically produce the operator's daily income exactly once, with source links and a CASH/DEBIT/CREDIT/TRANSFER breakdown. Manual income remains distinct from that production.
3. Every manual income and manual expense selects an active imputable account, description, and one mandatory payment method. Each movement is paid in full by that one method.
4. The close recomputes, on the server, `opening CASH + CASH income − CASH expenses`. It does not accept a declared-handoff amount or custody declaration.
5. Positive computed CASH atomically creates one `Valores a Depositar` outflow for that computed amount. Zero creates no transfer. Negative blocks close with a breakdown and no override.
6. Existing physical count, variance, and reason controls remain independent reconciliation records. They neither change the computed close transfer nor claim that its logical amount was physically delivered or bank-deposited.

Example: CASH income 30,000 − CASH expense 5,000 − TRANSFER expense 4,000 produces a close transfer of **25,000 CASH** to `Valores a Depositar`; the TRANSFER expense remains visible but does not reduce physical CASH.

## Scope and account attribution

- Seed and read/search the complete hierarchy supplied in the account-catalog input, rooted in Assets, Liabilities, Equity, Income, and Expenses. `Cuotas sociales` under `4.1 Ingresos Operativos` and `Valores a Depositar` are active imputable accounts. Chart CRUD remains deferred; this does not introduce a general ledger.
- Dues production binds to `Cuotas sociales`. Every other NEW production origin requires its own explicit approved binding; an unsupported NEW production mapping fails atomically and is never silently classified. Existing historical unclassified records remain historical only and are not remapped.
- Keep immutable account code/name/path snapshots on **every NEW source**, including automatic production, manual income, manual expense, and the dedicated close transfer. Do not remap legacy gasto codes or historical records.
- **Proposed for final design approval:** persist payment-method values as validated text, not as a database enum. DEBIT means payment card; BANK_DEBIT is a distinct validated manual-expense method, never income and never bank integration. The proposed first-version matrix is income `CASH`/`DEBIT`/`CREDIT`/`TRANSFER`; expense `CASH`/`DEBIT`/`CREDIT`/`TRANSFER`/`BANK_DEBIT`.
- **Proposed first-version limit:** each manual source is paid in full by one method and may carry one optional supporting record; this is not asserted retroactively about historical records. Retain optional external/internal supporting-document and tax transcription. Additive components reconcile to their document total; contained taxes remain informational and non-additive without amount-equality inference.

## Safety and boundaries

Reuse authoritative full settlement/allocation behavior: no client-entered payment amount, opening never becomes production, and replay/concurrency never duplicate source records. OPERADOR receives own-shift Caja access (including no-shift opening) and Collections full-payment access only in an own active shift; negotiation, condonation, generic reversal, and finance administration stay outside that journey. Existing finance reversal behavior remains intact; this proposal grants no new operator reversal.

Close, source creation, and automatic production must be atomic, idempotent where applicable, append-only, and exact-cent safe. A positive close creates one immutable dedicated `CLOSE_TRANSFER` with stable ID, close/shift uniqueness, snapshots, and a read DTO/history entry; it is shown in the movement list but excluded from the operational pre-transfer recomputation. Opening and physical count accept CASH-only exact cents; new UI/API requests reject non-cash keys, while completed historical replay/history remains readable unchanged. A preview is informational only: submit locks and recomputes authoritatively, accepts no client transfer amount, and blocks/refetches on a negative final result. Preserve existing expired-shift recovery and physical variance safeguards. Do not add treasury acceptance, bank-deposit confirmation, bank-ledger integration, debit reversal privileges, tax automation, external access, CTACTE, or double-entry GL.

## Affected capabilities

**New:** `account-chart`, `cash-supporting-records`, `accounted-personal-shifts`.

**Review-sized first unit:** chart seed plus read/search only. It deliberately does not deliver close, shift, settlement, or supporting-record infrastructure.

**Modified:** `debt-allocation-settlement`, `native-collections-web`, and `web-frontend` for the authorized Collections/Caja journey.

## Delivery decision still required

The user approved the revised proposal/design and small-unit plan. Before apply, resolve the existing ask-on-risk delivery-size choice and overlap ownership; that approval does not authorize implementation or a size exception.

QA001's live hold remains pending; documentary research requires no revision.
