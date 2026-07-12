# Cuenta Corriente Mutations Specification

## Purpose

Operator-driven mutations on a socio's cuenta corriente (`/ctacte/[cuenta]` page): registrar pago, registrar débito, reimprimir comprobante, and nota de movimientos. All four mutations emit `CTACTE_*` audit events via the extended `emitAudit` and reuse the four canonical Gorriti Premium UX patterns shipped in PRs #13–#22 (OperatorChip, useNotesCollapsed, notify(), Gorriti Premium tokens). Comprobante reprints aggregate ALL payments and debits within an operator-selected date range (capped at 50 movements per PDF), not individual isolated payments — v1 simplification. The `/ctacte/[cuenta]` page becomes the second realization of the canonical Gorriti Premium visual contract (first was `/socios/[id]`), so the page header, summary strip, mutation button group, and notes section all consume the same tokens and primitives. The `/ctacte` list page, the sibling `CtacteTab.tsx`, the `/admin/gastos` integration, and the Tesorería cross-system sync are all out of scope.

---

## Requirements

### Section A — API mutations

### Requirement: Register Payment Endpoint

The system SHALL expose `POST /api/v1/socios/:socioId/ctacte/movements/payment` accepting `multipart/form-data` with the fields `monto` (positive decimal, required), `fecha` (ISO date, required), `concepto` (text, required), and `comprobante` (file, optional). The caller MUST supply an opaque `Idempotency-Key` header of 1–128 characters, reused per payment intent across ambiguous retries. A successful new-intent request SHALL return `201 Created` with the new movement JSON and SHALL emit exactly one `CTACTE_PAYMENT_REGISTERED` audit event. The route SHALL be gated by `requireAuth()` only; no role check.

The canonical payment payload MUST be `{ operatorId, socioId, monto(2dp), fecha, concepto, comprobanteAttachmentHash-or-null }`. Same key with that same canonical payload SHALL replay the original movement without a second movement or audit effect; same key with a different canonical payload SHALL return `409 CONFLICT`. Missing/invalid key SHALL return `400 VALIDATION_ERROR`. The key MUST NOT be derived from content or elapsed time.

When the optional `comprobante` file is present, the system SHALL delegate directly to the shared `uploadAttachment` service with `category='comprobante'`, reusing its MIME / size / quota / magic-byte / SHA-256 validation, and store the returned `attachment_id` in the new ctacte row's `comprobante_attachment_id` column. The route MUST NOT issue an internal HTTP call to the attachments route. When `comprobante` is absent, the column SHALL be `NULL`.

#### Scenario: Happy path with comprobante file

- **WHEN** an authenticated operator POSTs a multipart body with `monto=1500.00`, `fecha=2026-07-09`, `concepto="Cuota Julio"`, a valid 2 MB PDF named `comprobante.pdf`, and a valid `Idempotency-Key`
- **THEN** the response status SHALL be `201 Created` with a JSON body containing the new movement (`id`, `fecha`, `monto`, `concepto`, `tipo="CREDITO"`, `comprobante_attachment_id`)
- **AND** exactly one `audit_events` row SHALL exist with `action="CTACTE_PAYMENT_REGISTERED"`, `entity_type="ctacte_movement"`, `entity_id=<new-uuid>`
- **AND** the comprobante bytes SHALL be persisted via `socios.socio_attachments` with `category="comprobante"` and `resource_type="ctacte_payment"`, `resource_id=<movement-uuid>`
- **AND** the service call to `uploadAttachment` SHALL be a direct in-process invocation (no internal HTTP)

#### Scenario: Payment retry replays durably

- **GIVEN** a payment was created for a key with a canonical payload
- **WHEN** the operator retries with that key and that canonical payload
- **THEN** the response SHALL be `201 Created` with the original movement
- **AND** NO additional movement row SHALL be inserted
- **AND** NO additional `audit_events` row SHALL be emitted

#### Scenario: Payment key conflicts on changed intent

- **GIVEN** a payment was created for a key
- **WHEN** the operator reuses that key with a changed canonical payload (different `monto`, `fecha`, `concepto`, or `comprobante` bytes)
- **THEN** the response status SHALL be `409 CONFLICT`
- **AND** NO additional movement row SHALL be inserted
- **AND** NO additional `audit_events` row SHALL be emitted

#### Scenario: Missing or malformed payment key is rejected

- **WHEN** an authenticated operator omits the `Idempotency-Key` header or sends an empty or over-128-character value
- **THEN** the response SHALL be `400 VALIDATION_ERROR`
- **AND** NO movement row SHALL be inserted
- **AND** NO `audit_events` row SHALL be emitted

#### Scenario: Pago without comprobante file is allowed

- **WHEN** an authenticated operator POSTs a multipart body with `monto=500.00`, `fecha=2026-07-09`, `concepto="Cuota"` and NO `comprobante` part
- **THEN** the response status SHALL be `201 Created`
- **AND** the new movement's `comprobante_attachment_id` SHALL be `NULL`

#### Scenario: monto zero or negative is rejected

