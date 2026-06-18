# Legacy Import Specification

## Purpose

Append-only import pipeline that copies raw records from 14 legacy Visual FoxPro tables into Athlos storage, with hash-based change detection and dependency enforcement.

## Requirements

### Requirement: Import Order Enforcement

The pipeline SHALL import tables in the mandatory order: paramet → tipocomp → SECUENCI → catálogos → socios → escuela → deportes → locacion → CTACTE → CTACTE1 → CONTABLE → CONTABL1 → CAJA → GASTOS.

The system MUST fail fast if a table is imported before its dependencies are satisfied.

#### Scenario: CTACTE imported before CTACTE1

- GIVEN CTACTE table has been imported
- WHEN CTACTE1 import is attempted
- THEN import succeeds (CTACTE dependency already met)

#### Scenario: CTACTE1 imported before CTACTE

- GIVEN CTACTE has NOT been imported
- WHEN CTACTE1 import is attempted
- THEN import MUST abort with dependency error "CTACTE must import before CTACTE1"

#### Scenario: CONTABLE imported before CONTABL1

- GIVEN CONTABLE has been imported
- WHEN CONTABL1 import is attempted
- THEN import succeeds

### Requirement: Hash-Based Change Detection

For each record imported, the system MUST compute SHA-256 of the legacy record content and store it alongside the raw record.

The system MUST skip re-importing records where the hash matches the previously stored hash for the same `(source_table, source_key)` AND the entity UUID already exists in `raw_events`.

#### Scenario: Unchanged record

- GIVEN `(source_table: "ctacte", source_key: "CTA-001", content_hash: "abc123", entity_id: <uuid>)` already exists
- WHEN the same record is encountered on re-import with the same hash
- THEN the system MUST skip the insert and log "Record unchanged"

#### Scenario: Modified record

- GIVEN `(source_table: "ctacte", source_key: "CTA-001", content_hash: "abc123", entity_id: <uuid>)` already exists
- WHEN the same key is encountered with hash "xyz789"
- THEN the system MUST append a new `raw_events` row with `entity_id: <uuid>` (reused, not regenerated), `source_key: "CTA-001"`, `content_hash: "xyz789"` (append-only semantics preserve history)

### Requirement: Append-Only Semantics

Raw imported records MUST NOT be mutated after insertion. Updates to legacy data result in new rows, never overwrites.

The system MUST support deleting a batch by `import_batch` identifier for rollback purposes. The system MUST enforce a hard cap of **1 MB per `raw_events.payload` row** (JSONB); records whose serialized payload exceeds 1 MB MUST be rejected at write time with `BusinessError(IMPORT_PAYLOAD_TOO_LARGE)` and the batch MUST abort. Operators streaming a full re-import MUST use a paginated cursor (e.g., `?cursor=<source_key>`) rather than fetching the full table client-side.

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

### Requirement: CONNROASIE Bridge Validation

The system MUST validate all CONNROASIE links on every import, alerting on orphan detection.

A link is orphan when it references a socio_id or roasie_id that does not exist in the imported data.

#### Scenario: Valid bridge

- GIVEN CONNROASIE record links socio_id "SOC-001" to roasie_id "ROA-001"
- AND both SOC-001 and ROA-001 exist in imported data
- WHEN validation runs
- THEN the link passes with no alert

#### Scenario: Orphan detection

- GIVEN CONNROASIE record links to socio_id "SOC-999" which does not exist
- WHEN validation runs
- THEN the system MUST emit an alert with "Orphan CONNROASIE link: socio_id SOC-999 not found"

### Requirement: Parameter Hash Monitoring

The system MUST hash parameter.dbf on each import and alert if the hash differs from the previous import.

#### Scenario: Parameter drift detected

- GIVEN previous parameter hash was "hash-a"
- WHEN paramet table is re-imported with content hash "hash-b"
- THEN the system MUST emit alert "Parameter drift detected: hash mismatch"

### Requirement: UUID Generation at Import

At the moment a legacy record is first appended to `raw_events`, the import pipeline MUST generate a UUIDv4 and store it in the `entity_id` column. For subsequent re-imports of the same `(source_table, source_key)`, the SAME UUID MUST be reused (lookup by `entity_id`; never regenerate).

This requirement carries Decision 4A: the UUID is the system-wide stable identifier, independent of legacy keys. It is the contract that the lineage-tracker spec depends on.

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
- THEN the client MUST send `DELETE /api/v1/import/trigger/:batchId` and the server MUST mark the job as `cancelled` (it does not run)
- AND the operator sees a "Importación cancelada" toast
- (Note: the cancel window of 30s is enforced client-side via a countdown; the server accepts `DELETE` only while the job is in `queued` state.)

## Success Criteria

- All 14 tables import without data loss
- Import order violations cause immediate failure with clear error
- Hash changes are detected and logged
- CONNROASIE orphans are identified and alerted
- Parameter hash changes trigger alerts