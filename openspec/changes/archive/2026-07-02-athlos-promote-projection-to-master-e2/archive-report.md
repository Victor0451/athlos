# Archive Report: athlos-promote-projection-to-master-e2

**Change**: athlos-promote-projection-to-master-e2
**Date**: 2026-07-02 (archived from openspec/changes/)
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ARCHIVED

## Summary

Slice E2 — admin API + `promoted_at` audit + runbook. CLOSES Slice E permanently. Adds `POST /api/v1/promote/trigger` (ADMIN-only, 1/min rate-limit, 120s timeout) + `GET /api/v1/promote/status` (last 20 runs), migration 0016 (`raw_events.promoted_at` column + index + socios backfill), `promote.ts` JOIN filter for already-promoted rows, per-domain audit via `audit_events`, and operator runbook section. 3 NEW additive canonical spec requirements appended. v0.5.6 bump. No breaking changes.

## Phases completed

| Phase | Artifact | Status |
|-------|----------|--------|
| Proposal | `openspec/changes/athlos-promote-projection-to-master-e2/proposal.md` | ✅ |
| Design | `openspec/changes/athlos-promote-projection-to-master-e2/design.md` | ✅ |
| Specs | `openspec/changes/athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md` | ✅ |
| Tasks | `openspec/changes/athlos-promote-projection-to-master-e2/tasks.md` | ✅ (12 tasks) |
| Apply | `apps/api/` + `packages/promotion/` + `packages/db/` | ✅ |
| Verify | `bash scripts/verify-slice.sh` (idempotency) + admin endpoint tests | ✅ |
| Archive | `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e2/` | ✅ |

## Commits shipped (v0.5.6 merge)

| SHA | Subject | Files |
|-----|---------|-------|
| `6f98b5c` | Merge Slice E2: admin API + promoted_at + runbook (v0.5.6) — closes Slice E | — |
| `0f3e8a6` | docs(spec): atomic sync — 3 NEW Slice E2 requirements | 1 file |
| `6f11df8` | feat(api+promotion): admin promote trigger endpoint + promoted_at audit (v0.5.6) | 9 files, +455/-7 |

## Files changed (code — from commit 6f11df8)

| Path | +lines | -lines |
|------|--------|--------|
| `apps/api/package.json` | +1 | 0 |
| `apps/api/src/container.ts` | +4 | 0 |
| `apps/api/src/routes/promote.test.ts` | +198 | 0 |
| `apps/api/src/routes/promote.ts` | +151 | 0 |
| `packages/db/drizzle/0016_promoted_at.sql` | +22 | 0 |
| `packages/db/drizzle/meta/_journal.json` | +7 | 0 |
| `packages/db/src/schema/public.ts` | +4 | 0 |
| `packages/promotion/src/dedup.ts` | +39 | 0 |
| `packages/promotion/src/promote.ts` | +36 | 0 |

## Tasks completed

| Task | Description | Status |
|------|------------|--------|
| TASK-001 | TDD-RED: Write 6 admin endpoint test cases | ✅ |
| TASK-002 | Migration 0016: `raw_events.promoted_at` column + index + socios backfill | ✅ |
| TASK-003 | Schema update: public.ts promotedAt column | ✅ |
| TASK-004 | promote.ts: JOIN filter + bulk UPDATE `promoted_at` | ✅ |
| TASK-005 | dedup.ts: ctacte/ctacte1 cross-check | ✅ |
| TASK-006 | Admin trigger endpoint: `POST /api/v1/promote/trigger` | ✅ |
| TASK-007 | Admin status endpoint: `GET /api/v1/promote/status` | ✅ |
| TASK-008 | Rate-limit (1/min) + concurrent trigger guard | ✅ |
| TASK-009 | Audit events emission (1 row per trigger) | ✅ |
| TASK-010 | TDD-REFACTOR + test green | ✅ |
| TASK-011 | Canonical spec sync (3 NEW additive requirements) | ✅ |
| TASK-012 | Closing release commit (v0.5.6) | ✅ |

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| 49. `POST /api/v1/promote/trigger` → 200 with `{status, inserted, skipped, failed, durationMs}` | ✅ |
| 50. `SELECT count(*) FROM public.raw_events WHERE promoted_at IS NOT NULL` → ~16,383 (socios backfill) | ✅ |
| 51. `bash scripts/verify-slice.sh` → 0 new inserts on 2nd run (8 domains) | ✅ |
| 52. Rate-limit: 2nd trigger within 60s → 429 | ✅ |
| 53. Non-admin JWT → 403 Forbidden | ✅ |
| 54. Concurrent trigger → `{status: 'already_running'}` | ✅ |

## Canonical spec sync status

**Canonical synced during apply phase** (commit `0f3e8a6`):
- `openspec/specs/deployment-devops/spec.md`: added 3 NEW additive requirements
  - "Admin Promotion Trigger" requirement (lines 622–672)
  - "Per-row Promotion Audit" requirement (lines 675–714)
  - "Runbook Documentation" requirement (lines 717–740)
- 3 NEW criteria (#49–51) appended to Success Criteria
- Diff between delta and canonical verified empty at apply time

## Out of scope (reaffirmed)

- **Async scheduler** (cron-based promotion) — deferred to future slice
- **ctacte/ctacte1 promotion** (`raw_events.legacy_id` direct path) — deferred to E3 (N14)
- **gastos FK to socios** — deferred to N16

## Risks / follow-ups / known gaps

- **N14:** ctacte1 promotion rate ~61% — `raw_events.legacy_id` column missing prevents direct-from-raw_events promotion; E3 closes this
- **ctacte/ctacte1 `promoted_at` backfill** — requires `raw_events.legacy_id` (E3+)
- **`promoted_at` backfill scope:** migration 0016 only covers `socios`; ctacte/ctacte1 remain NULL (N14 closure needed first)

## Artifacts

- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e2/proposal.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e2/design.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e2/tasks.md`
- `openspec/changes/archive/2026-07-02-athlos-promote-projection-to-master-e2/specs/deployment-devops/spec.md`
- `openspec/specs/deployment-devops/spec.md` (canonical, MODIFIED — E2 sync commit `0f3e8a6`)

## Next steps

E3 (v0.5.7) — closes N14: `raw_events.legacy_id` column + `promotion_deterministic_uuid()` SQL function + ctacte/ctacte1 direct-from-raw_events path. Target: ≥88% ctacte1 promotion rate.