- **WHEN** an authenticated operator POSTs `monto=0` or `monto=-100`
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: [{ field: "monto", message: "must be > 0" }]`
- **AND** NO movement row SHALL be inserted
- **AND** NO audit event SHALL be emitted

#### Scenario: fecha outside socio relationship range is rejected

- **WHEN** an authenticated operator POSTs `fecha=<two days before socio's fecha_alta>` OR `fecha=<future date>`
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: [{ field: "fecha", message: "outside socio's relationship range" }]`
- **AND** NO movement row SHALL be inserted
- **AND** NO audit event SHALL be emitted

#### Scenario: Missing JWT returns 401

- **WHEN** the endpoint is called without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** NO row SHALL be inserted and NO audit event SHALL be emitted

### Requirement: Register Debit Endpoint

The system SHALL expose `POST /api/v1/socios/:socioId/ctacte/movements/debit` accepting `application/json` with `monto` (positive decimal, required), `fecha` (ISO date, required), and `motivo` (text, required). The caller MUST supply an opaque `Idempotency-Key` header of 1–128 characters. A successful new intent SHALL return `201 Created` with the movement JSON and SHALL emit one `CTACTE_DEBIT_REGISTERED` audit event. The route SHALL be gated by `requireAuth()` only.

The system MUST canonicalize `{ operatorId, socioId, monto(2dp), fecha, motivo }`. The same key with that same canonical payload MUST replay the original movement without a second movement or audit effect; the same key with a different canonical payload MUST return `409 CONFLICT`. Different keys MUST create distinct debits, including identical payloads. The key MUST NOT be derived from content or time.

(Previously: debit identity was implicitly content/time-bucket deduplicated.)

#### Scenario: Happy path debit

- **WHEN** an authenticated operator POSTs `{"monto": 800.00, "fecha": "2026-07-09", "motivo": "Cuota social Julio"}` for an existing socio
- **THEN** the response status SHALL be `201 Created` with `{"id": "<uuid>", "tipo": "DEBITO", "monto": 800.00, "fecha": "2026-07-09", "motivo": "Cuota social Julio"}`
- **AND** exactly one `audit_events` row SHALL exist with `action="CTACTE_DEBIT_REGISTERED"`, `entity_type="ctacte_movement"`, `entity_id=<movement-id>`, `metadata.monto=800.00`, `metadata.fecha="2026-07-09"`, `metadata.motivo="Cuota social Julio"`

#### Scenario: Same key replays and payload mismatch conflicts

- **GIVEN** a debit was created with key `intent-1`
- **WHEN** the operator repeats its canonical payload with `intent-1`
- **THEN** the original movement SHALL be returned with no additional movement or audit
- **AND WHEN** the operator changes any canonical field with `intent-1`
- **THEN** the response SHALL be `409 CONFLICT`

#### Scenario: Identical debits with distinct keys are legitimate

- **WHEN** an operator submits the same canonical debit payload with `intent-1` and `intent-2`
- **THEN** two distinct movement rows and two audit effects SHALL exist

#### Scenario: Missing or malformed debit key is rejected

- **WHEN** an authenticated operator omits `Idempotency-Key` or sends an empty or over-128-character value
- **THEN** the response SHALL be `400 VALIDATION_ERROR`
- **AND** no movement or audit effect SHALL be created

#### Scenario: Debit validation rejects zero monto

- **WHEN** an authenticated operator POSTs `{"monto": 0, "fecha": "2026-07-09", "motivo": "X"}`
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: [{ field: "monto", message: "must be > 0" }]`

### Requirement: Add Note to Movement Endpoint

The system SHALL expose `POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes` accepting `application/json` with `body` (text, required). The caller MUST supply an opaque `Idempotency-Key` header of 1–128 characters, reused per note intent across ambiguous retries. A successful new-intent request SHALL return `201 Created` with the new note JSON and SHALL emit exactly one `CTACTE_MOVEMENT_NOTE_ADDED` audit event. The route SHALL be gated by `requireAuth()` only.

The canonical note payload MUST be `{ operatorId, socioId, movementId, body }`. Same key with that same canonical payload SHALL replay the persisted note without a second note row or audit effect; same key with a different canonical payload SHALL return `409 CONFLICT`. Missing/invalid key SHALL return `400 VALIDATION_ERROR`. A distinct key MAY create an identical note.

#### Scenario: Happy path note

- **WHEN** an authenticated operator POSTs `{"body": "Verificar comprobante físico"}` with a valid `Idempotency-Key` for an existing movement
- **THEN** the response status SHALL be `201 Created` with `{"id": "<uuid>", "ctacte_movement_id": "<movement-id>", "body": "Verificar comprobante físico", "author_operator_id": "<op-id>", "created_at": "<iso>"}`
- **AND** exactly one `audit_events` row SHALL exist with `action="CTACTE_MOVEMENT_NOTE_ADDED"`, `metadata: { ctacte_id, movement_id, body, author_operator_id }`

#### Scenario: Note retry replays durably

- **GIVEN** a note was created for a key and canonical payload
- **WHEN** the operator retries with that key and that canonical payload
- **THEN** the original note SHALL be returned without a duplicate note row or audit emission

#### Scenario: Note key conflicts on changed intent

- **GIVEN** a note was created for a key
- **WHEN** the operator reuses that key with a changed canonical payload (different `body`, `movementId`, or operator identity)
- **THEN** the response SHALL be `409 CONFLICT`
- **AND** NO additional note row SHALL be inserted and NO audit event SHALL be emitted

#### Scenario: Identical notes with distinct keys are legitimate

- **WHEN** an authenticated operator submits the same canonical note payload with two distinct `Idempotency-Key` values
- **THEN** two distinct note rows AND two audit effects SHALL exist

#### Scenario: Missing or malformed note key is rejected

- **WHEN** an authenticated operator omits the `Idempotency-Key` header or sends an empty or over-128-character value
- **THEN** the response SHALL be `400 VALIDATION_ERROR`
- **AND** NO note row SHALL be inserted and NO audit event SHALL be emitted

