# Lineage Tracker Specification

## Purpose

Provides full traceability from any Athlos displayed fact back to its legacy source record, recording source table, legacy key, content hash, and import timestamp.

## Requirements

### Requirement: Lineage Metadata Capture

Every imported raw record MUST store lineage metadata: source_table, source_key, content_hash, imported_at, and import_batch.

This metadata MUST be immutable after insertion.

#### Scenario: Lineage stored on import

- GIVEN legacy table CTACTE record with key "CTA-001" is imported
- WHEN the import completes
- THEN raw_events table MUST contain: source_table="CTACTE", source_key="CTA-001", content_hash="<sha256>", imported_at="<timestamp>", import_batch="<batch-id>"

### Requirement: Lineage Query API

The system MUST provide a query interface that, given a domain entity ID, returns the source lineage showing which legacy record it derives from.

#### Scenario: Query lineage for a displayed fact

- GIVEN user views a socio record "SOC-001" in the UI
- WHEN lineage query is executed for this entity
- THEN response MUST include: source_table="socios", source_key="SOC-001", content_hash, imported_at, import_batch

#### Scenario: Query lineage for a computed projection

- GIVEN user views a saldo calculated from CTACTE records
- WHEN lineage query is executed
- THEN response MUST list ALL source CTACTE records that contributed to this computation, with their hashes and import timestamps

### Requirement: Lineage Preservation on Rebuild

When projections are rebuilt from raw data, lineage metadata MUST remain intact and queryable.

#### Scenario: Post-rebuild lineage still valid

- GIVEN projection "socios_full" was rebuilt from raw import at 10:00
- WHEN lineage query is executed for any socio in that projection
- THEN the lineage MUST reflect the original import timestamp, not the rebuild time

### Requirement: Hash Verification

The system SHOULD provide a verification endpoint that recomputes the hash of a source record and compares it to the stored lineage hash, detecting potential data corruption.

#### Scenario: Hash matches

- GIVEN legacy record "SOC-001" has stored lineage hash "abc123"
- WHEN verification recomputes hash from source data
- THEN if recomputed hash equals "abc123", verification returns "valid"

#### Scenario: Hash mismatch (potential corruption)

- GIVEN legacy record "SOC-001" has stored lineage hash "abc123"
- WHEN source data has changed or corruption occurred
- THEN if recomputed hash differs, verification returns "invalid" with the new hash for audit

## Success Criteria

- Every raw record carries complete lineage metadata
- Lineage API returns source information for any displayed fact
- Rebuilt projections preserve original import timestamps in lineage
- Hash verification detects data drift or corruption