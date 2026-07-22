## Exploration: Padrones inscription lifecycle management

### Current State
Padrones is read-only. `GET /api/v1/padrones` is authenticated for every operator and lists enrollment rows by disciplina code and ejercicio year. The UI has list and shareable roster-detail views, both with an explicit create/edit/deactivate placeholder.

`deportes.inscripciones` already has the enrollment identity and lifecycle fields: `socio_id`, `disciplina_id`, `ejercicio_id`, `estado`, and `fecha_alta`. PostgreSQL enforces a unique enrollment per `(socio_id, disciplina_id, ejercicio_id)` and restricts deletion of referenced socio, disciplina, and ejercicio rows. States shown by the UI are `activa`, `pendiente`, and `baja`, but the database currently stores `estado` as unconstrained text. There is no `updated_at`, withdrawal date, or withdrawal reason.

The established mutation conventions are: Zod at the route boundary, `requireRole(...)` for write authorization, `BusinessError` with stable `ErrorCode` HTTP envelopes, and `emitAudit` inside the same database transaction as the business write. The audit package supports durable caller-key deduplication; CTACTE uses an `Idempotency-Key` header and rejects reuse with a different request fingerprint. API route tests use Fastify `app.inject` plus the in-memory Drizzle stand-in; web tests use Vitest, Testing Library, TanStack Query, and mocked API wrappers.

### Affected Areas
- `packages/db/src/schema/deportes.ts` and `packages/db/drizzle/` — enrollment state is unconstrained text; a lifecycle contract may need a check constraint and metadata columns.
- `apps/api/src/modules/padrones/repository.ts` — currently owns only roster joins; write repository/service operations belong beside it or in a focused lifecycle module.
- `apps/api/src/routes/padrones.ts` — add validated, role-gated write endpoints while retaining the any-authenticated read endpoint.
- `apps/api/src/test-standins/db.ts` and `apps/api/src/routes/padrones.test.ts` — extend the existing padrones test harness for inserts, updates, audit rows, conflicts, and authorization.
- `packages/audit/src/emitter.ts` — reuse transaction-aware `emitAudit`; add enrollment action constants only if the project keeps a closed action union.
- `apps/web/src/lib/api/padrones.ts` and its test — add typed mutation wrappers and error propagation tests.
- `apps/web/src/app/(authed)/padrones/page.tsx`, `[id]/page.tsx`, and `components/padrones/PadronRow.tsx` — replace placeholders with an ADMIN action entry point, lifecycle controls, and query invalidation.
- `apps/web/src/components/ui/Modal.tsx` — reuse the existing accessible modal primitive; no primitive change is expected.

### Approaches
1. **Single lifecycle slice: create, correct, deactivate, and reactivate** — Add POST and PATCH enrollment endpoints, audit each mutation atomically, and expose create plus row/detail actions in the roster UI.
   - Pros: Delivers the complete advertised lifecycle; one consistent DTO, authorization, and audit model; no second API redesign.
   - Cons: Exceeds the 400-line review budget once backend, stand-in, API/web wrappers, UI states/modals, and TDD coverage are included; product decisions on permissions, mutable fields, reactivation, and withdrawal metadata are required first.
   - Effort: High.

2. **Narrow vertical slice: create plus status transitions** — Treat the enrollment tuple as immutable, create an enrollment as `activa` or `pendiente`, and implement explicit `baja` / reactivation transitions. Defer correction of `fecha_alta` and any move between socio, disciplina, or ejercicio.
   - Pros: Smallest coherent operational lifecycle; preserves the existing unique key; avoids unsafe identity edits; maps to existing Socios soft-deactivate/reactivate UI and audit patterns.
   - Cons: Does not satisfy a broad interpretation of “edit”; may need a follow-up correction workflow and a decision on whether reactivation is allowed.
   - Effort: Medium to High.

