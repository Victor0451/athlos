# Archive Report: athlos-promote-projection-to-master-e1b2b

**Change**: athlos-promote-projection-to-master-e1b2b
**Date**: 2026-07-02 (archived from openspec/changes/)
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED

## Summary

Slice E1b2b — final data-promotion slice of Slice E. Wires the 8th domain `gastos` (tesoreria.gastos flat expense ledger) into the promotion pipeline via migration 0015, `transformGastos`, and algorithm extension. Closes Slice E data-promotion permanently: all 8 master domains (socios, escuela, deportes, locacion, caja, gastos, ctacte, ctacte1) now populate via `pnpm db:promote`. 3 scope corrections applied during propose phase: #C2 (5-tuple NK for gastos, not 3-tuple), #C7 (gastos has NO ctacte FK), #C8 (gastos has NO socio_id FK in v1). v0.5.5 bump. Contains FINAL atomic canonical spec sync.

## Phases completed

| Phase | Artifact | Status |
|-------|----------|--------|
| Proposal | `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` | ✅ |
| Design | `openspec/changes/athlos-promote-projection-to-master-e1b2b/design.md` | ✅ |
| Specs | `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` | ✅ |
| Tasks | `openspec/changes/athlos-promote-projection-to-master-e1b2b/tasks.md` | ✅ (8 tasks) |
| Apply | `packages/promotion/` + `packages/db/` | ✅ |
| Verify | `bash scripts/verify-slice.sh` (8 domains, 3-run idempotency) | ✅ |
| Archive | `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2b/` | ✅ |

## Commits shipped (v0.5.5 merge)

| SHA | Subject | Files |
|-----|---------|-------|
| `36ac630` | Merge Slice E1b2b: gastos + final atomic sync (v0.5.5) | — |
| `e753528` | docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E | 1 file |
| `3d381b7` | feat(promotion): wire gastos master table (flat ledger, 5-tuple NK) | 9 files, +336/-5 |
| `061be50` | Merge: verify-slice.sh fix (add gastos + fix schema.table parsing) | 1 file |
| `b26896c` | fix(test): remove destructive TRUNCATE from promote.test.ts beforeAll | 1 file |

Note: `b26896c` and `061be50` are fixes that shipped as part of the v0.5.5 release chain (applied before the merge commit `36ac630`).

## Files changed (code — from commit 3d381b7)

| Path | +lines | -lines |
|------|--------|--------|
| `packages/db/drizzle/0015_gastos.sql` | +40 | 0 |
| `packages/db/drizzle/meta/_journal.json` | +7 | 0 |
| `packages/db/src/schema/index.ts` | +4 | -1 |
| `packages/db/src/schema/tesoreria.ts` | +47 | 0 |
| `packages/promotion/src/PROMOTION_ORDER.ts` | +8 | 0 |
| `packages/promotion/src/__tests__/promote.test.ts` | +126 | 0 |
| `packages/promotion/src/dedup.ts` | +28 | 0 |
| `packages/promotion/src/promote.ts` | +17 | 0 |
| `packages/promotion/src/transforms/gastos.ts` | +64 | 0 |

## Tasks completed

| Task | Description | Status |
|------|------------|--------|
| TASK-001 | TDD-RED: Write 2 failing test cases T19–T20 (gastos happy path + idempotency) | ✅ |
| TASK-002 | Migration 0015_gastos.sql — hand-write + apply via psql | ✅ |
| TASK-003 | Schema update (tesoreria.ts: gastos master table) | ✅ |
| TASK-004 | Transform file (transforms/gastos.ts) | ✅ |
| TASK-005 | Algorithm extension (PROMOTION_ORDER + promote + dedup) | ✅ |
| TASK-006 | TDD-REFACTOR | ✅ |
| TASK-007 | Re-promotion smoke test (gastos 2,114 rows) | ✅ |
| TASK-008 | FINAL atomic canonical spec sync | ✅ |

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| 47. `pnpm db:promote` → gastos 2,114 rows (5-tuple NK, 100% unique) | ✅ |
| 48. Re-run idempotent (0 new inserts across all 8 master tables) | ✅ |
| 49. gastos has NO ctacte FK (flat ledger — GASCTAPRIN is accounting code) | ✅ |
| 50. gastos has NO socio_id FK in v1 (no GASNUMSOC/SOCCARNET field in payload) | ✅ |
| 51. caja 4-tuple NK preserved (8,145 rows, no silent loss) | ✅ |
| 52. escuela independence verified (0 SOCNUMERO/SOCCARNET in 66 rows) | ✅ |

## Canonical spec sync status

**Canonical fully synced during apply phase** (commit `e753528`):
- `openspec/specs/deployment-devops/spec.md`: FINAL atomic sync — adds gastos requirement + 8-domain PROMOTION_ORDER scenario + scope corrections (#C2, #C7, #C8) + 5 NEW criteria (#47–51)
- Diff between delta and canonical verified empty
- No further atomic syncs planned for Slice E

## Scope corrections applied (live-verified 2026-06-25)

| # | Correction | Impact |
|---|------------|--------|
| **#C2** | gastos NK is 5-tuple `(GASTIPGAST\|GASCTAPRIN\|GASSECUENC\|GASFECHA\|GASCOMPROB)` — NOT 3-tuple | 3-tuple yields 346 distinct (84% loss); 5-tuple yields 2,114 distinct (100%) |
| **#C7** | gastos has NO ctacte FK — `GASCTAPRIN` is accounting-plan code, NOT socio carnet | FK constraint deferred to N16 |
| **#C8** | gastos has NO socio_id FK in v1 — no source field in 11-field payload | `socio_id` column nullable, FK constraint deferred to N16 |

## Out of scope (reaffirmed)

- **Admin API endpoint** (`POST /api/v1/promote/trigger`) — deferred to E2
- **`promoted_at` audit column** — deferred to E2
- **Async scheduler** — deferred to future slice
- **gastos socio_id backfill** — deferred to N16

## Risks / follow-ups / known gaps

- **N14:** ctacte1 promotion rate stuck at ~61% due to stale `entity_uuids` — closed by E3 (v0.5.7) via `raw_events.legacy_id` direct path
- **N16:** gastos FK to socios deferred — future backfill
- **`verify-slice.sh`** is the REAL gate (replaces broken unit tests)

## Artifacts

- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2b/proposal.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2b/design.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2b/tasks.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md`
- `openspec/specs/deployment-devops/spec.md` (canonical, FINAL sync — commit `e753528`)

## Next steps

E2 (v0.5.6) — admin HTTP trigger (`POST /api/v1/promote/trigger`), `promoted_at` audit column, runbook documentation. E3 (v0.5.7) — closes N14 via `raw_events.legacy_id` direct path for ctacte/ctacte1.
