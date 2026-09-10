# Collections End-to-End Completion Design

## Decision summary

This change narrows and composes the existing dues, CashDesk, approval-token, audit, deployment, and Collections Web seams. It does not introduce a second financial ledger, approval lifecycle, settlement representation, or migration history. The product remains organized around nine dependency-ordered acceptance stages, while implementation is a single-writer sequence of 15 pre-split delivery work units. Every work unit has an evidence and rollback boundary, explicit dependencies and focused command, and a forecast below 400 authored changed lines, counting production and test additions plus deletions. CashDesk's transaction-aware tender seam is deliberately separate from payment orchestration/public API, approval/request authorization is separate from condonation execution/audit/recovery, and Web client/UI work remains in later styled UI units rather than backend atomicity units.

The core flow is:

```text
enrollment + effective prices
  -> read-only member range plan + source fingerprint
  -> atomic idempotent creation of missing obligations
  -> explicit same-currency obligation selection
  -> server-derived full outstanding balances
    -> 5A CashDesk transaction-aware SETTLEMENT tender seam
    -> 5B settlement + allocations + tender orchestration/public API + audit in one DB transaction
    -> exact whole-operation reversal across Collections and CashDesk

condonation selection
  -> 8A scoped approval_tokens request + authenticated Treasury approve/reject decision (financially inert)
  -> 8B approved execution revalidates and condones once, with audit/recovery; rejection remains inert
  -> 8C presents the treatment lifecycle in the later styled Web UI

```

`CTActe` stays behind `DUES_CTACTE_PROJECTION_ENABLED` and is neither called nor represented by this flow.

## Existing component map

| Concern                           | Existing path and symbol                                                                                                                                                                                                                                                                                        | Design use or correction                                                                                                                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration journal                 | `packages/db/drizzle/meta/_journal.json`; `packages/db/src/migration-journal.test.ts`                                                                                                                                                                                                                           | Append the compatibility migration after current head `0058_dues_open_agreements`; preserve strict file/journal order. Never add `0036` to a live ledger.                                                                                                              |
| Historical inscription migration  | `packages/db/drizzle/0036_padrones_inscription_lifecycle.sql`                                                                                                                                                                                                                                                   | Reference only as the historical schema intent. Do not execute, edit, renumber, or replay it.                                                                                                                                                                          |
| Enrollment schema                 | `packages/db/src/schema/deportes.ts#inscripciones`; `apps/api/src/modules/padrones/inscription-service.ts`                                                                                                                                                                                                      | The planner reads `fechaAlta`/`fechaBaja`; `[alta,baja)` remains the only lifecycle interpretation.                                                                                                                                                                    |
| Migration status                  | `packages/db/src/scripts/status.ts#diffMigrations`, `getAppliedMigrationsWithDates`, `main`; `packages/db/src/scripts/status.schema.ts`                                                                                                                                                                         | Keep generic divergence reporting. Add a Collections-specific baseline verifier rather than weakening generic migration checks.                                                                                                                                        |
| Deployment gate                   | `scripts/deploy/server-gate.sh#preflight` and deploy flow                                                                                                                                                                                                                                                       | Run the Collections baseline verifier before migration/startup and verify compatible schema after migration. An unsupported baseline stops before application containers are replaced.                                                                                 |
| Assessment calculator             | `apps/api/src/modules/dues/calculator.ts#calculateAssessment`, `proratedCents`, `boundedEligibility`                                                                                                                                                                                                            | Retain integer-cent half-up arithmetic, but replace `NEXT_PERIOD` postponement and label-driven boundary behavior with explicit conflict and lifecycle-boundary proration. Extend from one period to planner-owned period items.                                       |
| Assessment repository             | `apps/api/src/modules/dues/repository.ts#listEligibleMembers`, `listEffectivePrices`, `claimReceipt`, `finalizeReceipt`, `lockPeriod`, `findObligation`, `insertObligation`                                                                                                                                     | Add member-scoped range queries, complete price-candidate detection, existing-obligation lookup, deterministic locking, and transaction-aware insertion. Remove `insertObligation`'s nested transaction wrapper from orchestration by exposing an in-transaction seam. |
| Assessment service                | `apps/api/src/modules/dues/service.ts#AssessmentService`, `assessmentSource`, `snapshot`, `obligationComponents`                                                                                                                                                                                                | Split read-only `preview` from mutating `executeRange`. Execution recomputes and compares the reviewed fingerprint before all-or-nothing insertion.                                                                                                                    |
| Dues routes                       | `apps/api/src/routes/dues.ts#duesRoutes`, `periodBounds`, `context`, current `generationBodySchema`                                                                                                                                                                                                             | Replace the single-month generation command with preview and reviewed range execution contracts. Keep feature gates and finance authorization.                                                                                                                         |
| Obligations                       | `packages/db/src/schema/dues.ts#duesObligations`, `duesObligationComponents`, `duesGenerationReceipts`                                                                                                                                                                                                          | Reuse immutable obligations/components and their natural uniqueness; snapshots carry the range-plan facts and calculation evidence.                                                                                                                                    |
| Debt repository                   | `apps/api/src/modules/dues/allocations.ts#getDebt`, `DebtDetail`, `DebtObligation`                                                                                                                                                                                                                              | Add a stable selection fingerprint and settlement/tender correlation to the read model; do not add another debt projection.                                                                                                                                            |
| Settlement repository             | `apps/api/src/modules/dues/allocations.ts#claimSettlement`, `insertAllocation`, `listAllocations`, `findAllocation`                                                                                                                                                                                             | Replace caller-supplied monetary amounts with a locked `selectFullOutstanding` repository operation. Keep non-cash community-work behavior separate.                                                                                                                   |
| Settlement service                | `apps/api/src/modules/dues/settlements.ts#SettlementService`, `SettlementCommand`, `ReverseSettlementCommand`                                                                                                                                                                                                   | Narrow monetary creation to explicit obligation IDs, one shift, and one tender. Reverse a whole settlement, not a selected allocation.                                                                                                                                 |
| Settlement schema                 | `packages/db/src/schema/dues-settlements.ts#duesSettlements`, `duesAllocations`                                                                                                                                                                                                                                 | Reuse `reversalOfSettlementId` and compensating allocations as the debt-side correlation. Add only constraints/indexes needed to make whole-operation reversal unique.                                                                                                 |
| Agreements and community work     | `apps/api/src/modules/dues/agreements.ts#AgreementService`; `apps/api/src/modules/dues/community-work.ts#CommunityWorkService`                                                                                                                                                                                  | Preserve their existing gates and commands. Agreement remains debt-neutral; accepted community work remains its existing explicit non-cash operation.                                                                                                                  |
| CashDesk shifts/tenders           | `apps/api/src/modules/dues/cash-desk.ts#CashDeskService`, `TenderCommand`, `reconcileTenders`, private `shift`; `packages/db/src/schema/dues-cash.ts#duesCashShifts`, `duesCashTenders`                                                                                                                         | Extract transaction-aware tender persistence and open-shift validation. Derive physicality from the closed tender enum. Electronic tenders remain ledger facts but do not change expected physical cash.                                                               |
| Treasury routes                   | `apps/api/src/routes/treasury.ts#treasuryRoutes`                                                                                                                                                                                                                                                                | Continue to own shift opening/closing and Treasury views. Collections never gains shift-management controls.                                                                                                                                                           |
| Approval tokens                   | `packages/db/src/schema/approval-tokens.ts#approvalTokens`; `packages/approval/src/service.ts#createApprovalToken`, `getApprovalToken`, `consumeApprovalToken`                                                                                                                                                  | Extend this table/service with scoped snapshot, explicit decision, authenticated decision actor, and deterministic execution identity. Replace approve-only consumption; do not add a condonation-request table.                                                       |
| Approval routes                   | `apps/api/src/routes/approval.ts#approvalRoutes`, `internalApprovalLinksRoutes`, `decisionSchema`, `toContextResponse`                                                                                                                                                                                          | Replace the business-action stub and public-by-token decision authorization. Condonation decisions require authenticated Treasury identity and requester separation. Permit authenticated `OPERADOR` request creation only for this scoped action.                     |
| Audit                             | `packages/audit/src/emitter.ts#AuditAction`, `emitAudit`; `apps/api/src/routes/audit.ts#DUES_AUDIT_ACTIONS`, `DUES_FINANCIAL_ACTIONS`                                                                                                                                                                           | Add immutable request, decision, execution, stale, failure, replay, and recovery actions with redacted DTO mapping. Successful financial execution and its success audit commit together.                                                                              |
| Collections client                | `apps/web/src/lib/api/dues.ts` and `apps/web/src/lib/collections-idempotency.ts#createCollectionsIdempotencyStore`                                                                                                                                                                                              | Replace amount-bearing payment DTOs; add range preview/execution, tendered payment, whole-operation reversal, and condonation lifecycle decoders. Never persist approval token secrets client-side.                                                                    |
| Collections container             | `apps/web/src/app/(authed)/collections/page.tsx#CollectionsPage`, `canAccessCollections`                                                                                                                                                                                                                        | Remain the data/state container. It maps typed server outcomes to view models, refreshes after conflicts, and does not infer financial success.                                                                                                                        |
| Collections components            | `apps/web/src/components/collections/GenerationPanel.tsx#GenerationPanel`, `DebtPanel.tsx#DebtPanel`, `SettlementActions.tsx#SettlementActions`, `AgreementActions.tsx#AgreementActions`, `AgreementForm.tsx#AgreementForm`, `CommunityWorkForm.tsx#CommunityWorkForm`, `CollectionStatus.tsx#CollectionStatus` | Evolve into range preview, debt selection/payment, reversal, and treatment presenters. Delete manual amount inputs and allocation selection. Keep forms presentational.                                                                                                |
| Shared Gorriti Premium primitives | `apps/web/src/components/ui/Modal.tsx#Modal`, `apps/web/src/components/ui/Badge.tsx#Badge`, `apps/web/src/components/cards/StatusBadge.tsx#StatusBadge`, `apps/web/src/components/tables/DataTable.tsx#DataTable`, `apps/web/src/components/admin/ApprovalCard.tsx#ApprovalCard`                                | Reuse responsive dialog, badges, table/card behavior, and approval presentation. Extend primitives only for a generally reusable accessibility need; do not create Collections-only copies.                                                                            |
| Web verification                  | `apps/web/src/app/(authed)/collections/page.test.tsx`, component tests under `apps/web/src/components/collections/`, `apps/web/e2e/collections.spec.ts`                                                                                                                                                         | Cover each public work unit's complete responsive and accessible states as that work unit lands, not in a deferred styling pass.                                                                                                                                       |

