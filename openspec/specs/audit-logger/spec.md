# Audit Logger Specification

## Purpose

Audit logging system for operator actions and socio data changes. Provides immutable, queryable audit trail for compliance, debugging, and accountability.

## Requirements

### Requirement: Immutable Audit Trail

The system MUST record all auditable events in an append-only audit log. Audit records MUST NOT be updated or deleted after insertion.

Records MUST be retained indefinitely with NO purge job, NO TTL, and NO archival step in v1.

#### Scenario: Audit record is immutable

- GIVEN an audit record with `id: <uuid>` exists
- WHEN any update or delete is attempted on that record
- THEN the operation MUST be rejected with an error
- AND no scheduled job MAY delete records older than any threshold (because no threshold is defined)

#### Scenario: No purge job exists

- GIVEN the audit package is inspected
- WHEN the scheduler registry is queried
- THEN there MUST be no job named `audit-purge`, `audit-retention`, or any equivalent
- AND a CI test MUST assert the scheduler does not register any such job

### Requirement: API Operation Logging

The system MUST log all API operations (create, update, delete) with: `operator_id`, `timestamp`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `source_ip`.

The system MUST capture these via Fastify `onRequest` and `onResponse` hooks installed by the `audit` package's `auditPlugin`. The `onRequest` hook MUST snapshot the pre-mutation `entity_id` resolution; the `onResponse` hook MUST compute the diff and call `emitAudit` (which dedupes per the ADDED Idempotency Window requirement).

#### Scenario: API create logged

- GIVEN operator "OP-001" creates a new socio record via API
- WHEN the create request completes
- THEN audit log MUST contain: `operator_id: "OP-001"`, `action: "CREATE"`, `entity_type: "socio"`, `entity_id: <uuid>`, `old_value: null`, `new_value: <record>`, `source_ip: "192.168.1.10"`

#### Scenario: API update logged

- GIVEN operator "OP-002" updates socio "SOC-001" address via API
- WHEN the update request completes
- THEN audit log MUST contain: `operator_id: "OP-002"`, `action: "UPDATE"`, `entity_type: "socio"`, `entity_id: <uuid>`, `old_value: <old-address>`, `new_value: <new-address>`, `source_ip: "192.168.1.11"`

#### Scenario: API delete logged

- GIVEN operator "OP-001" deletes a payment record via API
- WHEN the delete request completes
- THEN audit log MUST contain: `operator_id: "OP-001"`, `action: "DELETE"`, `entity_type: "pago"`, `entity_id: <uuid>`, `old_value: <record>`, `new_value: null`, `source_ip: "192.168.1.10"`

### Requirement: Socio Card Change Events

The system MUST log socio card lifecycle events: sport changes, payment registrations, new members (alta), member exits (baja), and data edits.

#### Scenario: New member (alta) logged

- GIVEN a new socio is registered in the system
- WHEN the registration completes
- THEN audit log MUST contain: action="ALTA", entity_type="socio", entity_id="SOC-NEW", details including sport_id and alta timestamp

#### Scenario: Member exit (baja) logged

- GIVEN socio "SOC-001" is marked as baja (exit)
- WHEN the baja is processed
- THEN audit log MUST contain: action="BAJA", entity_type="socio", entity_id="SOC-001", details including baja reason and timestamp

#### Scenario: Sport change logged

- GIVEN socio "SOC-001" changes sport from "futbol" to "basquet"
- WHEN the sport change is processed
- THEN audit log MUST contain: action="SPORT_CHANGE", entity_type="socio", entity_id="SOC-001", old_value="futbol", new_value="basquet"

#### Scenario: Payment registration logged

- GIVEN a payment of 500 is registered for socio "SOC-001"
- WHEN the payment is recorded
- THEN audit log MUST contain: action="PAYMENT_REG", entity_type="pago", entity_id="PAGO-NEW", new_value="<payment-amount:500>", details including socio_id

### Requirement: Audit Query Interface

The system MUST provide a query interface for operators and admins to search and filter audit records by operator, entity, action type, and date range, with pagination.

The endpoint MUST live at `GET /api/v1/audit` and MUST be gated to ADMIN role. Filters and pagination match the `AuditQuery` / `AuditQueryResponse` types in the main spec; the response MUST order results by `timestamp DESC` and MUST honor `limit` (default 100, max 500) and `offset` for pagination.

