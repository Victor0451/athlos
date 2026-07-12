# Design: Athlos Ctacte Final Verify Remediation

## Technical Approach

Reconcile the active `athlos-ctacte-mutations` deltas with behavior already implemented, then isolate the only runtime change to the `/ctacte/[cuenta]` premium header. Preserve the current API/service/data flow: caller-generated keys remain durable mutation identity, field validation remains inline **and** toasted, and payment files continue through the shared `uploadAttachment` service. Final approval uses only an explicitly disposable PostgreSQL 16 database supplied through `ATHLOS_TEST_DATABASE_URL`.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Make caller-provided 1–128 character `Idempotency-Key` canonical for payment, debit, note, and comprobante intents; retain the key for the same intent and rotate after success, explicit cancel, or changed intent. | Restore audit-key/time-bucket identity. | Existing routes, clients, unique indexes, and retry stores already provide durable replay and changed-payload conflict semantics across time and processes. |
| Keep server field details additive to the general error toast. | Suppress toast when inline feedback renders. | Existing forms call `applyFieldErrors` and `notify`; local guidance and visible operation failure serve different UX purposes. |
| Call `uploadAttachment` directly from `registerPayment`. | Internal HTTP call to the attachment route; duplicate upload logic. | The shared service is the reusable validation/quota/storage boundary without transport coupling. |
| Limit runtime edits to premium header markup and focused page tests. | Refactor the 355-line page or mutation components. | Existing mutation behavior is correct; a narrow boundary lowers regression and review cost. |
| Verify against disposable PostgreSQL only. | Skip when the variable is absent; use production-like persistent infrastructure. | PostgreSQL-specific migrations, uniqueness, concurrency, and leases require the real engine, while destructive schema setup must remain disposable. |

## Data Flow

    Form intent ── stable key ──> Fastify route ──> ctacte service ──> PostgreSQL
         │                                           │
         ├── validation details ──> inline + toast   └── uploadAttachment ──> storage/metadata
         └── same intent retry ─────────────────────────> replay or 409 conflict

    Disposable PostgreSQL 16 <── ATHLOS_TEST_DATABASE_URL <── targeted verification suites

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` | Modify | Replace obsolete 10-second, route-upload, and toast-suppression requirements with durable keys, service reuse, and additive feedback. |
| `openspec/changes/athlos-ctacte-mutations/specs/ui-design/spec.md` | Modify | Keep the canonical premium-header contract aligned with focused assertions. |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` | Modify | Render token-only `rounded-xl shadow-sm p-8` header with circular back control, icon tile, uppercase titular name, socio/DNI metadata, estado badge, and existing actions. |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` | Modify | Add focused semantic/token assertions without broad snapshots. |
| `openspec/changes/athlos-ctacte-mutations/verify-report.md` | Modify | Record commands, disposable database identity, and pass/fail evidence; never credentials beyond a redacted/local test endpoint. |

## Interfaces / Contracts

- Same key + canonical payload returns the persisted result; same key + changed payload returns `409 CONFLICT`; missing/invalid key returns `400 VALIDATION_ERROR`.
- Field errors remain `{ error, message, details: [{ field, message }] }`; clients render recognized fields inline and always emit the operation-level error toast.
- Payment upload remains `registerPayment → uploadAttachment({ category: 'comprobante', ... })`; no internal HTTP request is introduced.
- Header tests own only header structure, content, accessibility, and design-token classes; existing page tests own ledger behavior.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit/web | Premium header boundary | RED focused Testing Library assertions, then markup change; run the page test and web typecheck. |
| API/service | Preserved keys, conflicts, feedback envelope, upload delegation | Run existing targeted route, service, field-error, and real-transport suites; contract-only edits require no runtime rewrite. |
| PostgreSQL integration | `0032`–`0034`, full-forward notes, uniqueness/concurrency, comprobante retry leases | Provision fresh PostgreSQL 16, set `ATHLOS_TEST_DATABASE_URL`, run targeted suites, then dispose it. Absence/unreachability fails loudly. |
| E2E | N/A | No E2E runner is configured. |

## Review and Rollback Boundaries

1. **Contracts (≤400 lines):** two delta specs only; rollback restores documentation only.
2. **Premium header (≤400 lines):** page plus focused tests; rollback restores prior header without touching mutations.
3. **DB evidence (≤400 lines):** verification artifact only; rollback discards invalid evidence and the disposable database.

Each stacked-to-main slice must have a clean diff against `main`, independent verification, and no mixed boundary. Stop and split before 400 authored changed lines.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration implementation changes. Running existing test commands against a disposable database is verification, not a new process boundary.

## Migration / Rollout

No migration or production rollout. Existing migrations are verified, not applied to production. Dispose the test database after evidence capture; do not deploy.

## Open Questions

None.
