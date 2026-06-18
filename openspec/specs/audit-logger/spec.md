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
