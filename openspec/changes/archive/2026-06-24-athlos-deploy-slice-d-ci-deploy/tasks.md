# Tasks: athlos-deploy-slice-d-ci-deploy

## Header

| Field | Value |
|-------|-------|
| Change | `athlos-deploy-slice-d-ci-deploy` |
| Date | 2026-06-24 |
| Phase | tasks |
| Mode | both (Engram + OpenSpec) |
| Status | written |
| File | `openspec/changes/athlos-deploy-slice-d-ci-deploy/tasks.md` |
| Work-unit count | 9 (TASK-001..TASK-009) |
| Target version | v0.5.0 |
| Delivery strategy | single-pr |

## Summary

This is the implementation task list for Slice D (athlos-deploy-slice-d-ci-deploy). It breaks the 3 deliverables + 4 supporting changes into 9 atomic, dependency-ordered tasks for `sdd-apply`. Slice D is pure GitHub Actions YAML + config (no application code); verification is via `actionlint` + `yamllint` + manual deploy test.

Slice D ships 3 CI/CD workflow files (deploy.yml, check-destructive.yml, labeler.yml) plus .env.example wiring and runbook documentation. The 3-commit structure is: (A) planning artifacts → (B) feat + atomic canonical spec sync → (C) release v0.5.0. B1b LESSON #1 (atomic canonical sync) is a HARD GATE in TASK-008: the 4 stale `CI/CD Pipeline` scenarios + 6 new ones MUST sync to canonical with `diff` empty before task is complete. B1b LESSON #2 mandates that the version bump and CHANGELOG entry live ONLY in the separate TASK-009 closing release commit.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | ~215 |
| 400-line budget risk | LOW (~54%) |
| Chained PRs recommended | No |
| Work-unit count | 9 (TASK-001..TASK-009) |
| Largest single change | TASK-005 `.github/workflows/deploy.yml` (~80 LoC) |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending (single PR, ~215 lines)
400-line budget risk: LOW

## Task List

### CONFIGURATION (no logic, just env vars)

- **TASK-001 [WIRING]:** Add `DEPLOY_HOST` and `DEPLOY_SSH_KEY` to `.env.example`
  - Add under existing `─── Containerized Deploy (PR Slice D) ───` section
  - `DEPLOY_HOST=192.168.1.102` (current dev IP; for prod, point to definitive server)
  - `DEPLOY_SSH_KEY=<paste-private-key-here>` (placeholder, never commit real key)
  - **Check:** `grep -E "^DEPLOY_(HOST|SSH_KEY)" .env.example` shows both lines

### LABELER + CI WIRING

- **TASK-002 [WIRING]:** Create `.github/labeler.yml`
  - Single rule: `db-destructive:` matching `packages/db/migrations/**`, `packages/db/src/schema/**`, `drizzle/**`
  - **Check:** `yamllint .github/labeler.yml` exits 0; `cat .github/labeler.yml` shows the 3 patterns

- **TASK-003 [WIRING]:** Add `labeler` job to `.github/workflows/test.yml`
  - New job `labeler:` with `runs-on: ubuntu-latest`, single step `uses: actions/labeler@v5` with `configuration-path: .github/labeler.yml`
  - Run on `pull_request: types: [opened, synchronize, reopened]`
  - **Check:** `actionlint .github/workflows/test.yml` exits 0; new `labeler:` job visible in `grep "labeler:" .github/workflows/test.yml`

### DESTRUCTIVE GATE

- **TASK-004 [WIRING]:** Create `.github/workflows/check-destructive.yml`
  - Trigger: `on: pull_request: types: [opened, synchronize, labeled, unlabeled]`
  - Single job `check:`:
    1. `actions/checkout@v4` with `fetch-depth: 0`
    2. Detect changed migration files: `git diff --name-only origin/main...HEAD | grep -E 'packages/db/migrations/.*\.sql$'`
    3. Detect destructive patterns: `xargs grep -lE 'DROP TABLE|TRUNCATE|DELETE FROM'`
    4. If destructive + `db-destructive` label present: require backup URL in PR comments OR `/backup-skipped` in PR body; else fail with actionable error
    5. If destructive + no label: fail with "missing db-destructive label"
    6. Else: pass with summary
  - **Check:** `actionlint .github/workflows/check-destructive.yml` exits 0; YAML structure matches design.md template

