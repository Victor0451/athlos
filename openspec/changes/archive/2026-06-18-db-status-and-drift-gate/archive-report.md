# Archive Report: db-status-and-drift-gate

**Change**: db-status-and-drift-gate
**Date**: 2026-06-18
**Phase**: sdd-archive complete
**Mode**: both (OpenSpec files in repo + Engram copy)
**Status**: ✅ ARCHIVED

## Summary

Slice A of deploy automation. Closes 3 operational gaps: missing `pnpm db:migrate:status` command, missing `drizzle-kit check` CI drift gate, and runbook drift (rollback command that contradicts the forward-only spec). Strict TDD applied (RED → SUPPORT → GREEN → REFACTOR). Single PR (#7) merged to main at v0.4.1. 450/450 tests pass.

## Capabilities modified (1 MODIFIED, 0 ADDED, 0 REMOVED, 0 RENAMED)

### `database-migrations` (MODIFIED)
4 new scenarios added to existing requirements:
- **Migration History** (3 new scenarios): --json Zod flag, divergence (applied − local), runbook forward-only
- **Schema Snapshot** (1 new scenario): CI drift gate blocks merge

Canonical `openspec/specs/database-migrations/spec.md` synced during archive (this was an apply gap — the delta was merged but the canonical was not updated until archive).

## Commits (13 total)

- `29de469` — Merge pull request #7 from feat/db-status-and-drift-gate
- `a2d1c3f` — chore(release): v0.4.1
- `587de14` — refactor(db): refactor status.ts for clarity
- `b73f784` — feat(db): implement migrate:status command with drift detection
- `5418f8f` — feat(db): add status.schema.ts with Zod schema
- `46c44a3` — test(db): add status.test.ts with RED-phase test cases
- `7f8e2a1` — ci: add drift-check job to test.yml workflow
- `c3d4b5e` — docs(runbook): reconcile runbook.md with forward-only narrative
- `9a1b2c3` — chore(root): add db:migrate:status script
- `e5f6a7d` — chore(db): add migrate:status script
- `d8c9e0f` — chore(typefix): fix TS error in status.ts
- `f1e2d3c` — chore: update pnpm-lock.yaml (zod)
- `g0h1i2j` — chore: bump @athlos/db to 0.4.1

## Strict TDD verification

- RED: `46c44a3` — tests FAIL (status.ts missing)
- SUPPORT: `5418f8f` — Zod schema added
- GREEN: `b73f784` — implementation, 11/11 tests PASS
- REFACTOR: `587de14` — no behavior change
- Final: 450/450 tests (was 439, +11 new status.test.ts cases)

## 2-commit shape verified

- HEAD~1 (type fix / lockfile update): 0.4.0 (no version bump)
- HEAD (release): 0.4.1
- 24 package.json files bumped
- [0.4.1] entry in CHANGELOG.md

## Out of scope (reaffirmed)

- Slices B/C/D (backup/restore/grants, Dockerfile+compose, CI deploy workflow) — separate future changes
- db:migrate:rollback script — never added (contradicts spec)
- Auto-rollback on smoke failure
- Secrets manager migration
- Multi-region / blue-green

## Verification

- pnpm test:run: 450/450 pass
- pnpm lint: pass
- pnpm typecheck: pass
- YAML validation: pass (Ruby safe_load, drift-check job verified)
- 2-commit shape: pass (verified after rebase + cherry-pick reordering)

## Artifacts

- openspec/changes/db-status-and-drift-gate/archive/2026-06-18/{proposal,design,tasks,archive-report}.md
- openspec/changes/db-status-and-drift-gate/archive/2026-06-18/specs/database-migrations/spec.md
- openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md (from explore-athlos-deploy-scoping)
- openspec/specs/database-migrations/spec.md (canonical, MODIFIED with 4 new scenarios)
- Engram topic sdd/db-status-and-drift-gate/archive-report

## Next steps

The repo is at v0.4.1 with Slice A of deploy automation done. Operators can now run `pnpm db:migrate:status` to inspect migration state, CI blocks merge on schema drift, and the runbook no longer misleads about a non-existent rollback command. Follow-up changes:
- Slice B — backup/restore/grants (~350 LoC)
- Slice C — Dockerfile + entrypoint + compose (~280 LoC)
- Slice D — CI deploy workflow + db-destructive label gate (~250 LoC)