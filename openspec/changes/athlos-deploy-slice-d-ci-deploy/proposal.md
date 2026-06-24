# Proposal: athlos-deploy-slice-d-ci-deploy

| Field | Value |
|-------|-------|
| **Change** | `athlos-deploy-slice-d-ci-deploy` |
| **Date** | 2026-06-24 |
| **Phase** | Propose |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — awaiting user confirmation on 4 minor decisions (defaults recommended) |
| **Source of truth** | `openspec/changes/explore-athlos-deploy-slice-d/exploration.md` (684 lines, Engram id 2434) |
| **Sister change (DONE)** | `athlos-deploy-slice-c-containerized-deploy` (v0.4.5, archived 2026-06-23) |
| **Target release** | v0.5.0 (MINOR — new CI capability, not just infra) |
| **Delivery** | single PR, ~215 LoC, no chained PRs |

---

## 1. Context

**State of deploy automation post-Slice C (v0.4.5).** The Athlos API ships as a real multi-stage `Dockerfile` + `docker-entrypoint.sh` + `docker-compose.yml` (`api + db`, healthchecks, env_file, port 3001). The compose file references `image: ghcr.io/victor0451/athlos-api:local` — a placeholder, not a real registry push. The runbook documents a manual "First deploy" via `docker compose up -d --build` and a manual "Rollback" via SSH. Slice C's `docker-build-smoke` CI job catches Dockerfile regressions on every PR but does **not** push to any registry.

**The missing piece.** There is no CI deploy workflow. Every merge to `main` requires the operator to SSH into the production server (192.168.1.102, Ubuntu 24.04 LTS) and run `git pull && docker compose pull && docker compose up -d` manually. This is slow (operator on-call), error-prone (typos in commands, missed healthchecks), and the canonical spec has been promising CI deploy since the foundation (`openspec/changes/athlos-foundation/design.md:6009-6019`, `tasks.md:270` TASK-075). The `db-destructive` PR label has been a spec requirement since B1a (line 56 of `openspec/specs/database-migrations/spec.md`: destructive changes require the label + a `pg_dump` backup), but no `.github/labeler.yml` exists and no CI check enforces the gate.

