# Delta for `audit-logger`

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
