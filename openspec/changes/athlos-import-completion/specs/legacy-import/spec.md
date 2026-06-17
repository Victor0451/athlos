# Delta for legacy-import

> Source: TASK-053/054 (already shipped in PR 7a) and TASK-060 (route surface) + Decisions 4A (UUID `entity_id` generated at import) and 5 (confirm-and-wait modal — referenced here, full UI spec lives in ui-design delta and is deferred to PR 8).

## MODIFIED Requirements

### Requirement: Append-Only Semantics

Raw imported records MUST NOT be mutated after insertion. Updates to legacy data result in new rows, never overwrites.

The system MUST support deleting a batch by `import_batch` identifier for rollback purposes. The system MUST enforce a hard cap of **1 MB per `raw_events.payload` row** (JSONB); records whose serialized payload exceeds 1 MB MUST be rejected at write time with `BusinessError(IMPORT_PAYLOAD_TOO_LARGE)` and the batch MUST abort. Operators streaming a full re-import MUST use a paginated cursor (e.g., `?cursor=<source_key>`) rather than fetching the full table client-side.
(Previously: append-only was defined, but no payload size cap or streaming guidance was specified. ctacte1 at production scale would push ~325MB into one row without the cap.)

#### Scenario: Rollback batch

- GIVEN import_batch "BATCH-2024-06-11-001" contains 1500 records
- WHEN a data quality issue is discovered
- THEN all records where `import_batch = "BATCH-2024-06-11-001"` MAY be deleted
- AND projections MAY be rebuilt from remaining raw data

#### Scenario: Oversized payload is rejected

- GIVEN a legacy record whose canonicalized JSON exceeds 1,048,576 bytes
- WHEN the import pipeline processes it
- THEN the insert MUST be rejected with `BusinessError(IMPORT_PAYLOAD_TOO_LARGE)` citing the offending `source_table` and `source_key`
- AND the batch MUST abort (no partial writes committed for that table)

#### Scenario: Large table uses paginated cursor

- GIVEN an operator triggers a re-import of `ctacte1` (390K rows)
- WHEN the client streams the import
- THEN each fetch MUST include a `cursor` query parameter
- AND no single client fetch MAY request more than the per-page row limit (10,000 rows)
- AND server-side the cursor MUST be opaque (base64 of last `source_key`), not a raw offset

### Requirement: Hash-Based Change Detection

For each record imported, the system MUST compute SHA-256 of the legacy record content and store it alongside the raw record.

The system MUST skip re-importing records where the hash matches the previously stored hash for the same `(source_table, source_key)` AND the entity UUID already exists in `raw_events` (per Decision 4A — see ADDED UUID requirement below).
(Previously: dedup key was implicitly `(source_table, source_key, content_hash)`; UUID layer was not part of the model.)

#### Scenario: Unchanged record

- GIVEN `(source_table: "ctacte", source_key: "CTA-001", content_hash: "abc123", entity_id: <uuid>)` already exists
- WHEN the same record is encountered on re-import with the same hash
- THEN the system MUST skip the insert and log "Record unchanged"

#### Scenario: Modified record

- GIVEN `(source_table: "ctacte", source_key: "CTA-001", content_hash: "abc123", entity_id: <uuid>)` already exists
- WHEN the same key is encountered with hash "xyz789"
- THEN the system MUST append a new `raw_events` row with `entity_id: <uuid>` (reused, not regenerated), `source_key: "CTA-001"`, `content_hash: "xyz789"` (append-only semantics preserve history)

## ADDED Requirements

### Requirement: UUID Generation at Import

At the moment a legacy record is first appended to `raw_events`, the import pipeline MUST generate a UUIDv4 and store it in the `entity_id` column. For subsequent re-imports of the same `(source_table, source_key)`, the SAME UUID MUST be reused (lookup by `entity_id`; never regenerate).

This requirement carries Decision 4A: the UUID is the system-wide stable identifier, independent of legacy keys. It is the contract that the lineage-tracker delta depends on.
(Decision 4A: UUID generated at import — robust to legacy schema renumbering, decoupled from domain naming.)

#### Scenario: First import for a legacy key generates a UUID

- GIVEN CTACTE row "CTA-001" is being imported for the first time
- WHEN the pipeline inserts into `raw_events`
- THEN the new row MUST have `entity_id: <uuid>` (a freshly generated UUIDv4)
- AND the same UUID MUST be the one returned by `lineage.queryLineage` for that entity

#### Scenario: Re-import reuses the existing UUID

- GIVEN `entity_id: <uuid>` already exists for `(source_table: "ctacte", source_key: "CTA-001")`
- WHEN the re-import encounters "CTA-001" with a different content_hash
- THEN the new `raw_events` row MUST have `entity_id: <uuid>` (reused)
- AND the lineage query for `<uuid>` MUST list BOTH raw events in the chain (append-only)

### Requirement: Manual Import Trigger Endpoint

The API MUST expose `POST /api/v1/import/trigger` gated to ADMIN role. On a valid request, the endpoint MUST enqueue an import job (via the scheduler) and return immediately with HTTP `202 Accepted` and a JSON body `{ batchId: UUID, status: "queued", estimatedTables: number }`.

The endpoint MUST be additive: it MUST NOT block, MUST NOT mutate any data synchronously, and MUST NOT replace the scheduled import crons. The `batchId` is returned to the client for polling via `GET /api/v1/import/status/:batchId`.
(From TASK-060. Decision 5 wires this endpoint to the confirm-and-wait modal — see ui-design delta.)

#### Scenario: Admin triggers an import

- GIVEN an admin token calls `POST /api/v1/import/trigger` with body `{ domain: "all" }`
- WHEN the handler runs
- THEN the response MUST be `202 Accepted` with body `{ batchId: "<uuid>", status: "queued", estimatedTables: 14 }`
- AND a job MUST be enqueued under that `batchId` (idempotent: re-triggering with the same body within 5s MUST return the same `batchId`)

#### Scenario: Non-admin cannot trigger

- GIVEN a CONSULTA token calls `POST /api/v1/import/trigger`
- WHEN the handler runs
- THEN it MUST return `403 Forbidden` with code `PERMISSION_DENIED`
- AND no job MUST be enqueued

#### Scenario: Confirm-and-wait modal cancel window

- GIVEN the admin clicks "Nueva importación" and the confirm modal shows
- WHEN the admin clicks "Cancelar" within 30 seconds of the trigger request
- THEN the client MUST send `DELETE /api/v1/import/trigger/:batchId` (TASK-060 follow-up) and the server MUST mark the job as `cancelled` (it does not run)
- AND the operator sees a "Importación cancelada" toast
- (Note: the cancel window of 30s is enforced client-side via a countdown; the server accepts `DELETE` only while the job is in `queued` state.)