**Slice D closes both loops.** It wires three new GitHub-side artifacts: `deploy.yml` (post-merge build → GHCR push → SSH deploy → healthcheck → auto-rollback), `check-destructive.yml` (pre-merge gate that requires a backup artifact OR the `/backup-skipped` operator directive), and `labeler.yml` (auto-applies `db-destructive` to PRs touching migration files). The result: every merge to `main` deploys itself; every destructive migration is forced through a backup gate. The canonical `CI/CD Pipeline` requirement (lines 72-105 of `deployment-devops/spec.md`) is rewritten IN-PLACE — the 4 stale foundation-era scenarios (referencing `ci.yml`, `staging` branch, `athlos/...` org) are replaced with reality (GHCR + `victor0451` + main-only + SSH), and 6 new scenarios cover the new capability.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | `.github/workflows/deploy.yml` runs on every push to `main`, builds the API image, pushes to GHCR (`ghcr.io/victor0451/athlos-api`), SSHes to the server, runs `docker compose pull && docker compose up -d`, polls `/health/ready` for 60s, auto-rollbacks on failure | A `git push origin main` triggers a workflow that completes in <5 min; server has new image tag visible via `docker images` |
| G2 | Image is tagged with `latest` (always), `vX.Y.Z` (when the closing commit is a version bump), and `main-<sha>` (always) | `docker images ghcr.io/victor0451/athlos-api` on the server shows all 3 tags after a release commit |
| G3 | `.github/workflows/check-destructive.yml` runs on PRs with the `db-destructive` label; requires a backup artifact URL in a PR comment OR `/backup-skipped` directive in PR body | A test PR with the label but no backup artifact + no directive fails the check with a clear error |
| G4 | `.github/labeler.yml` auto-applies `db-destructive` to PRs touching `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**` | Opening a test PR with a touched migration file shows the label applied within 1 min |
| G5 | `.env.example` extended with `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders | Operators know which secrets to set in GitHub repo settings |
| G6 | `docs/runbook.md` gets a new "CI/CD" section explaining deploy workflow, secrets, manual rollback, and the destructive gate | Runbook is the single source of truth for operators |
| G7 | `openspec/specs/deployment-devops/spec.md` MODIFIED — rewrite 4 stale `CI/CD Pipeline` scenarios IN-PLACE + add 6 new ones | Apply phase `diff delta vs canonical` is empty (B1b LESSON #1) |

### Non-Goals (deferred — documented for future slices)

(a) Blue-green deploy · (b) Auto-rollback on smoke failure (Slice A deferred; healthcheck is the v1 smoke) · (c) Secrets manager migration (GitHub Secrets + restricted SSH key is sufficient) · (d) Multi-region deploy · (e) HTTPS reverse proxy · (f) `apps/web` containerization · (g) Monitoring stack (Prometheus/Grafana) · (h) CODEOWNERS file (separate governance work) · (i) Auto-labeling of non-destructive migrations (e.g., `db-schema`) · (j) OIDC deploy · (k) Deploy previews for PRs · (l) Staging branch deploys.

---

## 3. Approach / Architecture

### 3.1 `.github/workflows/deploy.yml` (NEW, ~80 lines) — post-merge deploy

**Trigger:** `on: push: branches: [main]` — fires on every merge to main.
**Permissions:** `contents: read`, `packages: write` (GHCR push). OIDC not needed (SSH, not cloud).
**Concurrency:** `concurrency: group: deploy, cancel-in-progress: false` — queue, don't cancel mid-deploy.

**Jobs (sequential):**

1. **build-and-push**
   - `actions/checkout@v4` (`fetch-depth: 0` for version detection)
   - `pnpm/action-setup@v4` + `pnpm install --frozen-lockfile`
   - `pnpm test:run` + `pnpm typecheck` + `pnpm lint` — fail fast on regressions
   - `docker/setup-buildx-action@v3` + `docker/login-action@v3` (login GHCR with `GITHUB_TOKEN`)
   - `docker/metadata-action@v5` with `flavor: latest=regex=^v[0-9]+\\.[0-9]+\\.[0-9]+$` → outputs `tags: latest, vX.Y.Z, main-<sha>` + captures `IMAGE_TAG_PREVIOUS` for rollback
   - `docker/build-push-action@v5` with `push: ${{ github.event_name == 'push' }}` (only push on push events, not PRs), `cache-from: type=gha`, `cache-to: type=gha,mode=max`, `tags: ${{ steps.meta.outputs.tags }}`

2. **deploy** (needs build-and-push)
   - `appleboy/ssh-action@v1` with `DEPLOY_SSH_KEY` + `DEPLOY_HOST` → script:
     ```bash
     set -euo pipefail
     cd /run/media/vlongo/Archivos/Projectos/Athlos
     docker compose pull
     docker compose up -d
     for i in {1..30}; do
       if curl -fsS http://localhost:3001/health/ready > /dev/null 2>&1; then
         echo "OK: /health/ready returned 200 after ${i} attempts"; exit 0
       fi; sleep 2
     done
     docker compose logs --tail 200 api > /tmp/deploy-fail-$(date +%s).log
     echo "FAIL: /health/ready did not return 200 within 60s"
     exit 1
     ```

3. **rollback** (needs deploy, `if: failure()`)
   - Second `appleboy/ssh-action@v1` → redeploys `IMAGE_TAG=$IMAGE_TAG_PREVIOUS` via `docker compose up -d`

**Required GitHub Secrets:** `DEPLOY_HOST` (server IP), `DEPLOY_SSH_KEY` (long-lived private key, no passphrase). `GITHUB_TOKEN` is automatic.

### 3.2 `.github/workflows/check-destructive.yml` (NEW, ~50 lines) — pre-merge destructive gate

**Trigger:** `on: pull_request: types: [opened, synchronize, labeled, unlabeled]`.

**Single job `check-destructive`:**

1. Checkout (`fetch-depth: 0`)
2. `pnpm install --frozen-lockfile` (for `drizzle-kit check`)
3. Get changed files: `git diff --name-only origin/main...HEAD` → filter to `packages/db/migrations/**`
4. If no migration files changed → exit 0 (label irrelevant)
5. Scan migration diff for `(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA)|TRUNCATE|DELETE\s+FROM\s+\w+\s*;)` patterns
6. If destructive patterns found AND PR has `db-destructive` label → check:
   - PR body contains `/backup-skipped` directive → PASS (operator override)
   - PR comments contain a `*.sql.gz` URL (artifact) → PASS (backup posted)
   - Otherwise → FAIL with `::error::Destructive migration detected — please run \`pnpm db:backup && pnpm db:status\` and paste the backup URL, or add \`/backup-skipped\` directive to PR body with justification`
7. Else → PASS with summary comment

### 3.3 `.github/labeler.yml` (NEW, ~20 lines) — auto-label config

Format for `github-actions/labeler@v5`:

```yaml
db-destructive:
  - packages/db/migrations/**/*.{sql,ts}
  - packages/db/src/schema/**/*.ts
  - drizzle/**/*.{sql,ts}
