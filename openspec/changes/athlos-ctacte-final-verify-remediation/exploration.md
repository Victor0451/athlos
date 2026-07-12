## Exploration: athlos-ctacte-final-verify-remediation

### Current State
Final verify for `athlos-ctacte-mutations` failed on five blockers where the active specs, implementation, and verification environment disagree.

| Blocker | Current evidence | Correct remedy |
|---|---|---|
| Premium `/ctacte/[cuenta]` header | Active `ctacte-mutations` + `ui-design` deltas require a canonical header card (`rounded-xl shadow-sm p-8`, `text-3xl uppercase tracking-tight`, back-circle, icon tile, socio/DNI/estado). Current page uses a plain flex header with `text-2xl` and action buttons. | Implementation, unless product explicitly retracts the premium header contract. |
| Payment/note idempotency vs 10-second specs | Active delta still says payment and notes retain 10-second audit-key semantics. Current payment and note paths require caller `Idempotency-Key`, persist it (`0032` / `0034`), replay same-key requests durably, and 409 changed payloads. | Explicit product decision first. If durable caller-key semantics are accepted, correct the spec. If 10-second semantics are required, implement a rollback/redesign. Do not decide unilaterally. |
| Payment upload vs attachments route | Spec text says call `POST /api/v1/socios/:socioId/attachments`; implementation reads multipart in the payment route and calls the shared `uploadAttachment` service with `category='comprobante'`, reusing MIME/size/quota/audit logic without internal HTTP. | Specification/architecture correction is safest if service-level delegation is acceptable. Implementation is only needed if product/architecture explicitly requires route-level HTTP delegation and route middleware side effects. |
| Field-error toast behavior | Active validation scenario says server field validation renders inline and SHALL NOT toast; the toast table says every mutation error toasts. Current forms intentionally call `notify('error', ...)` after applying field errors. | Explicit product decision first. If the no-toast field-validation contract wins, implement toast suppression when server field details are applied. If additive toasts are desired, correct the spec. |
| PostgreSQL retry/migration suite | PostgreSQL integration tests for `0033`, `0034`, note concurrency, and comprobante leases throw or cannot prove behavior when `ATHLOS_TEST_DATABASE_URL` is unset. CI already provisions Postgres and sets the variable; local final verify did not. | Test/environment setup. DB-backed verification is mandatory for final approval of migration/retry semantics. |

### Affected Areas
- `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` — active contracts for idempotency, payment upload, toast behavior, and header success criteria.
- `openspec/changes/athlos-ctacte-mutations/specs/ui-design/spec.md` — premium `/ctacte/[cuenta]` header contract.
- `openspec/specs/ui-design/spec.md` and `openspec/specs/toast-notifications/spec.md` — main design/toast specs that may need reconciliation with ctacte-specific deltas.
- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` and `page.test.tsx` — header implementation and regression coverage.
- `apps/web/src/components/ctacte/CtactePaymentForm.tsx`, `CtacteDebitForm.tsx`, `CtacteNoteForm.tsx`, `CtacteComprobanteButton.tsx` plus `*.field-errors.test.tsx` — field-error toast behavior.
- `apps/web/src/lib/api/ctacte-mutations.ts` — client payment/note key behavior and tests if product chooses 10-second semantics.
- `apps/api/src/routes/ctacte-mutations.ts`, `apps/api/src/modules/socios/forms/ctacte-mutations.ts`, `apps/api/src/modules/socios/ctacte_movement_notes.ts`, `apps/api/src/modules/ctacte/repository.ts` — payment/note idempotency and upload-service behavior.
- `apps/api/src/routes/socios-attachments.ts` and `apps/api/src/modules/socios/attachments.ts` — existing attachment route/service contract that payment upload reuses.
- `packages/db/drizzle/0032_ctacte_payment_idempotency.sql`, `0034_ctacte_movement_notes_idempotency_key_full_unique.sql`, and related schema/tests — durable idempotency support.
- `packages/db/src/ctacte-comprobante-retries.integration.test.ts`, `packages/db/src/idempotency-index.integration.test.ts`, `apps/api/src/modules/socios/ctacte_movement_notes*.postgres.integration.test.ts`, `apps/api/src/modules/socios/forms/ctacte-comprobante.postgres.integration.test.ts`, `.github/workflows/test.yml` — DB-backed verification environment.

### Approaches
1. **Decision-led contract reconciliation** — First record product/architecture decisions for idempotency, upload delegation wording, and field-error toasts; then implement only behavior still contradicted by the reconciled specs.
   - Pros: avoids coding against contradictory specs; likely smallest diff because durable idempotency and upload service reuse may be spec corrections only; preserves reviewed safety fixes.
   - Cons: requires explicit maintainer/product answers before apply for ambiguous behavior.
   - Effort: Medium

2. **Implement active specs literally** — Change code to match the current active text: premium header, 10-second payment/note semantics, HTTP route-style payment upload delegation, no field-error toasts, and DB env setup.
   - Pros: current final verifier text would be satisfied without spec debate.
   - Cons: high risk of regressing R3/R4 durability fixes, introducing internal HTTP coupling, and exceeding the 400-line budget.
   - Effort: High

### Recommendation
Use approach 1. The smallest safe ordering under the 400-line guard is:

1. **Slice 0 — Product/spec decisions (docs only):** decide payment/note idempotency and field-error toast behavior; correct upload wording to service-level delegation if accepted. No DB required.
2. **Slice 1 — Premium header implementation:** update `/ctacte/[cuenta]` header and focused page tests. No DB required.
3. **Slice 2 — Field-error behavior:** either suppress toasts when server field details render inline, or update specs/tests to bless additive toasts. No DB required.
4. **Slice 3 — Idempotency contract:** if durable caller keys are accepted, spec correction + targeted tests only; if 10-second semantics are chosen, separate API/web implementation slice because risk and diff are higher. DB may be required if database uniqueness/migration behavior changes.
5. **Slice 4 — Upload delegation contract:** spec correction if shared `uploadAttachment` service is accepted; implementation slice only if route-level HTTP delegation is explicitly required. DB not mandatory for spec-only; storage/upload tests needed for implementation.
6. **Slice 5 — Final verification environment:** run the PostgreSQL retry/migration suites only with a disposable Postgres and `ATHLOS_TEST_DATABASE_URL` set. DB-backed environment is mandatory.

### Risks
- Product ambiguity remains for payment/note idempotency and field-error toasts; applying code before deciding would repeat the same final-verify failure pattern.
- Literal route delegation for payment upload could add internal HTTP coupling without user-visible benefit because the shared attachment service already centralizes validation/audit behavior.
- Header implementation is small, but page tests currently mock the comprobante button and do not assert the premium header structure; coverage must be updated deliberately.
- Final verification cannot approve PostgreSQL migration/retry behavior without a real disposable PostgreSQL URL.
- Worktree already has untracked/modified SDD artifacts from the prior change, so future apply must avoid mixing remediation artifacts with unrelated pending files.

### Ready for Proposal
Yes — the proposal should proceed, but it must mark idempotency and field-error toast behavior as explicit product decisions before implementation. It should also state that DB-backed verification with `ATHLOS_TEST_DATABASE_URL` is mandatory before any future final approval.
