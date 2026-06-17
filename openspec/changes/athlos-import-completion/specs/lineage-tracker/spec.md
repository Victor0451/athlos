# Delta for lineage-tracker

> Source: TASK-055 (`packages/lineage/src/{query,verify}.ts`) + Decision 4A (UUID `entityId` generated at import).

## MODIFIED Requirements

### Requirement: Lineage Query API

The system MUST provide a query interface that, given a domain entity ID, returns the source lineage showing which legacy record it derives from.

The response MUST conform to the `LineageResponse` shape: `{ entity_id: UUID, source_table, source_key, content_hash, imported_at, import_batch: UUID, audit_event_id: UUID | null }`. The `audit_event_id` field is non-null only when an operator mutation touched the entity after import.

The query MUST be resolved against the UUID `entity_id` generated at import (see ADDED Requirements below). Resolving lineage by legacy key alone is forbidden.
(Previously: response was a free-form shape; `entity_id` could be a legacy key or domain-scoped string.)

#### Scenario: Query lineage for a displayed fact

- GIVEN user views a socio record "SOC-001" in the UI
- AND UUID `<uuid>` was generated for this entity at import
- WHEN lineage query is executed for `<uuid>`
- THEN response MUST equal: `{ entity_id: "<uuid>", source_table: "socios", source_key: "SOC-001", content_hash, imported_at, import_batch, audit_event_id: null }`

#### Scenario: Query lineage for a computed projection

- GIVEN user views a saldo calculated from CTACTE records
- WHEN lineage query is executed
- THEN response MUST list ALL source CTACTE records that contributed, each with its `entity_id` (UUID), `content_hash`, and `imported_at`

### Requirement: Hash Verification

The system MUST provide a verification endpoint that recomputes the hash of a source record and compares it to the stored lineage hash, detecting potential data corruption.

The endpoint MUST accept a UUID `entity_id` (NOT a legacy key) and return a `HashVerificationResult`: `{ entity_id: UUID, match: boolean, stored_hash, recomputed_hash, verified_at: ISO8601 }`.
(Previously: accepted a legacy key; result shape was a free-form "valid"/"invalid" string.)

#### Scenario: Hash matches

- GIVEN `<uuid>` (lineage hash "abc123") for legacy record "SOC-001"
- WHEN verification recomputes hash from source data
- THEN result MUST have `match: true`, `stored_hash: "abc123"`, `recomputed_hash: "abc123"`

#### Scenario: Hash mismatch (potential corruption)

- GIVEN `<uuid>` (lineage hash "abc123") for legacy record "SOC-001"
- WHEN source data has changed or corruption occurred
- THEN result MUST have `match: false`, `stored_hash: "abc123"`, `recomputed_hash: "<new>"`, `verified_at: "<iso>"`

## ADDED Requirements

### Requirement: UUID Entity Identifier

The system MUST generate a UUIDv4 for each imported entity at the moment a legacy record is first appended to `raw_events`. The UUID MUST be stored alongside the raw event as `entity_id` and MUST be the only stable identifier exposed to the rest of the system (lineage query, audit chain, drift detection, projection rebuild).

The UUID MUST be independent of any legacy key and MUST be reused for every subsequent re-import of the same `(source_table, source_key)` pair (idempotency anchor).
(Decision 4A: UUID generated at import — independent of legacy keys, robust to legacy schema renumbering.)

#### Scenario: First import generates a UUID

- GIVEN CTACTE record key "CTA-001" has never been imported
- WHEN the import processes this record
- THEN `raw_events` MUST contain a new row with `entity_id: <uuid>`, `source_key: "CTA-001"`, `content_hash: <sha256>`

#### Scenario: Re-import reuses the existing UUID

- GIVEN `entity_id: <uuid>` was generated for `source_key: "CTA-001"` on a prior import
- WHEN a re-import encounters "CTA-001" with a different `content_hash`
- THEN the new `raw_events` row MUST have the SAME `entity_id: <uuid>`, `source_key: "CTA-001"`, `content_hash: <new-hash>`

#### Scenario: UUIDs are distinct for distinct legacy keys

- GIVEN source_keys "CTA-001" and "CTA-002" are imported
- WHEN UUIDs are generated
- THEN the two `entity_id` values MUST be distinct UUIDs
