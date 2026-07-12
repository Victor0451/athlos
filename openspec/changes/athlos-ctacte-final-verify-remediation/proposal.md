# Proposal: Athlos Ctacte Final Verify Remediation

## Intent

Resolve final-verification contract and evidence blockers without regressing durable retries, additive error feedback, or shared upload architecture. Complete the premium cuenta header and PostgreSQL-backed approval evidence.

## Scope

### In Scope
- Correct payment/note contracts to durable caller-provided `Idempotency-Key`, reused per mutation intent.
- Specify server field validation as inline errors plus a general error toast, and payment attachments as direct shared `uploadAttachment` service delegation.
- Implement the premium `/ctacte/[cuenta]` header with focused tests.
- Run final migration/retry verification against disposable PostgreSQL via `ATHLOS_TEST_DATABASE_URL`.
- Deliver ≤400-line stacked-to-main slices: contracts; header/tests; DB evidence.

### Out of Scope
- Reverting to 10-second audit-key deduplication, suppressing intended error toasts, or adding internal HTTP attachment-route calls.
- Production access, migrations, deployment, or unrelated redesign.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `ctacte-mutations`: Reconcile idempotency, feedback, upload delegation, header, and verification requirements.
- `ui-design`: Preserve and satisfy the premium `/ctacte/[cuenta]` header contract with focused coverage.

## Approach

First correct obsolete delta requirements and tests. Separately implement only the canonical header card, back control, icon tile, titular metadata, and estado treatment with existing tokens. Finally, provision disposable PostgreSQL, set `ATHLOS_TEST_DATABASE_URL`, and run required migration/retry suites. Already-correct idempotency, toast, and upload behavior remains unchanged.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `openspec/changes/athlos-ctacte-mutations/specs/` | Modified | Correct conflicting ctacte and UI contracts |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` | Modified | Add premium header |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` | Modified | Add focused header assertions |
| PostgreSQL integration suites | Verification | Prove migrations, leases, concurrency, and retries |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Contract edits accidentally weaken durable behavior | Medium | Assert caller-key replay/conflict semantics explicitly |
| Header slice exceeds review focus | Low | Keep tests with header and enforce 400-line slice budget |
| DB evidence uses unsafe infrastructure | Low | Require disposable PostgreSQL only; prohibit production access |

## Rollback Plan

Revert slices independently. Contract slices do not alter runtime behavior; reverting the header restores the prior layout. Discard disposable databases and invalid evidence.

## Dependencies

- Disposable PostgreSQL compatible with project migrations and `ATHLOS_TEST_DATABASE_URL`.

## Success Criteria

- [ ] Delta specs consistently encode all three confirmed contracts and remove obsolete contradictions.
- [ ] Premium header and focused tests satisfy the canonical UI contract.
- [ ] Required DB-backed migration/retry suites pass against disposable PostgreSQL.
- [ ] Every stacked-to-main slice stays within 400 changed lines; no production access or deploy occurs.