#### Scenario: Unknown movementId returns 404

- **WHEN** an authenticated operator POSTs to a `:movementId` that does not exist
- **THEN** the response status SHALL be `404 NOT_FOUND` with `error: "CTACTE_MOVEMENT_NOT_FOUND"`
- **AND** NO note row SHALL be inserted and NO audit event SHALL be emitted

#### Scenario: Empty body is rejected

- **WHEN** an authenticated operator POSTs `{"body": ""}` (empty string)
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: [{ field: "body", message: "required, non-empty" }]`

### Requirement: Comprobante PDF Endpoint

The system SHALL expose `GET /api/v1/socios/:socioId/ctacte/comprobante.pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&cuenta=<ctacte-id>` returning a server-rendered PDF. The caller MUST supply an opaque `Idempotency-Key` header of 1–128 characters. The response `Content-Type` SHALL be `application/pdf`, `Content-Disposition` SHALL be `inline; filename="ctacte-<socioNumero>-<from>-<to>.pdf"`, and the body SHALL begin with `%PDF-`. The PDF SHALL include the socio card, date-range movimientos table, and totals footer. The route SHALL be gated by `requireAuth()` only.

The movimientos query SHALL be hard-capped at `LIMIT 50` movements per PDF. If the date range would return more than 50 movements, the endpoint SHALL return `400 VALIDATION_ERROR` with `details: { cap: 50, requested: <count> }` and SHALL NOT invoke puppeteer.

For one key and canonical authenticated request payload, the system MUST durably persist and replay the exact `{ pdf, filename, sha256, byteSize, movementCount }` result across concurrent callers, processes, and instances. The same key with a different canonical request payload MUST return `409 CONFLICT`. It MUST render one PDF and emit one idempotent `CTACTE_COMPROBANTE_PRINTED` audit effect; replays MUST NOT render or emit again. A completed result MUST retain its actual `movementCount`, including non-zero values.

A durable claim MUST use an owner lease. Only its current owner MAY heartbeat, complete, or fail it. Waiters MUST use bounded backoff/jitter until completion, failure, stale lease, or caller cancellation, and MUST NOT impose a render-duration timeout. Caught render failures MUST become reclaimable `failed` state; a stale lease or failed claim MUST be atomically reclaimable. Result retention MUST be separate from the lease: cleanup MUST NOT remove active rendering state, and a completed result MAY be discarded only after its configured retention expiry, after which the same key starts a new attempt.

(Previously: comprobante replay was a 10-second audit/content bucket without durable result or lease semantics.)

#### Scenario: Happy path returns a valid PDF

- **WHEN** an authenticated operator calls `GET /api/v1/socios/<socioId>/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=<ctacte-id>` and the date range contains 12 movements
- **THEN** the response status SHALL be `200 OK`
- **AND** the `Content-Type` header SHALL equal `application/pdf`
- **AND** the `Content-Disposition` header SHALL equal `inline; filename="ctacte-<socioNumero>-2026-07-01-2026-07-31.pdf"`
- **AND** the response body SHALL begin with `%PDF-`
- **AND** exactly one `CTACTE_COMPROBANTE_PRINTED` audit event SHALL be emitted with `metadata: { socio_id, ctacte_id, from, to, movement_count: 12, sha256, byte_size }`

#### Scenario: Cap of 50 movements returns 400

- **WHEN** the date range would return 51 movements
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: { cap: 50, requested: 51 }`
- **AND** puppeteer SHALL NOT be invoked
- **AND** NO `CTACTE_COMPROBANTE_PRINTED` audit event SHALL be emitted

#### Scenario: from after to returns 400

