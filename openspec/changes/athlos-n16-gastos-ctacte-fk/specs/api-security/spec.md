# Delta for API Security

## ADDED Requirements

Additive-only per B1b LESSON #1. The existing api-security requirements (CORS, Rate Limiting, Helmet, Input Sanitization, API Keys, Audit Logging) are NOT modified; this delta ONLY adds role-gating and permission-denial-logging for the new ADMIN-only gastos and gastos-ctacte namespace routes.

### Requirement: ADMIN Role Gating for Gastos and Gastos-Ctacte Routes

The system SHALL enforce `requireRole('ADMIN')` on every new route under `/api/v1/gastos*` and `/api/v1/ctacte/:cuenta/gastos-links` and `/api/v1/admin/gastos-ctacte-candidates`. Non-ADMIN callers SHALL receive 403.

#### Scenario: Non-ADMIN request to any gastos or gastos-ctacte route

- GIVEN an OPERADOR/TESORERO/CONSULTA operator token
- WHEN they call any of the 6 gastos CRUD routes (`GET/POST/PATCH/DELETE /api/v1/gastos[/:id]`, `PATCH .../:id/anular`) OR any of the 6 gastos-ctacte routes (`GET/POST /api/v1/gastos/:id/ctacte-links`, `DELETE /api/v1/gastos-ctacte-links/:id`, `PATCH /api/v1/gastos-ctacte-links/:id/anular`, `GET /api/v1/ctacte/:cuenta/gastos-links`, `GET /api/v1/admin/gastos-ctacte-candidates`)
- THEN the system SHALL return 403 with `{"error":"FORBIDDEN"}`
- AND an audit row SHALL be emitted per existing api-security §F (Permission Denial Logging)

#### Scenario: ADMIN request proceeds past the auth gate

- GIVEN an ADMIN operator token
- WHEN they call any gastos or gastos-ctacte route
- THEN the auth middleware SHALL allow the request AND SHALL pass control to the handler

### Requirement: Permission Denial Logging for Gastos Routes

The system SHALL emit an `audit_events` row for any 403 returned by a gastos or gastos-ctacte route, capturing `operator_id`, `endpoint`, `required_role="ADMIN"`, and IP.

#### Scenario: 403 emits PERMISSION_DENIED audit row

- GIVEN a non-ADMIN request to any new gastos route
- WHEN the 403 response is returned
- THEN an `audit_events` row SHALL exist with `action="PERMISSION_DENIED"` AND `entity_type="gastos_route"`
- AND the row SHALL include the operator id, endpoint path, and IP address per existing §F schema

---

## Success Criteria (this change)

4. **api-security ADDED**: All 12 new gastos + gastos-ctacte routes enforce `requireRole('ADMIN')`; non-ADMIN → 403; every 403 emits a `PERMISSION_DENIED` `audit_events` row consistent with existing api-security §F schema (`operator_id`, `ip_address`, `endpoint`, `required_permission`).
