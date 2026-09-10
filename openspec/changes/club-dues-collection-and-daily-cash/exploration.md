## Exploration: club-dues-collection-and-daily-cash

### Current State
`tesoreria.ctacte` is the reusable member receivables ledger: `DEBITO` posts to `debe` (what the member owes) and `CREDITO` posts to `haber` (what they pay/are credited). Balance is recomputed as active `debe - haber` using bigint cents; rows are soft-annullable and writes require a unique client `Idempotency-Key`. Payment and debit commands validate positive amounts and emit audit records in the same transaction as the ledger write. The existing UI supports ledger reads, manual payments, manual debits, notes, CSV export, and comprobante PDFs.

Sports already provide the operational membership selection source: `deportes.inscripciones` uniquely identifies `(socio, disciplina, ejercicio)`, has lifecycle states `activa|pendiente|baja`, and its lifecycle commands have durable command receipts and atomic audit emission. It does not carry a price or a billing-effective interval. Therefore it can determine eligibility, but cannot itself be the historical source of a monthly sport charge.

`tesoreria.gastos` is a separate expense ledger with ADMIN CRUD, soft annulment, audit events, and a five-field natural key. `gastos_ctacte_mapping` is an explicit, auditable many-to-many correlation; it does not make a gasto a member payment and heuristic matches never persist automatically. The promoted legacy cash table is actually `tesoreria.caja_movimiento`, not `caja.caja_movimiento`; it contains only legacy header metadata (`numero`, `secuencia`, `fecha`, `hora`, `tip`, `descrip`) and no usable money, source, closing, or reconciliation model.

The audit log is append-only and has an idempotent emitter, although some older gastos route writes emit audit after the business mutation rather than as one financial transaction. Existing fee configuration, monthly assessment, allocation, debt agreement, settlement, cash-session, close, and reconciliation aggregates do not exist.

### Affected Areas
- `packages/db/src/schema/tesoreria.ts` — current ctacte, gastos, mapping, and legacy cash schema; new financial aggregates must preserve the existing ledger rather than overload it.
- `packages/db/drizzle/0032_ctacte_payment_idempotency.sql` and new forward migrations — ctacte has a full unique idempotency key; financial commands need equivalent durable replay guarantees and immutable historical references.
- `apps/api/src/modules/ctacte/repository.ts` and `apps/api/src/modules/socios/forms/ctacte-mutations.ts` — reusable amount, ledger-posting, transaction, attachment-compensation, and atomic-audit patterns.
- `apps/api/src/routes/ctacte.ts` and `apps/api/src/routes/ctacte-mutations.ts` — existing authenticated read surface and `ADMIN|TESORERO|OPERADOR` manual collection authority.
- `packages/db/src/schema/deportes.ts`, `packages/db/drizzle/0036_padrones_inscription_lifecycle.sql`, and `apps/api/src/modules/padrones/inscription-command-service.ts` — active enrollment and receipt/audit conventions; price-effective history is absent.
- `packages/db/src/schema/tesoreria.ts`, `packages/db/drizzle/0015_gastos.sql`, `packages/db/drizzle/0019_gastos_ctacte_mapping.sql`, and `apps/api/src/routes/admin/gastos.ts` — expense source and audit/mapping conventions; current mutable/hard-delete behavior cannot be the source of a closed cash report without snapshots or reversal semantics.
- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx`, `apps/web/src/components/ledger/MovementList.tsx`, and `apps/web/src/components/ctacte/` — existing collection console that can later receive traceable collection context, but not a substitute for a cash-close workspace.
- `packages/audit/src/emitter.ts` and `openspec/specs/audit-logger/spec.md` — append-only audit foundation and action registration point for the new financial commands.

### Approaches
1. **Layered receivables and cash-domain extension** — Version fee rules, snapshot them into monthly assessments, allocate payments/approved settlements explicitly to those assessments, then record money movements separately in a daily cash session and close it with immutable totals.
   - Pros: preserves why each debt exists, prevents fee edits from rewriting history, separates member debt settlement from actual cash, supports partial allocation and auditable reversals, and allows community work without falsely reporting cash.
   - Cons: introduces several focused aggregates and will require chained delivery under the 400-line review budget.
   - Effort: High.

2. **Extend manual ctacte rows and reuse legacy caja headers** — Store fee amounts in concepts, post manual debits/credits, and summarize those rows plus gastos each day.
   - Pros: low initial schema cost and superficially reuses current screens.
   - Cons: cannot prove which fee version or sport produced a charge; has no deterministic payment allocation; conflates work credits with cash; legacy cash headers have no monetary evidence; closed reports would change after later edits or annulments.
   - Effort: Medium initially, High corrective cost.

### Recommendation
Choose approach 1. Keep `ctacte` as the authoritative member-facing receivables posting surface, but add a financial sub-ledger that explains and constrains it:

- A versioned, effective-dated fee schedule with a base fee and per-discipline additive rules. A monthly assessment snapshots the selected rule versions, member/enrollment eligibility, calculation inputs, and resulting debit before the corresponding `ctacte` debit is posted.
- A payment/settlement allocation table linking a credit or approved settlement to one or more assessments, with explicit amount, ordering policy, and remaining balance. Never infer allocation from chronology after the fact.
- Debt agreements as their own lifecycle record with terms, approval, and fulfillment evidence. A community-work agreement must be either (a) non-monetary fulfillment that does not reduce debt, or (b) an approved valuation policy that produces a separately traceable non-cash settlement credit. It must never enter the daily cash income total.
- A daily cash-session/close aggregate that records actual collection tenders and approved expense outflows, then seals a snapshot containing included movement identities, totals by tender/source, operator, timestamps, and variance. Corrections after close must be compensating movements or a controlled close adjustment, never recomputation or mutation of the sealed period.

The first proposal should define the domain boundaries and invariants before selecting endpoints or screens. Anticipate at least separate reviewable slices for fee/assessment generation, collection and allocation, settlement agreements, and cash close/expense intake. The current 400-line budget makes a single implementation PR unsafe.

### Risks
- Mutable fee rows or querying today's active sport enrollment during reporting would retroactively alter historical monthly debt; assessments must snapshot effective rule and eligibility inputs.
- Deleting/overwriting debt, hard-deleting closed expenses, or recomputing a closed day destroys traceability; use annulment/reversal/correction records and immutable close snapshots.
- Treating community work as cash or as an unpriced credit makes both debt and daily cash false; an explicit valuation, approval, evidence, and settlement policy is mandatory before it reduces debt.
- A generic payment credit without allocation leaves paid/unpaid assessments ambiguous, especially for partial payments, agreements, and backdated corrections.
- Existing gastos CRUD and its route-level audit are not sufficient evidence for a sealed cash close; the close must atomically capture inclusion and totals, with idempotent commands.
- This is a multi-aggregate financial domain and is certain to exceed 400 changed lines if delivered as one change; use chained slices when task planning forecasts the work.

### Ready for Proposal
No — resolve these five highest-impact business decisions first:

1. What is the authoritative effective-date rule for base and sport fees: calendar month, club exercise, or both; and may a fee change affect an already assessed month?
2. Which enrollment states and dates make a sport chargeable, and are charges prorated for alta/baja during a month?
3. What allocation rule applies to a money payment: oldest debt first, operator-selected assessments, member-selected assessments, or an approved agreement schedule; may one payment split across debts?
4. When may community work reduce debt: never, only after a valuation policy approved before work, or after an authorized post-work valuation; who approves it and what evidence is required?
5. What does a daily close include and seal: cash only or all tenders, which expense sources are eligible, who may close/reopen it, and how must a post-close correction appear?