## Forward-only compatibility and deployment

### Migration placement

Create the next journaled migration at the current head (expected tag prefix `0059_`) and register it once in `packages/db/drizzle/meta/_journal.json`. It must transform only the exact supported sparse `deportes.inscripciones` state into the exact compatible state below. It must not copy the body of `0036`, insert a historical ledger row, or rewrite any journal timestamp/hash. A compatible schema is not accepted merely because `fecha_baja` exists.

The migration is safe to rerun at the SQL statement level, but Drizzle remains the migration owner. Guarding handles only the exact supported sparse state or the exact compatible no-op state; it is not permission for untracked replay.

### Exact `deportes.inscripciones` acceptance predicate

The baseline verifier MUST accept only an exact supported migration ledger identity (the contiguous local lineage or the observed sparse BETA lineage defined below) paired with one of these exact schema states:

1. **Known sparse pre-state:** the exact supported predecessor ledger, with every lifecycle addition absent: `fecha_baja` absent, `baja_motivo` absent, `updated_at` absent, `inscripciones_estado_check` absent, and `inscripciones_baja_metadata_check` absent. Existing non-lifecycle columns remain the observed supported `deportes.inscripciones` shape.
2. **Compatible state:** the exact supported predecessor or exact current head ledger, with `fecha_baja date NULL`, `baja_motivo text NULL`, and `updated_at timestamptz NOT NULL DEFAULT now()`, plus a **validated** `inscripciones_estado_check` with canonical predicate `CHECK (estado IN ('activa', 'pendiente', 'baja'))` and a **validated** `inscripciones_baja_metadata_check` with canonical predicate `CHECK (estado <> 'baja' OR (fecha_baja IS NOT NULL AND baja_motivo IS NOT NULL AND btrim(baja_motivo) <> ''))`. Constraint identity, validation status, column type, nullability, and default must all match this predicate.

