# Projection Engine Specification

## Purpose

Normalized, rebuildable projections computed from raw import data. Projections are derived views optimized for query access, completely rebuildable from raw at any time.

## Requirements

### Requirement: Rebuildable Projections

Each projection MUST be fully rebuildable by replaying all relevant raw events in dependency order.

The system MUST support on-demand projection rebuild without data loss. The rebuild MUST be scoped to a single domain and MUST operate over the projection table listed in the ADDED `Projection Domain Table Map` below.

#### Scenario: Full projection rebuild

- GIVEN `raw_events` contains 390K CTACTE records imported across 5 batches
- WHEN `rebuildProjection("ctacte")` is called
- THEN all 390K records are processed in import order
- AND the `tesoreria.ctacte_projection` table is replaced with the computed result
- AND no raw data is modified

#### Scenario: Selective domain rebuild

- GIVEN `raw_events` contains data for all 14 tables
- WHEN `rebuildProjection("socios")` is called
- THEN only `socios` raw events are processed
- AND only the `socios.socios_projection` table is touched
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

The system MUST NOT trust cached saldo fields (`SOCSALDO`, `CCTSALDO`) from legacy. Saldo MUST be recomputed from `raw_events` CTACTE rows joined by `entity_id` (UUID, see lineage-tracker spec).

The system MUST expose `computeSaldo(socioEntityId: UUID): Promise<{ socioEntityId, debe: numeric, haber: numeric, saldo: numeric, as_of: ISO8601 }>`.

#### Scenario: Saldo computed from CTACTE

- GIVEN socio with `entity_id: <uuid>` has 3 CTACTE rows: +500, -200, +100
- WHEN `computeSaldo(<uuid>)` is called
- THEN result MUST equal `{ socioEntityId: "<uuid>", debe: 500, haber: 300, saldo: 200, as_of: "<iso>" }`

#### Scenario: Rebuild is idempotent on saldo

- GIVEN CTACTE projection has been built once
- WHEN `rebuildProjection("ctacte")` runs again with the same raw events
- THEN `computeSaldo` for every socio MUST return the same saldo as before

### Requirement: Projection Storage

Projections MUST be stored in normalized tables optimized for query performance.

The system SHOULD index projections by domain key for O(1) lookup.

#### Scenario: Indexed projection query

- GIVEN projection "socios_full" is indexed by socio_id
- WHEN query requests socio_id = "SOC-001"
- THEN response time MUST be under 50ms for up to 100K records

### Requirement: Projection Domain Table Map

The system MUST maintain a code-level mapping from `Domain` enum values to the target projection table that `rebuildProjection` truncates and repopulates. The mapping MUST be exported from `packages/projection/src/rebuild.ts` as `DOMAIN_PROJECTION_TABLE: Record<Domain, string>`.

The mapping MUST be:

| Domain       | Target projection table          |
|--------------|----------------------------------|
| `socios`     | `socios.socios_projection`       |
| `ctacte`     | `tesoreria.ctacte_projection`    |
| `ctacte1`    | `tesoreria.ctacte1_projection`   |
| `contable`   | `contabilidad.contable_projection` |
| `contabl1`   | `contabilidad.contabl1_projection` |
| `catastros`  | `socios.catastros_projection`    |
| `escuela`    | `socios.escuela_projection`      |
| `deportes`   | `deportes.deportes_projection`   |
| `locacion`   | `socios.locacion_projection`     |
| `caja`       | `tesoreria.caja_projection`      |
| `gastos`     | `tesoreria.gastos_projection`    |

Adding a new domain to this map MUST require a code change and a corresponding migration that creates the projection table.

#### Scenario: rebuildProjection routes to the correct table

- GIVEN `rebuildProjection("contable")` is called
- WHEN the rebuild runs
- THEN the target table is `contabilidad.contable_projection`
- AND no other table is truncated

#### Scenario: Unknown domain is rejected

- GIVEN `rebuildProjection("not_a_real_domain")` is called
- WHEN the handler runs
- THEN it MUST throw `BusinessError(VALIDATION)` with the offending domain name
- AND no table truncation MAY occur

## Success Criteria

- All projections rebuild correctly from raw events
- Saldo is always computed from raw CTACTE, never from cached fields
- Rebuild preserves data integrity with no loss
- Projection queries perform within acceptable latency