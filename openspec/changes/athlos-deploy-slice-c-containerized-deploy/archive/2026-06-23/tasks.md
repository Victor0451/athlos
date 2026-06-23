# Tasks: athlos-deploy-slice-c-containerized-deploy

## Header

| Field | Value |
|-------|-------|
| Change | `athlos-deploy-slice-c-containerized-deploy` |
| Date | 2026-06-23 |
| Phase | tasks |
| Mode | executor |
| Status | written |
| File | `openspec/changes/athlos-deploy-slice-c-containerized-deploy/tasks.md` |
| Work-unit count | 14 |
| Target version | v0.4.5 |

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~315 |
| 400-line budget risk | **LOW** (~79%) |
| Chained PRs recommended | **No** |
| Delivery strategy | `single-pr` |
| Chain strategy | N/A (single PR) |
| Decision needed before apply | No |

**Decision needed before apply**: No
**Chained PRs recommended**: No
**Chain strategy**: pending
**400-line budget risk**: Low

---

## Summary

This is the implementation task list for **Slice C: Containerized Deploy**. The change breaks 14 work-units from `design.md` into atomic, dependency-ordered tasks for `sdd-apply`.

**TDD chain applies ONLY to the dotenv guard** (1 file, 3 vitest cases). Infrastructure files (Dockerfile, entrypoint, compose) are validated via the CI `docker-build-smoke` job + manual smoke.

**3-commit structure:**
- Commit A (pre-merge): `docs(plan): slice-c containerized deploy planning artifacts` (TASK-000)
- Commit B (feature): `feat(deploy): containerized deploy — Dockerfile + entrypoint + compose + 3 spec drift fixes` (TASK-001..TASK-012)
- Commit C (release): `chore(release): v0.4.5` (TASK-013)

**B1a/B1b LESSON #1 (HIGH recurrence):** TASK-012 runs `diff delta vs canonical` atomically for all 5 changed sections. If ANY diff is non-empty, fix canonical BEFORE marking task complete. This is NOT optional.

