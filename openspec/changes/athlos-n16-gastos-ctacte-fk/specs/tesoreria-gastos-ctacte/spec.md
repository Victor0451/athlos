# Tesoreria Gastos-Ctacte Mapping Specification

## Purpose

Many-to-many bridge between `tesoreria.gastos` (accounting-plan `cuenta_principal`) and `tesoreria.ctacte` (socio carnet `cctcuenta`). Verified 2026-06-29: namespaces do not intersect (0 of 165 distinct `cuenta_principal` match any `cctcuenta`). The mapping is an explicit table (no FK); each link carries `motivo` and `created_by`. View `gastos_with_ctacte_candidates` surfaces heuristic candidates; the operator MUST confirm before persisting.

---

## Requirements

### Requirement: Manual Link Creation with Partial Unique Index

The system SHALL allow ADMIN to create a many-to-many link between `gasto_id` and `ctacte_id` with `monto_cubierto` and `motivo`. The pair SHALL have a PARTIAL UNIQUE INDEX `(gasto_id, ctacte_id) WHERE anulado = false` allowing re-link after annulment.

#### Scenario: ADMIN creates manual link

- GIVEN an ADMIN and active `gasto_id` + `ctacte_id` with no existing link
- WHEN `POST /api/v1/gastos/:gasto_id/ctacte-links` with `{ ctacte_id, monto_cubierto: "5000.00", motivo: "manual" }`
- THEN response SHALL be 201 with the link row AND an `audit_events` row with `action="GASTOS_CTACTE_LINK_CREATE"`

#### Scenario: Duplicate active link for same (gasto_id, ctacte_id)

- GIVEN an ACTIVE link exists for the same `(gasto_id, ctacte_id)` pair
- WHEN ADMIN creates another link for the same pair
- THEN response SHALL be 409 with `{"error":"LINK_ALREADY_EXISTS"}` AND no new row SHALL be inserted

#### Scenario: Re-link after previous link was anulado

- GIVEN a previous link for `(gasto_id, ctacte_id)` has `anulado=true`
- WHEN ADMIN creates a new link for the same pair
- THEN response SHALL be 201 (partial UNIQUE excludes `anulado=true` rows) AND the previous row remains as audit trail

### Requirement: Link Validation and Existence Checks

The system SHALL reject `monto_cubierto > gasto.importe` (400), return 404 for non-existent `gasto_id`, and return 404 for non-existent `ctacte_id`.

#### Scenario: monto_cubierto exceeds parent gasto.importe

- GIVEN a `gasto` with `importe="2000.00"` AND any valid `ctacte_id`
- WHEN ADMIN posts a link with `monto_cubierto: "3000.00"`
- THEN response SHALL be 400 with `{"error":"MONTO_EXCEEDS_GASTO"}`

#### Scenario: gasto_id or ctacte_id missing

- GIVEN a non-existent `gasto_id` or `ctacte_id`
- WHEN ADMIN creates a link referencing either
- THEN response SHALL be 404 with `{"error":"GASTO_NOT_FOUND"}` or `{"error":"CTACTE_NOT_FOUND"}`

### Requirement: Hard Delete, Soft Annulment, Role Gating

The system SHALL support `DELETE` (hard remove) and `PATCH .../anular` (soft `anulado=true` with motivo). Both ADMIN-only; each emits a `GASTOS_CTACTE_LINK_*` audit row.

#### Scenario: ADMIN hard-deletes a link

- GIVEN an ACTIVE link
- WHEN ADMIN calls `DELETE /api/v1/gastos-ctacte-links/:linkId`
- THEN response SHALL be 200, the row SHALL be removed, AND audit row `action="GASTOS_CTACTE_LINK_DELETE"` SHALL be emitted

#### Scenario: ADMIN soft-annuls a link

- GIVEN an ACTIVE link
- WHEN ADMIN calls `PATCH .../anular` with `{ motivo }`
- THEN response SHALL be 200 with `anulado=true`, `anulado_at=now()` AND audit row `action="GASTOS_CTACTE_LINK_ANULAR"`

#### Scenario: Non-ADMIN mutation attempt

- GIVEN an OPERADOR/TESORERO/CONSULTA token
- WHEN they call either link-mutation route
- THEN response SHALL be 403 with `{"error":"FORBIDDEN"}` AND no DB mutation occurs

### Requirement: List Links for a Gasto

The system SHALL expose `GET /api/v1/gastos/:id/ctacte-links` (with `?active=true`) and `GET /api/v1/ctacte/:cuenta/gastos-links`. ADMIN-only.

#### Scenario: List links for a gasto, with active filter

- GIVEN an ADMIN and a `gasto_id`
- WHEN `GET /api/v1/gastos/:id/ctacte-links?active=true`
- THEN response SHALL include `monto_cubierto`, `motivo`, `ctacte_id`, `anulado`, joined `socio_id` AND omitting filter SHALL return ALL rows

### Requirement: Heuristic Candidate Discovery (Never Auto-Persists)

The system SHALL expose `GET /api/v1/admin/gastos-ctacte-candidates?gasto_id=:id` returning up to 50 candidates. Candidates SHALL NEVER auto-persist and require explicit confirmation.

#### Scenario: Returns heuristic candidates and never persists them

- GIVEN an ADMIN and a `gasto_id` with ≥1 ctacte row matching `fecha ± 3 days` AND `debe::numeric = importe::numeric`
- WHEN the candidates endpoint is called
- THEN response SHALL return up to 50 candidates with `motivo="heuristic-pending"` AND no `gastos_ctacte_mapping` row SHALL be created until operator confirms

---

## Success Criteria

1. **tesoreria-gastos-ctacte NEW**: Migration 0019 creates `gastos_ctacte_mapping` with partial UNIQUE `(gasto_id, ctacte_id) WHERE anulado = false`; heuristic view returns up to 50 candidates; ADMIN routes enforce `requireRole('ADMIN')`; every mutation emits a `GASTOS_CTACTE_LINK_*` audit row; candidates are never auto-persisted.
