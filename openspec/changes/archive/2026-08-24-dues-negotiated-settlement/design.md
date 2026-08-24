# Technical Design: Negotiated Dues Settlement

## 1. Design Goals and Boundaries

This change extends the existing native dues agreement capability into an open negotiation model while preserving the shipped `SIMPLE` and `INSTALLMENT` contracts. It is additive and feature-gated.

The design preserves these boundaries:

- An agreement records negotiated intent; it never changes debt.
- Debt changes only through an explicit settlement allocation.
- Accepted community work uses the existing `NON_CASH` settlement and allocation transaction.
- Collections does not create tender, cash-shift, daily-close, Treasury, or `CTActe` effects.
- Existing pricing, assessment, monetary settlement, reversal, cash, and closing behavior is unchanged.
- Agreement and community-work mutations remain limited to `ADMIN` and `TESORERO`.
- Existing historical agreement, settlement, allocation, evidence, and audit rows remain immutable and readable after feature rollback.

## 2. Current-System Findings

The current implementation already provides useful invariants:

- `tesoreria.dues_agreements` has immutable revisions, a partial unique index allowing at most one `ACTIVE` agreement per obligation, caller-key/fingerprint idempotency, and deferred supersession validation.
- `AgreementService` performs mutation and audit emission in one database transaction, but only validates monetary schedules and exposes no read route.
- The database trigger in migration `0053_dues_agreements_community_work.sql` assumes every `terms` value is a bounded monetary schedule.
- `CommunityWorkService` already claims a `NON_CASH` settlement, inserts one allocation, writes community-work evidence, and emits three audit facts in one transaction. Its replay branch avoids a second allocation and audit emission.
- The Web dues client exposes debt, monetary settlement, and reversal only. `CollectionsPage` owns API orchestration/idempotency and `DebtPanel`/`SettlementActions` are presentational components with Spanish copy and focused conflict handling.
- `AuditAction` already contains all required agreement/community-work action names. `emitAudit` is transaction-capable and durably deduplicates by actor, action, entity, and caller key.

## 3. Data Model Decision

### 3.1 Chosen representation

Keep the existing immutable row and revision lineage, add one technical representation variant, and version the JSONB terms explicitly:

- Extend the existing PostgreSQL `dues_agreement_kind` enum with `NEGOTIATED`.
- Add `terms_version integer NOT NULL DEFAULT 0` to `dues_agreements`.
- Treat `SIMPLE` and `INSTALLMENT` with `terms_version = 0` as the legacy monetary representation.
- Treat `NEGOTIATED` with `terms_version = 1` as the first open representation.
- Keep the required business reason in the existing `reason` column and the reason for later revisions in `revision_reason`.

`kind` is a technical storage/decoder discriminator, not a settlement-category taxonomy. `NEGOTIATED` does not classify the agreement as money, work, or any other business category. All open-ended meaning remains in narrative and optional structures. Future additions to open terms use new `terms_version` decoders and do not require settlement-category enum growth.

This is preferred over replacing the enum/columns with a new discriminated table because it preserves current rows, foreign keys, uniqueness, immutability, route compatibility, and revision lineage without copying financial history. It is preferred over unversioned free-form JSON because readers and validators need deterministic semantics across releases.

### 3.2 Terms contracts

Legacy version 0 remains unchanged:

```ts
type LegacyAgreementTerms = {
  amountCents: number
  installments: Array<{ amountCents: number; dueDate: string }>
}
```

Negotiated version 1 is intentionally open:

```ts
type NegotiatedAgreementTermsV1 = {
  narrative: string
  commitments?: Array<{
    id: string
    title: string
    description?: string
    dueDate?: string
    amountCents?: number
    evidence?: {
      note?: string
      references?: string[]
      metadata?: Record<string, unknown>
    }
  }>
  evidence?: {
    note?: string
    references?: string[]
    metadata?: Record<string, unknown>
  }
}
```

There is deliberately no `category`, `type`, or exhaustive commitment-kind enum. Structured commitments are optional annotations for dates, values, and evidence; the narrative is authoritative for what was agreed. A structured amount is a commitment, not an allocation, and does not reduce debt or create a settlement.

