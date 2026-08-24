# Proposal: Negotiated Dues Settlement

## Intent

Close the remaining club-dues BETA gap by giving authorized club accounting staff a Web workflow to record the outcome of an open negotiation with a member.

The product must not force negotiations into a closed settlement-category list. An agreement is the primary flexible record of what the member and club agreed: money, community work, another action, or a combination. Community work is one supported form of settlement evidence within that broader negotiation model, not the boundary of what may be negotiated.

This change completes the operator-facing collections workflow while preserving the separation between dues settlement and Treasury cash/tender handling.

## Outcomes and Scope

### In Scope

- Add a Spanish-language Web workflow, consistent with existing Collections and Treasury visual patterns, for authorized operators to:
  - record a negotiated agreement against an open dues obligation;
  - describe arbitrary agreed actions without selecting from a rigid category taxonomy;
  - record monetary commitments, community-work evidence, and mixed or other commitments when applicable;
  - review the agreement and its current lifecycle state;
  - revise an active agreement without erasing its history;
  - register community work that reduces an obligation through the existing non-cash settlement path.
- Extend the Web dues API client with typed agreement and community-work operations.
- Evolve the agreement contract where necessary so the domain can represent open-ended negotiated commitments rather than only `SIMPLE` or `INSTALLMENT` monetary plans.
- Preserve complete auditability for creation, revision, and settlement evidence, including actor, timestamp, reason, authorization evidence, request identity, and the agreed details.
- Respect existing authorization and debt invariants: agreement and community-work actions remain limited to authorized `ADMIN` or `TESORERO` operators, target the member's own obligation, and cannot settle more than the outstanding debt.
- Enable the required BETA feature flags in the BETA deployment configuration: `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_ASSESSMENT_ENABLED`, `DUES_AGREEMENTS_ENABLED`, and `DUES_CASH_ENABLED`.

### First Slice

The first product slice will provide one coherent operator journey from an open obligation:

1. Open a negotiation form from the member's debt view.
2. Record a human-readable agreement description and required reason/evidence.
3. Add zero or more structured commitments where structure is useful, without requiring every commitment to fit a predefined category.
4. Save and display the active agreement with its audit-relevant details.
5. When community work has actually been accepted/performed, record its evidence and approved debt value through the existing non-cash settlement capability, then refresh the debt view.
6. Revise an active agreement while retaining revision lineage.

The slice must handle validation, permission, conflict, replay/idempotency, partial-data, and API-failure states clearly in Spanish. Tests ship in the same work unit as each behavior and record strict TDD RED/GREEN evidence.

### Non-Goals

- Creating a closed catalog of settlement categories or attempting to enumerate every action a club and member may negotiate.
- Treating an agreement itself as proof that an obligation has been paid or fulfilled. Debt changes only through an accepted settlement/allocation event.
- Automatically converting every promised action into a debt reduction.
- Linking dues settlements to `CTActe`, or introducing Treasury cash/tender behavior into Collections.
- Replacing the existing monetary settlement and reversal workflows.
- Redesigning dues pricing, assessment generation, daily cash, or cash closing.
- Building member self-service negotiation or approval in this BETA slice.
- Adding automated valuation rules for non-monetary actions; authorized staff remains responsible for the approved value and evidence.

## Capabilities

### New Capabilities

#### Open Negotiation Web Workflow

Authorized accounting staff can record and inspect a negotiated agreement from an open dues obligation. The workflow captures the agreement in open-ended terms and may add structured monetary dates or action evidence without making those structures an exhaustive category list. All user-facing labels, guidance, validation, and status messages are in Spanish.

#### Negotiated Settlement Evidence

Authorized staff can register evidence that an agreed action has been completed or accepted. Community work uses the existing community-work/non-cash settlement path, including an approved amount allocated to one obligation. Other negotiated actions remain representable in the agreement and require an explicit supported settlement event before reducing debt.

#### Agreement Revision Visibility

Operators can revise an active agreement and see its current state and revision lineage. Prior versions remain auditable and are never overwritten in place.

### Modified Capabilities

#### Agreement Domain Contract

The current agreement implementation accepts `SIMPLE` or `INSTALLMENT` and validates monetary `amountCents` plus one to sixty installments. It must be generalized without losing existing records or monetary-plan behavior. The durable model must support an open agreement description and extensible commitments/evidence, with versioned validation rather than a hard-coded exhaustive settlement category enum.

