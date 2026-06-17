# Delta for audit-logger

> Source: TASK-059 (`packages/audit/src/{middleware,emitter,query}.ts`) + Decision 3 (indefinite retention, no purge job). Critical: the Fastify middleware MUST be wrapped with `fastify-plugin` to avoid the PR 3a encapsulation bug class — see ADDED requirement.

## MODIFIED Requirements

### Requirement: Immutable Audit Trail

The system MUST record all auditable events in an append-only audit log. Audit records MUST NOT be updated or deleted after insertion.

Records MUST be retained indefinitely with NO purge job, NO TTL, and NO archival step in v1.
(Decision 3: indefinite retention, no purge. Aligns with current behavior — no change required to row lifecycle, only to the absence of a purge path.)

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
(Previously: contract was general — no explicit hook shape.)

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

### Requirement: Audit Query Interface

The system MUST provide a query interface for operators and admins to search and filter audit records by operator, entity, action type, and date range, with pagination.

The endpoint MUST live at `GET /api/v1/audit` and MUST be gated to ADMIN role. Filters and pagination match the `AuditQuery` / `AuditQueryResponse` types in the main spec; the response MUST order results by `timestamp DESC` and MUST honor `limit` (default 100, max 500) and `offset` for pagination.
(Previously: query interface was underspecified; route was not in the main spec.)

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

## ADDED Requirements

### Requirement: Idempotency Window

`emitAudit(record)` MUST compute an idempotency key as `sha256(operator_id || action || entity_id || canonical_json(payload) || bucket_now)`, where `bucket_now` is `floor(Date.now() / 10_000)` (a 10-second bucket, NOT the raw timestamp).

The emitter MUST look up the `idempotency_key` column in `audit_events` before inserting. If a row with the same key exists, the insert MUST be skipped (return `{ inserted: false, deduped: true }`). The window is exactly 10 seconds — actions more than 10s apart MUST produce distinct rows even if all other fields are identical.
(Decision: prevents double-emission from Fastify's `onResponse` hook firing twice on retries or from operator double-clicks. Carries the 10s window from the archived TASK-059 AC.)

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

Rationale: a plugin registered via `app.register(auditPlugin)` without `fp` wrapping is encapsulated. The `addHook('onRequest', ...)` and `decorateRequest(...)` calls inside the plugin then apply only to the plugin's own scope (which is empty), not to the routes registered elsewhere in the app. The result is silent: protected routes look authenticated but `request.operator` is never set, and mutations are either unaudited (worst case: data change with no audit row) or 401 (best case: visible failure). The PR 3a bugfix (Engram obs #1990) hit exactly this class of bug — the inline-in-test pattern hid it. Wrapping with `fp` exposes the hooks/decorators to the parent scope, which is what we want.
(Decision: fp-wrap is mandatory. The same lesson applies to any future plugin in this codebase.)

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