### DEPLOY WORKFLOW (the big one)

- **TASK-005 [WIRING]:** Create `.github/workflows/deploy.yml`
  - Trigger: `on: push: branches: [main]`
  - `concurrency: group: deploy, cancel-in-progress: false`
  - Permissions: `contents: read`, `packages: write`
  - Single job `deploy:` with `timeout-minutes: 15`
  - Steps (per design.md section 4.1):
    1. `actions/checkout@v4` with `fetch-depth: 0`
    2. `pnpm/action-setup@v4` + `actions/setup-node@v4` (node 22, cache pnpm)
    3. `pnpm install --frozen-lockfile` + `pnpm test:run` + `pnpm lint` + `pnpm typecheck`
    4. `docker/setup-buildx-action@v3` + `docker/login-action@v3` (GHCR)
    5. `docker/metadata-action@v5` with tags `:latest`, `:vX.Y.Z`, `:main-<sha>`
    6. `docker/build-push-action@v5` with `push: true`, `cache-from: type=gha`, `cache-to: type=gha,mode=max`
    7. `appleboy/ssh-action@v1` with `DEPLOY_SSH_KEY` + `DEPLOY_HOST` → run `docker compose pull && docker compose up -d` + poll `/health/ready` for 60s + auto-rollback on fail
  - **Check:** `actionlint .github/workflows/deploy.yml` exits 0; YAML structure matches design.md section 4.1; all 5 GitHub Secrets referenced (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `GITHUB_TOKEN`)

### DOCUMENTATION