Any partial addition or mismatch—wrong type, default, nullability, constraint definition, constraint name, unvalidated constraint, missing field, extra lifecycle field, or unsupported ledger identity—MUST fail closed. The forward migration may transform only the exact known sparse pre-state or no-op the exact compatible state; it MUST never replay `0036`.

### Baseline verifier

Add a read-only verifier, likely `packages/db/src/scripts/collections-baseline.ts`, called by `scripts/deploy/server-gate.sh` before migrations/startup. It reads the selected Drizzle ledger (`drizzle.__drizzle_migrations`, with the existing `public` fallback) and `information_schema.columns` in one consistent observation. Local identity is the tuple `{ tag, journalWhen, sha256(sqlBytes) }`, using the same raw-file SHA-256 convention as `packages/db/src/scripts/status.ts`; applied identity is `{ created_at, hash }`. Classification compares the complete ordered tuples, not only migration numbers or the latest timestamp.

The supported pre-`0059` ledger shapes are closed and exact:

1. **Contiguous local lineage:** every local journal identity in journal order from `0000_quick_wraith` through `0058_dues_open_agreements`, with each applied `created_at` equal to that entry's `when` and each applied hash equal to SHA-256 of that exact local SQL file. There may be no missing, additional, reordered, duplicate, hash-mismatched, or timestamp-mismatched row.
2. **Observed sparse BETA lineage:** exactly `0044_socios_member_evidence_resolutions@1785758400000`, then `0048_socios_admin_route_relations_repair@1786320000000`, `0049_dues_pricing_obligations@1786900000000`, `0050_dues_benefit_rules@1786900001000`, `0051_dues_family_groups@1786900002000`, `0052_dues_settlements@1786900003000`, `0053_dues_agreements_community_work@1786900004000`, `0054_dues_cash_closes@1786900005000`, `0055_cash_policy_atomicity@1786900006000`, `0056_cash_recovery_policy@1786900007000`, `0057_cash_lifecycle_boundaries@1786900008000`, and `0058_dues_open_agreements@1786900009000`. Every row must carry the SHA-256 of the correspondingly named local SQL file. No `0045`–`0047`, earlier row, extra row, duplicate, reorder, hash mismatch, or timestamp mismatch is accepted.

After `0059`, the only supported head is one of those exact predecessor shapes followed by the exact local `0059` identity. If `deportes.inscripciones.fecha_baja` already exists as compatible `date` semantics on a supported predecessor, `0059` is a guarded no-op and startup still requires the new exact head. Compatibility of the column NEVER makes an unknown ledger shape acceptable.

| Observed schema on an exact supported predecessor                                                                                          | Pre-migration result              | Migration result                                                                        | Startup result                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The exact compatible `deportes.inscripciones` state exists on an exact supported predecessor                                               | Supported/already compatible      | Exact local `0059` records a guarded no-op                                              | Continue only after exact-head and full schema post-check                       |
| The exact known sparse pre-state exists on an exact contiguous or sparse BETA predecessor                                                  | Supported/forward repair required | Exact local `0059` adds all lifecycle fields/constraints; no historical row is inserted | Continue only after exact-head and full schema post-check                       |
| Ledger has any other gap, row, order, hash, timestamp, or head; table is absent; or any schema predicate is partial/mismatched/unvalidated | Unsupported                       | Do not migrate                                                                          | Stop with the first ledger/schema mismatch and a forward-only corrective action |

The verifier must not “fix” a baseline. Its only verbs are classify and report. Generic `migrate:status` divergence remains intact.

### Rollback principle

Schema rollback is forward-only: never drop `fecha_baja`, replay `0036`, or edit ledger history. If deployment fails after compatibility is applied, roll application images/configuration back while leaving the additive compatible schema in place. Any later schema correction is a new guarded forward migration.

## Assessment range planner

### Data model

The planner is a pure/read-only orchestration over repository facts. Suggested types are colocated with `AssessmentService` or a focused `range-planner.ts` as required by work-unit 2A/2B boundaries:

```ts
type AssessmentRangeRequest = {
  socioId: string
  fromPeriod: string // YYYY-MM
  throughPeriod: string // inclusive YYYY-MM
}

type AssessmentPlan = {
  socioId: string
  fromPeriod: string
  throughPeriod: string
  executable: boolean
  currency: string | null
  periods: AssessmentPlanPeriod[]
  issues: AssessmentPlanIssue[]
  sourceSnapshot: AssessmentSourceSnapshot
  fingerprint: string
}

type AssessmentPlanPeriod = {
  period: string
  start: string // first calendar day, inclusive
  end: string // first day of next month, exclusive
  calendarDays: number
  components: AssessmentPlanComponent[]
  existingObligationId: string | null
  pendingAmountCents: number
}

type AssessmentPlanComponent = {
  kind: 'BASE' | 'SPORT'
  componentKey: string
  lifecycle: { alta: string; baja: string | null }
  eligibleFrom: string
  eligibleTo: string
  eligibleDays: number
  calendarDays: number
  currency: string
  segments: AssessmentPriceSegment[]
  numerator: number
  amountCents: number
  status: 'PENDING' | 'ZERO' | 'ALREADY_GENERATED' | 'CONFLICT'
}

type AssessmentPriceSegment = {
  priceVersionId: string
  from: string // inclusive intersection bound
  to: string // exclusive intersection bound
  eligibleDays: number
  unitAmountCents: number
  rule: 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
}
```

`AssessmentSourceSnapshot` contains ordered enrollment IDs and alta/baja facts, effective price candidates and effective bounds, existing obligation IDs/amounts, requested range, calculator version, and rounding mode. The fingerprint is SHA-256 over a canonical, key-sorted encoding of that snapshot and the complete plan. It is not a client-authored summary.

### Planner rules and exact intra-month math