Version 1 validation is bounded rather than categorical:

- `narrative`: trimmed, required, 1–4,000 characters.
- `reason`/`revision_reason`: existing required rule, maximum 500 characters at the API boundary.
- `commitments`: optional, at most 50.
- Each commitment has a stable client-generated UUID `id`, a required trimmed title, optional bounded description, optional valid date-only value, optional positive safe integer amount not exceeding `MAX_MONEY_CENTS`, and optional evidence.
- Evidence/reference strings and metadata are size/depth bounded at the API/service boundary; the complete request body remains below the existing HTTP request limit. Unknown top-level v1 keys are rejected so accidental schema drift requires a new version. `metadata` remains extensible JSON and is bounded by serialized size/depth.

### 3.3 Forward migration

Create the next migration using the repository convention, expected as `packages/db/drizzle/0058_dues_open_agreements.sql`, and register it in `packages/db/drizzle/meta/_journal.json` (plus generated snapshot metadata if the repository migration tooling requires it).

The migration will:

1. Add `NEGOTIATED` to `tesoreria.dues_agreement_kind` with `ADD VALUE IF NOT EXISTS`.
2. Add `terms_version integer NOT NULL DEFAULT 0` and a non-negative check.
3. Leave every existing row untouched; the default makes all existing `SIMPLE`/`INSTALLMENT` rows version 0.
4. Replace `validate_dues_agreement()` with discriminator-aware validation:
   - legacy kind/version runs the existing amount/installment/outstanding checks unchanged;
   - negotiated v1 validates narrative and bounded optional structures, but does not apply legacy schedule or agreed-amount checks;
   - unsupported kind/version pairs fail closed;
   - socio/obligation ownership and revision-number/obligation-lineage checks run for every representation.
5. Update the immutability trigger predicate to include `terms_version`, preventing it from being changed in place.
6. Preserve the active-obligation unique index and deferred supersession constraint.
7. Add nullable `agreement_id` to `dues_community_work`, referencing `dues_agreements(id) ON DELETE RESTRICT`, and extend its validation trigger so a supplied agreement belongs to the same socio and obligation.

The migration does not backfill narratives into legacy rows and does not reinterpret legacy reasons. A previous binary can still read all pre-migration legacy rows. Because a previous binary cannot decode newly created `NEGOTIATED` rows, rollback is operational: disable the agreement/Web flags before rolling back application code, retain the additive schema, and never down-migrate or delete negotiated history.

## 4. API Domain and Service Evolution

### 4.1 Domain types and decoding

`apps/api/src/modules/dues/agreements.ts` will expose a versioned union:

```ts
type AgreementRepresentation =
  | { kind: 'SIMPLE' | 'INSTALLMENT'; termsVersion: 0; terms: LegacyAgreementTerms }
  | { kind: 'NEGOTIATED'; termsVersion: 1; terms: NegotiatedAgreementTermsV1 }
```

A single `decodeAgreementTerms(kind, termsVersion, terms, agreementDate)` function validates inputs and persisted rows. Legacy validation reuses the current monetary schedule checks. Negotiated validation is independent of settlement categories. Reads fail as partial/unavailable data for unsupported or malformed persisted representations rather than presenting them as complete agreements.

Rename service intent from `reschedule` to `revise`, while retaining `reschedule` as a backward-compatible legacy method/route alias. A negotiated revision preserves `kind = NEGOTIATED`, accepts version 1 terms and a required revision reason, inserts a successor, and supersedes the predecessor in the existing obligation lock/transaction. A legacy reschedule preserves kind/version 0 and its current schedule semantics. Cross-representation revision is rejected in this BETA to avoid silently converting a legacy monetary plan into an open agreement; operators can view legacy plans and use their established reschedule operation.

### 4.2 Repository outcomes and idempotency

Repository mutations return an explicit claim result:

```ts
type AgreementMutationResult = {
  outcome: 'created' | 'replayed'
  agreement: Agreement
}
```

The `(operator_id, caller_key)` unique claim and `request_fingerprint` comparison remain authoritative:

- same key and same material fingerprint returns the original row with `replayed`;
- same key and different fingerprint returns `CONFLICT`;
- a competing create is rejected by `dues_agreements_active_obligation_unique`;
- revisions lock the obligation and predecessor row, require `ACTIVE`, and atomically update predecessor status plus insert exactly one successor;
- serialization/deadlock failures map to `CONFLICT`;
- failed commands leave no agreement or audit fact.

The service emits audit only for `created`, not for `replayed`. The emitter's durable dedupe remains a defensive concurrency layer, not the method used to infer replay.

### 4.3 Authorization and target checks

Fastify keeps `FINANCE_GATE`, and the service keeps explicit `ADMIN | TESORERO` authorization. Database validation remains the final invariant that `obligation_id` belongs to `socio_id`. Reads use the same finance gate. No new role, permission, member-self-service path, or authorization interpretation is introduced.

### 4.4 Route contracts

Existing routes remain accepted:

- `POST /api/v1/dues/agreements` continues accepting the exact `SIMPLE | INSTALLMENT` body.
- `POST /api/v1/dues/agreements/:id/reschedule` remains the legacy monetary alias.

The create route becomes a strict union and additionally accepts:

```json
{
  "socio_id": "uuid",
  "obligation_id": "uuid",
  "kind": "NEGOTIATED",
  "terms_version": 1,
  "terms": {
    "narrative": "El socio se compromete a...",
    "commitments": [],
    "evidence": { "note": "Acuerdo conversado en secretaría" }
  },
  "reason": "Condiciones acordadas con el socio"
}
```

New/read contracts:

- `GET /api/v1/dues/obligations/:obligationId/agreements` returns `{ active, revisions }`, with revisions ordered by `revision_number` ascending. It returns legacy and negotiated DTOs through the same versioned union and is the Web workflow's single lineage read.
- `POST /api/v1/dues/agreements/:id/revisions` accepts `{ terms_version: 1, terms, reason }` for negotiated agreements and creates the successor.

Agreement DTOs add `terms_version`, `reason`, `revision_reason`, and `replayed` while preserving all current fields. `replayed` is `false` on reads. Create remains HTTP 201 and revise/reschedule remains HTTP 200 to avoid status-level breaking changes; replay is communicated in the additive field.

All mutation routes require `Idempotency-Key`. The request fingerprint continues to include command, URL, and canonical material body through `context()`. The read route requires no key.

## 5. Community-Work Settlement Evidence Flow

The Web submits accepted work to the existing `POST /api/v1/dues/community-work` route with the current required fields plus optional `agreement_id`. The BETA negotiation UI always supplies the active agreement ID.

The transaction remains:

1. Authorize `ADMIN | TESORERO` and validate positive approved value, reason, non-empty evidence, socio, obligation, and optional agreement relationship.
2. `claimSettlement(... kind: 'NON_CASH')` using caller key and request fingerprint.
3. If replayed, load the previously committed community-work row/allocation and return it with `replayed: true`; perform no writes or audit emission.
4. If newly claimed, lock/validate the obligation through `insertAllocation`; reject over-allocation or stale balance as `CONFLICT`.
5. Insert one `dues_community_work` row linked to settlement, obligation, and active agreement.
6. Emit settlement-created, allocation-created, and community-work-created audit facts in the same transaction.
7. Commit and return IDs plus `replayed: false`.
8. Only after confirmation does the Web refresh debt and render the new outstanding amount.

The settlement caller-key uniqueness, one-to-one community-work `settlement_id`, allocation constraints, and one database transaction guarantee that retries reduce debt exactly once. An agreement commitment by itself never invokes this flow.

## 6. Audit Integration and Atomicity

No emitter architecture change is required. `emitAudit(dbOrTx, record)` already accepts the same transaction handle as dues mutations and uses a durable caller-key idempotency hash.

Agreement audit records will be made complete:

- Create: `newValue` includes agreement ID, obligation ID, kind, terms version, terms, status, revision number, and reason.
- Revision: `oldValue` identifies and snapshots the predecessor representation; `newValue` includes the successor representation; metadata includes predecessor/successor IDs and revision reason.
- Metadata includes actor, role, granted permissions, authorization evidence, caller key, request fingerprint, service timestamp, and reason.