- **WHEN** an operator calls with `from=2026-08-01&to=2026-07-01` (inverted range)
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` with `details: [{ field: "from", message: "must be <= to" }]`

#### Scenario: Missing required query params return 400

- **WHEN** an operator calls the endpoint with no `from` or no `to`
- **THEN** the response status SHALL be `400 VALIDATION_ERROR` listing the missing fields
- **AND** puppeteer SHALL NOT be invoked

#### Scenario: Missing JWT returns 401

- **WHEN** the endpoint is called without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** puppeteer SHALL NOT be invoked
- **AND** NO audit event SHALL be emitted

#### Scenario: Slow cross-instance replay returns the complete result

- **GIVEN** one instance owns a render that exceeds 500 ms and a second instance receives the same key and canonical request
- **WHEN** the owner completes
- **THEN** both callers SHALL receive the same persisted PDF result, including `movementCount`
- **AND** one PDF render and one audit effect SHALL exist

#### Scenario: Failed or abandoned claim is reclaimed

- **GIVEN** a render throws or its owner dies after the lease becomes stale
- **WHEN** a retry with the same key arrives
- **THEN** it SHALL atomically claim a new attempt and complete or report its new failure
- **AND** no active claim SHALL be deleted by expiry cleanup

#### Scenario: Reused comprobante key rejects a changed request

- **GIVEN** a completed comprobante request for a key
- **WHEN** an authenticated caller reuses that key with a different canonical request payload
- **THEN** the response SHALL be `409 CONFLICT`
- **AND** no PDF render or audit effect SHALL be added

### Requirement: Idempotency Contracts for Mutations

All four ctacte mutations — Payment, Debit, Note, and Comprobante PDF — MUST use caller-supplied opaque `Idempotency-Key` headers of 1–128 characters. Identity MUST NOT be derived from content, elapsed time, or audit-bucket dedup. Same key with the same canonical payload SHALL replay the persisted result without a second mutation or audit effect; same key with a different canonical payload SHALL return `409 CONFLICT`. Missing/invalid key SHALL return `400 VALIDATION_ERROR`. A new or expired result requires a fresh key; expiry MUST NOT collapse two legitimate identical intents.

The Pago canonical payload is `{ operatorId, socioId, monto(2dp), fecha, concepto, comprobanteAttachmentHash-or-null }` (see Register Payment Endpoint). The Débito canonical payload is `{ operatorId, socioId, monto(2dp), fecha, motivo }` (see Register Debit Endpoint). The Nota canonical payload is `{ operatorId, socioId, movementId, body }` (see Add Note to Movement Endpoint). The Comprobante canonical payload is the authenticated request itself — `socioId`, `from`, `to`, `cuenta`, and the calling operator (see Comprobante PDF Endpoint).

(Previously: payment and note idempotency were specified as 10-second audit-key contracts; debit and comprobante used caller-provided keys. All four are now aligned to caller-provided keys across time and processes.)

#### Scenario: Pago replay requires key identity, not elapsed time

- **WHEN** an authenticated operator POSTs the same pago canonical payload twice with the same `Idempotency-Key`, regardless of elapsed time within result retention
- **THEN** exactly one movement row SHALL exist
- **AND** exactly one `audit_events` row SHALL exist for `CTACTE_PAYMENT_REGISTERED`

#### Scenario: Debit replay requires key identity, not elapsed time

- **WHEN** an authenticated operator POSTs the same débito body twice with the same key, regardless of elapsed time within result retention
- **THEN** exactly one movement row and audit effect SHALL exist
- **AND WHEN** the operator uses a new key
- **THEN** a second movement and audit effect SHALL exist

#### Scenario: Notes with distinct canonical payloads are distinct rows

- **WHEN** an authenticated operator POSTs two notes with `body="A"` then `body="B"`, regardless of elapsed time, using two `Idempotency-Key` values
- **THEN** exactly two `ctacte_movement_notes` rows SHALL exist
- **AND** exactly two `CTACTE_MOVEMENT_NOTE_ADDED` audit events SHALL be emitted

#### Scenario: Notes with identical canonical payload and same key replay to one row

- **WHEN** an authenticated operator POSTs the same canonical note payload twice with the same `Idempotency-Key`
- **THEN** exactly one `ctacte_movement_notes` row SHALL exist
- **AND** exactly one `CTACTE_MOVEMENT_NOTE_ADDED` audit event SHALL be emitted

#### Scenario: Comprobante replay across instances persists and returns the complete result

- **GIVEN** one instance owns a comprobante render for a key and a second instance receives the same key and canonical request
- **WHEN** the owner completes
- **THEN** both callers SHALL receive the same persisted PDF result, including `movementCount`
- **AND** one PDF render and one audit effect SHALL exist

#### Scenario: Failed or abandoned comprobante claim is reclaimed

- **GIVEN** a render throws or its owner dies after the lease becomes stale
- **WHEN** a retry with the same key arrives
- **THEN** it SHALL atomically claim a new attempt and complete or report its new failure
- **AND** no active claim SHALL be deleted by expiry cleanup

### Requirement: Auth Gate Is requireAuth() Only on All Four Routes

The system SHALL gate all four ctacte mutation routes (`payment`, `debit`, `notes`, `comprobante.pdf`) with `requireAuth()` only — no role check, no socio-assignment matrix. Any authenticated operator (ADMIN, TESORERO, OPERADOR, CONSULTA) may call any of the four routes. Missing or invalid JWT SHALL return `401 UNAUTHORIZED` with the standard `ApiError` envelope.

#### Scenario: CONSULTA role can register a pago

- **WHEN** an authenticated operator with role `CONSULTA` calls `POST /api/v1/socios/<id>/ctacte/movements/payment`
- **THEN** the response status SHALL be `201 Created` (no role-mismatch error SHALL be raised)

#### Scenario: Missing JWT returns 401 on every route

- **WHEN** any of the four routes is called without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED` with `error: "UNAUTHORIZED"`
- **AND** the response body SHALL conform to the `ApiError` envelope

---

## Section B — DB schema

### Requirement: `ctacte_movement_notes` Table