1. Convert `fromPeriod` and inclusive `throughPeriod` to ordered calendar-month intervals `[monthStart,nextMonthStart)`. Reject inverted input and any through-period after the club's current calendar month.
2. For each base or sport component-period, intersect the calendar month with its lifecycle eligibility `[alta,baja)`. Alta counts; baja does not. Same-day alta/baja has zero eligible days.
3. Query every non-revoked price version whose effective interval `[effectiveFrom,effectiveTo)` intersects that eligibility interval; the current `listEffectivePrices` point-at-period-start query is insufficient and must become an interval-overlap query.
4. Sweep all eligibility and price boundaries into maximal price-bound segments. Every eligible day must be covered by exactly one applicable price version. A day covered by zero or multiple versions emits an issue with component, period, and affected interval and blocks the WHOLE preview/execution. An explicit zero price is one valid covering price.
5. Any segment carrying `NEXT_PERIOD` is a blocking issue; it never postpones accrual. `FULL_MONTH` is metadata only for lifecycle-bound calculation. Use the actual calendar-month denominator `D` (28/29/30/31) for every segment in that component-period.
6. For segment `s`, calculate the integer numerator `Ns = unitAmountCents(s) × eligibleDays(s)`. Sum those integer numerators for the complete component-period, `N = Σ Ns`, before rounding. Compute `q = floor(N / D)` and `r = N mod D`; the component amount is `q + 1` when `2r >= D`, otherwise `q`. This is one nearest-cent rounding with exact halves up. Safe-integer/maximum-money checks apply to every product, the aggregate numerator, the rounded component, and the period sum. Do not round segments separately and do not round the range total again.
7. A fully eligible component-month with one price naturally yields that full unit amount. Multiple successive prices in one month yield their day-weighted aggregate under the shared month denominator. For QA-001, NATACION effective `2026-08-24` does NOT backcharge eligible `2026-07-25..2026-08-24`; those uncovered days block preview until authoritative price versions cover every eligible day.
8. Persist and fingerprint ordered segment snapshots—not one `priceVersionId`—for every component: `{ priceVersionId, from, to, eligibleDays, unitAmountCents, rule }`, plus `D`, every `Ns`, aggregate `N`, rounding remainder/result, lifecycle bounds, and all candidate intervals. Existing `dues_obligation_components.price_version_id` may be null when multiple segments apply; `price_snapshot` and `calculation_inputs` are the immutable multi-segment authority. Do not invent a parallel segment table in this change.
9. Mark existing monthly obligations as `ALREADY_GENERATED`; retain them in the preview and source fingerprint but exclude them from pending creation. Collect all issues across the range; any issue makes the complete plan non-executable and no valid subrange is offered.

### API and execution

- `POST /api/v1/dues/assessments/preview`: body `{ socio_id, from_period, through_period }`; read-only; returns the complete plan DTO and `fingerprint`.
- `POST /api/v1/dues/assessments/execute`: same range plus `preview_fingerprint`; requires `Idempotency-Key`; no amount or component override is accepted.

`execute` opens one DB transaction, claims the range receipt, locks the member/range in deterministic order, rereads every source fact, rebuilds the plan, and compares its fingerprint. A mismatch returns conflict with changed fact classes and creates nothing. A match inserts all missing positive obligations/components, finalizes one receipt, and writes audit evidence in that transaction. Zero and already-generated periods remain explicit result items. Equivalent retries return the receipt result. Concurrent distinct keys serialize on the same member/range and the loser either observes existing obligations in a fresh matching plan or receives a stale-plan conflict; it never duplicates debt.

Refactor `repository.insertObligation` into `insertObligationInTransaction(db: DuesDb, input)` plus an optional top-level wrapper for standalone callers. `AssessmentService.executeRange` uses only the transaction-aware function, avoiding nested transactions and preserving whole-range atomicity.

## Full-selection payment contract

### Internal command first; public contract only with atomic Treasury

Acceptance stage 4 implements and tests the full-selection command, strict validator, selection fingerprint, and locked server-derived allocations internally. In that backend-only work unit it withdraws the legacy public monetary route: `/api/v1/dues/settlements` MUST omit monetary registration or reject it as unavailable. The amount-bearing Collections client method and payment controls MUST be absent from the reachable public flow; their removal and replacement with the styled client/UI belongs to 7B, never to a backend atomicity unit. Non-cash community work remains on its separate route. The internal full-selection command is reachable only from tests/internal composition and cannot commit through public API, client, or UI.

Delivery work unit 5A establishes and proves `recordSettlementTenderInTransaction` without registering a payment route or exposing Web behavior. Work unit 5B consumes that seam in the atomic payment orchestrator and registers the replacement strict backend API only after the forced-rollback proof. The client decoder and payment UI action belong to later styled unit 7B. There is no intermediate release in which ANY successful public payment lacks Treasury truth, and no backend atomicity unit exposes Web client/UI work.

The internal command that becomes public through the backend in work unit 5B is:

```ts
type PaymentTender = 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'

type FullSelectionPaymentCommand = AuditContext & {
  socioId: string
  obligationIds: string[]
  shiftId: string
  tender: PaymentTender
  selectionFingerprint: string
}
```

Once the atomic work unit lands, `POST /api/v1/dues/settlements` accepts only:

```json
{
  "socio_id": "uuid",
  "obligation_ids": ["uuid"],
  "shift_id": "uuid",
  "tender": "CASH",
  "selection_fingerprint": "sha256"
}
```

The route rejects unknown fields, so `amount_cents`, `allocations`, `currency`, `kind`, multiple tenders, and manual evidence cannot be smuggled into payment. Existing non-cash community work continues through `/api/v1/dues/community-work`, not this monetary endpoint.

Within the transaction, `selectFullOutstanding` locks selected obligations in sorted UUID order and validates: non-empty unique explicit IDs; all belong to `socioId`; all are open; one currency; positive full outstanding balances; current selection fingerprint matches; and every obligation remains unchanged. The server derives each allocation amount and total. The supplied `shiftId` must identify an open, policy-valid CashDesk shift available to the authenticated finance actor. Every tender, including electronic tender, requires that open shift.

The idempotency fingerprint covers sorted obligation IDs, shift ID, tender, and reviewed selection fingerprint. An equivalent replay returns the committed payment. A changed payload with the same key conflicts. Concurrent payments lock the same obligations; only the first can consume the balances.

## One financial transaction and the no-nesting seam

`SettlementService.create` is the transaction owner. It performs this ordered unit of work on one `tx`:

1. Validate/claim payment idempotency.
2. Lock and derive full outstanding selections.
3. Lock and validate the open CashDesk shift.
4. Insert one monetary `dues_settlements` row.
5. Insert one full allocation for each selected obligation.
6. Insert one `dues_cash_tenders` row with `source_type='SETTLEMENT'` and `source_id=<settlement id>`.
7. Append settlement, allocation, and tender audit events.
8. Return only after commit.

