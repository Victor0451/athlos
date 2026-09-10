# Delta for Tesoreria Gastos

## MODIFIED Requirements

### Requirement: Create, Update, Anular, Hard-Delete a Gasto

The system SHALL support `POST /api/v1/gastos`, `PATCH /api/v1/gastos/:id`, `PATCH /api/v1/gastos/:id/anular`, and `DELETE /api/v1/gastos/:id` (with ON DELETE CASCADE on `gastos_ctacte_mapping`). ADMIN-only. Every mutation MUST require an explicit `Idempotency-Key`; the database MUST persist and compare a request fingerprint. Mutation plus financial audit plus compensation writes MUST commit or roll back together. A gasto included in a closed cash period MUST NOT be updated, annulled, or hard-deleted; an authorized, reasoned compensating expense entry MUST be used instead. Same-key replay returns the original result and a payload mismatch conflicts. (Previously: active gastos could be updated, annulled, or hard-deleted regardless of cash-period closure.)

#### Scenario: ADMIN creates a gasto

- GIVEN an ADMIN and a valid payload `{ tipo, tipo_cuenta, cuenta_principal, secuencia, comprobante, fecha, concepto, importe, iva }`
- WHEN they call `POST /api/v1/gastos`
- THEN the system SHALL return 201 with the new gasto id
- AND the 5-tuple UNIQUE `(tipo, cuenta_principal, secuencia, fecha, comprobante)` SHALL hold
- AND an audit row SHALL be emitted

#### Scenario: ADMIN updates a gasto

- GIVEN an ADMIN and an existing gasto not included in a closed period
- WHEN they call `PATCH /api/v1/gastos/:id` with changed fields
- THEN the system SHALL return 200 with the updated row
- AND the 5-tuple UNIQUE SHALL still hold after the update

#### Scenario: ADMIN annuls a gasto (soft delete)

- GIVEN an ADMIN and an ACTIVE gasto not included in a closed period
- WHEN they call `PATCH /api/v1/gastos/:id/anular` with `{ motivo }`
- THEN the system SHALL return 200 AND SHALL set `gasto.anulado=true`, `gasto.anulado_at=now()`
- AND associated `gastos_ctacte_mapping` rows SHALL remain (no cascade on annulment)

#### Scenario: ADMIN hard-deletes a gasto

- GIVEN an ADMIN and an ACTIVE gasto not included in a closed period
- WHEN they call `DELETE /api/v1/gastos/:id`
- THEN the system SHALL return 200 and remove the row
- AND associated `gastos_ctacte_mapping` rows SHALL be removed via ON DELETE CASCADE
- AND an audit row SHALL be emitted with `action="GASTO_DELETE"`

#### Scenario: Closed-period expense requires compensation

- GIVEN an expense is included in an immutable closed cash period
- WHEN an ADMIN attempts to update, annul, or delete it
- THEN the operation SHALL be rejected
- AND an authorized compensating expense with a reason MAY be recorded
