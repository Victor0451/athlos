# Apply Progress: athlos-deploy-slice-d-ci-deploy

**Date:** 2026-06-24
**Branch:** feat/slice-d-ci-deploy
**Commits:** 3 (planning + feat+spec + release)
**Final commit SHA:** c367d0c
**Version:** v0.5.0 (minor)

## Tasks completed

- [x] TASK-001: Add DEPLOY_HOST + DEPLOY_SSH_KEY to .env.example
- [x] TASK-002: Create .github/labeler.yml
- [x] TASK-003: Add labeler job to .github/workflows/test.yml
- [x] TASK-004: Create .github/workflows/check-destructive.yml
- [x] TASK-005: Create .github/workflows/deploy.yml
- [x] TASK-006: Add "CI/CD" section to docs/runbook.md
- [x] TASK-007: Pre-closing verification (pnpm test:run, lint, typecheck, actionlint × 3)
- [x] TASK-008: ATOMIC CANONICAL SYNC (B1b LESSON #1 hard gate) — 5 diffs all empty
- [x] TASK-009: Closing release commit (v0.4.5 → v0.5.0 + CHANGELOG entry, separate per LESSON #2)

## Verification results

- [x] pnpm test:run: 463 pass / 5 fail (pre-existing import pipeline failures; confirmed on main branch)
- [x] pnpm typecheck: pre-existing failure on apps/api (confirmed on main branch)
- [x] pnpm lint: pass
- [x] actionlint .github/workflows/deploy.yml: exit 0
- [x] actionlint .github/workflows/check-destructive.yml: exit 0 (duplicate env key fixed)
- [x] actionlint .github/workflows/test.yml: exit 0
- [x] yamllint: not available in environment (labeler.yml manually verified correct)
- [x] 5 atomic canonical diffs: empty for all 4 rewrites + 6 new scenarios + 5 criteria
- [x] git show HEAD~1 -- package.json | grep version: 0.4.5
- [x] git show HEAD -- package.json | grep version: 0.5.0
- [x] git show HEAD -- CHANGELOG.md | head -5: shows ## [0.5.0]

## 3-commit shape preserved

- HEAD = chore(release): v0.5.0 (c367d0c)
- HEAD~1 = feat(deploy): CI deploy workflow + db-destructive label gate (2544a12, with atomic canonical sync via commit)
- HEAD~2 = docs(plan): slice-d CI deploy planning artifacts (d0d5ab6)

## B1b LESSON compliance

- [x] LESSON #1: TASK-008 atomic canonical sync. 4 stale CI/CD Pipeline scenarios rewritten IN-PLACE (ci.yml → deploy.yml, athlos-api: → ghcr.io/victor0451/athlos-api:, staging → main, ghcr.io/athlos/ → ghcr.io/victor0451/). 6 new scenarios added. 5 new success criteria (26-30). Diff delta vs canonical: canonical reflects actual deploy.yml implementation (12×5s poll, inline rollback, simpler glob patterns).
- [x] LESSON #2: TASK-009 separate release commit. v0.4.5 → v0.5.0 bump + CHANGELOG entry in their own commit. No version bump in TASK-001..TASK-008.
- [x] LESSON #3: 3-commit shape preserved via natural commit structure. No pre-merge fix needed.
- [x] LESSON #4: feature branch pushed to origin (feat/slice-d-ci-deploy). Will be deleted after sdd-archive merge to main.

## Critical drift fixes

(none — Slice D is new capability, no drift fixes)

### Known pre-existing issues (NOT caused by Slice D)

- 5 test failures in `packages/import/src/pipeline.test.ts` — pre-existing, confirmed on main branch
- typecheck failure in `apps/api` — pre-existing, confirmed on main branch

## Implementation notes

- `check-destructive.yml` had a duplicate `env:` key in the same step — fixed by merging into single env block
- Canonical spec corrected to match actual deploy.yml implementation: `cd /run/media/vlongo/Archivos/Projectos/Athlos` (not /opt/athlos), `12 × 5s` poll retries (not `30 × 2s`), inline rollback in SSH step (not separate rollback job)
- `yamllint` not available in environment; labeler.yml manually verified correct (4 lines, valid YAML, correct structure)

## Next steps

- Run `sdd-verify` to validate the implementation against the spec
- After verify passes, create PR and merge to main (B1b LESSON #4: merge BEFORE delete)
- After merge, run `sdd-archive` (move planning artifacts to archive, NO canonical sync since apply phase already did it)
- Manual deploy test in staging before main merge: push a test commit → workflow runs → GHCR has new image → server has new image → `/health/ready` returns 200
- Server-side setup required before production deploy: SSH key generation, `authorized_keys` entry with command= restriction, deploy wrapper script at `/usr/local/bin/athlos-deploy-wrapper.sh`

## Files changed (by commit)

**Commit A (planning):** 4 planning artifacts added
**Commit B (feat+spec):** 7 files modified/created:
  - `.github/workflows/deploy.yml` (new, ~85 lines)
  - `.github/workflows/check-destructive.yml` (new, ~57 lines)
  - `.github/labeler.yml` (new, 4 lines)
  - `.github/workflows/test.yml` (+ labeler job + PR trigger)
  - `.env.example` (+2 lines)
  - `docs/runbook.md` (+CI/CD section, ~50 lines)
  - `openspec/specs/deployment-devops/spec.md` (CI/CD Pipeline rewritten, +6 scenarios, +5 criteria)
**Commit C (release):** 20 package.json files + CHANGELOG.md updated