#### Web Dues API Client

`apps/web/src/lib/api/dues.ts` currently exposes prices, assessment generation, debt, monetary settlement, and reversal only. It will gain typed agreement create/read/revision operations and community-work settlement operations, including idempotency inputs and actionable error handling.

#### Debt Collection Actions

The existing monetary allocation and reversal UI remains intact. Additive, feature-gated actions will expose negotiation and community-work recording from the relevant obligation context.

## Approach and Invariants

### Open-Negotiation Model

- The agreement is a negotiated record, not a settlement-category selector.
- A required narrative captures what was agreed in the operator's own terms.
- Structured fields are optional aids for commitments that benefit from dates, values, or evidence; they do not define the universe of allowed agreements.
- Extensibility is achieved through a versioned agreement payload/commitment representation and evidence metadata, not an expanding enum of business categories.
- Existing simple and installment agreements remain readable and retain their established semantics.
- Community work is a specialized, audited settlement-evidence flow that can reduce debt; it does not become the generic model for all negotiated actions.

### Debt and Lifecycle Invariants

- Recording or revising an agreement does not directly reduce outstanding debt.
- Debt is reduced only by a valid settlement allocation.
- A non-cash settlement has an explicit club-approved monetary value, evidence, reason, and target obligation.
- No allocation may exceed the obligation's outstanding balance.
- An obligation has at most one active agreement under the existing lifecycle rule; revisions supersede rather than mutate prior records.
- Existing statuses and revision lineage remain preserved unless a later specification defines a backward-compatible extension.
- Idempotency and concurrency conflicts must not create duplicate agreements, evidence, settlements, or allocations.

### Audit and Authorization Invariants

- Agreement creation, revision, community-work evidence, settlement creation, and allocation remain atomic with their audit records.
- Audit data includes actor, role/permissions context, timestamp, reason, authorization evidence, caller key/request fingerprint, entity identity, and relevant before/after or revision linkage.
- Only authorized `ADMIN` or `TESORERO` operators may perform these actions.
- The UI must not imply success until the API confirms the audited transaction.
- Evidence is required when an action is used to reduce debt; an unfulfilled promise is not settlement evidence.

### Product Boundary Invariants

- Collections owns obligation settlement and allocation.
- Treasury owns cash/tender and daily cash operations.
- No `CTActe` linkage or cash-register side effect is introduced.
- Existing monetary collection, reversal, pricing, assessment, and Treasury behavior is preserved.

## Rollout Strategy

- Deliver additive, feature-gated work units, each at or below 400 authored changed lines including tests.
- Keep tests with the behavior they verify and capture strict TDD RED/GREEN evidence for every implementation slice.
- Recommended slices, subject to task-phase line estimates:
  1. Generalize the agreement contract and preserve legacy monetary agreements, with API/domain tests.
  2. Add typed Web client operations and contract tests for agreements and community work.
  3. Add the Spanish open-negotiation create/view workflow behind `DUES_AGREEMENTS_ENABLED` and `NATIVE_COLLECTIONS_WEB_ENABLED`.
  4. Add agreement revision and community-work settlement evidence with debt refresh, behind the same Collections gates.
  5. Configure and validate the four required flags in the BETA environment, with an operational rollback note.
- If any slice cannot stay within the 400-line review budget, the task phase must recommend chained PRs and the `ask-on-risk` delivery strategy must pause before apply for the chain decision.
- Enable flags first in the club BETA environment only after the dependent slices are deployed and smoke-checked. Production defaults remain `false`.

## Affected Areas

- `apps/web/src/lib/api/dues.ts`: agreement and community-work client contracts and operations.
- Collections debt UI, including the obligation-level settlement actions and new Spanish negotiation/evidence states.
- Web tests for API typing, validation, permissions/errors, successful negotiation, revision, community-work settlement, and debt refresh.
- Dues agreement API/domain model, validation, persistence compatibility, lifecycle, and audit emission where required by the open model.
- Community-work API integration and existing non-cash allocation/audit behavior.
- API/domain tests for compatibility, authorization, idempotency, concurrency, audit completeness, and debt invariants.
- BETA deployment configuration for `NATIVE_COLLECTIONS_WEB_ENABLED`, `DUES_ASSESSMENT_ENABLED`, `DUES_AGREEMENTS_ENABLED`, and `DUES_CASH_ENABLED`; all currently default to `false` in `packages/config/src/schema.ts`.
- Operator documentation or release notes needed to explain the distinction between an agreement and a completed settlement.

