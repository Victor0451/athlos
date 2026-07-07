# Operator Lookup Specification

## Purpose

Read-only batch resolution of operator summaries (`id`, `username`, `role`) for any authenticated operator. The AuditTab and SocioNotesCard at `/socios/:id` swap UUID short-form actors for a `username · ROLE` chip; this capability backs that chip with one non-admin endpoint, one shared TanStack Query cache, and one render helper that collapses every "missing" case into one fallback string.

## Requirements

### Requirement: Batch lookup endpoint

The system SHALL expose `GET /api/v1/operators?ids=<uuid>,…` returning `{ operators: OperatorSummary[] }` where `OperatorSummary = { id: string; username: string; role: string }`.

#### Scenario: All ids active

- **WHEN** `GET /api/v1/operators?ids=a,b,c` with all rows `is_active = true`
- **THEN** response is 200 with `{ operators: [<a>, <b>, <c>] }`, each row containing only `id`, `username`, `role`

#### Scenario: Mixed valid + unknown

- **WHEN** ids `a,b,missing` are queried and only `a,b` exist
- **THEN** response is 200 with `{ operators: [<a>, <b>] }`, `missing` silently omitted

#### Scenario: All ids unknown

- **WHEN** no id matches any row
- **THEN** response is 200 with `{ operators: [] }` (NOT 404)

### Requirement: Authentication gate (any role)

The system SHALL require `requireAuth()` regardless of role. The endpoint SHALL NOT live under `/admin/`.

#### Scenario: No session

- **WHEN** request has no `Authorization: Bearer`
- **THEN** response is 401 with `{"error":"UNAUTHORIZED"}`

#### Scenario: CONSULTA allowed

- **WHEN** an authenticated operator with role=`CONSULTA` calls the endpoint
- **THEN** response is 200 (no 403)

### Requirement: Input validation

The system SHALL validate `ids` as a non-empty array of UUID strings, max 200 entries. Violations return HTTP 400 with the standard `VALIDATION_ERROR` shape.

#### Scenario: Empty ids

- **WHEN** `GET /api/v1/operators?ids=` is called
- **THEN** response is 400 with `{"error":"VALIDATION_ERROR","details":[{"field":"ids","message":"ids must contain at least one uuid"}]}`

#### Scenario: Non-UUID string

- **WHEN** `GET /api/v1/operators?ids=not-a-uuid` is called
- **THEN** response is 400 with `{"error":"VALIDATION_ERROR","details":[{"field":"ids","message":"…"}]}`

#### Scenario: 201 ids rejected

- **WHEN** 201 valid UUIDs are sent
- **THEN** response is 400 with `{"error":"VALIDATION_ERROR","details":[{"field":"ids","message":"ids cannot exceed 200 entries"}]}`

#### Scenario: 200 ids accepted (boundary)

- **WHEN** 200 valid UUIDs are sent
- **THEN** response is 200

### Requirement: Soft-deleted operators retained

The system SHALL include rows where `is_active = false` so historical audit actors keep their name.

#### Scenario: Mixed active + inactive

- **WHEN** ids `a` (active) and `y` (inactive) are queried
- **THEN** both rows appear in the response with no "deleted" indicator in the UI

### Requirement: Minimal response shape

The system SHALL expose only `{ id, username, role }` per row. No other `operators` column SHALL appear.

#### Scenario: No extra fields

- **WHEN** any operator row is returned
- **THEN** each object contains exactly `id`, `username`, `role`
- **AND** SHALL NOT contain `password_hash`, `is_active`, `can_reprint`, `can_anulate`, `last_login_at`, `failed_login_attempts`, `locked_until`, `created_at`, `updated_at`

### Requirement: Single batched query

The system SHALL resolve the batch with one Drizzle query (`inArray(operators.id, ids)`). The system SHALL NOT issue per-id roundtrips.

#### Scenario: One query for many ids

- **WHEN** the resolver handles 50 ids
- **THEN** it invokes `db.select().from(operators).where(inArray(operators.id, ids))` exactly once

## UI Rendering Semantics

### Requirement: OperatorChip helper

A single `<OperatorChip operatorId={…} />` SHALL centralise every render path. Username casing SHALL be preserved verbatim.

#### Scenario: Known operator

- **WHEN** the lookup map has `id → { username: "vlongo", role: "ADMIN" }`
- **THEN** the chip renders exactly `vlongo · ADMIN`

#### Scenario: Soft-deleted operator

- **WHEN** the lookup map has the same record for an inactive row
- **THEN** the chip renders exactly `vlongo · ADMIN` (no badge, no strikethrough)

#### Scenario: id missing from lookup

- **WHEN** the lookup response does NOT contain `operatorId`
- **THEN** the chip renders exactly `Operador desconocido`

#### Scenario: System event (`operator_id === null`)

- **WHEN** an audit row has `operator_id = null`
- **THEN** the chip renders exactly `Operador desconocido`

#### Scenario: Username casing preserved

- **WHEN** the lookup returns `username: "vlongo"`
- **THEN** the rendered username is exactly `vlongo` (no capitalisation)

### Requirement: Shared TanStack Query cache

`AuditTab` and `SocioNotesCard` SHALL hit one shared TanStack Query cache keyed on the sorted, comma-joined id list.

#### Scenario: Deterministic key

- **WHEN** two components query id sets `[c, a, b]` and `[a, b, c]`
- **THEN** both yield the same cache key `"a,b,c"`

#### Scenario: Second mount reuses first fetch

- **WHEN** `AuditTab` fetches `["a","b","c"]` then `SocioNotesCard` mounts with the same set
- **THEN** `SocioNotesCard` reuses the cached result (no second network request)

## Success Criteria

- [ ] Endpoint returns 200 with `{ id, username, role }` for any authenticated operator.
- [ ] Validation rejects empty, non-UUID, and >200 ids with 400 `VALIDATION_ERROR`.
- [ ] Soft-deleted operators appear; missing ids silently omitted.
- [ ] One Drizzle `inArray` query, never per-id roundtrips.
- [ ] `<OperatorChip>` renders `username · ROLE` for known operators and `Operador desconocido` for system events, missing lookups, and unknown ids.
- [ ] `AuditTab` and `SocioNotesCard` share one fetch per id-set mount.