#### Scenario: Query by operator with pagination

- GIVEN audit records exist for operators "OP-001" and "OP-002"
- WHEN admin queries `GET /api/v1/audit?operator_id=OP-001&limit=50&offset=100`
- THEN response MUST return only records where `operator_id: "OP-001"`
- AND `total` MUST be the unpaginated count
- AND `limit: 50`, `offset: 100` MUST be echoed back

#### Scenario: Non-admin cannot query audit

- GIVEN a CONSULTA token calls `GET /api/v1/audit`
- WHEN the route handler runs
- THEN it MUST return 403 with code `PERMISSION_DENIED`
- AND no rows MUST be returned

### Requirement: Lineage Integration

Audit events MUST be integrated into the existing lineage system as first-class lineage events, enabling traceability from displayed facts to the operator action that created or modified them.

#### Scenario: Audit event in lineage chain

- GIVEN socio "SOC-001" was created by operator "OP-001" via API
- WHEN lineage query is executed for SOC-001
- THEN lineage chain MUST include the audit event showing operator_id, action, and timestamp

### Requirement: Idempotency Window

`emitAudit(record)` MUST compute an idempotency key as `sha256(operator_id || action || entity_id || canonical_json(payload) || bucket_now)`, where `bucket_now` is `floor(Date.now() / 10_000)` (a 10-second bucket, NOT the raw timestamp).

The emitter MUST look up the `idempotency_key` column in `audit_events` before inserting. If a row with the same key exists, the insert MUST be skipped (return `{ inserted: false, deduped: true }`). The window is exactly 10 seconds — actions more than 10s apart MUST produce distinct rows even if all other fields are identical.

#### Scenario: Repeated request within 10s is deduped

- GIVEN a PATCH `/socios/<uuid>` was processed at 12:00:03.500 and emitted 1 audit row
- WHEN the same PATCH is replayed at 12:00:07.000 (3.5s later, same 10s bucket)
- THEN exactly 0 additional rows MUST be inserted
- AND `emitAudit` MUST return `{ inserted: false, deduped: true }`

#### Scenario: Same request after the 10s window is a new row

- GIVEN a PATCH `/socios/<uuid>` was processed at 12:00:03.500
- WHEN the same PATCH is replayed at 12:00:14.000 (next 10s bucket)
- THEN exactly 1 new row MUST be inserted with a different `idempotency_key`

#### Scenario: Different payload within the same bucket is a new row

- GIVEN a PATCH `/socios/<uuid>` was processed with `new_value: { address: "A" }`
- WHEN a different PATCH `/socios/<uuid>` with `new_value: { address: "B" }` arrives in the same 10s bucket
- THEN exactly 1 new row MUST be inserted (the canonical JSON differs → key differs)

### Requirement: Fastify Plugin Encapsulation

The `auditPlugin` exported by `packages/audit/src/middleware.ts` MUST be wrapped with `fastify-plugin` (aliased as `fp`) before being returned. The wrapper MUST include the plugin name `'athlos-audit'`.

Rationale: a plugin registered via `app.register(auditPlugin)` without `fp` wrapping is encapsulated. The `addHook('onRequest', ...)` and `decorateRequest(...)` calls inside the plugin then apply only to the plugin's own scope (which is empty), not to the routes registered elsewhere in the app. The result is silent: protected routes look authenticated but `request.operator` is never set, and mutations are either unaudited or 401. Wrapping with `fp` exposes the hooks/decorators to the parent scope.

#### Scenario: Audit plugin is fp-wrapped

- GIVEN `packages/audit/src/middleware.ts` exports `auditPlugin`
- WHEN the export is inspected
- THEN it MUST be the result of `fp(function (...) { ... }, { name: 'athlos-audit' })`
- AND a CI grep MUST assert the presence of the `fp` wrapper and the `name: 'athlos-audit'` literal

#### Scenario: Protected mutation produces exactly 1 audit row in an integration test

- GIVEN the Fastify test app registers `auditPlugin` via `app.register(auditPlugin)`
- AND registers a PATCH `/socios/:id` route with `preHandler: requireAuth()`
- WHEN an authenticated PATCH `/socios/<uuid>` request is made via the test app
- THEN the response MUST be 200
- AND exactly 1 row MUST be inserted into `audit_events` with the correct `operator_id`, `action: "UPDATE"`, `entity_id: <uuid>`