### Recommendation
Choose approach 2, with **ADMIN-only** writes as the initial authorization default. This matches existing Socios master-data mutations; any broader role should be an explicit product decision, not inferred from read access. Keep `(socio, disciplina, ejercicio)` immutable after creation. Allow only `estado` in the first PATCH; defer `fecha_alta` correction unless the product explicitly needs it. Use soft removal only (`estado='baja'`) and include reactivation as the inverse state transition if the club confirms that a withdrawn enrollment can return in the same exercise.

Place **Crear inscripción** on the filtered roster list and/or its roster-detail header, because disciplina and ejercicio are already known there. Put **Dar baja / Reactivar** in a separate explicit row action (not inside the whole-row button, which currently navigates to the socio) and optionally repeat it on the roster-detail view. Do not place enrollment actions on the Socio detail in this slice: that page lacks the necessary disciplina/ejercicio context and would broaden the scope.

Proposed API contract direction: `POST /api/v1/padrones/inscripciones` with `{ socio_id, disciplina, ejercicio, estado?, fecha_alta }`; `PATCH /api/v1/padrones/inscripciones/:id` with `{ estado }`. Validate referenced records, translate duplicate-key races to `409 CONFLICT`, and return `404 NOT_FOUND` for an unknown enrollment. Require an `Idempotency-Key` on POST and make the enrollment write plus its audit row one transaction; retry with the same key and payload returns the original enrollment, while a different payload returns `409`. PATCH should be conditional/idempotent: requesting the already-current state is a no-op success with no duplicate audit event, and concurrent state changes must not produce a misleading audit row.

Required audit events: `INSCRIPCION_CREATED`, `INSCRIPCION_STATUS_CHANGED` (including old/new state and target identity), and, only if a date-correction endpoint is later approved, `INSCRIPCION_UPDATED`. Every event must include actor, source IP, entity type `inscripcion`, entity ID, before/after snapshots, and an idempotency key. A status transition and its audit record must commit or roll back together.

Product decisions to confirm before proposal:
- Are **ADMIN** operators the only creators, editors, and deactivators, or should `OPERADOR` also manage daily enrollments?
- Is `fecha_alta` correctable after creation? Socio, disciplina, and ejercicio should remain immutable because they define the unique enrollment identity.
- Is `baja` the only removal model, and may an enrollment be reactivated within the same ejercicio?
- Is the existing unique key `(socio_id, disciplina_id, ejercicio_id)` the intended duplicate rule? It prevents a second enrollment after baja; reactivation, not reinsertion, is then required.
- Does deactivation require a reason and/or effective date beyond the audit trail? If yes, add persistent columns before implementing it.

Schema recommendation: add a database `CHECK` for the approved state vocabulary and `updated_at`; add `fecha_baja` and `baja_motivo` only if those values are operational data rather than audit-only context. No migration is required for the existing identity or unique-key rule, but a lifecycle-status constraint is a data-integrity gap that should not be left solely to Zod.

Forecast: the complete approach 1 is likely **700–1,000 authored changed lines** including strict TDD and will exceed the 400-line review budget. Use chained PRs: (1) migration, backend lifecycle service/routes, atomic audit/idempotency, and API tests; (2) typed web wrappers, create modal, status action/confirmations, invalidation, and web tests; (3) only if approved, date correction or withdrawal metadata. Each slice is independently testable and reversible. Deployment issue #12 is explicitly out of scope.

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High

### Risks
- The current free-text `estado` allows invalid data; API validation alone cannot protect direct imports or future callers.
- A unique key that includes baja means “create again” must be designed as reactivation, or the duplicate contract will be violated.
- The roster row is a full-width navigation button; adding nested row action buttons requires a layout/accessibility refactor.
- Existing audit use is not universally atomic; this lifecycle must follow the stronger CTACTE transaction pattern rather than the simpler route-level audit calls.
- Product decisions on roles, reactivation, mutable fields, and withdrawal metadata remain unresolved.

### Ready for Proposal
No — confirm the five product decisions above, especially write roles, reactivation, and whether withdrawal metadata is persistent. Once confirmed, propose the narrow lifecycle slice and its chained PR plan; do not include deployment work.