Work unit 5A refactors `CashDeskService.recordTender` in the same pattern already used by `recordExpenseCompensationInTransaction`:

```ts
recordSettlementTenderInTransaction(db: CashDb, input: SettlementTenderInput)
```

The function accepts the caller-owned `tx`; it never calls `db.transaction`. The existing public `recordTender` wrapper may remain for Treasury-owned manual calls, but Collections must inject/use only the in-transaction function. Work unit 5B owns `SettlementService.create`, the strict public payment API, and the single transaction that consumes the seam. Likewise, settlement repository methods accept `DuesDb`. This is the concrete seam that prevents nested transaction commits.

Physicality is derived, never caller supplied:

| Tender     | Treasury/CashDesk fact     | Expected physical cash |
| ---------- | -------------------------- | ---------------------- |
| `CASH`     | `SETTLEMENT`, physical     | Increase by amount     |
| `DEBIT`    | `SETTLEMENT`, non-physical | No change              |
| `CREDIT`   | `SETTLEMENT`, non-physical | No change              |
| `TRANSFER` | `SETTLEMENT`, non-physical | No change              |

`reconcileTenders` retains electronic facts for Treasury reporting but computes the expected counted physical balance from `CASH` only. A forced failure at any numbered write proves no settlement, allocation, tender, or success audit survives.

## Exact reversal correlation

Change reversal to `POST /api/v1/dues/settlements/:id/reverse` with body `{ reason }` and `Idempotency-Key`. The client cannot choose an allocation.

The service locks the original settlement and resolves all of its allocations and the unique CashDesk tender by `dues_cash_tenders.source_type='SETTLEMENT' AND source_id=<original settlement id>`. It rejects non-monetary, incomplete, already-reversed, mixed, or missing correlation. In one transaction it:

- creates one settlement with `reversal_of_settlement_id=<original id>`;
- creates compensating allocations for every original allocation, each using `compensates_allocation_id`;
- creates the matching compensating CashDesk tender bound to the reversal settlement and original tender correlation;
- records the reason and append-only audit evidence.

The CashDesk policy must explicitly recognize a monetary reversal settlement as a compensating direction while preserving append-only records. Correlation is exact through original settlement -> original allocations and tender, then reversal settlement -> compensating allocations and tender. A uniqueness constraint/index on whole-settlement reversal and settlement tender source prevents a second reversal. Replay returns the first result or reports already reversed; it never asks the operator to reselect allocations or tender.

## Approval-backed condonation

### Existing defects to replace

The implementation must replace, not wrap, these defects:

1. `packages/approval/src/service.ts#consumeApprovalToken` always writes `status: 'approved'` and has no decision input.
2. `apps/api/src/routes/approval.ts#approvalRoutes` consumes before examining financial execution and contains an explicit business-action stub.
3. `apps/api/src/routes/approval.ts#internalApprovalLinksRoutes` is restricted to `ADMIN`/`TESORERO`, excluding the specified authenticated `OPERADOR` request path.
4. Approval decisions are public-by-token and do not bind an authenticated Treasury actor or enforce requester/approver separation.
5. `approval_tokens` does not persist the selected-obligation snapshot, decision actor/reason/evidence, or deterministic execution identity.

### Token-owned request and decision

Extend `approval_tokens`; do not add a condonation request table. Use `action_type='dues.condonation'`, a stable request UUID as `action_id`, a JSON scoped snapshot of selected obligation IDs/currencies/full outstanding balances, requester identity in `created_by_operator_id`, expiry, explicit status, decision actor/time/reason/evidence, and deterministic execution identity. The raw token remains hashed and is never stored by Web.

Add an authenticated `OPERADOR` request route in the Collections/dues boundary. It validates explicit, full, same-currency open obligations and creates the scoped pending token plus immutable request audit in one transaction. It creates no settlement, allocation, tender, condonation, or balance mutation.

Treasury decision uses an authenticated route and an explicit `approve | reject` body. Token possession identifies scope but does not replace Treasury authentication. The service locks the token, verifies pending/unexpired/scope, verifies the approver is eligible and differs from `createdByOperatorId`, then commits exactly one decision and decision audit.

- Rejection sets `rejected`; its audit states no financial execution. It never invokes settlement code.
- Approval sets `approved` with approver evidence and a deterministic execution identity. Work unit 8A does not execute financial effects; the approved decision is handed to work unit 8B. The approved decision remains auditable if execution fails, enabling recovery without a second decision.

### Approved execution and recovery (work unit 8B)

Work unit 8B consumes only an approved, authenticated decision and owns the financial execution, audit, and recovery boundary. Execution uses a stable key derived from the token/request identity. It locks every snapshotted obligation, compares IDs, currency, and full outstanding balances, and either:

- atomically creates the full condonation financial effect and one successful audit lineage; or
- records a stale/non-executed or failed/recoverable audit outcome without partial financial facts.

Replay/recovery uses the same execution identity. A prior committed result is returned. A prior failed-no-effect attempt may retry the same lineage; a second successful financial effect or success audit is impossible. Request, requester, approver, explicit decision, reason/evidence, snapshot, revalidation, execution identity, and terminal outcome are linked in audit metadata. Audit route DTOs expose only role-authorized evidence.

Condonation reuses the debt settlement/allocation machinery as an explicit non-cash financial treatment, but it is not payment and creates no CashDesk tender. Community work remains its existing gated non-cash command. No token state is mirrored in a Collections table. Work unit 8C consumes the proven lifecycle as styled treatment UI; it does not authorize, execute, or audit financial effects.

## Treatment boundaries

| Operation               | May reduce debt                                                         | CashDesk tender                 | Approval requirement                      | Boundary                                          |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Payment                 | Yes, full selected outstanding only                                     | Exactly one `SETTLEMENT` tender | Finance authorization                     | No manual/partial allocation                      |
| Accepted community work | Only through existing gated supported valuation/allocation operation    | None                            | Existing gates/authorization              | Not inferred from agreement or condonation        |
| Agreement               | No                                                                      | None                            | Existing agreement gates                  | Terms and revisions are commitments/evidence only |
| Condonation             | Only after explicit Treasury approval and fresh full-balance validation | None                            | Scoped `approval_tokens` request/decision | Request and rejection are inert                   |

