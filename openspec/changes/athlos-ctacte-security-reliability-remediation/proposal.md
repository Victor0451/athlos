# Proposal: Athlos CTACTE Security and Reliability Remediation

## Intent

Correct security and reliability defects in CTACTE mutations. Successful covered mutations must be atomically audited, caller retries durable, and receipt replay actor-bound.

## Scope

### In Scope
- Atomically persist each covered payment, debit, and note mutation with its audit event; failures roll back the mutation—no swallowed errors or counter fallback.
- Permit payment, debit, and note mutations only for `ADMIN`, `TESORERO`, and `OPERADOR`; keep `CONSULTA` read-only. Enforce `can_reprint` at the comprobante endpoint.
- Preserve durable caller idempotency while removing the obsolete 10-second audit bucket from CTACTE caller-key events.
- Enforce a 30-second comprobante render wait; persist terminal timeout reason `RENDER_TIMEOUT`, keep ordinary renderer failures reclaimable, and return `504` on retry. Bind replay to the actor and expose failures.
- Add the nullable comprobante failure-reason schema after `0034`, then enable timeout runtime behavior in a dependent slice.
- Guarantee attachment compensation/provenance, consistent input validation, and documented `0031 → 0032 → 0033 → 0034 → 0035` rollout integrity.

### Out of Scope
- New features, UI redesign, unrelated concurrency changes or migrations, deployment, or production operations.
- Branches, commits, pushes, PRs, or production changes.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `audit-logger`: atomic CTACTE audit persistence and durable caller-key deduplication without the 10-second bucket.
- `api-design`: mutation roles, `can_reprint`, actor-bound replay, `504`, and uniform validation contracts.
- `auth-login`: CTACTE role and reprint-permission enforcement.
- `database-migrations`: ordered inclusion and integrity evidence through additive `0035`.
- `socio-attachments`: compensation and provenance for payment comprobante attachments.
- `monitoring-observability`: bounded render waits and failure visibility.

## Approach

Deliver independently rollbackable, stacked-to-main slices of ≤400 changed lines: S0 contracts; S1 authorization/validation; S2 atomic audit/idempotency; S3 attachment/replay; S4a additive failure-reason schema/state semantics; S4b timeout/HTTP/observability. S4b depends on S4a. This phase performs no implementation or tests.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `openspec/specs/*/spec.md` | Modified | Correct listed capability contracts |
| `apps/api/src/routes/ctacte-mutations.ts` | Modified | Authorization, permission, validation, timeout |
| `apps/api/src/modules/socios/` | Modified | Atomic audit, compensation, replay provenance |
| `packages/audit/src/emitter.ts` | Modified | Durable caller-key audit semantics |
| `packages/db/drizzle/0035_ctacte_comprobante_failure_reason.sql` | Added | Nullable terminal timeout reason, ordered after `0034` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Audit failure rejects a mutation | Medium | One DB transaction and explicit error envelope |
| Timeout/replay race | Medium | Durable failed state and actor-bound ownership |
| Contract drift across slices | Medium | S0 lands first; each slice is autonomous |

## Rollback Plan

Revert slices in reverse order. Migrations `0034` and additive `0035` remain applied under the forward-only policy; prior application code ignores nullable `0035`. Do not deploy incomplete dependent slices.

## Dependencies

- Migrations `0031`–`0034`, followed by additive `0035`; audit transactions; and comprobante lease state.

## Success Criteria

- [ ] Covered mutations cannot commit without exactly one matching audit event across delayed retries.
- [ ] Authorization, permission, validation, compensation, actor-bound replay, ordered `0034`/`0035`, and 30-second/`504` contracts are specified.
- [ ] S4a and S4b are each ≤400 changed lines, independently reviewable, and application-rollbackable; the forward-only `0035` schema remains after rollback.