#### Scenario: Unwrapped plugin would fail this test (regression guard)

- GIVEN a refactor removes the `fp` wrapper from `auditPlugin`
- WHEN the integration test in the previous scenario runs
- THEN it MUST fail with "0 audit rows inserted" (or the row MUST have `operator_id: null`)
- AND the failure message MUST cite the fp-wrap requirement so the regression is obvious

---

### Requirement: Negotiated Dues Action Audit Completeness

The system MUST append an immutable audit record atomically with each successful agreement creation, agreement revision, accepted community-work evidence record, non-cash settlement, and allocation. Each record MUST include the actor identity, timestamp, action, affected obligation and agreement or settlement identity, reason, authorization evidence sufficient to establish the actor's `ADMIN` or `TESORERO` authority, request identity or request fingerprint, and the relevant agreed details, evidence, or before/after revision linkage.

#### Scenario: Agreement revision is fully auditable

- GIVEN an `ADMIN` or `TESORERO` revises an active agreement
- WHEN the revision succeeds
- THEN immutable audit records MUST identify the actor, timestamp, reason, authorization evidence, request identity, predecessor, successor, and changed agreement details

#### Scenario: Community-work settlement is fully auditable

- GIVEN an authorized operator records accepted community-work evidence that produces a non-cash allocation
- WHEN the transaction succeeds
- THEN immutable audit records MUST identify the actor, timestamp, reason, authorization evidence, request identity, evidence, approved value, obligation, settlement, and allocation

---

### Requirement: Rejected Negotiated Dues Commands Do Not Produce Financial Audit Facts

The system MUST NOT append a successful agreement, settlement, or allocation audit fact when authorization, validation, idempotency mismatch, over-allocation, or concurrency validation rejects the command. A replay that returns an existing completed result MUST NOT append duplicate audit facts.

#### Scenario: Conflict leaves no successful audit fact

- GIVEN a stale community-work command conflicts with a concurrent allocation
- WHEN the command is rejected
- THEN no successful settlement or allocation audit record MUST be appended for the rejected command
- AND the pre-existing audit history MUST remain unchanged

## Input/Output Contracts

### Audit Record Schema

```typescript
interface AuditRecord {
  id: string;              // UUID
  operator_id: string;     // Operator who performed the action
  timestamp: string;       // ISO 8601
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ALTA' | 'BAJA' | 'SPORT_CHANGE' | 'PAYMENT_REG';
  entity_type: string;     // e.g., 'socio', 'pago', 'deporte'
  entity_id: string;       // ID of the affected entity
  old_value: object | null;
  new_value: object | null;
  source_ip: string;
  metadata?: object;       // Optional extra context
}
```

### Audit Query API

```typescript
interface AuditQuery {
  operator_id?: string;
  entity_type?: string;
  entity_id?: string;
  action?: string;
  start_date?: string;     // ISO 8601
  end_date?: string;       // ISO 8601
  limit?: number;         // Default 100
  offset?: number;
}

interface AuditQueryResponse {
  records: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}
```

## Success Criteria

- All API operations (create/update/delete) produce audit records
- All socio card events (alta, baja, sport change, payment reg) produce audit records
- Audit records are immutable — no update or delete permitted
- Query interface supports filtering by operator, entity, action, and date range
- Audit events appear in lineage queries for affected entities
- Audit log is append-only with no mutation pathways

---

## Delta — Synced from change `athlos-socio-legajo` (2026-07-07)

> Synced from change `athlos-socio-legajo` (2026-07-07).

This delta extends the Audit Logger Specification with two new audit actions and a corresponding union-widening of the `AuditRecord.action` TypeScript type. Required by `athlos-socio-legajo` to record uploads and soft deletes of `socio_attachments`.

## ADDED Requirements

### Requirement: Socio-Attachment Audit Actions

The system SHALL record the following socio-attachment lifecycle events:

| Action | Entity Type | Trigger | Required `metadata` keys |
|---|---|---|---|
| `SOCIO_ATTACHMENT_UPLOADED` | `socio_attachment` | Successful upload of a single attachment row | `attachment_id`, `filename`, `category`, `size_bytes` |
| `SOCIO_ATTACHMENT_DELETED` | `socio_attachment` | Successful soft-delete of an attachment row | `attachment_id`, `filename`, `category`, `size_bytes` |