Community-work audit records retain the three existing action facts. The community-work fact adds agreement ID and evidence; settlement/allocation facts include approved value and target obligation. Sensitive narrative/evidence remains stored for authorized audit use, while `packages/audit/src/query.ts` and `apps/api/src/routes/audit.ts` continue their allowlisted/redacted projection for callers without financial-evidence privilege.

Atomicity is reconciled with current behavior by requiring every emitter call to receive the dues transaction `tx`. If any audit insert fails, the agreement, settlement, allocation, and evidence writes roll back. Rejected commands and explicit replay branches do not call the emitter. Emitter dedupe handles a concurrent duplicate audit insert without creating a second fact.

## 7. Web Client Contract

`apps/web/src/lib/api/dues.ts` gains:

- `LegacyAgreementTerms`, `NegotiatedAgreementTermsV1`, `DuesAgreement`, `AgreementLineageResponse`.
- `CreateNegotiatedAgreementInput`, `ReviseNegotiatedAgreementInput`.
- `CommunityWorkEvidenceInput`, `CommunityWorkEvidenceResult`.
- `getObligationAgreements(obligationId)`.
- `createNegotiatedAgreement(input, idempotencyKey)`.
- `reviseNegotiatedAgreement(agreementId, input, idempotencyKey)`.
- `createCommunityWorkEvidence(input, idempotencyKey)`.

Mutation functions always set `idempotency-key`; the page container obtains keys from `createCollectionsIdempotencyStore` using action plus a stable draft fingerprint.

The client adds bounded runtime DTO decoders because TypeScript alone cannot distinguish malformed successful responses. It exposes a normalized error:

```ts
type DuesOperationErrorKind =
  | 'validation'
  | 'permission'
  | 'conflict'
  | 'not_found'
  | 'partial_data'
  | 'unavailable'
```

`ApiError` status/code maps to validation, permission, conflict, not-found, or unavailable; network failures map to unavailable; malformed 2xx payloads map to partial data. The error retains the original cause/details for diagnostics but the UI maps only the normalized kind to Spanish copy. Successful mutation results retain `replayed` so replay is not announced as a new agreement.

## 8. Spanish Web UI Structure and States

### 8.1 Component responsibilities

Follow the current container/presentational split:

- `apps/web/src/app/(authed)/collections/page.tsx` remains the container. It owns authorization, feature config, agreement loading, idempotency keys, mutation calls, stale-conflict refresh, and debt refresh after community work.
- `DebtPanel.tsx` remains presentational and passes each open obligation to a new obligation-level negotiation component.
- `AgreementActions.tsx` is presentational and renders create/view/revise actions, immutable revision history, and the accepted-work entry point. It receives state and callbacks; it does not call APIs.
- `AgreementForm.tsx` renders narrative, reason, and optional commitment fields inside the existing `Modal` pattern.
- `CommunityWorkForm.tsx` renders evidence, reason, and club-approved value, clearly separated from agreement save.

The layout uses existing rounded borders, spacing, headings, modal footer buttons, focused `role="alert"`, polite `role="status"`, disabled busy controls, and preserved drafts on conflicts. All copy is Spanish. Example boundary guidance: “Guardar el acuerdo no reduce la deuda. La deuda cambia solo cuando se registra una cancelación válida.”

`FeatureConfig` gains `agreementsEnabled`; `AuthedLayout` passes `process.env.DUES_AGREEMENTS_ENABLED === 'true'`. Negotiation actions render only when both `collectionsEnabled` and `agreementsEnabled` are true and the obligation is open. Existing payment/reversal actions remain visible and unchanged.

### 8.2 Required UX states

The native Collections specification states are represented explicitly:

- **Idle/closed:** “Registrar acuerdo” is available on an open obligation.
- **Loading:** agreement card/modal uses “Cargando el acuerdo…” and disables mutations.
- **Ready without agreement:** create form is available; no settlement is implied.
- **Ready with active agreement:** show narrative, reason, optional commitments/evidence, state, revision number, date, and “La deuda continúa abierta…”. Show prior revisions as historical, never editable records.
- **Validation failure:** retain draft, focus field/top alert, and identify missing narrative/reason or invalid optional values in Spanish.
- **Permission denied:** show “No tenés permiso para registrar o modificar acuerdos.” and never show success.
- **Active-agreement or stale-revision conflict:** retain the draft, require “Revisar acuerdo actualizado”, reload lineage/debt, abandon the stale idempotency draft, and require an explicit resubmit.
- **API/service failure:** show retryable “No se pudo cargar/guardar…” without clearing the draft or implying persistence.
- **Success:** close the form, reload lineage, and announce “Acuerdo registrado.” or “Acuerdo actualizado.” while stating debt remains open.
- **Replay:** display the returned original agreement and announce “Este acuerdo ya había sido registrado.”, not a second success.
- **Partial data:** show “El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.”; do not render a complete-looking card or allow revision until a complete refresh succeeds.
- **Community-work loading/success:** disable confirmation while pending; announce success only after API confirmation and debt refresh.
- **Community-work validation/permission/conflict/replay/failure:** preserve evidence draft; distinguish invalid value/evidence, denied access, changed balance, already-recorded evidence, and service failure. On conflict, refresh debt before allowing review/resubmit.

No negotiation screen offers Treasury tender, cash shift/close, reconciliation, or `CTActe` controls.

## 9. Reconciliation with `member-benefits-agreements`

The active `club-dues-collection-and-daily-cash` capability already owns `member-benefits-agreements`. Its overlap is intentional:

- It defines simple arrangements/formal installment plans, immutable rescheduling, one native obligation link, bounded amounts/schedules, and append-only debt history.
- This change generalizes the agreement representation and adds the missing Web workflow; it does not replace the existing capability or loosen legacy monetary-plan rules.

Resolution:

- `SIMPLE | INSTALLMENT`, version 0 remains the normative implementation of the existing bounded monetary requirements.
- `NEGOTIATED`, version 1 is an additive open representation governed by this change's `agreement-contract` specification.
- Shared lifecycle, authorization, obligation ownership, active uniqueness, idempotency, audit, and immutability invariants apply to both.
- Legacy rescheduling remains available and bounded. Negotiated revision remains within the negotiated representation during BETA.
- If the changes are archived into common specs later, `member-benefits-agreements` should describe legacy monetary variants as supported agreement representations and refer open narrative/commitment semantics to the generalized agreement contract, avoiding two competing agreement aggregates.

## 10. File Change Map

Expected implementation files (exact grouping belongs to the task phase):

- Persistence: `packages/db/src/schema/dues-agreements.ts`, `packages/db/src/schema/dues.test.ts`, `packages/db/drizzle/0058_dues_open_agreements.sql`, migration journal/snapshot metadata.
- API domain: `apps/api/src/modules/dues/agreements.ts`, `agreements.test.ts`, `community-work.ts`, `community-work.test.ts`, and focused cases in `settlements.postgres.integration.test.ts`.
- API routes/audit: `apps/api/src/routes/dues.ts`, `agreements-routes.test.ts`, `audit.test.ts`; audit query/route projection only where the added details require allowlisting/redaction.
- Web client: `apps/web/src/lib/api/dues.ts`, `dues.test.ts`.
- Web feature config/container: `apps/web/src/lib/features.tsx`, `apps/web/src/app/(authed)/layout.tsx`, layout tests, `apps/web/src/app/(authed)/collections/page.tsx`, page tests.
- Web presentation: `DebtPanel.tsx`, new `AgreementActions.tsx`, `AgreementForm.tsx`, `CommunityWorkForm.tsx`, and colocated component tests.
- BETA rollout: `docker-compose.beta.yml`, BETA environment/deployment validation, safe-default examples/config tests, and operator rollout/rollback notes.

## 11. Strict-TDD and Reviewable Rollout Slices

Every slice starts with the listed RED test, then implements the minimum GREEN behavior, triangulates boundary cases, and refactors without moving tests to a later slice. Estimates are authored additions plus deletions and include tests; generated migration snapshots are excluded from the authored count but remain part of delivery identity.

