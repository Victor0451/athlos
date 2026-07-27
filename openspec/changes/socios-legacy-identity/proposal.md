# Proposal: Socios Legacy Identity Foundation

## Intent and Problem

Separate people, family accounts, and legacy evidence. Flat `socios.socios` cannot represent families, transferable responsibility, ambiguous keys, or distinct identifiers safely.

## Outcomes

- Staff can distinguish family-account and member numbers; every person retains an immutable UUID.
- Holder responsibility becomes transferable and auditable; ambiguity remains traceable and reviewable.

## Scope

### In Scope
- Additive schema for accounts, people, memberships, holder history, provenance, and `imported | validated | review_required` status.
- Automatic visible-number assignment with separate uniqueness for accounts and members.
- Constraints proving immutable person identity and one current primary holder for validated accounts.
- Migration and schema tests within 400 changed lines.

### Out of Scope
- Changes to `socios.socios`, API/UI contracts, `ctacte` ownership, or dossier references.
- Promotion/backfill, modern-Socio reconciliation, family merge/split workflows, and category normalization.
- Fee engine, charges, payment allocation, digital cards, and attendance.

## Capabilities

### New Capabilities
- `socios-identity`: Family accounts, person identity, visible numbering, transferable holder history, provenance, and review states.

### Modified Capabilities
- None in this slice; `legacy-import` and `lineage-tracker` integration is deferred to promotion/backfill.

## Approach and Compatibility

Add Drizzle tables and a forward-only migration beside Socio. Preserve raw values, source keys, batch lineage, anomaly reasons, and `SOCCARNET + SOCFAMILIA` without treating the pair as a UUID or deduplication rule. Existing foreign keys and endpoints remain unchanged.

## Proposal question round

Validated accounts require one current holder; review-required accounts may lack one pending human resolution. Transfer authorization, merge/split operations, and modern-Socio linking require later workflow specifications.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/db/src/schema/socios.ts` | Modified | Add identity model and constraints. |
| `packages/db/migrations/` | New | Additive, forward-only migration. |
| `packages/db/src/schema/*test.ts` | Modified | Verify invariants and compatibility. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legacy collisions or missing keys | High | Preserve evidence and mark review-required. |
| Identifier conflation | Medium | Separate UUID, account number, member number, and legacy keys. |
| Scope exceeds review budget | Medium | Keep this slice schema-only; defer promotion and consumers. |

## Rollback Plan

Keep consumers on existing paths and issue a forward-fix migration removing or disabling only additive objects; Socio and financial paths remain authoritative.

## Dependencies

- Existing raw-event lineage and database migration conventions.

## Acceptance Boundaries

- [ ] Migration and schema tests prove numbering, UUID, holder-history, status, and provenance invariants.
- [ ] Ambiguous groups can be stored as review-required without inferred identity or authority.
- [ ] Existing Socio, CTACTE, API, and import behavior remains unchanged.
- [ ] Forecasted implementation is below 400 changed lines.
