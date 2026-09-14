# Accounted cash-shift close — exploration

## Status
Planning only. Proposal is blocked on the bounded business decisions in preproposal.md. No implementation, tests, infrastructure access or delivery authorized. Base: d700f92d, work/caja-diagnosis. QA-001 live remains pending.

## Confirmed scope
- Automatically expose existing Collections production without recapturing payments; explicit shifts, including operator own-shift access.
- Manual income/expense with searchable chart account, description and existing supporting-document metadata; no fiscal issuance or ARCA integration.
- Seed hierarchical chart with five roots (assets, liabilities, equity, income, expenses); leaf accounts imputable, full CRUD deferred. Preserve asset/liability selections for cash movements.
- Facturas A/B/C/E/M/T, credit/debit notes, Recibos A/B/C/X, Remitos R/X and Tickets are document categories, not fiscal validity assertions or automatic payment triggers.
- Optional tax breakdown: taxable net, exempt/non-taxable amounts, multiple VAT amounts/rates, IVA/IIBB perceptions and other named taxes; reconcile against document total without generating extra payment movements.
- Expected CASH = opening CASH + CASH income - CASH expenses. Other tenders stay separate.
- Positive expected CASH generates exactly one closing transfer outflow to Valores a Depositar and zero operating balance, not an operating expense or bank deposit confirmation. Physical discrepancy remains explicit.
- Negative expected CASH warns with breakdown and blocks close. Unclosed prior shift blocks new opening until closed/regularized; no duplicate carryover or newly approved exception.

## Current evidence
| Source | Observation |
| --- | --- |
| apps/api/src/modules/dues/cash-desk.ts, reconcileTenders and close | Existing opening/CASH reconciliation; nonzero count discrepancy requires reason; no positive closing transfer or specific negative expected balance block. |
| packages/db/src/schema/dues-cash.ts | Immutable snapshot stores expected/count/discrepancy; tender sources SETTLEMENT/GASTO/MANUAL cannot express a dedicated closing transfer yet. |
| apps/api/src/modules/dues/settlements.ts | Payment settlement/allocation/tender transaction already atomic; reversal is correlated. Do not copy ERPGW delayed capture mechanically. |
| packages/db/drizzle/0054_dues_cash_closes.sql through 0057_cash_lifecycle_boundaries.sql | One OPEN shift per desk; immutable closes, append-only tenders and frozen included expenses; existing >24h recovery policy must not be silently removed. |
| packages/db/drizzle/0061_dues_cash_settlement_reversal_expense.sql | Reversal expense must match original tender and shift. |
| apps/api/src/routes/treasury.ts and cash-desk.ts | ADMIN/TESORERO gates; adding OPERADOR needs server-side own-shift checks. |
| apps/api/src/routes/dues.ts and settlements.ts | Collections also has finance-role gates; broader operator collection access is a separate scope decision. |
| packages/db/src/schema/tesoreria.ts; routes/admin/gastos.ts | Legacy gasto has free-text cuenta_principal and flat IVA/ingreso_bruto, no new chart FK or general document model. |
| packages/db/src/schema/contabilidad.ts | Empty accounting schema shell, no existing chart. |

Money storage uses numeric(14,2); new input arithmetic must use bounded integer cents and preserve exact reconciliation. Tests were inspected, not run.

## Isolation and overlaps
Treasury page/test, PesoAmountInput/test, dues routes, settlement-detail, cash E2E, CI and runbook overlap pending condonation d700f92d...e8da0734. Peer proposed S1 to free Treasury surfaces, not verified delivered. Do not copy/cherry-pick probe or alter its review authority. Principal older branch contains club-dues-collection-and-daily-cash docs absent from main; not current scope authority.

## Reference limits
Authorized ERPGW Obsidian documentation describes production/accounting close, account-linked movements and positive netting. It is documentary evidence, not runtime verification. Fiscal/legal compliance is not claimed. Existing Athlos physical reconciliation and immutable lifecycle remain authoritative preservation constraints.

## Risks
Expected vs counted transfer semantics, recovery after 24 hours, opening blocker scope and document/payment identity need explicit resolution. Multi-area implementation likely exceeds 400 lines; delivery strategy remains ask-on-risk, no size exception or chain authorized.
