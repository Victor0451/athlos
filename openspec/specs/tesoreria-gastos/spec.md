# Tesoreria Gastos CRUD Specification

## Purpose

ADMIN-only read + write endpoints for `tesoreria.gastos` rows. Closes the Slice 8 gap (`openspec/changes/archive/2026-06-29-athlos-ui/athlos-ui/exploration.md` line 311: "No `caja` or `gastos` specific read endpoints ... Full caja/gastos ledger UI is a Phase 2 slice"). The `socio_id` column remains nullable UUID with NO FK constraint (0 of 2,114 current rows have it); `cuenta_principal` is the club accounting-plan code, NOT a socio carnet.

---

## Requirements

### Requirement: Gastos List with Pagination and Filters

The system SHALL expose `GET /api/v1/gastos` returning paginated gastos filtered by `cuenta_principal`, `fecha_desde`, `fecha_hasta`, and `anulado`. ADMIN-only.

#### Scenario: ADMIN lists gastos with filters

- GIVEN an ADMIN
- WHEN they call `GET /api/v1/gastos?cuenta_principal=6003009&fecha_desde=2024-01-01&fecha_hasta=2024-12-31&page=1&limit=50`
- THEN the response SHALL return 200 with `{ data, total, page, limit, has_more }`
- AND each row SHALL include `id`, `cuenta_principal`, `fecha`, `concepto`, `importe`, `iva`, `anulado`, `link_count`

### Requirement: Gasto Detail

The system SHALL expose `GET /api/v1/gastos/:id` returning a single gasto by id with its `links[]` (joined `gastos_ctacte_mapping` rows).

#### Scenario: ADMIN fetches gasto detail

- GIVEN an ADMIN and a `gasto_id` that exists
- WHEN they call `GET /api/v1/gastos/:id`
- THEN the response SHALL return 200 with the gasto row
- AND the response SHALL include `links: [{ link_id, ctacte_id, monto_cubierto, motivo, anulado }]`

### Requirement: Create, Update, Anular, Hard-Delete a Gasto

The system SHALL support `POST /api/v1/gastos`, `PATCH /api/v1/gastos/:id`, `PATCH /api/v1/gastos/:id/anular`, and `DELETE /api/v1/gastos/:id` (with ON DELETE CASCADE on `gastos_ctacte_mapping`). ADMIN-only.

#### Scenario: ADMIN creates a gasto

- GIVEN an ADMIN and a valid payload `{ tipo, tipo_cuenta, cuenta_principal, secuencia, comprobante, fecha, concepto, importe, iva }`
- WHEN they call `POST /api/v1/gastos`
- THEN the system SHALL return 201 with the new gasto id
- AND the 5-tuple UNIQUE `(tipo, cuenta_principal, secuencia, fecha, comprobante)` SHALL hold
- AND an audit row SHALL be emitted

#### Scenario: ADMIN updates a gasto

- GIVEN an ADMIN and an existing `gasto_id`
- WHEN they call `PATCH /api/v1/gastos/:id` with changed fields
- THEN the system SHALL return 200 with the updated row
- AND the 5-tuple UNIQUE SHALL still hold after the update

#### Scenario: ADMIN annuls a gasto (soft delete)

- GIVEN an ADMIN and an ACTIVE gasto
- WHEN they call `PATCH /api/v1/gastos/:id/anular` with `{ motivo }`
- THEN the system SHALL return 200 AND SHALL set `gasto.anulado=true`, `gasto.anulado_at=now()`
- AND associated `gastos_ctacte_mapping` rows SHALL remain (no cascade on annulment)

#### Scenario: ADMIN hard-deletes a gasto

- GIVEN an ADMIN and an ACTIVE gasto
- WHEN they call `DELETE /api/v1/gastos/:id`
- THEN the system SHALL return 200 and remove the row
- AND associated `gastos_ctacte_mapping` rows SHALL be removed via ON DELETE CASCADE
- AND an audit row SHALL be emitted with `action="GASTO_DELETE"`

### Requirement: Role Enforcement on All Gastos Routes

The system SHALL require `requireRole('ADMIN')` for every gastos endpoint. Non-ADMIN tokens SHALL receive 403.

#### Scenario: Non-ADMIN rejected on any gastos route

- GIVEN an OPERADOR/TESORERO/CONSULTA token
- WHEN they call ANY `GET|POST|PATCH|DELETE /api/v1/gastos*` route
- THEN the system SHALL return 403 with `{"error":"FORBIDDEN"}`

---

## Success Criteria

2. **tesoreria-gastos NEW**: All 6 endpoints (`GET /gastos`, `GET /gastos/:id`, `POST /gastos`, `PATCH /gastos/:id`, `PATCH /gastos/:id/anular`, `DELETE /gastos/:id`) return 200/201 for ADMIN and 403 for non-ADMIN; `socio_id` stays nullable with NO FK constraint; `cuenta_principal` is NOT a socio carnet; hard-delete cascades to `gastos_ctacte_mapping`.