No operation calls `CtacteProjectionService`, `/api/v1/dues/ctacte/projections`, or any CTActe client. Existing unrelated feature-gated CTActe behavior is untouched.

## UI information architecture

`CollectionsPage` remains a container and coordinates member selection, server data, idempotency keys, refresh, and typed outcome mapping. Components receive immutable view models and callbacks; they do not fetch or derive financial amounts.

```text
CollectionsPage (container)
  Member context/header
  AssessmentRangePanel (presentational)
    range controls -> preview -> itemized period/component review -> execute
  DebtPanel (presentational)
    DebtObligationList
    FullSelectionPaymentPanel
    SettlementReversalPanel
  TreatmentWorkspace (presentational tabs/sections)
    Payment | Community work | Agreement | Condonation
    CondonationLifecycle
```

Use `Modal` for destructive/financial confirmation and reversal reason, `Badge`/`StatusBadge` with text labels for lifecycle state, and `DataTable` on wide screens with a semantic stacked-card equivalent on narrow screens. Controls retain labels, visible focus, keyboard order, and touch target sizing. `aria-live` status regions announce loading/commit outcomes; recoverable errors and committed results receive managed focus. Color is supplementary.

Complete Gorriti Premium styling and accessibility ship with each relevant public work unit:

- Compatibility/deploy diagnostics use actionable Spanish operator/deploy copy where surfaced.
- Planner UI includes loading, no applicable charge, explicit zero price, missing/ambiguous price, `NEXT_PERIOD` conflict, already generated, executable preview, stale, and error states.
- Execution UI distinguishes created, replayed, zero-obligation, conflict, rollback, and success.
- Payment UI uses checkboxes for obligations, read-only full balances and derived total, one tender radio group, open-shift failure, mixed-currency prevention, stale/conflict refresh, transactional failure, replay, and committed success. It contains no amount inputs.
- Reversal UI shows the complete original settlement, allocations, tender, amount, and mandatory reason; it distinguishes conflict, replay, rollback, and success.
- Treatments UI keeps four separately named operations. Pending/rejected condonation continues showing unchanged debt; only approved-and-executed refreshes debt. Expired, stale, replayed, and recovery outcomes are explicit and identify requester/approver where authorized.

Acceptance stage 7 is integration and end-to-end consolidation, not the first styling pass. UI states are introduced only in later styled units 7A/7B, after their public backend contracts are proven, and are production-styled and accessible when merged. Backend atomicity units never expose Web client/UI work.

## Strict TDD strategy

Strict TDD applies to every implementation unit. Add the named behavior test first, run the narrowest capable test to observe RED against the then-current code, implement the minimum behavior, then run the wider layer. This design does not claim any historical RED; RED evidence must be captured during apply.

| Acceptance stage | Named RED cases to introduce                                                                                                                                                                                                                                                                                                                                                         | Test layers                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1                | `accepts exact sparse BETA identities without fecha_baja`; `leaves already-compatible exact head unchanged`; `blocks unsupported hash or timestamp before mutation`; `journal appends compatibility migration without 0036 replay`                                                                                                                                                   | DB script unit, PostgreSQL migration integration, deploy Bats/preflight                                                         |
| 2                | `previews inclusive range without mutation`; `uses alta included and baja excluded`; `same-day lifecycle yields zero`; `FULL_MONTH boundary prorates`; `NEXT_PERIOD blocks complete range`; `aggregates price-segment numerators before one half-up rounding`; `missing, uncovered, or overlapping price days block all periods`; `QA-001 uncovered NATACION days do not backcharge` | Calculator unit, planner service unit, repository PostgreSQL, Fastify route, component accessibility                            |
| 3                | `execute matches preview for every period`; `persists ordered segment snapshots`; `existing periods are excluded`; `equivalent retry replays`; `changed source fingerprint creates nothing`; `mid-range persistence failure rolls back all`                                                                                                                                          | Service transaction unit, PostgreSQL integration, route contract, Web state test                                                |
| 4                | `internal payment accepts selected IDs without amounts`; `server derives every full balance`; `rejects empty paid mixed-currency or stale selection`; `public payment API remains unavailable before Treasury atomicity`                                                                                                                                                             | Validator/service unit, repository PostgreSQL locking, route-registration absence tests                                         |
| 5                | `5A tender seam accepts caller transaction without nesting`; `all tenders require open shift`; `CASH changes physical expected balance`; `electronic tenders remain non-physical`; `5B forced failure rolls back settlement allocations tender and audits`; `strict public API appears only with atomic integration`                                                                 | CashDesk seam unit, PostgreSQL transaction integration, settlement service and strict route contract; Web client/UI is deferred |
| 6                | `reverses every allocation and exact tender for original settlement`; `reversal accepts no allocation choice`; `duplicate or concurrent reversal is idempotent`; `reversal write failure preserves original posting`                                                                                                                                                                 | Repository/service unit, PostgreSQL correlation integration, route and component tests                                          |
| 7                | `narrow viewport preserves preview selection tender and reversal information`; `keyboard and focus recover from stale payment`; `success appears only after committed refresh`; `no CTActe control or request exists`                                                                                                                                                                | React Testing Library, axe/accessibility checks where configured, Playwright Collections journey                                |
| 8                | `8A OPERADOR request is inert and scoped`; `requester cannot decide`; `Treasury rejection stays inert`; `8B approved execution applies the full snapshot once`; `stale approval executes nothing`; `recovery returns one success lineage`; `8C keeps agreement alone debt-neutral and renders treatment states`                                                                      | Approval/service unit, PostgreSQL concurrency/transaction, Fastify auth/routes, audit DTO, component and Playwright lifecycle   |
| 9                | `QA-001 produces expected bounded obligations`; `QA-001 payment has matching CashDesk evidence`; `QA-001 exact reversal restores both domains`; `QA-001 treatment evidence preserves boundaries`; `completion remains blocked without user sign-off`                                                                                                                                 | Live BETA runbook evidence plus automated smoke/supporting queries; user acceptance is manual and mandatory                     |

Tests must assert absence of partial rows and false success states, not only response codes. Existing tests that encode manual/partial monetary allocation or approve-only token consumption are replaced because they pin superseded defects; unrelated non-cash community-work and agreement tests remain.