- **TASK-006 [WIRING]:** Add "CI/CD" section to `docs/runbook.md`
  - New top-level section `## CI/CD`:
    - `### Deploy flow`: push to main → CI builds → GHCR push → SSH deploy → healthcheck → if pass done, if fail auto-rollback
    - `### Auto-rollback procedure`: what happens on healthcheck fail (workflow logs to `/tmp/deploy-fail-<sha>.log` on server; redeploys previous tag)
    - `### db-destructive label`: when it auto-applies (migrations/** or schema/** changes), what reviewers should expect
    - `### Manual rollback`: `docker compose pull && IMAGE_TAG=<previous> docker compose up -d` (when auto-rollback fails or operator needs to roll back further)
    - `### Server-side hardening`: `authorized_keys` `command=` + `from=` restrictions + deploy wrapper script that ONLY accepts `docker compose` commands
  - **Check:** `grep -A 1 "^## CI/CD" docs/runbook.md | head -3` shows the new section

### PRE-CLOSING VERIFICATION

- **TASK-007 [VERIFY]:** Run full pre-closing verification
  - `pnpm test:run` → 468+ vitest pass (no regression)
  - `pnpm typecheck` → pass
  - `pnpm lint` → pass
  - `actionlint .github/workflows/deploy.yml` → exit 0
  - `actionlint .github/workflows/check-destructive.yml` → exit 0
  - `actionlint .github/workflows/test.yml` → exit 0 (after labeler job added)
  - `yamllint .github/labeler.yml` → exit 0
  - Manual labeler test (optional): create a draft PR that touches `packages/db/migrations/0000_*.sql`, observe `db-destructive` label auto-applied
  - **Check:** All 8 commands above exit 0

### ATOMIC CANONICAL SYNC (B1b LESSON #1 — HARD GATE)

- **TASK-008 [HARD-GATE]:** Atomic canonical spec sync
  - Apply the spec delta to canonical `openspec/specs/deployment-devops/spec.md`:
    - Rewrite 4 stale scenarios IN-PLACE in the `CI/CD Pipeline` requirement:
      1. "CI workflow file is `.github/workflows/deploy.yml`" (was: `ci.yml`)
      2. "Image is `ghcr.io/victor0451/athlos-api`" (was: `athlos-api:`)
      3. "Deploys on push to `main` branch" (was: `staging`)
      4. "Registry organization is `ghcr.io/victor0451`" (was: `ghcr.io/athlos`)
    - Add the 6 new scenarios (image tags, SSH action, auto-rollback, concurrency, destructive gate, auto-labeler)
    - Add the 5 new success criteria
  - Run the 5 atomic canonical diffs:
    ```bash
    # 1 new requirement + 4 rewrites + 6 new scenarios + 5 new criteria = 5 diffs total
    # Diff 1: verify new requirement text
    diff <(grep -A 50 "Requirement: CI/CD Pipeline" openspec/specs/deployment-devops/spec.md | head -60) \
         <(grep -A 50 "Requirement: CI/CD Pipeline" openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md | head -60)
    # MUST be empty (or show only intended delta)

    # Diffs 2-5: verify each stale scenario rewrite individually
    ```
  - **Check:** All 5 atomic diffs are empty OR show ONLY the intended delta
  - **B1b LESSON #1:** If ANY diff is non-empty, fix canonical BEFORE marking task complete

### CLOSING RELEASE COMMIT (B1b LESSON #2)

- **TASK-009 [RELEASE]:** Closing release commit (v0.4.5 → v0.5.0)
  - Bump version in all 25 `package.json` files: `0.4.5` → `0.5.0`
  - Add entry to `CHANGELOG.md` (top): `## [0.5.0] - 2026-06-24` + bullet list of 5 changes (deploy.yml, check-destructive.yml, labeler.yml, runbook CI/CD section, atomic spec sync)
  - Commit message: `chore(release): v0.5.0` (separate from feat commit per LESSON #2)
  - **Check:** `git show HEAD~1 -- package.json | grep version` = `0.4.5`; `git show HEAD -- package.json | grep version` = `0.5.0`; `git show HEAD -- CHANGELOG.md | head -5` shows `## [0.5.0]`

## Dependency Graph

```
TASK-001 (env vars)          ── independent
TASK-002 (labeler.yml)       ── independent
TASK-003 (labeler job)       ── depends on TASK-002
TASK-004 (check-destructive) ── depends on TASK-002
TASK-005 (deploy.yml)        ── independent
TASK-006 (runbook)           ── depends on TASK-005
TASK-007 (verify)            ── depends on TASK-001..TASK-006
TASK-008 (atomic sync)       ── depends on TASK-007
TASK-009 (release)           ── depends on TASK-008
```

## Commit Plan

### 3-Commit Structure

| Commit | Message | What | Check |
|--------|---------|------|-------|
| A | `docs(plan): slice-d CI deploy planning artifacts` | `openspec/changes/athlos-deploy-slice-d-ci-deploy/proposal.md` + `specs/` + `design.md` + `tasks.md` | `git log --oneline -3` shows planning commit as HEAD~2 |
| B | `feat(deploy): CI deploy workflow + db-destructive label gate` | `.github/workflows/deploy.yml` + `check-destructive.yml` + `labeler.yml` + `test.yml` (labeler job) + `.env.example` + `docs/runbook.md` + atomic sync of canonical spec | `git log --oneline -3` shows feat commit as HEAD~1; NO version bump, NO CHANGELOG edit |
| C | `chore(release): v0.5.0` | 25 `package.json` (v0.4.5 → v0.5.0) + `CHANGELOG.md` (new entry) | `git show HEAD -- package.json | grep version` = `0.5.0`; `git show HEAD~1 -- package.json | grep version` = `0.4.5` |

### Commit A — Planning Artifacts
- Stage: `openspec/changes/athlos-deploy-slice-d-ci-deploy/proposal.md` + `specs/deployment-devops/spec.md` + `design.md` + `tasks.md`
- Check: `git log --oneline -3` shows planning commit as separate entry

### Commit B — Feature + Atomic Spec Sync
- Stage: `.github/workflows/deploy.yml` + `check-destructive.yml` + `labeler.yml` + `test.yml` (labeler job) + `.env.example` + `docs/runbook.md` + atomic sync of canonical spec
- Check: `git log --oneline -3` shows feat commit + canonical spec sync as part of same commit (B1b LESSON #1)
- B1b LESSON #1: atomic canonical diff is empty before commit

### Commit C — Release (separate)
- Stage: 25 `package.json` (v0.4.5 → v0.5.0) + `CHANGELOG.md` (new entry)
- Check: `git show HEAD -- package.json | grep version` = `0.5.0`; `git show HEAD~1 -- package.json | grep version` = `0.4.5`
- B1b LESSON #2: NO version bump in TASK-001..TASK-008

## Pre-Commit Checklist

### Per Commit
- [ ] All task-level checks passed
- [ ] No `Co-Authored-By: ... <noreply@anthropic.com>` or AI attribution
- [ ] Conventional Commits format
- [ ] No version bump in Commit B (only in Commit C)
- [ ] No CHANGELOG.md edit in Commit B (only in Commit C)
- [ ] Atomic canonical diff is empty (Commit B)

### Commit B Specific
- [ ] `actionlint .github/workflows/deploy.yml` exits 0
- [ ] `actionlint .github/workflows/check-destructive.yml` exits 0
- [ ] `actionlint .github/workflows/test.yml` exits 0
- [ ] `yamllint .github/labeler.yml` exits 0
- [ ] No `echo ${{ secrets.X }}` leaks in any YAML
- [ ] `DEPLOY_SSH_KEY` and `DEPLOY_HOST` referenced via `${{ secrets.DEPLOY_SSH_KEY }}` and `${{ secrets.DEPLOY_HOST }}`
- [ ] `.env.example` has placeholder values, not real keys

### Commit C Specific
- [ ] All 25 `package.json` files updated to `0.5.0`
- [ ] `CHANGELOG.md` has `## [0.5.0]` entry at top with all 5 changes listed
- [ ] `git show HEAD~1 -- package.json | grep version` still shows `0.4.5`

## TDD Workflow

**NO TDD chain for Slice D** — Slice D is pure GitHub Actions YAML + config (no application code). All verification is infrastructure-level:

- `actionlint` — validates GitHub Actions YAML schema and common mistakes
- `yamllint` — validates labeler.yml YAML syntax
- `pnpm test:run` — no regression (468+ vitest tests pass)
- `pnpm lint` + `pnpm typecheck` — no application code changes, but ensure no regression
- Manual deploy test (in staging before main merge) — full end-to-end of deploy workflow

YAML changes should be reviewed for:
- GitHub Actions schema validity
- Secret leak: no `echo ${{ secrets.X }}` in logs
- Proper `if:` conditions on destructive steps
- Correct `concurrency` group naming
- `timeout-minutes` set on long-running jobs

## B1a/B1b LESSONs (MANDATORY embed in apply prompt)

### LESSON #1 (HIGHEST recurrence — HARD GATE)
**TASK-008 atomic canonical spec sync** — run `diff delta vs canonical` atomically. The 4 stale `CI/CD Pipeline` scenarios + 6 new ones MUST sync to canonical with `diff` empty before task complete. Exhaustive diff covers every new + rewritten scenario. Apply to the 4 rewrites + 6 new scenarios + 1 new requirement + 5 new criteria. **This is the most likely failure mode if lessons are forgotten.**

### LESSON #2 (recurring)
**Closing release commit MUST be separate from feature commit.** Version bump + CHANGELOG entry in TASK-009 only. Do NOT touch `package.json` version or `CHANGELOG.md` in TASK-001 through TASK-008.

### LESSON #3 (B1b critical)
**If pre-merge fix needed** (e.g., actionlint catches a workflow bug after Commit B), apply fix + cherry-pick reorder to preserve 3-commit shape: HEAD~2 = planning, HEAD~1 = feat+spec, HEAD = release.

### LESSON #4 (B1b recovery)
**ALWAYS merge feature branch to main BEFORE `git branch -D`.** If branch is lost, recover via `git branch recovery <sha>` from reflog.

## Acceptance Criteria

- [ ] All 9 tasks completed with checks passed
- [ ] 3-commit structure preserved (HEAD~2=planning, HEAD~1=feat+spec sync, HEAD=release)
- [ ] 5 atomic canonical diffs empty (1 new requirement + 4 rewrites + 6 new scenarios + 5 new criteria)
- [ ] 468+ vitest tests pass
- [ ] `pnpm lint` + `pnpm typecheck` pass
- [ ] `actionlint` passes on all 3 workflow files
- [ ] `yamllint` passes on labeler.yml
- [ ] Manual deploy test (in staging before main merge): push commit → workflow runs → GHCR has new image with 3 tags → server has new image → `/health/ready` returns 200
- [ ] Auto-labeler test: PR touching `packages/db/migrations/*.sql` → `db-destructive` label auto-applied
- [ ] Destructive gate test: PR with `DROP TABLE` + `db-destructive` label + no backup + no `/backup-skipped` → workflow FAILS
- [ ] PR title: `feat(deploy): CI deploy workflow + db-destructive label gate (v0.5.0)`

## Open Questions

**NONE** — all 4 open questions from the proposal phase were resolved in the design phase. All 9 tasks are dependency-ordered and fully specified.