Every `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED` emission MUST include all four required `metadata` keys; missing any key SHALL fail the audit assertion. Audit emission is best-effort relative to the primary write — a failed insert MUST NOT roll back the upload or the soft delete.

#### Scenario: SOCIO_ATTACHMENT_UPLOADED row contains full metadata

- **WHEN** an upload of `attachmentId = "abc-…-123"` for `category = "dni"`, `filename = "front.jpg"`, `size_bytes = 524288` completes
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_ATTACHMENT_UPLOADED"`
- **AND** `metadata` SHALL be a JSON object containing exactly the keys `attachment_id`, `filename`, `category`, `size_bytes` (numeric)
- **AND** `metadata.attachment_id` SHALL equal `"abc-…-123"`
- **AND** `metadata.filename` SHALL equal `"front.jpg"`
- **AND** `metadata.category` SHALL equal `"dni"`
- **AND** `metadata.size_bytes` SHALL equal `524288`

#### Scenario: SOCIO_ATTACHMENT_DELETED row contains full metadata

- **WHEN** a soft delete of `attachmentId = "abc-…-123"` completes
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_ATTACHMENT_DELETED"`
- **AND** `metadata` SHALL be a JSON object containing exactly the keys `attachment_id`, `filename`, `category`, `size_bytes`

#### Scenario: Failed audit insert does not roll back upload

- **WHEN** an upload's row insertion succeeds but the subsequent `emitAudit()` call throws
- **THEN** the upload SHALL still be visible to subsequent list/get requests
- **AND** the API response SHALL still be `201 Created`
- **AND** a single warning log line SHALL mention the failed audit emission

#### Scenario: Audit query filters by socio-attachment actions

- **WHEN** an operator calls `GET /api/v1/audit?action=SOCIO_ATTACHMENT_UPLOADED`
- **THEN** the response SHALL include ONLY rows where `action = "SOCIO_ATTACHMENT_UPLOADED"`
- **AND** the `metadata` field SHALL be returned verbatim (object, not stringified twice)

## MODIFIED Requirements

### Requirement: Audit Record Schema — Action Union Widened to Allow Custom Actions

(Previously: `action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ALTA' | 'BAJA' | 'SPORT_CHANGE' | 'PAYMENT_REG'`.)

The `AuditRecord.action` field SHALL accept one of the following:

```typescript
type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'ALTA'
  | 'BAJA'
  | 'SPORT_CHANGE'
  | 'PAYMENT_REG'
  | 'SOCIO_ATTACHMENT_UPLOADED'
  | 'SOCIO_ATTACHMENT_DELETED';
```

The action is server-emitted and NEVER client-supplied — all five CRUD-style legacy actions plus the two new socio-attachment actions SHALL be the only accepted values. Adding a new action requires updating this union AND publishing a delta spec; v1 has exactly these two new actions.

The `metadata` field remains `object` (free-form JSON) and is the canonical place for action-specific keys (e.g., `attachment_id`, `size_bytes`). The legacy fields (`old_value`, `new_value`) remain available for diff-based audit; the new actions MAY omit them or set them to a one-line summary.

**Implementation note:** The codebase pre-existing pattern uses `action: string` plus an `AuditAction` const-map at the TypeScript level rather than a TypeScript literal union. The `AuditAction` const-map is the canonical list of accepted values; the union above is the canonical spec contract. New callers SHOULD use the `AuditAction` const-map; runtime validation in the Zod schema enforces the canonical set.

#### Scenario: SOCIO_ATTACHMENT_UPLOADED passes TypeScript narrowing

- **WHEN** TypeScript code narrows `action: AuditAction` against the union
- **THEN** `'SOCIO_ATTACHMENT_UPLOADED'` SHALL match a member of the union
- **AND** narrowing SHALL discriminate correctly against other actions (e.g., `'CREATE'`)

#### Scenario: Zod schema accepts the new action values

- **WHEN** a new audit row is inserted with `action = "SOCIO_ATTACHMENT_DELETED"`
- **THEN** the Zod validator SHALL accept it
- **AND** a row with `action = "NOT_A_REAL_ACTION"` SHALL be rejected by the validator