## Deployment, QA-001 evidence, and rollback

Deployment order is: verifier pre-check -> normal migration -> verifier post-check -> API/Web rollout -> readiness -> automated Collections smoke -> live QA-001 acceptance. Record bounded, privacy-safe evidence in `openspec/changes/collections-end-to-end-completion/qa-001-evidence.md`: deployment revision, baseline classification, migration/post-check result, QA-001 range and itemized expected/actual amounts, idempotent replay, settlement ID, CashDesk tender correlation and physicality, reversal correlation, treatment/approval outcomes, timestamps, accepting user identity/reference, and explicit sign-off status. Do not store raw approval tokens or unnecessary member PII.

Rollback is by proven delivery work unit and application image. Financial rollback uses the exact reversal command, never direct ledger edits. A failed transaction needs no compensating edit because it commits nothing. Pending/rejected condonation remains inert; failed approved execution is recovered under the same execution identity. If any QA-001 step or sign-off fails, preserve evidence, classify the failed root boundary, keep Collections incomplete, and retain the exclusive P0 block.

## Pre-split delivery work units and demonstrated review budget

The nine product acceptance stages remain the acceptance vocabulary. They map to the smaller work units below; a work unit is the commit/PR candidate and must remain single-writer and sequential. Forecasts count authored production and test additions plus deletions; generated outputs are excluded only from the numeric forecast, never from candidate identity. Tasks must re-estimate from the actual diff before each apply. If either forecast or actual authored count exceeds 400, split again at the named boundary—NEVER combine units, omit tests, or claim an exception.

| Unit (stage)                                                    | Production | Tests | Total | Dependencies                        | Focused command                                                                                                                                               | Runtime evidence                                                                                                               | Rollback boundary                                                                                  |
| --------------------------------------------------------------- | ---------: | ----: | ----: | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1 (1) Schema migration + exact baseline verifier                |        245 |   125 |   370 | None                                | `pnpm exec vitest run packages/db/src/migration-journal.test.ts packages/db/src/scripts/collections-baseline.test.ts && bats scripts/deploy/server-gate.bats` | preflight on exact contiguous, exact sparse BETA, exact compatible, and hash/timestamp mismatch fixtures                       | revert verifier/deploy wiring and application image; leave additive `0059` schema/head intact      |
| 2A (2) Price-interval resolver and aggregate math               |        155 |   190 |   345 | 1                                   | `pnpm exec vitest run apps/api/src/modules/dues/calculator.test.ts apps/api/src/modules/dues/range-planner.test.ts`                                           | N/A: pure domain/repository fixture boundary; PostgreSQL overlap query is covered in 2B                                        | revert resolver/calculator seam before API exposure                                                |
| 2B (2) Planner repository + preview API                         |        180 |   185 |   365 | 1, 2A                               | `pnpm exec vitest run apps/api/src/modules/dues/repository.test.ts apps/api/src/routes/dues-assessments.test.ts`                                              | authenticated preview against seeded member with zero, covered, uncovered, and overlapping prices                              | remove preview route/service adapter; no obligations were mutable                                  |
| 3 (3) Atomic idempotent backfill                                |        170 |   195 |   365 | 2B                                  | `pnpm exec vitest run apps/api/src/modules/dues/service.test.ts apps/api/src/modules/dues/range-execution.test.ts`                                            | execute seeded multi-period plan twice and observe one obligation set                                                          | remove execution route/orchestrator; preserve any already-valid obligations and preview            |
| 4 (4) Internal full-payment contract + legacy public withdrawal |        150 |   185 |   335 | 3                                   | `pnpm exec vitest run apps/api/src/modules/dues/selection.test.ts apps/api/src/routes/dues-settlements-legacy.test.ts`                                        | authenticated legacy/new monetary API requests are unavailable; internal service integration alone succeeds                    | revert internal command/repository seam; do not restore non-atomic public payment                  |
| 5A (5) CashDesk transaction-aware tender seam                   |        140 |   160 |   300 | 4                                   | `pnpm exec vitest run apps/api/src/modules/dues/cash-desk.test.ts apps/api/src/modules/dues/cash-desk-transaction.test.ts`                                    | seeded open-shift tender seam for all tenders plus forced seam failure; no public payment API                                  | remove only the transaction-aware CashDesk seam and its tests; leave public payment unavailable    |
| 5B (5) Atomic payment orchestrator + public API                 |        190 |   205 |   395 | 4, 5A                               | `pnpm exec vitest run apps/api/src/modules/dues/settlements.test.ts apps/api/src/routes/dues-settlements.test.ts`                                             | authenticated payment with open shift for each tender plus forced failure showing zero partial rows; Web client/UI is N/A here | remove backend route/orchestrator together; committed payments use exact reversal, never row edits |
| 6A (6) Reversal domain + Treasury correlation                   |        170 |   195 |   365 | 5B                                  | `pnpm exec vitest run apps/api/src/modules/dues/reversal.test.ts apps/api/src/modules/dues/reversal-correlation.test.ts`                                      | service-level reversal of a seeded multi-allocation payment                                                                    | revert unexposed reversal service/schema adapter; retain append-only posted facts                  |
| 6B (6) Reversal API + idempotency                               |        145 |   180 |   325 | 6A                                  | `pnpm exec vitest run apps/api/src/routes/dues-reversal.test.ts apps/web/src/lib/api/dues.test.ts`                                                            | authenticated original-payment review and exact reversal API journey; styled UI remains in 7B                                  | remove reversal route/client contract together; already committed reversals remain append-only     |
| 7A (7) Styled preview + itemized debt shell                     |        155 |   180 |   335 | 2B, 3, 6B                           | `pnpm exec vitest run apps/web/src/components/collections/GenerationPanel.test.tsx apps/web/src/components/collections/DebtPanel.test.tsx`                    | Playwright narrow/wide preview and debt-read journey                                                                           | remove new presenters/container wiring; backend contracts remain available                         |
| 7B (7) Payment, confirmation, and reversal UI                   |        155 |   190 |   345 | 5B, 6B, 7A                          | `pnpm exec vitest run "apps/web/src/app/(authed)/collections/page.test.tsx" apps/web/src/components/collections/SettlementActions.test.tsx`                   | Playwright payment and reversal over atomic public APIs, including client decoder states                                       | remove action presenters/client wiring together; financial records remain authoritative            |
| 8A (8) Approval decision + OPERADOR request authorization       |        120 |   145 |   265 | 7B, existing `approval_tokens` seam | `pnpm exec vitest run packages/approval/src/service.test.ts apps/api/src/routes/approval.test.ts`                                                             | authenticated OPERADOR request then Treasury approve/reject against PostgreSQL; verify no financial rows                       | remove scoped request/decision routes and service wiring; pending/rejected remain inert            |
| 8B (8) Condonation execution + audit/recovery                   |        155 |   190 |   345 | 3, 6A, 8A                           | `pnpm exec vitest run apps/api/src/modules/dues/condonation-execution.test.ts packages/audit/src/emitter.test.ts`                                             | approved execution, stale rejection, forced no-effect failure, and same-identity recovery against PostgreSQL                   | remove execution/recovery adapter; committed condonations remain append-only                       |
| 8C (8) Unified treatments UI                                    |        150 |   185 |   335 | 7B, 8B                              | `pnpm exec vitest run apps/web/src/components/collections/TreatmentWorkspace.test.tsx apps/web/src/components/collections/CondonationLifecycle.test.tsx`      | Playwright pending/rejected/approved/stale treatment journey                                                                   | remove treatment workspace wiring; preserve existing gated agreement/community-work behavior       |
| 9 (9) QA-001 BETA acceptance evidence                           |         60 |    40 |   100 | 1–8C                                | `pnpm exec vitest run apps/api/src/modules/dues/qa-001-smoke.test.ts`                                                                                         | mandatory live QA-001 run and explicit accepting-user sign-off                                                                 | retain failed evidence and P0 block; no direct financial rollback outside exact reversal           |

