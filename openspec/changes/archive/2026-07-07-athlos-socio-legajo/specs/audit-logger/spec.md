# Delta for `audit-logger`

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