## Risks and Rollback

### Risks

- **False flexibility:** adding a free-text field while retaining a monetary-only domain contract would appear open but still reject real club agreements. Mitigation: specify and test an extensible agreement representation before building the final UI.
- **Premature debt reduction:** treating a promise as completed evidence could understate receivables. Mitigation: keep agreement and settlement transitions explicit and separate.
- **Audit gaps:** flexible payloads can become opaque or unactionable. Mitigation: require narrative, reason, actor context, timestamps, evidence for settlement, and immutable revision history.
- **Legacy compatibility:** generalizing agreement terms could make existing `SIMPLE`/`INSTALLMENT` records unreadable. Mitigation: version the contract and test legacy read/revision behavior.
- **Duplicate or conflicting actions:** retries or concurrent operators could duplicate agreements or allocations. Mitigation: preserve idempotency keys, request fingerprints, active-agreement uniqueness, transactional writes, and visible conflict handling.
- **Operator ambiguity:** staff may confuse recording an agreement with settling debt. Mitigation: Spanish UI copy must state whether debt remains open and require a separate completion/evidence action.
- **Feature-flag mismatch:** enabling only part of the dependency set could expose an incomplete BETA flow. Mitigation: validate all four required flags and dependent services together before club testing.
- **Review overload:** cross-layer changes may exceed one reviewable PR. Mitigation: use behavior-complete sub-400-line slices and apply `ask-on-risk` before chained delivery.

### Rollback

- Disable `DUES_AGREEMENTS_ENABLED` and/or `NATIVE_COLLECTIONS_WEB_ENABLED` to remove the new Web entry points without affecting existing monetary collection.
- Disable the BETA flag set to return the environment to its prior operational surface.
- Revert individual additive work-unit slices independently; tests and any operator documentation roll back with their behavior.
- Preserve all agreement, revision, settlement, evidence, and audit records created while enabled. Rollback must never delete or rewrite financial/audit history.
- Any persistence evolution must be backward compatible so the prior application can continue reading legacy records, or must include an explicit safe down-compatibility plan before implementation.

## Dependencies

- Existing dues debt, obligation, settlement, allocation, reversal, agreement, community-work, and audit capabilities.
- Existing authorization context and `ADMIN`/`TESORERO` role enforcement.
- Existing Collections debt UI and visual patterns shared with Collections/Treasury.
- Existing idempotency/request-fingerprint behavior.
- BETA deployment access to configure and verify the four required feature flags.
- A follow-up specification must define the versioned open agreement payload, lifecycle transitions, evidence requirements, API contracts, Spanish UX states, and legacy compatibility rules before implementation.

## Success Criteria

- An authorized club accounting operator can open a member's outstanding obligation and record, in Spanish, the actual agreement reached without choosing from an exhaustive category list.
- The agreement can represent monetary, community-work, mixed, and other negotiated commitments through an open, versioned model.
- Saving an agreement does not reduce debt; the UI clearly shows that the obligation remains open until a valid settlement is recorded.
- An operator can revise an active agreement while prior revisions remain available to audit.
- An operator can record approved community-work evidence and value; the API creates one non-cash settlement/allocation and the refreshed debt reflects the reduction exactly once.
- Every agreement, revision, and completed settlement action is attributable to an authorized actor and includes timestamp, reason, authorization evidence, request identity, and relevant evidence.
- Unauthorized users, invalid evidence, over-allocation, conflicting active agreements, stale/concurrent updates, and idempotency mismatches fail safely with actionable Spanish UI feedback and no partial financial state.
- Existing monetary settlement, reversal, pricing, assessment, Treasury cash/closing, and non-`CTActe` boundaries remain unchanged.
- The BETA environment runs with the four required feature flags enabled while schema defaults remain safe (`false`) for other environments.
- Every implementation work unit includes strict TDD RED/GREEN evidence, behavior-aligned tests, a defined rollback boundary, and no PR exceeds 400 authored changed lines without an explicit delivery decision.
