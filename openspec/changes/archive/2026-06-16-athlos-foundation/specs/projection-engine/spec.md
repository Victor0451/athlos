# Projection Engine Specification

## Purpose

Normalized, rebuildable projections computed from raw import data. Projections are derived views optimized for query access, completely rebuildable from raw at any time.

## Requirements

### Requirement: Rebuildable Projections

Each projection MUST be fully rebuildable by replaying all relevant raw events in dependency order.

The system MUST support on-demand projection rebuild without data loss.

#### Scenario: Full projection rebuild

- GIVEN raw_events contains 390K CTACTE records imported across 5 batches
- WHEN rebuild command is issued for CTACTE projection
- THEN all 390K records are processed in import order
- AND projection table is replaced with computed result
- AND no raw data is modified

#### Scenario: Selective domain rebuild

- GIVEN raw_events contains data for all 14 tables
- WHEN rebuild command is issued for "socios" domain only
- THEN only socios-related raw events are processed
- AND other domain projections remain unchanged

### Requirement: Dependency-Aware Computation

CTACTE1 projections MUST derive from CTACTE records that were imported first. CONTABL1 MUST derive from CONTABLE.

The system SHALL compute projections respecting the same dependency order as raw import.

#### Scenario: CTACTE1 depends on CTACTE

- GIVEN CTACTE1 raw records reference CTACTE keys
- WHEN CTACTE1 projection is rebuilt
- THEN all referenced CTACTE records are available in the computation context

#### Scenario: CONTABL1 depends on CONTABLE

- GIVEN CONTABL1 raw records reference CONTABLE keys
- WHEN CONTABL1 projection is rebuilt
- THEN all referenced CONTABLE records are available

### Requirement: Saldo Recalculation

The system MUST NOT trust cached saldo fields (SOCSALDO, CCTSALDO) from legacy. Saldo MUST be recalculated from CTACTE records.

#### Scenario: Saldo computed from CTACTE

- GIVEN socio "SOC-001" has 3 CTACTE records: +500, -200, +100
- WHEN saldo projection is computed
- THEN resulting saldo = 400 (sum of all CTACTE movements)

### Requirement: Projection Storage

Projections MUST be stored in normalized tables optimized for query performance.

The system SHOULD index projections by domain key for O(1) lookup.

#### Scenario: Indexed projection query

- GIVEN projection "socios_full" is indexed by socio_id
- WHEN query requests socio_id = "SOC-001"
- THEN response time MUST be under 50ms for up to 100K records

## Success Criteria

- All projections rebuild correctly from raw events
- Saldo is always computed from raw CTACTE, never from cached fields
- Rebuild preserves data integrity with no loss
- Projection queries perform within acceptable latency