#### Scenario: All existing actions continue to work

- **WHEN** any of the legacy actions (`CREATE`, `UPDATE`, `DELETE`, etc.) is emitted as before
- **THEN** the row SHALL still be inserted
- **AND** the union widening SHALL NOT have broken existing call sites

#### Scenario: Audit timeline UI renders socio-attachment rows

- **WHEN** the AuditTab on `/socios/[id]` renders a row with `action = "SOCIO_ATTACHMENT_UPLOADED"`
- **THEN** the row SHALL show the filename, category chip, and size from `metadata`
- **AND** the row SHALL include a `FolderOpen` Lucide icon (matching the Legajo tab visual)

---

## Delta — Synced from change `athlos-socio-form-emit` (2026-07-07)

> Synced from change `athlos-socio-form-emit` (2026-07-07).

This delta extends the Audit Logger Specification with a new audit action and the exact metadata shape required by the form emission endpoint. Required by `athlos-socio-form-emit` to record every successful PDF emission so the bytes can be verified against the audit log in the future.

## ADDED Requirements

### Requirement: Form Emission Audit Action

The system SHALL record the following socio-form emission event:

| Action | Entity Type | Trigger | Required `metadata` keys |
|---|---|---|---|
| `SOCIO_FORM_EMITTED` | `socio` | Successful generation of the `solicitud-inscripcion.pdf` for a socio | `socio_id`, `form_id`, `sha256`, `byte_size` |

`form_id` SHALL be the string literal `"solicitud-inscripcion"` for the v1 form. `sha256` SHALL be a 64-character lowercase hex string (the SHA-256 of the PDF bytes). `byte_size` SHALL be a positive integer (`Buffer.byteLength(pdfBuffer)`). The `AuditAction` const-map at `packages/audit/src/emitter.ts` SHALL be widened to include `SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED'` so the TypeScript type, the Zod validator, and the const-map all accept the new value.

Every `SOCIO_FORM_EMITTED` emission MUST include all four required `metadata` keys; missing any key SHALL fail the audit assertion. Audit emission is best-effort relative to the primary write — a failed insert MUST NOT roll back the PDF response.

#### Scenario: SOCIO_FORM_EMITTED row contains the four required metadata keys

- **WHEN** a successful PDF emission completes for `socioId = "uuid-abc-123"`, `form_id = "solicitud-inscripcion"`, `sha256 = "<64-char hex>"`, `byte_size = 47210`
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_FORM_EMITTED"`
- **AND** `entity_type` SHALL equal `"socio"`
- **AND** `entity_id` SHALL equal `"uuid-abc-123"`
- **AND** `operator_id` SHALL equal the caller's operator id
- **AND** `metadata` SHALL be a JSON object containing exactly the keys `socio_id`, `form_id`, `sha256`, `byte_size` (no more, no less)
- **AND** `metadata.socio_id` SHALL equal `"uuid-abc-123"`
- **AND** `metadata.form_id` SHALL equal `"solicitud-inscripcion"`
- **AND** `metadata.sha256` SHALL equal `<64-char hex>` and match the regex `^[0-9a-f]{64}$`
- **AND** `metadata.byte_size` SHALL equal the integer `47210`

#### Scenario: SOCIO_FORM_EMITTED passes TypeScript narrowing

- **WHEN** TypeScript code narrows `action: AuditAction` against the union
- **THEN** `'SOCIO_FORM_EMITTED'` SHALL match a member of the union
- **AND** narrowing SHALL discriminate correctly against other actions (e.g., `'CREATE'`)

#### Scenario: Zod schema accepts SOCIO_FORM_EMITTED

- **WHEN** a new audit row is inserted with `action = "SOCIO_FORM_EMITTED"`
- **THEN** the Zod validator SHALL accept it
- **AND** a row with `action = "NOT_A_REAL_ACTION"` SHALL be rejected by the validator

#### Scenario: Failed audit emission does not roll back the PDF response

- **WHEN** the PDF is generated and the response is sent successfully, but the subsequent `emitAudit()` call throws
- **THEN** the API response SHALL still be `200 OK` with the PDF bytes
- **AND** a single warning log line SHALL mention the failed audit emission
- **AND** the operator SHALL still have a valid PDF to print
