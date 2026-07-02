# Archive Report — `athlos-async-scheduler`

**Archived**: 2026-06-26
**Status**: SHIPPED + VERIFIED + FIXED
**Final tag**: v0.5.10
**Final merge commit**: 62f542a on main

## Slice Summary

Slice `athlos-async-scheduler` added scheduled promotion (cron-driven `promoteAll` every 6 hours via `@athlos/scheduler` + node-cron) and 3 admin-gated REST endpoints (`POST /run-now`, `GET /`, `GET /:name`, `PATCH /:name`) to the API server. The `JobScheduler.setEnabled` interface method was added to support enable/disable of scheduled jobs with BullMQ swap-in compatibility deferred to E5+.

## Timeline

| Tag | Date | What |
|---|---|---|
| v0.5.8 | 2026-06-26 | Initial slice shipped (merge 2180a2b) |
| v0.5.9 | 2026-06-26 | Verify follow-up: C1 typecheck + S1/S2/S3 fixes (commit b2ab397) |
| v0.5.10 | 2026-06-26 | Verify audit follow-up: 5 pre-existing test failures fixed (commit 62f542a) |

## Spec Atomic Sync

- deployment-devops/spec.md: **PASS** (4 NEW scenarios in "E-Future Delta: Slice athlos-async-scheduler")
  - Scenario: scheduled promotion runs every 6 hours via PROMOTION_CRON
  - Scenario: PROMOTION_CRON env var defaults to `0 */6 * * *` if unset
  - Scenario: scheduler worker starts at API server startup
  - Scenario: SIGTERM mid-promotion aborts cleanly
- scheduler-jobs/spec.md: **PASS** (5 NEW scenarios in 2 "NEW in athlos-async-scheduler" requirements)
  - Admin Scheduler Endpoints requirement (4 scenarios: POST run-now, GET list, GET /:name, PATCH enable/disable)
  - JobScheduler.setEnabled Interface Method requirement (1 scenario: BullMQ swap-in compatibility)

## Final Test Suite

- 64 test files | 499 passed | 17 skipped | 0 failed
- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm format:check`: PASS
- `bash scripts/verify-slice.sh`: PASS (Steps 1-8 all green)

## Final Git State

- Branch `feat/athlos-async-scheduler`: deleted
- Tag v0.5.10: pushed to origin
- All commits on main: clean, no Co-Authored-By trailers

## LESSONs Consolidated

### Recurring (apply sub-agent gaps, 5th occurrence in a row)

The E-Future slice applied via sub-agent triggered the same gaps as E1b/E1b2a/E2/E3:
1. Apply sub-agent did NOT merge/tag/delete-branch (orchestrator did it per LESSON)
2. Apply sub-agent did NOT add CHANGELOG entry (orchestrator added + amended)
3. Apply sub-agent added `Co-Authored-By: gentle-ai[bot]` to all 3 commits (stripped via filter-branch)
4. Apply sub-agent had `git reset --hard main` incident mid-apply (recovered via reflog; Incident Rule audit confirmed recovery)

### NEW LESSON: sdd-verify must run FULL test suite

**Problem**: sdd-verify for E2/E3/E-Future ran `pnpm --filter @athlos/{api,promotion,db,scheduler} test:run` but NOT `pnpm test:run` (full monorepo). The 5 pre-existing test failures in `packages/import/src/pipeline.test.ts` (broken since PR 7a on 2026-06-16) went undetected for 10 days.

**Fix**: Update sdd-verify protocol — the orchestrator MUST run `pnpm test:run` (full monorepo) as part of the verification phase, in addition to per-package tests. Per-package tests alone are insufficient.

**Root cause of undetected failures**: The pipeline.test.ts file's tests were broken at the same commit they were written (`59153bf feat(import): PR 7a — raw_events schema + @athlos/import foundation`). The standin's `values(v: NewRawEvent)` only accepted single objects, but the pipeline's `insertRawEventBatch` path passes an array. The standin treated `v` as an array in `makeRawEvent(v)`, reading `v.sourceTable` etc. as undefined. Result: inserted rows were missing key fields, tests checking them failed.

### Orchestrator post-apply checklist (codified)

```bash
#!/bin/bash
# Run BEFORE merging any apply sub-agent's branch
set -e
BRANCH=$1
git checkout "$BRANCH"

# 1. Co-Authored-By check + strip
if git log main.."$BRANCH" --format=%B | grep -q Co-Authored; then
  echo "FIXING: Co-Authored-By detected"
  git branch backup/pre-fix
  git filter-branch -f --msg-filter 'sed -e "/^Co-Authored-By:.*$/d"' main.."$BRANCH"
fi

# 2. CHANGELOG check
NEW_VERSION=$(grep '"version"' package.json | head -1 | grep -oE '0\.[0-9]+\.[0-9]+')
if ! head -10 CHANGELOG.md | grep -q "## \[$NEW_VERSION\]"; then
  echo "FIXING: CHANGELOG entry missing for $NEW_VERSION"
  # ... add it manually ...
fi

# 3. verify-slice.sh PASS
bash scripts/verify-slice.sh
```

## Engram Artifact IDs (for traceability)

| Artifact | Observation ID |
|---|---|
| proposal | #2599 |
| spec (deployment-devops) | #2602 |
| spec (scheduler-jobs) | #2602 |
| design | #2604 |
| tasks | #2605 |
| apply-progress | #2611 |
| verify-report | #2614 |
| archive-report | (this document) |

## Next Candidates (E3+ remaining scope)

- Cross-table analytics endpoints (B) — ~400-600 LoC, 5-10 endpoints, read-only over existing data
- N16 gastos FK to ctacte via cctcuenta lookup (small follow-up slice)
- BullMQ migration (E5+) — interface preserved via `setEnabled` swap-in
- Multi-region deployment (C) — 1000+ LoC, NGINX + Postgres replication

## Files Archived

```
openspec/changes/archive/2026-06-26/athlos-async-scheduler/
├── proposal.md
├── design.md
├── specs/
│   ├── deployment-devops/
│   │   └── spec.md
│   └── scheduler-jobs/
│       └── spec.md
├── tasks.md
└── verify-report.md
```