```

**Wired** by adding a `labeler` job to the existing `.github/workflows/test.yml` (~10 lines), not a new workflow file.

### 3.4 Other deliverables

- **`.env.example`** (+5 lines): `─── CI Deploy (PR Slice D) ───` block with `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders.
- **`docs/runbook.md`** (+30 lines): new `## CI/CD` section after "Containerized Deploy (Docker)" — deploy flow, GitHub Secrets table, manual rollback procedure, destructive gate explanation.
- **`openspec/specs/deployment-devops/spec.md`** (~20 net lines): atomic canonical sync (B1b LESSON #1) — rewrite 4 stale scenarios IN-PLACE (no `_v2` suffix) + add 6 new scenarios.

**Rewrites (4, IN-PLACE):** `ci.yml` → `deploy.yml`; `athlos-api:` → `ghcr.io/victor0451/athlos-api:`; drop `staging` branch scenario; `ghcr.io/athlos/...` → `ghcr.io/victor0451/...` + add `vX.Y.Z` + `main-<sha>` tags.

**Adds (6):** (1) `push to main triggers deploy.yml`; (2) `deploy.yml pushes image to GHCR with three tags`; (3) `deploy.yml SSHes to server and runs docker compose pull && up -d`; (4) `deploy.yml verifies /health/ready returns 200 within 60s and rolls back on failure`; (5) `labeler.yml auto-applies db-destructive to migration PRs`; (6) `check-destructive.yml blocks PRs with destructive migrations and no backup`.

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `.github/workflows/deploy.yml` | create | ~80 | post-merge build → GHCR push → SSH → healthcheck → auto-rollback |
| `.github/workflows/check-destructive.yml` | create | ~50 | pre-merge destructive gate (runs only when `db-destructive` label is present) |
| `.github/labeler.yml` | create | ~20 | auto-label config for `db-destructive` |
| `.github/workflows/test.yml` | modify | +10 | add `labeler` job wiring `.github/labeler.yml` |
| `.env.example` | modify | +5 | `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders |
| `docs/runbook.md` | modify | +30 | new "CI/CD" section after "Containerized Deploy (Docker)" |
| `openspec/specs/deployment-devops/spec.md` | modify (atomic sync) | +20 net | 4 stale scenarios rewritten IN-PLACE + 6 new scenarios |
| `package.json` + 18 `packages/*/package.json` | modify | +1 line each | bump v0.4.5 → v0.5.0 (only in release commit) |
| `CHANGELOG.md` | modify | +5 | v0.5.0 entry under Released |
| **Total PR LoC** | | **~215** | **Under 400-line budget (~54%)** |

**Out of scope (intentionally NOT created):** `CODEOWNERS` file (separate governance work), `docker-compose.override.yml` for staging, `Dockerfile.staging`.

---

## 5. Implementation Order (9 work-units)

The 8-task structure mirrors B1b's pattern (config first, code next, atomic sync at the end, release commit last):

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-001 | Add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders | Pure config; no logic. | `.env.example` (+5) |
| TASK-002 | Create `.github/labeler.yml` | Auto-label config for `db-destructive`. | `.github/labeler.yml` (+20) |
| TASK-003 | Add `labeler` job to `test.yml` | 10-line addition; uses `actions/labeler@v5`. | `.github/workflows/test.yml` (+10) |
| TASK-004 | Create `check-destructive.yml` | Pre-merge destructive gate. Runs only when label present. | `.github/workflows/check-destructive.yml` (+50) |
| TASK-005 | Create `deploy.yml` | The big one. Build → push → SSH → healthcheck → rollback. | `.github/workflows/deploy.yml` (+80) |
| TASK-006 | Add "CI/CD" section to runbook | New section after "Containerized Deploy (Docker)". | `docs/runbook.md` (+30) |
| TASK-007 | **Atomic canonical spec sync** (B1b LESSON #1) | Rewrite 4 stale `CI/CD Pipeline` scenarios IN-PLACE + add 6 new ones. Run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` — MUST be empty before marking complete. | `openspec/specs/deployment-devops/spec.md` (+20 net) |
| TASK-008 | **Pre-closing verification** | `actionlint .github/workflows/deploy.yml` + `actionlint .github/workflows/check-destructive.yml` + `yamllint .github/labeler.yml` all pass. Manual test: open a test PR with a touched migration file, observe labeler auto-applies `db-destructive`. Test deploy via `workflow_dispatch` or push to a non-main branch. | (no files) |
| TASK-009 | **Closing release commit** (v0.4.5 → v0.5.0) | Bump `package.json` + 18 `packages/*/package.json` to `0.5.0`, add `CHANGELOG.md` entry. **Separate from feat commit** per B1b LESSON #2. | `package.json`, 18 `packages/*/package.json`, `CHANGELOG.md` |

**Commit shape (per B1b LESSON #2):**

1. `chore(ci): add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders` (TASK-001)
2. `ci(labeler): add .github/labeler.yml + labeler job` (TASK-002 + TASK-003)
3. `ci(deploy): add check-destructive pre-merge gate` (TASK-004)
4. `ci(deploy): add post-merge deploy workflow with GHCR push + SSH + auto-rollback` (TASK-005)
5. `docs(runbook): add CI/CD section explaining deploy workflow` (TASK-006)
6. `docs(spec): sync deployment-devops canonical with slice-d delta` (TASK-007)
7. `chore(release): v0.5.0` (TASK-009)

**Critical:** TASK-007 MUST verify `diff` is empty. TASK-009 release commit MUST be separate from feat commit (B1b LESSON #2). Pre-merge fix + cherry-pick reorder pattern from B1b (LESSON #3) is used if verify catches a critical issue. B1b LESSON #4 (merge BEFORE branch delete) is applied: `git branch -D feat/slice-d-ci-deploy` only AFTER `git merge --no-ff` to main.

---

## 6. Risks & Mitigations (top 5)

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| R1 | **Secret leakage: `DEPLOY_SSH_KEY` is long-lived private key** | Low / Critical | Server-side `authorized_keys` with `command="/usr/local/bin/athlos-deploy-wrapper.sh"` + `from="*.github.com,140.82.114.0/24,185.199.108.0/22,192.30.252.0/22"` + `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty` restrictions. Wrapper script only accepts `docker compose pull/up/logs/ps` commands. Runbook documents quarterly rotation. |
| R2 | **Auto-rollback on healthcheck failure** | Medium | `docker/metadata-action@v5` captures `IMAGE_TAG_PREVIOUS` via `flavor: versioned`. Second SSH step (`if: failure()`) redeploys previous tag. Pre-rollback log dump to `/tmp/deploy-fail-<ts>.log`. |
| R3 | **`db-destructive` label abuse / false negatives** | Low | Labeler is the only auto-applier; matches migration file paths (high precision). `check-destructive.yml` scans diff for destructive SQL patterns as defense in depth. `/backup-skipped` directive is logged in workflow output for post-mortem audit. CODEOWNERS deferred (separate work). |
| R4 | **Image build time + cache invalidation** | Certain / Low | `cache-from: type=gha` + `cache-to: type=gha,mode=max` drops first build from ~3 min to ~30s. `docker/build-push-action` with `push: ${{ github.event_name == 'push' }}` avoids "can't push from PR" failures. |
| R5 | **Concurrent deploys race condition** | Low | `concurrency: group: deploy, cancel-in-progress: false` queues, doesn't cancel. `docker compose up -d` is idempotent. Auto-rollback handles the "lost the race" case. |

---

## 7. Dependencies (all confirmed shipped)

| Dependency | What Slice D needs | Status |
|------------|-------------------|--------|
| **Slice C** (v0.4.5) | Real multi-stage `Dockerfile` (52L) + `docker-compose.yml` (80L) + `docker-entrypoint.sh` + `BACKUP_BEFORE_MIGRATE` env support + `docker-build-smoke` CI job | ✅ shipped 2026-06-23 |
| **Slice A** (v0.4.1) | `pnpm db:status` + `drizzle-kit check` for the drift check (referenced by `check-destructive.yml`) | ✅ shipped 2026-06-18 |
| **Slice B1a** (v0.4.3) | `BACKUP_BEFORE_MIGRATE` env var + `scripts/backup.sh` (91L) + `BACKUP_DIR=/var/backups/athlos` | ✅ shipped 2026-06-19 |
| **Slice B1b** (v0.4.4) | `B1b LESSON #1` (atomic canonical sync) — methodology, not code dep | ✅ shipped 2026-06-19 |
| **GitHub Actions** | Free for public repos | ✅ available |
| **GHCR** (`ghcr.io`) | Free for public repos, integrated with `${{ secrets.GITHUB_TOKEN }}` | ✅ available |
| **`appleboy/ssh-action@v1`** | Open-source action, 50k+ stars, no auth | ✅ available |
| **`docker/metadata-action@v5`** + `docker/build-push-action@v5` + `docker/setup-buildx-action@v3` + `docker/login-action@v3` | Open-source actions, no auth | ✅ available |
| **`github-actions/labeler@v5`** | Open-source action, no auth | ✅ available |
| **Server**: Ubuntu 24.04 LTS + Docker Engine 29 + Compose v2 + SSH key setup | Per `5-Server-Infrastructure.md` ADRs #28-#33 | ✅ verified |

**No new external dependencies.** Slice D adds zero npm packages, zero Ubuntu packages, zero third-party services.

---

## 8. Acceptance Criteria

A Slice D change is accepted when **all** of the following pass:

### 8.1 Build & lint
- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases — current count, no regression)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)
- [ ] `actionlint .github/workflows/deploy.yml` passes (0 errors)
- [ ] `actionlint .github/workflows/check-destructive.yml` passes
- [ ] `yamllint .github/labeler.yml` passes

### 8.2 Spec sync (B1b LESSON #1 — atomic)
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md` returns 0 lines of output
- [ ] All 4 stale `CI/CD Pipeline` scenarios (lines 72-105) are rewritten IN-PLACE in the canonical
- [ ] All 6 new scenarios are present in the canonical
- [ ] `database-migrations/spec.md` is unchanged (labeler + check IMPLEMENT, don't REDEFINE, the existing `db-destructive` requirement)

### 8.3 Manual deploy test
- [ ] A test PR touching `packages/db/migrations/0007_test.sql` triggers `.github/labeler.yml` to auto-apply `db-destructive` within 1 min
- [ ] Same test PR (label + no backup + no `/backup-skipped`) fails `check-destructive` with clear error
- [ ] Same test PR (label + `/backup-skipped` directive in body) passes `check-destructive`
- [ ] A `git push origin main` (or `workflow_dispatch`) triggers `deploy.yml` and completes in <5 min
- [ ] After deploy: `docker images ghcr.io/victor0451/athlos-api` shows all 3 tags
- [ ] After deploy: `curl http://$DEPLOY_HOST:3001/health/ready` returns 200
- [ ] After deploy: `docker compose ps` shows both `api` and `db` as `(healthy)`

### 8.4 Auto-rollback test
- [ ] A test commit that breaks the entrypoint triggers deploy failure
- [ ] Auto-rollback SSH step redeploys previous image tag
- [ ] After rollback: `docker compose ps` shows old image tag
- [ ] `/tmp/deploy-fail-*.log` exists on the server with failed container's logs

### 8.5 Hygiene (B1b LESSONs)
- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR back to `main`
- [ ] B1b LESSON #2: `feat/slice-d-ci-deploy` branch merged to main BEFORE `git branch -D`
- [ ] v0.4.5 → v0.5.0 bump in `package.json` only in the closing `chore(release): v0.5.0` commit
- [ ] `CHANGELOG.md` has v0.5.0 entry

### 8.6 Documentation
- [ ] `docs/runbook.md` has "CI/CD" section after "Containerized Deploy (Docker)"
- [ ] Section explains deploy workflow, GitHub Secrets table, manual rollback procedure, destructive gate
- [ ] Runbook does NOT duplicate spec scenarios (spec is source of truth; runbook links to it)

---

## 9. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines (total) | **~215** |
| Per-PR target | ≤ 400 (single PR) |
| 400-line budget risk | **LOW (~54%)** |
| Chained PRs recommended | **No** |
| Suggested split | N/A |
| Delivery strategy | single-pr |
| Chain strategy | N/A |
| Work-unit count | **9** (TASK-001..TASK-009) |
| Largest single change | TASK-005 `.github/workflows/deploy.yml` (~80 LoC) |
| Estimated reviewer time | ~15-25 min (one pass — focus on `deploy.yml` step logic + labeler paths + atomic canonical sync diff) |

---

## 10. Out of Scope (deferred, document for future)

Blue-green deploy · auto-rollback on smoke failure (healthcheck is v1 smoke) · secrets manager migration (Vault, AWS SM) · multi-region · HTTPS reverse proxy · `apps/web` containerization · monitoring stack (Prometheus/Grafana/Cockpit) · deploy previews for PRs · staging branch · OIDC deploy · CODEOWNERS file · audit event integration for destructive deploys · `pg_basebackup` / WAL archiving / PITR · S3/cloud backups (REJECTED per ADR #30) · distroless image · auto-scaling.

---

## 11. Open Questions (defaults recommended — confirm or override)

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | **Version bump:** patch `v0.4.5 → v0.4.6` or minor `v0.5.0`? | **MINOR v0.5.0** — CI deploy + label gate are new capabilities |
| Q2 | **Image tag strategy:** `latest` + `vX.Y.Z` + `main-<sha>` (3) or `latest` + `vX.Y.Z` only (2)? | **3 tags** — `main-<sha>` is the rollback anchor |
| Q3 | **Destructive gate:** strict (require backup artifact) or lenient (require artifact OR `/backup-skipped`)? | **Lenient** — `/backup-skipped` is operator override, logged in workflow output |
| Q4 | **Concurrency policy:** queue (`cancel-in-progress: false`) or cancel (`cancel-in-progress: true`)? | **Queue** — canceling mid-deploy leaves server in unknown state |

---

## 12. Ready for spec?

**Yes** — pending the four open questions above (defaults recommended). Once confirmed: `sdd-spec` → `sdd-design` → `sdd-tasks` → `sdd-apply` (B1b LESSON #1 atomic sync) → `sdd-verify` → `sdd-archive`.

**B1b LESSONs embedded in apply prompt (CRITICAL):**
1. **LESSON #1 (HIGHEST recurrence):** Apply MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` atomically; the 4 stale scenarios are rewritten IN-PLACE (no `_v2` suffix); Verify includes the diff in its checklist.
2. **LESSON #2:** Version bump + CHANGELOG MUST be in a SEPARATE closing release commit (commit shape: HEAD~2 = planning, HEAD~1 = feat + spec sync, HEAD = release).
3. **LESSON #3:** If verify catches a critical issue pre-merge, apply fix + cherry-pick reorder to preserve the 3-commit shape.
4. **LESSON #4:** ALWAYS merge feature branch to main BEFORE `git branch -D`; if lost, recover via `git branch recovery <sha>` from reflog.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-d-ci-deploy/proposal.md`*
- *Engram topic `sdd/athlos-deploy-slice-d-ci-deploy/proposal`*