**Forecast total:** 15 units; **2,340 production + 2,550 tests = 4,890 authored changed lines**. Every unit remains at or below 400 lines; generated outputs are excluded only from this numeric forecast, never from candidate identity.

Dependency graph:

```text
    1 -> 2A -> 2B -> 3 -> 4 -> 5A -> 5B -> 6A -> 6B -> 7A -> 7B -> 8A -> 8B -> 8C -> 9
                              internal only --^ public payment appears in 5B; Web payment UI appears in 7B

```

## Scoped reconciliation with overlapping changes

| Existing/active artifact                                                                                   | This change takes precedence only for                                                                                                                               | Preserved behavior                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openspec/changes/club-dues-collection-and-daily-cash/`                                                    | Monetary partial/manual allocations; lifecycle-label behavior that suppresses alta/baja proration; effective `NEXT_PERIOD` postponement across lifecycle boundaries | Benefits, agreements, accepted community-work gates and semantics, CashDesk shifts/expenses/close, audit, optional CTActe behavior outside this explicit flow |
| `native-collections-web` canonical/active results and this change's `specs/native-collections-web/spec.md` | Complete range, full-selection tender, exact reversal, approval lifecycle, responsive state requirements                                                            | Existing Collections feature gate, navigation/access shell, agreement/community-work controls where still authorized                                          |
| `dues-negotiated-settlement` prior direction                                                               | Flexible monetary allocation and allocation-by-amount UI/API                                                                                                        | Negotiated agreement evidence and separate non-payment treatment behavior                                                                                     |
| `auth-login`                                                                                               | Adds the scoped `dues.condonation` `OPERADOR` request and authenticated Treasury decision rules                                                                     | Hashing, expiry, single-use token security, unrelated action types and authorization contracts                                                                |
| `debt-allocation-settlement`                                                                               | Full selected-balance payment, whole-operation reversal, and approved condonation execution                                                                         | Append-only obligations/settlements/allocations and unrelated non-cash operations                                                                             |
| `audit-logger`                                                                                             | Adds condonation request/decision/execution/recovery evidence                                                                                                       | Existing immutable emitter, privacy minimization, and unrelated audit DTOs                                                                                    |
| `deployment-devops`                                                                                        | Adds the named Collections baseline classifier and post-check                                                                                                       | Existing restricted deploy gate, image pinning, readiness, and rollback behavior                                                                              |

Archive/synchronization must not restore superseded partial/manual monetary allocation, `NEXT_PERIOD` postponement, approve-only token consumption, or allocation-level reversal. It also must not delete unrelated completed behavior from those domains.

## Rejected implementation shapes

- No replay or copied execution of migration `0036`; no historical ledger rewrite.
- No partial payment, manual allocation amount, mixed tender, inferred obligation, or allocation-choice reversal.
- No separate Collections tender table, Treasury projection, condonation request table, approval status mirror, or settlement state machine.
- No nested `db.transaction` between settlement and CashDesk persistence.
- No decision inferred from token consumption and no unauthenticated Treasury decision.
- No agreement side effect on debt and no implicit CTActe call or claim.
- No unstyled intermediate financial UI and no final cosmetic/accessibility pass.
- No monolithic implementation or parallel approval/Treasury/settlement writers.

## Risks and controls

| Risk                                                                             | Control                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live ledger shape differs from the observed BETA baseline                        | Closed supported-state table and read-only preflight; unknown is a stop, not guessed compatibility.                                                                                                                  |
| Existing calculator silently postpones or full-month charges a boundary          | Named RED tests replace those exact branches before planner use.                                                                                                                                                     |
| Range fingerprint is unstable                                                    | Canonical sorted serialization, versioned calculator metadata, and parity tests between preview and execution.                                                                                                       |
| Transaction refactor accidentally nests or commits tender separately             | Transaction-aware repository functions plus injected forced-failure PostgreSQL tests.                                                                                                                                |
| Electronic tender changes physical cash                                          | Closed enum-to-physicality map and reconciliation tests for every tender.                                                                                                                                            |
| Existing approval token semantics lose an approved decision on execution failure | Separate durable explicit decision from deterministic recoverable financial execution; one audit lineage.                                                                                                            |
| Work unit 8A, 8B, or 8C exceeds its review budget                                | Tasks must split again at request/decision, execution/audit/recovery, or presenter/container boundaries and stop before apply if the <400 authored-line forecast cannot be maintained; never waive or hide coverage. |
| Automated success is mistaken for BETA completion                                | QA-001 evidence and explicit accepting-user sign-off remain the terminal gate.                                                                                                                                       |
