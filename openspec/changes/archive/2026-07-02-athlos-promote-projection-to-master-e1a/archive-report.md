# Archive Report: athlos-promote-projection-to-master-e1a

**Change**: athlos-promote-projection-to-master-e1a
**Date**: 2026-07-02 (archived from openspec/changes/)
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED

## Summary

Slice E1a — data layer foundation for the promotion pipeline. Ships `packages/promotion/` workspace package with `promoteDomain` + `promoteAll` algorithms, `pnpm db:promote` CLI runner, 3 priority domain transforms (socios 39,357 rows, ctacte 326,275 rows, ctacte1 245,370 rows), bulk FK-lookup pattern (1 SELECT → in-memory Map), batched INSERT with `ON CONFLICT DO NOTHING`, 7 vitest TDD cases. v0.5.1 bump. ctacte1 deferred to E1b (FK model gap — `cctcuenta` column missing from master table).

## Phases completed

| Phase | Artifact | Status |
|-------|----------|--------|
| Proposal | `openspec/changes/athlos-promote-projection-to-master-e1a/proposal.md` | ✅ |
| Design | `openspec/changes/athlos-promote-projection-to-master-e1a/design.md` | ✅ |
| Specs | `openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` | ✅ |
| Tasks | `openspec/changes/athlos-promote-projection-to-master-e1a/tasks.md` | ✅ (9 tasks) |
| Apply | `packages/promotion/` + `packages/db/` | ✅ |
| Verify | `pnpm db:promote` smoke test | ✅ |
| Archive | `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1a/` | ✅ |

## Commits shipped (v0.5.1 merge — 26 files)

| SHA | Subject | Files |
|-----|---------|-------|
| `bc6aa60` | Merge Slice E1a: promotion pipeline (v0.5.1) | — |
| `fdc96db` | feat(promotion): add projection-to-master promotion pipeline (E1a) | 18 files, +5239/-3 |
| `829cd10` | docs(spec): atomic sync — add Promotion Pipeline requirement | 1 file |
| `1c1f81d` | chore(release): v0.5.1 | 19 files (version bumps) |

Post-merge fix `c9ad524` applied post-v0.5.1: corrected migration field name, transform field names, dedup compound key, fk-lookup JOIN (NOT part of the release commit, applied separately).

## Files changed (code)

| Path | +lines | -lines |
|------|--------|--------|
| `packages/db/drizzle/0012_volatile_rocket_racer.sql` | +11 | 0 |
| `packages/db/drizzle/meta/_journal.json` | +7 | 0 |
| `packages/db/src/schema/index.ts` | +4 | -1 |
| `packages/db/src/schema/tesoreria.ts` | +25 | 0 |
| `packages/promotion/package.json` | +24 | 0 |
| `packages/promotion/src/PROMOTION_ORDER.ts` | +40 | 0 |
| `packages/promotion/src/__tests__/promote.test.ts` | +371 | 0 |
| `packages/promotion/src/dedup.ts` | +50 | 0 |
| `packages/promotion/src/fk-lookup.ts` | +42 | 0 |
| `packages/promotion/src/index.ts` | +24 | 0 |
| `packages/promotion/src/promote-cli.ts` | +44 | 0 |
| `packages/promotion/src/promote.ts` | +172 | 0 |
| `packages/promotion/src/transform-helpers.ts` | +75 | 0 |
| `packages/promotion/src/transforms/ctacte.ts` | +35 | 0 |
| `packages/promotion/src/transforms/ctacte1.ts` | +44 | 0 |
| `packages/promotion/src/transforms/socios.ts` | +65 | 0 |
| `packages/promotion/tsconfig.json` | +8 | 0 |
| `pnpm-lock.yaml` | +22 | 0 |

## Tasks completed

| Task | Description | Status |
|------|------------|--------|
| TASK-001 | TDD-RED: Write 7 vitest test cases (T1–T7) | ✅ |
| TASK-002a | TDD-GREEN: Schema + transforms + helpers | ✅ |
| TASK-002b | TDD-GREEN: Core algorithm + CLI | ✅ |
| TASK-003 | TDD-REFACTOR | ✅ |
| TASK-004 | Package skeleton (`@athlos/promotion`) | ✅ |
| TASK-005 | Root `db:promote` script | ✅ |
| TASK-006 | Pre-closing verification | ✅ |
| TASK-007 | Atomic canonical spec sync | ✅ |
| TASK-008 | Pre-merge fix slot | ✅ (no fix needed) |
| TASK-009 | Closing release commit (v0.5.1) | ✅ |

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| 31. `pnpm --filter @athlos/promotion test` → 7/7 PASS | ✅ |
| 32. `pnpm db:promote` → socios 39,357 rows | ✅ |
| 33. `pnpm db:promote` → ctacte 326,275 rows | ✅ |
| 34. `pnpm db:promote` → ctacte1 245,370 rows | ✅ (partial — E1b fixed) |
| 35. Re-run idempotent (0 new inserts) | ✅ |
| 36. FK cascade short-circuit (empty socios → ctacte/ctacte1 skipped) | ✅ |

## Canonical spec sync status

**Canonical synced during apply phase** (commit `829cd10`):
- `openspec/specs/deployment-devops/spec.md`: added "Promotion Pipeline" requirement (3 scenarios + 6 criteria)
- Delta-to-canonical diff verified empty at apply time

## Out of scope (reaffirmed)

- **ctacte1 promotion** — deferred to E1b (FK model gap: `cctcuenta` column missing from `tesoreria.ctacte` master)
- **5 remaining domains** (escuela, deportes, locacion, caja, gastos) — deferred to E1b/E1b2a/E1b2b
- **Admin API endpoint** — deferred to E2
- **`promoted_at` audit column** — deferred to E2
- **Async scheduler** — deferred to future slice

## Risks / follow-ups / known gaps

- **R1 (HIGH):** ctacte1 FK lookup requires `cctcuenta` column on `tesoreria.ctacte` master — E1b adds this via migration 0013 + backfill
- **R2 (HIGH):** ctacte1 promotion rate ~61% post-E1b (N14 stale `entity_uuids`) — E3 closes this via `raw_events.legacy_id` direct path
- **R3:** Re-runs may duplicate rows for ctacte/ctacte1 (E2's `promoted_at` column fixes this)

## Artifacts

- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1a/proposal.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1a/design.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1a/tasks.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md`
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED, synced — commit `829cd10`)

## Next steps

E1b (v0.5.2/v0.5.3) wires ctacte1 promotion via `cctcuenta` + `entity_uuids` backfill. E1b2a (v0.5.4) wires 4 NEW domains. E1b2b (v0.5.5) wires `gastos`. E2 (v0.5.6) adds admin API + `promoted_at` audit. E3 (v0.5.7) closes N14.
