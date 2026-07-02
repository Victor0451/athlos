# Archive Report: athlos-promote-projection-to-master-e1b2a

**Change**: athlos-promote-projection-to-master-e1b2a
**Date**: 2026-07-02 (archived from openspec/changes/)
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED — PARTIAL (tasks-only, no proposal/design/spec artifacts)

## Summary

Sub-slice of E1b2b — wires 4 NEW master tables (escuela, deportes, locacion, caja) into the promotion pipeline. Adds migration 0014 (3 NEW tables + legacy_id columns + 7 UNIQUE INDEXes), 4 transform files, algorithm extension (PROMOTION_ORDER, dedup, insertMasterBatch), and 6 NEW vitest test cases (T13–T18). Ships 8,332 NEW rows: 66 escuela + 32 deportes + 89 locacion + 8,145 caja. v0.5.4 bump.

**Partial archive note:** This change shipped as a sub-slice of E1b2b. Material is tasks-only by design — proposal and design are covered by E1b2b's `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` and `design.md`. The spec delta for this scope is part of E1b2b's spec sync. No attempt was made to recreate missing artifacts.

## Phases completed

| Phase | Artifact | Status |
|-------|----------|--------|
| Proposal | None (covered by e1b2b proposal) | ⚠️ N/A |
| Design | None (covered by e1b2b design) | ⚠️ N/A |
| Specs | None (delta in e1b2b's specs/deployment-devops/spec.md) | ⚠️ N/A |
| Tasks | `openspec/changes/athlos-promote-projection-to-master-e1b2a/tasks.md` | ✅ (10 tasks) |
| Apply | `packages/promotion/` + `packages/db/` | ✅ |
| Verify | `bash scripts/verify-slice.sh` (3-run idempotency) | ✅ |
| Archive | `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2a/` | ✅ |

## Commits shipped (v0.5.4 merge)

| SHA | Subject | Files |
|-----|---------|-------|
| `b8d8e43` | Merge Slice E1b2a: Promotion Pipeline — 4 NEW master tables (v0.5.4) | — |
| `1a604dc` | feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja) | 15 files, +831/-35 |
| `cf0f8f8` | docs(spec): atomic sync — Promotion Pipeline with 4 NEW domains | 1 file |

Post-merge fix `304f37a` (verify-slice.sh fix) and `b26896c` (remove destructive TRUNCATE from tests) applied post-v0.5.4.

## Files changed (code — from commit 1a604dc)

| Path | +lines | -lines |
|------|--------|--------|
| `packages/db/drizzle/0014_new_masters.sql` | +96 | 0 |
| `packages/db/drizzle/meta/_journal.json` | +7 | 0 |
| `packages/db/src/schema/deportes.ts` | +2 | 0 |
| `packages/db/src/schema/index.ts` | +15 | -1 |
| `packages/db/src/schema/socios.ts` | +91 | 0 |
| `packages/db/src/schema/tesoreria.ts` | +30 | 0 |
| `packages/promotion/src/PROMOTION_ORDER.ts` | +26 | 0 |
| `packages/promotion/src/__tests__/promote.test.ts` | +302 | 0 |
| `packages/promotion/src/dedup.ts` | +78 | 0 |
| `packages/promotion/src/index.ts` | +4 | 0 |
| `packages/promotion/src/promote.ts` | +38 | 0 |
| `packages/promotion/src/transforms/caja.ts` | +42 | 0 |
| `packages/promotion/src/transforms/deportes.ts` | +34 | 0 |
| `packages/promotion/src/transforms/escuela.ts` | +48 | 0 |
| `packages/promotion/src/transforms/locacion.ts` | +53 | 0 |

## Tasks completed

| Task | Description | Status |
|------|------------|--------|
| TASK-001 | TDD-RED: Write 6 failing test cases T13–T18 | ✅ |
| TASK-002 | Migration 0014 — hand-write + apply via psql | ✅ |
| TASK-003 | Schema updates (socios + deportes + tesoreria + index) | ✅ |
| TASK-004 | 4 transform files (escuela + deportes + locacion + caja) | ✅ |
| TASK-005 | Algorithm extension (PROMOTION_ORDER + promote + dedup) | ✅ |
| TASK-006 | TDD-REFACTOR | ✅ |
| TASK-007 | Re-promotion smoke test (3-run idempotency) | ✅ |
| TASK-008 | Atomic canonical spec sync | ✅ |
| TASK-009 | Pre-closing verification | ✅ |
| TASK-010 | Closing release commit (v0.5.4) | ✅ |

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| 43. escuela promotion: 66 rows inserted | ✅ |
| 44. deportes promotion: 32 rows inserted | ✅ |
| 45. locacion promotion: 89 rows inserted | ✅ |
| 46. caja promotion: 8,145 rows inserted | ✅ |
| 47. caja 4-tuple NK: no silent row loss (verified 4-tuple vs 3-tuple) | ✅ |
| 48. Re-run idempotent (0 new inserts on 2nd + 3rd runs) | ✅ |
| 49. escuela has NO socio_id FK (per scope correction #C1) | ✅ |
| 50–54. Cross-domain independence: escuela failure does NOT block siblings | ✅ |

## Canonical spec sync status

**Delta synced via E1b2b's FINAL atomic sync** (commit `e753528`, v0.5.5):
- E1b2a's 4 NEW domain scenarios are part of the 7-domain PROMOTION_ORDER scenario
- 4 NEW domain scenarios (escuela, deportes, locacion, caja) added to "Promotion Pipeline" requirement
- Criteria #43–50 added

## Out of scope (reaffirmed)

- **gastos domain** — deferred to E1b2b (5-tuple NK, flat ledger)
- **Admin API endpoint** — deferred to E2
- **ctacte/ctacte1 raw_events direct path** — deferred to E3

## Risks / follow-ups / known gaps

- **Scope correction #C1:** escuela is per-school master with NO `socio_id` FK — verified 0 of 66 projection rows contain SOCNUMERO/SOCCARNET
- **Scope correction #C3:** caja 4-tuple NK is CRITICAL — 3-tuple yields 7,957 distinct (188 row losses), 4-tuple yields 8,145 distinct (100% unique)

## Artifacts

- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1b2a/tasks.md` (ONLY artifact — tasks-only by design)
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED — E1b2a scope synced via E1b2b FINAL sync `e753528`)

## Next steps

E1b2b (v0.5.5) wires `gastos` domain (8th and final master table). E2 (v0.5.6) adds admin API + `promoted_at` audit. E3 (v0.5.7) closes N14 via `raw_events.legacy_id`.