| Slice | Behavior-complete scope and RED test placement                                                                                                                                                                                                                        | Rough authored lines | Budget risk                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------: | -------------------------------------------------------------------------- |
| 1A    | Add representation/version persistence, legacy-preserving migration, negotiated DB validation, and optional community-work agreement FK. RED in `packages/db/src/schema/dues.test.ts` and API PostgreSQL agreement integration tests before schema/migration changes. |              300–360 | Medium; trigger SQL may be dense and must be measured.                     |
| 1B    | Add versioned domain decoder, negotiated create/revise, explicit replay outcomes, legacy read compatibility, and immutable lineage. RED in `agreements.test.ts` plus focused PostgreSQL replay/concurrency tests.                                                     |              340–395 | High near 400; pause under `ask-on-risk` if measured forecast exceeds 400. |
| 1C    | Add lineage read/revision routes and complete atomic agreement audit payload/redaction. RED in `agreements-routes.test.ts` and `routes/audit.test.ts`.                                                                                                                |              280–350 | Medium.                                                                    |
| 2     | Add typed Web client operations, runtime partial-data decoder, replay field, idempotency headers, and normalized actionable errors. RED in `apps/web/src/lib/api/dues.test.ts`.                                                                                       |              190–260 | Low.                                                                       |
| 3     | Add feature-config gate and Spanish obligation-level create/view workflow with all load/validation/permission/conflict/success/replay/partial states. RED in `layout.test.tsx`, `collections/page.test.tsx`, and new agreement component tests.                       |              340–400 | High; component extraction must not push the slice over 400.               |
| 4A    | Add negotiated revision UI, immutable history display, stale-conflict refresh, and idempotency-draft handling. RED in `AgreementActions.test.tsx` and `collections/page.test.tsx`.                                                                                    |              250–330 | Medium.                                                                    |
| 4B    | Add accepted community-work evidence UI/client wiring, exactly-once replay handling, and debt refresh after confirmation. RED in `CommunityWorkForm.test.tsx`, page tests, and focused API community-work tests for agreement linkage/audit evidence.                 |              300–380 | Medium to high.                                                            |
| 5     | Add complete four-flag BETA deployment configuration validation, smoke-check contract, and rollback note while defaults remain false. RED in config/compose validation tests before deployment-file edits.                                                            |               80–150 | Low.                                                                       |

The full change is well above 400 lines and should not be delivered as one PR. The slices are suitable work-unit/PR boundaries with tests and rollback in the same unit. Slices 1B and 3 are explicit `ask-on-risk` gates: if task-phase or pre-apply measurement exceeds 400, stop for a chain-strategy decision rather than accepting an oversized PR implicitly.

Deployment order is 1A → 1B → 1C → 2 → 3 → 4A → 4B → 5. Database/API additions deploy safely behind false flags. After dependent slices pass focused tests and a BETA smoke check, enable `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_ASSESSMENT_ENABLED`, `DUES_AGREEMENTS_ENABLED`, and `DUES_CASH_ENABLED` together in BETA. Production and example defaults remain false.

Rollback disables `DUES_AGREEMENTS_ENABLED` and/or `NATIVE_COLLECTIONS_WEB_ENABLED`, restores the prior Web surface, and leaves additive schema/history intact. Individual application slices can be reverted in reverse order only if they continue to read legacy rows; the migration and created financial/audit history are never destructively reversed.

## 12. Verification Focus

Implementation verification must prove:

- legacy `SIMPLE`/`INSTALLMENT` rows still decode and reschedule with unchanged constraints;
- narrative-only negotiated agreements are accepted without a category;
- malformed/unsupported versions fail closed and appear as partial data in Web;
- create/revise replay returns the original result and emits no duplicate audit;
- competing creates/revisions leave one active row and complete lineage;
- agreement create/revise does not change debt or settlement/allocation history;
- accepted community work creates one non-cash settlement/allocation, reduces debt once, creates no cash movement, and replays exactly once;
- agreement/community-work audit records contain required actor, authorization, request, reason, terms/evidence, and linkage data atomically;
- unauthorized, invalid, over-allocation, fingerprint mismatch, and stale commands leave no partial financial or successful audit state;
- all required Spanish UI states are accessible and do not imply settlement before API confirmation;
- no Treasury or `CTActe` request/control is introduced;
- all four BETA flags are validated as a complete set and non-BETA defaults remain false.
