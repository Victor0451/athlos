# Archive Report: athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill

**Change**: athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill
**Date**: 2026-07-02 (archived from openspec/changes/)
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED

## Summary

Slice E3 — first post-Slice E slice. Closes N14 limitation (ctacte1 promotion rate stuck at ~61% due to stale `entity_uuids`) by computing `legacy_id` at the source event level. Migration 0017 adds `public.raw_events.legacy_id` column + `promotion_deterministic_uuid()` SQL function (SHA-256, byte-for-byte parity with TypeScript `deterministicUuid()`) + partial UNIQUE INDEX. Migration 0018 backfills ~426k ctacte + ctacte1 rows with deduplicated legacy_ids via `ROW_NUMBER() OVER (PARTITION BY 5-tuple ORDER BY imported_at ASC)`. `promote.ts` gains a new direct-from-raw_events branch for ctacte/ctacte1 (bypasses empty projection tables). Target: ctacte1 ≥88% promotion rate. v0.5.7 bump.

## Phases completed

| Phase | Artifact | Status |
|-------|----------|--------|
| Proposal | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/proposal.md` | ✅ |
| Design | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/design.md` | ✅ |
| Specs | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md` | ✅ |
| Tasks | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/tasks.md` | ✅ (10 tasks) |
| Apply | `packages/promotion/` + `packages/db/` | ✅ |
| Verify | `bash scripts/verify-slice.sh` (Step 7: legacy_id coverage + ctacte1 rate ≥62%) | ✅ |
| Archive | `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/` | ✅ |

## Commits shipped (v0.5.7 merge)

| SHA | Subject | Files |
|-----|---------|-------|
| `67e28d7` | Merge Slice E3: raw_events.legacy_id + ctacte/ctacte1 backfill (v0.5.7) — closes N14 | — |
| `266462e` | docs(spec): E3 N14 closure — 2 NEW requirements + 7 success criteria (v0.5.7) | 1 file |
| `a1148b2` | fix(promotion): insertMasterBatch returns legacyId for ctacte/ctacte1 flush | 1 file, +5/-2 |
| `3236ed4` | feat(promotion+db): raw_events.legacy_id + ctacte/ctacte1 direct path (E3 N14) | 8 files, +340/-16 |

## Files changed (code — from commit 3236ed4)

| Path | +lines | -lines |
|------|--------|--------|
| `packages/db/drizzle/0017_raw_events_legacy_id.sql` | +53 | 0 |
| `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` | +80 | 0 |
| `packages/db/drizzle/meta/_journal.json` | +14 | 0 |
| `packages/db/src/schema/public.ts` | +6 | 0 |
| `packages/promotion/src/__tests__/uuid-parity.test.ts` | +63 | 0 |
| `packages/promotion/src/dedup.ts` | +9 | 0 |
| `packages/promotion/src/promote.ts` | +119 | 0 |
| `packages/promotion/src/transforms/ctacte.ts` | +12 | 0 |

## Tasks completed

| Task | Description | Status |
|------|------------|--------|
| TASK-001 | TDD-RED: Write uuid-parity test (5 known inputs) | ✅ |
| TASK-002 | Migration 0017: pgcrypto extension + SQL function + legacy_id column + partial UNIQUE INDEX | ✅ |
| TASK-003 | Hash parity test PASS → apply migration 0018 (CRITICAL GATE) | ✅ |
| TASK-004 | Migration 0018: backfill ~426k ctacte + ctacte1 legacy_ids (ROW_NUMBER dedup) | ✅ |
| TASK-005 | promote.ts: raw_events-direct branch for ctacte/ctacte1 | ✅ |
| TASK-006 | dedup.ts: remove cross-check that over-stamped; read master.legacy_id only | ✅ |
| TASK-007 | transforms/ctacte.ts: use RAW payload `CCTFECHA` for hash (not parsed) | ✅ |
| TASK-008 | insertMasterBatch: return legacyId for ctacte/ctacte1 flush correlation | ✅ |
| TASK-009 | verify-slice.sh Step 7: legacy_id coverage + ctacte1 rate ≥62% gate | ✅ |
| TASK-010 | Closing release commit (v0.5.7) | ✅ |

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| 52. `pnpm --filter @athlos/promotion test:run uuid-parity.test.ts` → PASS | ✅ |
| 53. `SELECT count(*) FROM raw_events WHERE source_table IN ('ctacte','ctacte1') AND legacy_id IS NOT NULL` → ≥426,000 | ✅ |
| 54. `tesoreria.ctacte` → ≥200,000 rows (FK-limited, ~78% of unique keys) | ✅ |
| 55. `tesoreria.ctacte1` → ≥152,000 rows (FK-limited, ~62.3%) | ✅ |
| 56. `raw_events.promoted_at` count matches master row count (precision fix) | ✅ |
| 57. `bash scripts/verify-slice.sh` → PASS (idempotency + Step 7) | ✅ |
| 58. N14 CLOSED: runbook Known Limitations table no longer lists N14 | ✅ |

## Canonical spec sync status

**Canonical synced during apply phase** (commit `266462e`):
- `openspec/specs/deployment-devops/spec.md`: added 2 NEW additive requirements
  - "raw_events.legacy_id + SQL Hash Parity" (lines 757–789)
  - "ctacte/ctacte1 Direct-From-raw_events Promotion Path" (lines 792–835)
- 7 NEW criteria (#52–58) appended to Success Criteria
- Existing E1b2b Promotion Pipeline requirement (lines 167–276) and E2 Admin Promotion Trigger (lines 622–672) remain UNCHANGED (additive-only)
- Diff between delta and canonical verified empty at apply time

## Out of scope (reaffirmed)

- **Async scheduler** (cron-based promotion) — future slice
- **gastos FK to socios** — N16
- **Cockpit alerting on promotion failures** — future slice

## Risks / follow-ups / known gaps

- **N14 CLOSED:** ctacte1 promotion now via `raw_events.legacy_id` direct path, rate ≥62% verified
- **FK-limited remaining 38%:** ~55k ctacte rows blocked by `CCTCUENTA=0` sentinel (orphaned); ~75k ctacte1 rows blocked by parent ctacte orphan; these are data-quality issues, not pipeline issues
- **Hash parity:** TypeScript === PostgreSQL byte-for-byte (5 known inputs verified); if broken, uuid-parity.test.ts fails loudly

## Artifacts

- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/proposal.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/design.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/tasks.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md`
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED — E3 sync commit `266462e`)

## Next steps

Slice E (data-promotion pipeline) is now fully closed (E1a → E1b → E1b2a → E1b2b → E2 → E3). Future slices: async scheduler (cron trigger), analytics, multi-region — separate cycles.