The system SHALL add a new table `socios.ctacte_movement_notes` with the following columns: `id UUID PRIMARY KEY default gen_random_uuid()`, `ctacte_movement_id UUID NOT NULL` (FK to `tesoreria.ctacte.id` ON DELETE RESTRICT), `body TEXT NOT NULL`, `author_operator_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`. The table SHALL have an index on `(ctacte_movement_id)` and an index on `(created_at DESC)`. The table SHALL be created via the hand-written migration `packages/db/drizzle/0031_ctacte_movement_notes.sql` (applied via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0031_*.sql` because the Drizzle pipeline is broken in prod). The SQL SHALL use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for idempotent re-runs.

The Drizzle schema declaration SHALL live at `packages/db/src/schema/tesoreria.ts` (or a sibling `notes.ts` imported from `tesoreria.ts`) so the TypeScript layer compiles.

#### Scenario: Migration applies idempotently

- **WHEN** `packages/db/drizzle/0031_ctacte_movement_notes.sql` is applied twice to the same database
- **THEN** the second application SHALL be a no-op
- **AND** the table `socios.ctacte_movement_notes` SHALL exist with all required columns
- **AND** both indexes SHALL exist

#### Scenario: Schema declaration compiles

- **WHEN** the TypeScript layer references `ctacteMovementNotes` from `@athlos/db`
- **THEN** `pnpm typecheck` SHALL succeed
- **AND** the inferred row type SHALL include `id`, `ctacte_movement_id`, `body`, `author_operator_id`, `created_at`, `deleted_at`

### Requirement: `comprobante_attachment_id` Nullable FK Column on `tesoreria.ctacte`

The system SHALL add a nullable column `tesoreria.ctacte.comprobante_attachment_id UUID NULL` with a FOREIGN KEY to `socios.socio_attachments.id` (ON DELETE SET NULL so a hard-deleted attachment does not break the ctacte row). The column SHALL be added in the same `0031_*.sql` migration (idempotent via `ADD COLUMN IF NOT EXISTS`). The Drizzle schema SHALL declare `comprobanteAttachmentId: uuid('comprobante_attachment_id')` so the `ctacte` table type includes the new field.

#### Scenario: Payment without comprobante stores NULL

- **WHEN** a payment row is inserted without an uploaded comprobante
- **THEN** `ctacte.comprobante_attachment_id` SHALL be `NULL`

#### Scenario: Payment with comprobante stores the attachment_id

- **WHEN** a payment row is inserted after a successful `socio_attachments` upload
- **THEN** `ctacte.comprobante_attachment_id` SHALL equal the returned `attachment_id`

#### Scenario: Column addition is idempotent

- **WHEN** migration `0031` is applied twice
- **THEN** the column SHALL exist exactly once (no duplicate-column error)

### Requirement: Soft-Delete on Notes Preserves Audit Trail

The system SHALL soft-delete notes by setting `deleted_at = now()`. Notes queries SHALL exclude rows where `deleted_at IS NOT NULL`. The underlying row SHALL remain in the table indefinitely (matching the audit-logger spec's append-only invariant). The `CTACTE_MOVEMENT_NOTE_ADDED` audit event SHALL remain queryable after soft-delete.

#### Scenario: Soft-deleted note is hidden from list

- **WHEN** a note with `id=<uuid>` is soft-deleted
- **THEN** `GET /api/v1/socios/<id>/ctacte/movements/<movementId>/notes` SHALL NOT include that note in the response
- **AND** the underlying row SHALL remain in the table (verifiable via direct SQL)

#### Scenario: Audit event for soft-deleted note remains queryable

- **WHEN** a note is soft-deleted
- **THEN** the original `CTACTE_MOVEMENT_NOTE_ADDED` audit row SHALL still be returned by `GET /api/v1/audit?action=CTACTE_MOVEMENT_NOTE_ADDED&entity_id=<note-id>`

### Requirement: Durable Comprobante Replay Migration and Manual Rollout

The system SHALL provide forward-compatible hand-written migration `0033_ctacte_comprobante_retries.sql` and matching schema declarations for durable replay. It MUST store `status` constrained to `rendering`, `complete`, or `failed`; lease owner/expiry; attempt count; update time; `movement_count`; and completed-result fields. SQL MUST safely tolerate reapplication through guarded additions and constraints. Because the production Drizzle journal is incomplete after 0020, 0033 MUST NOT be represented as Drizzle-applied.

`docs/runbook.md` and the PR deployment note MUST require: database backup; application of required `0031`, `0032`, then `0033` before API rollout using `psql -v ON_ERROR_STOP=1 --single-transaction`; verification of the table, columns, status CHECK, and expiry index; then deployment. This phase MUST NOT apply migrations, deploy, or access production.

#### Scenario: Manual migration is safe to reapply

- **GIVEN** an ephemeral PostgreSQL database with prerequisite migrations applied
- **WHEN** `0033` is applied twice using the documented command semantics
- **THEN** both executions SHALL succeed
- **AND** introspection SHALL confirm the required columns, CHECK constraint, and expiry index

#### Scenario: Rollout stops before API deployment on migration failure

- **GIVEN** backup, migration, or verification fails
- **WHEN** the manual runbook is followed
- **THEN** API rollout SHALL NOT proceed

### Requirement: Executable Strict-TDD Evidence for R2 Remediation

Every R2 corrective task SHALL have executable targeted tests for slow replay, failed/stale-claim reclaim, cross-instance convergence, exact non-zero `movementCount` replay, debit same-key replay/payload conflict/distinct-key identity, and PostgreSQL migration reapplication. `apply-progress.md` MUST record the test file/name and layer, pre-change commit, exact RED command/exit code/failure excerpt, implementation commit, exact GREEN command/exit code/pass count, triangulation case, and targeted safety-net command/result. Missing or invalid RED evidence MUST be recorded as missing and MUST NOT satisfy Strict TDD; inferred or fabricated evidence is prohibited.

#### Scenario: Evidence is independently executable

- **WHEN** a reviewer runs each recorded RED, GREEN, triangulation, and safety-net command at its stated commit
- **THEN** the recorded outcome SHALL be reproducible
- **AND** each corrective behavior SHALL map to a named targeted test

---

## Section C — Frontend mutation UI

### Requirement: Three Mutation Modals on `/ctacte/[cuenta]`

The system SHALL expose three mutation modals on the `/ctacte/[cuenta]` page, each built on the existing `<Modal>` primitive (sticky header / scroll body / sticky footer). All three modals SHALL validate with Zod via `react-hook-form` and SHALL surface errors via the standard `ApiError` envelope (inline field error messages plus an error toast for top-level failures).

The Débito form MUST create one UUID `Idempotency-Key` for a submit intent, send it with the request, retain it across ambiguous/network retries, and rotate it only after success or explicit cancel. It MUST NOT derive the key from form content or elapsed time.

| Modal | Open trigger | Fields | Submit calls |
|---|---|---|---|
| Registrar Pago | "Registrar Pago" header button | `monto`, `fecha`, `concepto`, optional `comprobante` (drag-and-drop + file picker) | `POST /api/v1/socios/<id>/ctacte/movements/payment` (multipart) |
| Registrar Débito | "Registrar Débito" header button | `monto`, `fecha`, `motivo` | `POST /api/v1/socios/<id>/ctacte/movements/debit` (JSON) |
| Nota | Per-movement "Nota" button on each `MovementList` row | `body` (textarea) | `POST /api/v1/socios/<id>/ctacte/movements/<movementId>/notes` (JSON) |

#### Scenario: Pago modal opens with empty form

- **WHEN** the operator clicks "Registrar Pago" in the page header
- **THEN** the Pago modal SHALL mount
- **AND** the form SHALL render four fields: monto, fecha, concepto, comprobante (with drag-and-drop zone + file picker)
- **AND** the Submit button SHALL be disabled until all required fields are populated

#### Scenario: Pago modal submits and closes on success

- **WHEN** the operator fills all fields and clicks Submit
- **THEN** the client SHALL POST the multipart payload to the payment endpoint
- **AND** on `201 Created`, the modal SHALL close, `notify('success', 'Pago registrado')` SHALL fire, and the movements list SHALL re-fetch
- **AND** on a non-201 response, the modal SHALL remain open and surface the field-level error from the `ApiError` envelope

#### Scenario: Débito modal rejects monto <= 0 client-side

- **WHEN** the operator enters `monto = -50` in the Débito modal
- **THEN** the Submit button SHALL remain disabled
- **AND** an inline error message ("El monto debe ser positivo") SHALL display under the field
- **AND** NO API call SHALL fire

#### Scenario: Débito retry retains its caller key

- **GIVEN** an operator submits a valid Débito form and the client cannot determine the response outcome
- **WHEN** the operator retries the same submit intent
- **THEN** the request SHALL reuse its original `Idempotency-Key`
- **AND** success or explicit cancel SHALL rotate the next intent to a new key

#### Scenario: Nota modal attaches to the right movement

- **WHEN** the operator clicks the "Nota" button on a specific movement row
- **THEN** the Nota modal SHALL open
- **AND** the modal title SHALL include the movement identifier (e.g., "Nota · Movimiento #12345")
- **AND** on Submit, the request URL SHALL include that movement's `:movementId`

### Requirement: Reimprimir Comprobante Button + Date-Range Picker

The system SHALL expose a "Reimprimir Comprobante" button in the page header's mutation button group. Clicking the button SHALL open a modal with a date-range picker (two `YYYY-MM-DD` inputs: `from` + `to`). Submit SHALL call `GET /api/v1/socios/<id>/ctacte/comprobante.pdf?from=...&to=...&cuenta=...` via `apiFetchBlob`, convert the response to a `Blob`, and open it in a new tab via `URL.createObjectURL` + `window.open(blobUrl, '_blank', 'noopener,noreferrer')`. The button SHALL match the Emitir Solicitud precedent from PR 8d (Secondary variant, Lucide `Printer` icon, no shadow, no `rounded-full`).

#### Scenario: Reimprimir Comprobante opens PDF in a new tab

- **WHEN** the operator clicks "Reimprimir Comprobante", picks `from=2026-07-01&to=2026-07-31`, and clicks Submit
- **THEN** the client SHALL call `apiFetchBlob('/api/v1/socios/<id>/ctacte/comprobante.pdf?from=...&to=...')`
- **AND** on success, a new browser tab SHALL open with the PDF rendered inline
- **AND** `notify('success', 'Comprobante emitido')` SHALL fire

#### Scenario: Reimprimir Comprobante surfaces cap error

- **WHEN** the date range would exceed the 50-movement cap and the API returns `400 VALIDATION_ERROR`
- **THEN** the modal SHALL remain open
- **AND** an error toast SHALL fire via `notify('error', 'El rango excede el límite de 50 movimientos')`
- **AND** the operator SHALL be able to narrow the range and retry

#### Scenario: Reimprimir Comprobante uses window.open with noopener,noreferrer

- **WHEN** the Submit click handler completes
- **THEN** the client SHALL call `window.open(blobUrl, '_blank', 'noopener,noreferrer')`
- **AND** the new tab SHALL NOT have an opener reference (security hardening)

### Requirement: Toast Feedback on All Four Mutations

The system SHALL fire `notify(kind, message)` from `@/lib/notifications` for every mutation outcome:

| Mutation | Success toast | Error toast |
|---|---|---|
| Registrar Pago | `notify('success', 'Pago registrado')` | `notify('error', 'No se pudo registrar el pago')` |
| Registrar Débito | `notify('success', 'Débito registrado')` | `notify('error', 'No se pudo registrar el débito')` |
| Reimprimir Comprobante | `notify('success', 'Comprobante emitido')` | `notify('error', 'No se pudo emitir el comprobante')` |
| Nota | `notify('success', 'Nota agregada')` | `notify('error', 'No se pudo agregar la nota')` |

Toasts SHALL use the existing sonner wrapper (light theme, top-right, auto-dismiss ~4000 ms for success, ~6000 ms for error) per the `athlos-toast-primitivo` change.

#### Scenario: Success toast renders top-right with role=status

- **WHEN** a pago is successfully registered
- **THEN** `notify('success', 'Pago registrado')` SHALL fire
- **AND** the toast SHALL render top-right with `role="status"`
- **AND** auto-dismiss after ~4000 ms

#### Scenario: Error toast renders top-right with role=alert

- **WHEN** a débito registration fails (e.g., API returns 400)
- **THEN** `notify('error', 'No se pudo registrar el débito')` SHALL fire
- **AND** the toast SHALL render top-right with `role="alert"`
- **AND** auto-dismiss after ~6000 ms

### Requirement: apiFetch and apiFetchBlob Used for JSON + PDF Mutations

The system SHALL use `apiFetch(url, init)` (for JSON mutations: pago JSON fields, débito, nota) and `apiFetchBlob(url, init)` (for the comprobante PDF download) from `apps/web/src/lib/api.ts`. Both helpers MUST attach the JWT access token to every request via `Authorization: Bearer <token>` and MUST route through the single-flight refresh helper so a 401 response from the server triggers exactly one refresh attempt and one retry — no refresh storm.

#### Scenario: Pago JSON mutation uses apiFetch with Authorization header

- **WHEN** the Pago modal submits
- **THEN** the request SHALL include `Authorization: Bearer <access_token>`
- **AND** the helper SHALL NOT allow anonymous calls (missing token → request rejected before send)

#### Scenario: Comprobante PDF uses apiFetchBlob

- **WHEN** Reimprimir Comprobante submits
- **THEN** the client SHALL call `apiFetchBlob('/api/v1/socios/<id>/ctacte/comprobante.pdf?...')`
- **AND** the response SHALL be a `Blob` with `type: 'application/pdf'`
- **AND** the helper SHALL route the download through `URL.createObjectURL` (not a bare `window.open(url)` so auth headers carry through)

#### Scenario: Single-flight refresh on 401

- **WHEN** any of the four mutations returns `401 UNAUTHORIZED` and the refresh token is still valid
- **THEN** the helper SHALL trigger exactly one refresh
- **AND** the original request SHALL be retried exactly once with the new token
- **AND** a SECOND 401 SHALL surface to the caller (no retry loop)

---

## Section D — Canonical UX patterns

### Requirement: OperatorChip Renders Audit Actors as `username · ROLE`

The system SHALL render every audit actor (e.g., the `author_operator_id` on a note row, the `operator_id` on a `CTACTE_MOVEMENT_NOTE_ADDED` event) using the existing `<OperatorChip>` primitive from `apps/web/src/components/socios/OperatorChip.tsx`. The chip SHALL resolve the operator UUID via the existing `/api/v1/operators` endpoint and SHALL render the text in the format `username · ROLE` (e.g., `jperez · OPERADOR`). The chip replaces any prior pattern that showed the raw UUID (e.g., `Operador 1f2a3b4c-…`).

#### Scenario: OperatorChip resolves a known operator

- **WHEN** a note with `author_operator_id = "<uuid>"` is rendered
- **THEN** the OperatorChip SHALL display `username · ROLE` (e.g., `jperez · OPERADOR`)
- **AND** SHALL NOT display the raw UUID

#### Scenario: OperatorChip shows fallback when operator is deleted

- **WHEN** an operator is hard-deleted and the note references the stale UUID
- **THEN** the OperatorChip SHALL display a fallback like `Operador eliminado`
- **AND** SHALL NOT throw or break the row render

### Requirement: Per-Cuenta Notes Collapsed State Persists in localStorage

The system SHALL manage the collapsed/expanded state of the per-cuenta notes section via the `useNotesCollapsed(cuentaId, null)` hook colocated in `apps/web/src/components/ledger/CtacteMovementNotesCard.tsx`. The hook SHALL persist state in `localStorage` under the key `ctacte-notes-collapsed-<cuenta>` (one key per cuenta). The default collapsed state SHALL be `true` (collapsed) on first visit so the page does not flash expanded content.

#### Scenario: Collapsed state persists across reloads

- **WHEN** the operator expands the notes section on `/ctacte/<cuenta-A>`, reloads the page, and the hook reads from localStorage
- **THEN** `localStorage.getItem('ctacte-notes-collapsed-<cuenta-A>')` SHALL equal `"false"` (expanded)
- **AND** the section SHALL render expanded on the second visit

#### Scenario: State is isolated per cuenta

- **WHEN** the operator expands notes for `cuenta-A` but collapses notes for `cuenta-B`
- **THEN** `localStorage.getItem('ctacte-notes-collapsed-<cuenta-A>')` SHALL equal `"false"`
- **AND** `localStorage.getItem('ctacte-notes-collapsed-<cuenta-B>')` SHALL equal `"true"`
- **AND** visiting cuenta-A renders expanded; visiting cuenta-B renders collapsed

#### Scenario: Default state is collapsed on first visit

- **WHEN** the operator opens `/ctacte/<cuenta-X>` for the first time (no localStorage key)
- **THEN** the notes section SHALL render collapsed
- **AND** the hook SHALL write `"true"` to `localStorage` for that cuenta

### Requirement: Gorriti Premium Tokens Consumed Throughout `/ctacte/[cuenta]`

The system SHALL consume Gorriti Premium tokens (`surface-page`, `ink-150`, `radius-xl`, `radius-2xl`, `shadow-sm`) for all cards, sections, and buttons added to `/ctacte/[cuenta]`. No new tokens SHALL be introduced in this change. Raw hex values SHALL NOT appear in the new component code outside the token files (`apps/web/src/styles/tokens.css` and `apps/web/tailwind.config.ts`). The page header SHALL follow the canonical pattern from `/socios/[id]`: `rounded-xl + shadow-sm + p-8` card, `text-3xl uppercase tracking-tight` title, Lucide icon tiles, back-circle button.

#### Scenario: Cards consume tokens (no raw hex)

- **WHEN** the page renders
- **THEN** the header card, summary strip, mutation card, and notes card SHALL use `bg-surface-page`, `rounded-xl`, `shadow-sm`, `p-8` from the token set
- **AND** a CI grep over the new component files SHALL find ZERO raw hex literals (`#[0-9a-fA-F]{3,8}` outside `tokens.css`)

#### Scenario: No new tokens introduced

- **WHEN** the change is applied
- **THEN** `apps/web/src/styles/tokens.css` SHALL NOT gain new CSS variables beyond what was already there before the change
- **AND** `apps/web/tailwind.config.ts` SHALL NOT gain new `theme.extend` entries beyond what was already there before the change

### Requirement: Zod Validation + ApiError Surfacing on All Forms

The system SHALL validate every mutation form (Pago, Débito, Nota, Reimprimir) using Zod schemas colocated in the form module. Validation errors SHALL be surfaced inline per-field (red helper text under the input per the Input token table). Top-level server errors (non-201 responses, network failures, 401) SHALL be surfaced via the standard `ApiError` envelope rendered either as an inline modal banner or as a `notify('error', ...)` toast per the table in the Toast Feedback requirement.

#### Scenario: Zod catches missing required field client-side

- **WHEN** the operator submits the Débito form with `motivo` empty
- **THEN** Zod SHALL reject the payload client-side
- **AND** the Submit button SHALL NOT call the API
- **AND** an inline error message ("El motivo es obligatorio") SHALL display under the motivo field

#### Scenario: Server ApiError is rendered to the user

- **WHEN** the Pago API returns `400 VALIDATION_ERROR` with `details: [{ field: "monto", message: "must be > 0" }]`
- **THEN** the client SHALL parse the `ApiError` envelope
- **AND** SHALL surface the per-field message inline under the monto input via `applyFieldErrors`
- **AND** SHALL additionally call `notify('error', ...)` so the operator sees the operation-level failure toast alongside the inline guidance

#### Scenario: Inline field errors and additive toast are both preserved

- **WHEN** any mutation API returns a `400 VALIDATION_ERROR` envelope with one or more field details
- **THEN** the client SHALL render the per-field message inline
- **AND** SHALL fire one error toast via `notify('error', ...)`
- **AND** the modal SHALL remain open so the operator can correct the fields and retry

#### Scenario: Network failure fires an error toast

- **WHEN** the API call rejects with a network error (offline, DNS failure)
- **THEN** the client SHALL fire `notify('error', 'No se pudo conectar con el servidor')`
- **AND** the modal SHALL remain open so the operator can retry

---

## Success Criteria

- [ ] `POST /api/v1/socios/:socioId/ctacte/movements/payment` returns `201 Created` with the new movement + `CTACTE_PAYMENT_REGISTERED` audit; rejects `monto <= 0`, `fecha` out of range, and missing JWT; stores `comprobante` in `socios.socio_attachments` with `resource_type='ctacte_payment'`.
- [ ] Debit requires a caller `Idempotency-Key`: same key plus canonical payload replays, changed payload returns `409`, and identical payloads with distinct keys create distinct movements.
- [ ] `POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes` returns `201` + `CTACTE_MOVEMENT_NOTE_ADDED` audit; rejects empty body and unknown `:movementId`.
- [ ] Comprobante replay is durable across instances and slow renders, reclaims failed/stale claims, preserves the complete persisted result including `movementCount`, and produces one PDF/audit effect per key.
- [ ] Payment and notes retain their 10-second audit-key contracts; debit and comprobante use caller-provided keys rather than content/time-bucket identity.
- [ ] `socios.ctacte_movement_notes` table + `tesoreria.ctacte.comprobante_attachment_id` column created via hand-written `0031_*.sql`, applied via `docker exec psql`, idempotent on re-runs.
- [ ] 3 mutation modals (Pago, Débito, Nota) + Reimprimir Comprobante button on `/ctacte/[cuenta]`, all using the `<Modal>` primitive and `notify()` for feedback.
- [ ] `OperatorChip` renders `username · ROLE` for audit actors; `useNotesCollapsed(cuentaId, null)` persists per-cuenta under `localStorage` key `ctacte-notes-collapsed-<cuenta>`.
- [ ] Gorriti Premium tokens consumed throughout; no raw hex outside token files; no new tokens added.
- [ ] Zod validation + `ApiError` envelope rendering on all forms.
- [ ] 3 PRs stacked-to-main (`A1a` → `A1b` → `A2`); each PR ≤ 400 changed lines.
- [ ] Migration `0031_ctacte_movement_notes.sql` applied via `docker exec psql`; re-runs idempotent.
- [ ] `0033_ctacte_comprobante_retries.sql` is manually applied only through the documented backup, ordered migration, verification, and rollout runbook; its PostgreSQL reapplication test passes.
- [ ] R2 corrective tests and `apply-progress.md` provide independently executable RED/GREEN, triangulation, and safety-net evidence for every task.
- [ ] `pnpm typecheck` + `pnpm lint` clean; full API + web test suites pass; 1:1 source:test ratio preserved.