**3 critical drift fixes included:**
1. `dotenv/config` unconditional load in `apps/api/src/index.ts:3` → `NODE_ENV !== 'production'` guard
2. `BACKUP_BEFORE_MIGRATE` S3→local reconciliation (`$BACKUP_DIR` per ADR #30)
3. 4 stale scenarios in `deployment-devops/spec.md` rewritten in-place

---

## Task List

### PRE-MERGE PLANNING (TASK-000 — separate commit, first)

- [ ] **TASK-000 [PRE-MERGE]** Commit planning artifacts
  - Stage `openspec/changes/athlos-deploy-slice-c-containerized-deploy/` files (proposal, spec, design, tasks)
  - Commit message: `docs(plan): slice-c containerized deploy planning artifacts`
  - Push to feature branch BEFORE the feat commit
  - **Check:** `git log --oneline -5` shows planning artifacts as a separate entry
  - **Check:** `git status` is clean after this commit

---

### TDD CHAIN (only dotenv guard — strict RED → GREEN → REFACTOR)

- [ ] **TASK-001 [TDD-RED]** Write `apps/api/test/dotenv-guard.test.ts`
  - 3 test cases: `NODE_ENV=production` skips dotenv; `NODE_ENV=development` loads; `NODE_ENV` unset loads
  - Use `vi.mock('dotenv/config', ...)` to capture whether dotenv was loaded
  - Commit before TASK-002
  - **Check:** `pnpm test:run apps/api/test/dotenv-guard.test.ts` → 3 tests **FAIL** (RED)

- [ ] **TASK-002 [TDD-GREEN]** Modify `apps/api/src/index.ts:3`
  - Replace unconditional `import 'dotenv/config'` with:
    ```ts
    if (process.env['NODE_ENV'] !== 'production') {
      await import('dotenv/config');
    }
    ```
  - Dynamic import (ESM-friendly, lazy — production never executes the side effect)
  - **Check:** `pnpm test:run apps/api/test/dotenv-guard.test.ts` → 3 tests **PASS** (GREEN)
  - **Check:** `pnpm test:run` → 464 + 3 = **467 vitest tests pass** (no regression)

- [ ] **TASK-003 [TDD-REFACTOR]** Clean up `apps/api/src/index.ts` if needed
  - Optional — only if the dynamic import pattern needs cleanup
  - **Check:** `pnpm test:run` → 467 vitest tests pass
  - **Check:** `pnpm lint` + `pnpm typecheck` → pass

---

### INFRASTRUCTURE (no TDD — validated by CI docker-build-smoke + manual smoke)

- [ ] **TASK-004** Rewrite `Dockerfile` (~50 lines, real multi-stage)

  Stage 1 `builder`:
  - Base: `node:22-alpine`
  - `apk add --no-cache libc6-compat`
  - `WORKDIR /app`
  - Copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  - `pnpm fetch` + `pnpm install --frozen-lockfile --offline`
  - Copy source code
  - `pnpm --filter @athlos/api build`
  - `pnpm --filter @athlos/db generate`

  Stage 2 `runner`:
  - Base: `node:22-alpine`
  - `apk add --no-cache tini bash postgresql-client`
  - Create non-root `athlos` user (UID 1001)
  - Copy artifacts from builder
  - Copy `docker-entrypoint.sh`
  - `chmod +x`
  - `USER athlos`
  - `EXPOSE 3000`
  - `ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]`
  - `CMD ["node", "apps/api/dist/index.js"]`

  - **Check:** `docker build -t athlos-api:test .` → succeeds, multi-stage builds, ~150 MB final image
  - **Check:** `docker run --rm athlos-api:test node --version` → outputs Node 22.x
  - **Check:** `docker run --rm athlos-api:test ls /usr/local/bin/docker-entrypoint.sh` → outputs the path
  - **Check:** `docker run --rm athlos-api:test id` → outputs `uid=1001(athlos)` (non-root)

- [ ] **TASK-005** Create `docker-entrypoint.sh` (~40 lines bash)
  - `set -euo pipefail`
  - Source `scripts/lib/common.sh`
  - Wait for `db` ready: loop `pg_isready -h db -p 5432 -U "$POSTGRES_USER"` (timeout 60s)
  - If `BACKUP_BEFORE_MIGRATE=true`: call `scripts/backup.sh`, **exit 2** on failure
  - If `RUN_MIGRATIONS=true`: `cd /app && pnpm --filter @athlos/db migrate`, **exit 3** on failure
  - `exec "$@"` (the API process from CMD)
  - **Check:** `bash -n docker-entrypoint.sh` → no syntax errors
  - **Check:** `chmod +x docker-entrypoint.sh` → entrypoint is executable

- [ ] **TASK-006** Rewrite `docker-compose.yml` (~110 lines YAML, real prod)

  `services:`
  - `db`: `postgres:16-alpine`, env_file, `pgdata` volume, healthcheck `pg_isready`, json-file logs `10m × 3`
  - `api`: build context, env_file `.env.production`, `RUN_MIGRATIONS`/`BACKUP_BEFORE_MIGRATE`/`NODE_ENV` env overrides, `depends_on db` (healthy), ports `3000:3000`, host-mounted `./backups`, healthcheck `/health/ready` `30s/5s/5/30s-start_period`, json-file logs `10m × 3`

  `volumes: pgdata:`

  - **Check:** `docker compose -f docker-compose.yml config` → validates YAML syntax
  - **Check:** `docker compose -f docker-compose.yml up -d` → both services healthy within 60s
  - **Check:** `curl http://localhost:3000/health/ready` → 200

- [ ] **TASK-007** Modify `.env.example` (+10 lines)
  - New section `─── Containerized Deploy (PR Slice C) ───`
  - Add: `RUN_MIGRATIONS=true`, `BACKUP_BEFORE_MIGRATE=true`, `BUILD_SHA=<git-sha>`, `NODE_ENV=production`, `POSTGRES_DB=athlos`, `POSTGRES_USER=athlos`, `POSTGRES_PASSWORD=`, `DATABASE_URL=postgresql://athlos:CHANGE_ME@db:5432/athlos`

- [ ] **TASK-008** Modify `.dockerignore` (+5 lines)
  - Add: `openspec/`, `.atl/`, `**/coverage/`, `**/.nyc_output/`, `.husky/`

- [ ] **TASK-009** Modify `docs/runbook.md` (+25 lines)
  - New section `## Containerized Deploy (Docker)`
  - Subsections: first deploy, verify, logs, migration, backup, rollback, one-off migration
  - Reference `docker-entrypoint.sh` and the spec scenarios

- [ ] **TASK-010** Modify `.github/workflows/test.yml` (+10 lines YAML, new job)
  - New job `docker-build-smoke` running on PR + push to main
  - Steps: checkout, `docker/setup-buildx-action@v3`, `docker build -t athlos-api:smoke .`, `docker run --rm athlos-api:smoke node --version`, `docker run --rm athlos-api:smoke ls /usr/local/bin/docker-entrypoint.sh`
  - No push (per locked decision)
  - Blocks merge on failure (like other jobs)

---

### VERIFICATION & RELEASE

- [ ] **TASK-011** Run full pre-closing verification
  - `pnpm test:run` → 467 vitest tests pass
  - `pnpm lint` → pass
  - `pnpm typecheck` → pass
  - `bats scripts/tests/*.test.bats` → all pass (B1a/B1b unchanged)
  - `docker build -t athlos-api:test .` → succeeds
  - `docker compose -f docker-compose.yml config` → validates YAML
  - `docker compose -f docker-compose.yml up -d` → both services healthy
  - `curl http://localhost:3000/health/ready` → 200
  - `ls -la ./backups/` → contains `athlos-<ts>.sql.gz`
  - **CRITICAL:** `grep -c "s3://" openspec/specs/deployment-devops/spec.md` = 0 (S3 reconciled)
  - **CRITICAL:** `grep -c "RUN_MIGRATIONS" openspec/specs/deployment-devops/spec.md` ≥ 1
  - **CRITICAL:** `grep -c "Containerized Deploy" openspec/specs/deployment-devops/spec.md` = 1
  - **CRITICAL:** `grep -c "BACKUP_DIR" openspec/specs/deployment-devops/spec.md` ≥ 1
  - **CRITICAL:** `grep -c "dotenv" openspec/specs/deployment-devops/spec.md` ≥ 1

- [ ] **TASK-012 [B1a/B1b LESSON #1 — ATOMIC CANONICAL SYNC SELF-VERIFY]**
  - Run ALL 5 diffs below; if ANY is non-empty, fix canonical BEFORE marking task complete
  - `diff <(grep -A 200 "Containerized Deploy" openspec/specs/deployment-devops/spec.md) <(grep -A 200 "Containerized Deploy" openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md | head -100)` → MUST be empty
  - `diff <(grep -A 50 "Database migrations on startup" openspec/specs/deployment-devops/spec.md | head -30) <(grep -A 50 "Database migrations on startup" openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md | head -30)` → MUST be empty
  - `diff <(grep -A 50 "Rollback procedure" openspec/specs/deployment-devops/spec.md | head -30) <(grep -A 50 "Rollback procedure" openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md | head -30)` → MUST be empty
  - `diff <(grep -A 50 "One-off migration execution" openspec/specs/deployment-devops/spec.md | head -30) <(grep -A 50 "One-off migration execution" openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md | head -30)` → MUST be empty
  - `diff <(grep -A 50 "Backup storage location" openspec/specs/deployment-devops/spec.md | head -30) <(grep -A 50 "Backup storage location" openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md | head -30)` → MUST be empty
  - **Check:** All 5 diffs are empty
  - **This is LESSON #1 — HIGH recurrence, do NOT skip**

- [ ] **TASK-013** Closing release commit
  - Modify ALL 24 `package.json` files: `0.4.4` → `0.4.5` (one-line bump each)
  - Add entry to `CHANGELOG.md` (top): `## [0.4.5] - 2026-06-XX` + 5-bullet list of changes
  - Commit message: `chore(release): v0.4.5`
  - **Check:** `git show HEAD~1 -- package.json | grep version` = `0.4.4`
  - **Check:** `git show HEAD -- package.json | grep version` = `0.4.5`
  - **Check:** `git show HEAD -- CHANGELOG.md | head -5` shows `## [0.4.5]`

---

## Dependency Graph

```
TASK-000 (planning) ─────────────────────────────────────────────────────┐
                                                                     │
TASK-001 (TDD-RED) ──→ TASK-002 (TDD-GREEN) ──→ TASK-003 (TDD-REFACTOR) │
                                                                     │
TASK-004 (Dockerfile)        ─────────────────────────────────────────│
TASK-005 (entrypoint)        ─────────────────────────────────────────│
TASK-006 (compose)           ─────────────────────────────────────────│
TASK-007 (.env.example)     ─────────────────────────────────────────│
TASK-008 (.dockerignore)     ─────────────────────────────────────────│
TASK-009 (runbook)           ─────────────────────────────────────────│
TASK-010 (CI job)            ─────────────────────────────────────────│
                                                                     │
                                    TASK-011 (verify) ─────────────────│
                                                                     │
                                    TASK-012 (canonical sync) ─────────│
                                                                     │
                                    TASK-013 (release commit) ←────────┘
```

**Key:**
- TASK-000: first, separate commit (pre-merge)
- TASK-001 → TASK-002 → TASK-003: TDD chain (sequential)
- TASK-004..TASK-010: infra (independent, can run in any order)
- TASK-011: verify (depends on TASK-003 + TASK-004..TASK-010)
- TASK-012: canonical sync (depends on TASK-011)
- TASK-013: release (depends on TASK-012)

---

## Commit Plan

| # | Type | Message | Tasks |
|---|------|---------|-------|
| A | `docs(plan):` | `slice-c containerized deploy planning artifacts` | TASK-000 |
| B | `feat(deploy):` | `containerized deploy — Dockerfile + entrypoint + compose + 3 spec drift fixes` | TASK-001..TASK-012 |
| C | `chore(release):` | `v0.4.5` | TASK-013 |

**All 3 commits pushed to feature branch as a single PR.**

**B1b LESSON (pre-merge fix + cherry-pick reorder):** If verify (TASK-011) catches drift after Commit B, apply fix + cherry-pick reorder to preserve shape: `HEAD~2` = planning, `HEAD~1` = feat, `HEAD` = release.

---

## Pre-Commit Checklist (per commit)

**Commit A (planning):**
- [ ] All `openspec/changes/athlos-deploy-slice-c-containerized-deploy/` files staged
- [ ] `git status` is clean after this commit
- [ ] No `Co-Authored-By` or AI attribution
- [ ] Conventional Commits format

**Commit B (feature):**
- [ ] All task-level checks passed
- [ ] No `Co-Authored-By` or AI attribution
- [ ] Conventional Commits format
- [ ] NO version bump in this commit (only in Commit C)
- [ ] NO `CHANGELOG.md` edit in this commit (only in Commit C)
- [ ] `pnpm test:run` → 467 vitest tests pass
- [ ] `pnpm lint` + `pnpm typecheck` → pass
- [ ] `docker build .` → succeeds
- [ ] `docker compose -f docker-compose.yml config` → validates YAML
- [ ] All 5 canonical diffs in TASK-012 are empty

**Commit C (release):**
- [ ] All 24 `package.json` files bumped to `0.4.5`
- [ ] `CHANGELOG.md` updated with `## [0.4.5] - 2026-06-XX` + 5-bullet list
- [ ] `git show HEAD~1 -- package.json | grep version` = `0.4.4`
- [ ] `git show HEAD -- package.json | grep version` = `0.4.5`
- [ ] No `Co-Authored-By` or AI attribution
- [ ] Conventional Commits format

---

## TDD Workflow

**ONLY the dotenv guard follows strict TDD (TASK-001 / TASK-002 / TASK-003).**

**NOT** Dockerfile, entrypoint, compose (infrastructure — no TDD).

TDD is enforced via:
1. **RED**: Write failing test in TASK-001 → commit
2. **GREEN**: Implement fix in TASK-002 → commit → `pnpm test:run` shows 3 new passing tests
3. **REFACTOR** (optional): Clean up in TASK-003

---

## B1a/B1b LESSONs (MANDATORY — embedded in apply prompt)

### LESSON #1 (HIGH recurrence)
**TASK-012**: Run `diff delta vs canonical` for ALL 5 changed sections atomically. If ANY diff is non-empty, fix canonical BEFORE marking task complete. Verify MUST include the diff in checklist.

### LESSON #2
**TASK-013**: Closing release commit MUST be separate from feature commit. Version bump + CHANGELOG entry ONLY in TASK-013, NOT in feature commit.

### LESSON #3 (B1b critical)
**Pre-merge fix + cherry-pick reorder**: If verify catches drift after Commit B, apply fix + cherry-pick reorder to preserve 2-commit shape: `HEAD~2` = planning, `HEAD~1` = feat, `HEAD` = release.

### LESSON #4 (B1b recovery)
**merge-to-main rule**: ALWAYS merge feature branch to main BEFORE `git branch -D`. If branch is lost, recover via `git branch recovery <sha>` from reflog.

---

## Acceptance Criteria

Binary pass/fail checks the verify phase will run:

- [ ] All 14 tasks completed with checks passed
- [ ] 3-commit structure preserved (planning + feat + release)
- [ ] All 5 canonical diffs empty (TASK-012)
- [ ] 467 vitest tests pass (`pnpm test:run`)
- [ ] `pnpm lint` + `pnpm typecheck` pass
- [ ] `bats scripts/tests/*.test.bats` all pass
- [ ] `docker build .` succeeds
- [ ] `docker compose -f docker-compose.yml up -d` brings up both services healthy
- [ ] `curl /health/ready` returns 200
- [ ] `./backups/` contains migration-time backup
- [ ] No `s3://` in canonical spec (`grep -c "s3://" openspec/specs/deployment-devops/spec.md` = 0)
- [ ] `grep -c "RUN_MIGRATIONS" openspec/specs/deployment-devops/spec.md` ≥ 1
- [ ] `grep -c "Containerized Deploy" openspec/specs/deployment-devops/spec.md` = 1
- [ ] `grep -c "BACKUP_DIR" openspec/specs/deployment-devops/spec.md` ≥ 1
- [ ] `grep -c "dotenv" openspec/specs/deployment-devops/spec.md` ≥ 1
- [ ] PR title: `feat(deploy): containerized deploy — Dockerfile + entrypoint + compose + 3 spec drift fixes (v0.4.5)`

---

## Open Questions

**None** — all decisions locked by explore + propose phases. All 11 explore questions resolved, all 4 stale scenario rewrites confirmed, all locked decisions documented.
