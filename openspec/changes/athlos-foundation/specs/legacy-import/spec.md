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

The system SHOULD skip re-importing records where the hash matches the previously stored hash for the same legacy key.

#### Scenario: Unchanged record

- GIVEN a legacy record with key "SOC-001" and hash "abc123" already exists in raw storage
- WHEN the same record is encountered on re-import with hash "abc123"
- THEN the system SHALL skip inserting and log "Record unchanged"

#### Scenario: Modified record

- GIVEN a legacy record with key "SOC-001" and hash "abc123" already exists
- WHEN the same key is encountered with hash "xyz789"
- THEN the system SHALL append the new record as a new raw event (append-only semantics preserve history)

### Requirement: Append-Only Semantics

Raw imported records MUST NOT be mutated after insertion. Updates to legacy data result in new rows, never overwrites.

The system MUST support deleting a batch by import_batch identifier for rollback purposes.

#### Scenario: Rollback batch

- GIVEN import_batch "BATCH-2024-06-11-001" contains 1500 records
- WHEN a data quality issue is discovered
- THEN all records where import_batch = "BATCH-2024-06-11-001" MAY be deleted
- AND projections MAY be rebuilt from remaining raw data

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

## Success Criteria

- All 14 tables import without data loss
- Import order violations cause immediate failure with clear error
- Hash changes are detected and logged
- CONNROASIE orphans are identified and alerted
- Parameter hash changes trigger alerts