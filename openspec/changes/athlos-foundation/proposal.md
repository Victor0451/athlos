# Proposal: Athlos Foundation — Phase 1

## Intent

Build the foundation of Athlos, a greenfield replacement for the legacy Visual FoxPro system of Club Atlético Gorriti. During development, Athlos operates as a **reader and projector** — importing facts from legacy without writing them. The goal is a working coexistence system ready for phased cutover.

**Why**: The legacy system (334K CTACTE records, 847K CONTABL1 lines, 39K socios) is the sole writer. Any disruption risks club operations. Athlos must prove itself as a reliable reader before it earns write authority.

---

## Scope

### In Scope (Phase 1)
- **Import pipeline**: append-only raw imports from 14 legacy tables (no GX0\* staging tables)
- **Lineage system**: every imported record tracks source table, legacy key, hash, and timestamp
- **Projection layer**: normalized views rebuilt from raw imports on demand
- **Reconciliation jobs**: detect drift between legacy and Athlos projections
- **Freshness indicators**: UI shows sync status per domain
- **Cutover-ready architecture**: domain-by-domain switch from reader to writer

### Out of Scope (Phase 1)
- Writing any business facts (all writes remain in legacy until cutover)
- Genexus staging tables (543 GX0\* tables — do not import)
- Cutover of any domain (planned after Phase 1)

---

## Capabilities

### New Capabilities
- `legacy-import`: Append-only import pipeline with hash-based change detection
- `lineage-tracker`: Full traceability from Athlos projection to legacy source record
- `projection-engine`: Rebuildable normalized projections from raw imports
- `drift-detector`: Reconciliation jobs comparing Athlos state vs legacy facts
- `freshness-monitor`: Real-time sync status indicators per domain

### Modified Capabilities
- None yet — this is the foundation phase

---

## Approach

### Architecture: Two-Layer Import Model

```
Legacy (writer) → Raw Import (append-only) → Projection (rebuildable)
```

1. **Raw import**: bit-perfect copy of legacy records with lineage metadata. Never mutated after insert.
2. **Projection**: normalized structures optimized for queries. Rebuildable from raw at any time.

### Import Order (mandatory)
```
paramet → tipocomp → SECUENCI → catálogos → socios → escuela → deportes → locacion →
CTACTE → CTACTE1 → CONTABLE → CONTABL1 → CAJA → GASTOS
```

CTACTE must import before CTACTE1. CONTABLE before CONTABL1. Violating this breaks projections.

### Coexistence Boundaries
- **Athlos writes**: nothing during Phase 1
- **Athlos reads**: everything, computes projections from raw
- **Legacy**: sole writer of all business facts
- **Drift handling**: detect and alert, never auto-correct

### Critical Risk Mitigation

| Risk | Mitigation |
|------|------------|
| CONNROASIE bridge corruption | Validate 325K+ links on every import; alert on orphan detection |
| Parameter drift | Hash parameter.dbf on each import; alert on mismatch |
| Cached saldo inconsistency | Never trust SOCSALDO/CCTSALDO; recalculate from CTACTE |
| Import order violations | Enforce dependency graph in pipeline; fail fast on violation |

---

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `imports/raw_events` | New | Universal import table with lineage |
| `projections/` | New | Domain-specific projections rebuilt from raw |
| `jobs/reconciliation` | New | Drift detection jobs per domain |
| `ui/freshness` | New | Sync status indicators |

---

## Rollback Plan

If import pipeline corrupts data:
1. Halt import job
2. Raw import is append-only — no corruption of existing records
3. Delete bad batch by `import_batch` filter
4. Recompute projections from remaining raw data
5. Resume with fix applied

---

## Dependencies

- Legacy DBF access (read-only) on Windows share `\\ServidorGorriti\AplicacionGorriti`
- .NET runtime for DBF reading (VFP ODBC driver or equivalent)

---

## Success Criteria

- [ ] All 14 business tables import without data loss
- [ ] Lineage query returns source table + key + timestamp for any displayed fact
- [ ] Projections rebuild correctly after raw import re-run
- [ ] Reconciliation job detects simulated drift and alerts
- [ ] Freshness indicator shows import age per domain
- [ ] CONNROASIE bridge validation passes with 0 orphans
- [ ] Parameter hash change triggers alert