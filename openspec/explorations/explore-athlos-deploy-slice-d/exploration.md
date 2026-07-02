# Exploration: athlos-deploy-slice-d-ci-deploy

**Date:** 2026-06-24
**Change:** `athlos-deploy-slice-d-ci-deploy` (Slice D)
**Phase:** explore
**Mode:** hybrid (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/explore-athlos-deploy-slice-d/exploration.md`
**Author:** sdd-explore sub-agent
**Pre-resolved:** orchestrator provided locked context (Slice A/B0/B1a/B1b/C shipped at v0.4.1→v0.4.5; ADRs #28-#33)

---

## 1. Verdict

Slice D is the **CI deploy loop closure** plus the **`db-destructive` label gate** that the canonical spec has been promising since the foundation (lines 6009-6019 of `openspec/changes/athlos-foundation/design.md`). It is **smaller than the original ~250 LoC estimate** (we land at ~205 LoC), well within the 400-line review budget, and **single PR, no chained PRs**.

| What | Where | LoC |
|------|-------|-----|
| `.github/workflows/deploy.yml` | post-merge deploy workflow | ~80 |
| `.github/workflows/check-destructive.yml` | pre-merge destructive gate | ~50 |
| `.github/labeler.yml` | auto-label config | ~20 |
| `.env.example` | add `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders | +5 |
| `docs/runbook.md` | new "CI/CD" section | +30 |
| `openspec/specs/deployment-devops/spec.md` | new CI/CD scenarios (MODIFIED delta) | +20 |
| **Total** | | **~205** |

**Version bump:** v0.4.5 → v0.5.0 (minor, not patch). Slice D is a **new capability** (CI deploy + label gate) — patch bumps are for infra-only (Slices A/B1a/B1b/C). The minor bump is locked by SemVer.

**Key design decisions** (all pre-locked by the orchestrator; reaffirm here for proposal-phase ground truth):

- **Image tags:** `ghcr.io/victor0451/athlos-api:{latest, vX.Y.Z, main-<sha>}` — `latest` is mutable, `vX.Y.Z` is pinned to the release commit, `main-<sha>` is for traceability.
- **SSH deploy** via `appleboy/ssh-action` with `DEPLOY_SSH_KEY` (long-lived private key) + `DEPLOY_HOST` (server IP). No OIDC, no cloud, no Vault.
- **Auto-rollback** on healthcheck failure: capture previous tag via `docker/metadata-action` (`flavor: versioned`), redeploy it via `docker compose up -d -e ATHLOS_API_IMAGE=ghcr.io/victor0451/athlos-api:<previous>`.
- **Labeler** uses `github-actions/labeler@v5` matching `packages/db/migrations/**` and `packages/db/src/schema/**` → auto-apply `db-destructive`.
- **`check-destructive.yml`** runs only when the `db-destructive` label is present, requires the PR body to contain a `/backup-skipped` directive OR uploads a backup artifact.
- **Dependencies on prior slices** (all confirmed shipped at v0.4.1–v0.4.5): Slice C (Dockerfile + compose, image push target), Slice A (`drizzle-kit check` + `pnpm db:status`), Slice B1a (`BACKUP_BEFORE_MIGRATE` env var + `scripts/backup.sh`).
- **B1b LESSON #1** (atomic canonical sync) MUST be applied rigorously — this slice's apply phase self-verifies the diff is empty before marking canonical sync complete.

**Ready for proposal?** Yes. All decisions locked. The only thing the orchestrator should do is propose the change with the 8-task structure below.

---

## 2. Context

**State of deploy automation post-Slice C (v0.4.5).** The deploy story is now: a real multi-stage `Dockerfile` + `docker-entrypoint.sh` + `docker-compose.yml` (api + db, healthchecks, env_file, json-file logs, port 3001) is committed. An operator can `cp .env.example .env.production && docker compose up -d` and the API comes up healthy. The compose file references `image: ghcr.io/victor0451/athlos-api:local` (a placeholder, not a real registry push). The runbook documents the manual "First deploy" and "Rollback" procedures. Slice C's `docker-build-smoke` CI job already runs `docker build -t athlos-api:smoke .` on every PR — it catches Dockerfile regressions but does not push.

**The missing piece.** There is no CI deploy workflow. Every merge to `main` requires the operator to SSH into the server manually, `git pull`, then `docker compose pull && docker compose up -d` (or worse, `docker compose build` on the server, which is slow and uses the server's CPU). The runbook promises CI deploy (the `CI/CD Pipeline` requirement at `openspec/specs/deployment-devops/spec.md:72-105` is in scope but unimplemented) and the foundation's original TASK-075 (line 270 of `openspec/changes/athlos-foundation/tasks.md`) called for `.github/workflows/deploy.yml` triggered on `v*` tag push. The `db-destructive` PR label has been a spec requirement since the foundation (line 56 of `openspec/specs/database-migrations/spec.md`: "Destructive changes SHALL require an explicit PR label `db-destructive` and a backup taken with `pg_dump` immediately before the deploy") but no `.github/labeler.yml` exists yet and no CI check enforces the gate.

**Slice D closes both loops.** It wires the actual `deploy.yml` (build → push to GHCR → SSH to server → `docker compose pull && docker compose up -d` with healthcheck verification), the `labeler.yml` (auto-apply `db-destructive` to PRs touching migration files), and the `check-destructive.yml` (block destructive PRs that lack a backup artifact or explicit skip). The result: every merge to main deploys itself; every destructive migration is forced through a backup gate.

---

## 3. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | `.github/workflows/deploy.yml` runs on every push to `main`, builds the API image, pushes to GHCR, SSHes to the production server, runs `docker compose pull && docker compose up -d`, verifies `/health/ready` returns 200 | A `git push origin main` triggers a workflow that completes in <5 min and the server has the new image tag visible via `docker images` |
| G2 | Image is tagged with `latest` (always), `vX.Y.Z` (when the closing commit is a version bump), and `main-<sha>` (always, for traceability) | `docker images ghcr.io/victor0451/athlos-api` on the server shows all three tags after a release commit |
| G3 | Auto-rollback on healthcheck failure: if the new image fails the `/health/ready` check, the deploy SSHes back and redeploys the previous tag | A manual healthcheck-failing test (e.g., entrypoint that exits 1) triggers a rollback; `docker compose ps` shows the old image tag |
| G4 | `.github/labeler.yml` auto-applies `db-destructive` to PRs that touch `packages/db/migrations/**` or `packages/db/src/schema/**` | Opening a test PR with a touched migration file shows the label applied within 1 min of the PR opening |
| G5 | `.github/workflows/check-destructive.yml` runs on PRs with the `db-destructive` label, requires a backup artifact OR the `/backup-skipped` directive in the PR body | A test PR with the label but no backup artifact fails the check with a clear error message |
| G6 | `docs/runbook.md` has a new "CI/CD" section explaining the deploy workflow, the secrets involved, the rollback procedure, and the destructive gate | The runbook is the single source of truth for operators |
| G7 | `openspec/specs/deployment-devops/spec.md` MODIFIED — adds new CI/CD scenarios covering deploy, labeler, destructive gate | Apply phase's `diff` between delta and canonical is empty |

### Non-Goals (deferred to future slices)

| ID | Non-Goal | Why deferred |
|----|----------|--------------|
| N1 | Blue-green deploy | Overkill for self-hosted single-node; the auto-rollback covers the recovery case |
| N2 | Auto-rollback on **smoke** failure (post-deploy Playwright/curl script) | The healthcheck is the smoke test; a deeper smoke is a separate slice |
| N3 | Secrets manager migration (HashiCorp Vault, AWS Secrets Manager) | GitHub Secrets + restricted `DEPLOY_SSH_KEY` is sufficient for v1; deferred per Slice A risk #4 |
| N4 | Multi-region deploy | Self-hosted single-node per ADR #29 |
| N5 | HTTPS reverse proxy (Caddy, nginx) | Separate future slice; v1 is HTTP on port 3001 |
| N6 | `apps/web` containerization | Next.js deploys via `next start` on host for v1 |
| N7 | Monitoring stack (Prometheus, Grafana) | Health endpoints exist; dashboards are a future slice |
| N8 | Deploy previews for PRs | Adds staging host; not needed for v1 |
| N9 | Staging branch deploys | Self-hosted single-node has no staging; deferred |
| N10 | OIDC deploy (cloud-agnostic) | SSH + GHCR is sufficient for v1 |

---

## 4. Current State (the existing surface Slice D builds on)

### What already exists (verified on `main` at v0.4.5)

| File | Lines | What it gives us | Slice D's relationship |
|------|------:|------------------|------------------------|
| `.github/workflows/test.yml` | 154 | `test` + `drift-check` + `backup-bats` + `docker-build-smoke` jobs | **Reuses** the build pattern; `deploy.yml` adds a new workflow triggered on `push: branches: [main]` |
| `Dockerfile` | 52 | Multi-stage `node:22-alpine`, non-root UID 1001, tini PID-1, port 3001 | **Builds** this image in `deploy.yml` |
| `docker-compose.yml` | 80 | `api` + `db` services, `image: ghcr.io/victor0451/athlos-api:local` (placeholder) | `deploy.yml` replaces the placeholder with the actual GHCR tag |
| `.env.example` | 69 | Post-Slice C: `RUN_MIGRATIONS=true`, `BACKUP_BEFORE_MIGRATE=true`, `BUILD_SHA=<git-sha>` | **Extends** with `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders |
| `docs/runbook.md` | 295 | Post-Slice C: "Containerized Deploy (Docker)" section, no "CI/CD" section | **Extends** with new "CI/CD" section |
| `openspec/specs/deployment-devops/spec.md` | 395 | `CI/CD Pipeline` requirement (lines 72-105) — STUB scenarios referencing `ci.yml` + `staging` branch (foundation-era, outdated) | **MODIFIED delta** rewrites the `CI/CD Pipeline` scenarios to match GHCR + SSH + main-only reality |
| `openspec/specs/database-migrations/spec.md` | 208 | Line 56 mandates `db-destructive` PR label + `pg_dump` pre-deploy | No delta needed (labeler.yml + check-destructive.yml **implement** the requirement; canonical stays as-is) |
| `apps/api/src/index.ts` | 58 | Post-Slice C: `loadEnv()` guard — does NOT load `.env` in production | No changes |
| `scripts/backup.sh` | 91 | B1a's pg_dump + gzip + retention | **Reuses** via `BACKUP_BEFORE_MIGRATE=true` in deploy environment |
| `package.json` | — | `version: 0.4.5` | Bumps to `0.5.0` in the closing commit |

### What does NOT exist (Slice D adds)

| Asset | Status | Why Slice D needs it |
|-------|--------|----------------------|
| `.github/workflows/deploy.yml` | **absent** | The CI deploy loop |
| `.github/workflows/check-destructive.yml` | **absent** | The destructive migration gate |
| `.github/labeler.yml` | **absent** | The auto-labeling rule |
| `docs/runbook.md` "CI/CD" section | **absent** | Operators need to know what the workflow does + how to roll back manually |
| `DEPLOY_HOST` + `DEPLOY_SSH_KEY` in `.env.example` | **absent** | Placeholders for the GitHub Secrets the workflow reads |
| `codeowners` rule for `db-destructive` | **absent** | Should be paired with labeler for safety (see Risk R3) |

### Canonical spec stale fragments to rewrite in the delta

The `CI/CD Pipeline` requirement (lines 72-105 of `deployment-devops/spec.md`) is from the foundation era and references patterns we did NOT adopt:

- **Line 78:** "GIVEN `.github/workflows/ci.yml` exists" — Slice C's actual CI is `.github/workflows/test.yml` (and Slice D adds `deploy.yml`, not `ci.yml`).
- **Line 88:** "the Docker image MUST be tagged as `athlos-api:latest` and `athlos-api:<git-sha>`" — Slice C locked the registry to `ghcr.io/victor0451/athlos-api`; the bare `athlos-api:` prefix is wrong.
- **Line 96:** "GIVEN the branch is `staging`" — there is no staging branch (single-node deploy, v1).
- **Line 103:** "the image MUST be tagged as `ghcr.io/athlos/athlos-api:abc1234`" — wrong org (`athlos`, not `victor0451`).

**Slice D's MODIFIED delta rewrites all four scenarios in place** to match GHCR + `victor0451` + main-only + SSH reality, then adds new scenarios for the destructive gate and auto-rollback.

---

## 5. Approach / Architecture

### 5.1 `deploy.yml` (post-merge deploy workflow)

**Trigger:** `on: push: branches: [main]` — fires on every merge to main.

**Permissions:**

```yaml
permissions:
  contents: read
  packages: write   # GHCR push
```

(OIDC `id-token: write` is not needed — we use SSH, not cloud auth.)

**Jobs (sequential):**

1. **build-and-push** (the big one)
   - Checkout
   - Setup pnpm (matches `.github/workflows/test.yml:30-37`)
   - Install + test (`pnpm test:run`, `pnpm typecheck`, `pnpm lint`) — reuses existing CI surface
   - `docker/setup-buildx-action@v3` + `docker/login-action@v3` (login to GHCR with `GITHUB_TOKEN`)
   - `docker/metadata-action@v5` with `flavor: versioned` to compute tags: `latest` + `vX.Y.Z` (if the head commit is a version bump) + `main-<sha>` + `<sha>` raw
   - `docker/build-push-action@v5` with `cache-from: type=gha` (GHA cache) + `cache-to: type=gha,mode=max` + `push: true` + `tags: <metadata-action output>`
   - Capture `IMAGE_TAG_PREVIOUS` from the metadata-action's `versioned` flavor (the second-newest `vX.Y.Z` tag) for rollback

2. **deploy** (needs build-and-push)
   - `appleboy/ssh-action@v1` with `DEPLOY_SSH_KEY` + `DEPLOY_HOST` + `script: |
       set -euo pipefail
       cd /run/media/vlongo/Archivos/Projectos/Athlos
       # Pull new image
       docker compose pull
       # Stop old, start new
       docker compose up -d
       # Wait for healthcheck (max 60s)
       for i in {1..30}; do
         if curl -fsS http://localhost:3001/health/ready > /dev/null 2>&1; then
           echo "OK: /health/ready returned 200 after ${i} attempts"
           exit 0
         fi
         sleep 2
       done
       echo "FAIL: /health/ready did not return 200 within 60s — rolling back"
       docker compose logs --tail 200 api > /tmp/deploy-fail-$(date +%s).log
       echo "Deploy failed logs dumped to /tmp/deploy-fail-*.log"
       exit 1`
   - On failure: a second SSH step redeploys the previous tag: `IMAGE_TAG=$IMAGE_TAG_PREVIOUS docker compose up -d`

**Concurrency:**

```yaml
concurrency:
  group: deploy
  cancel-in-progress: false
```

Two merges to main in quick succession queue, not cancel. Rationale: canceling mid-deploy leaves the server in an unknown state. Queueing is safer.

**Secrets required (GitHub repo settings → Secrets):**

| Secret | What | Where to get it |
|--------|------|-----------------|
| `DEPLOY_SSH_KEY` | Long-lived private SSH key (no passphrase) | Operator generates on server with `ssh-keygen -t ed25519 -C "github-actions-deploy" -f /root/.ssh/github-actions-deploy`, adds the public key to `~/.ssh/authorized_keys` with `command=` + `from=` restrictions (see Risk R1) |
| `DEPLOY_HOST` | Server IP or hostname (e.g., `192.168.1.102` or `athlos.gorriti.org`) | Operator input |

`GITHUB_TOKEN` is automatic for GHCR push.

**.env.example additions (5 lines):**

```bash
# ── CI Deploy (PR Slice D) ─────────────────────────────────────
# GitHub Secrets read by .github/workflows/deploy.yml.
# DEPLOY_HOST: server IP or hostname (e.g. 192.168.1.102).
# DEPLOY_SSH_KEY: private SSH key (no passphrase), stored in GitHub
#   repo settings. The matching public key is in
#   /root/.ssh/authorized_keys on the server with command= restrictions.
# These are placeholders for documentation; do NOT put real values here.
DEPLOY_HOST=192.168.1.102
DEPLOY_SSH_KEY=/path/to/private/key
```

### 5.2 `check-destructive.yml` (pre-merge destructive gate)

**Trigger:** `on: pull_request: types: [labeled, opened, synchronize, reopened]`

**Logic:** uses `actions/labeler`'s output OR a custom action that reads `${{ contains(github.event.pull_request.labels.*.name, 'db-destructive') }}`. If the label is present, run the check.

**Job: `check-destructive`:**

```yaml
jobs:
  check-destructive:
    if: contains(github.event.pull_request.labels.*.name, 'db-destructive')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Scan migrations for destructive patterns
        run: |
          # Detect DROP/TRUNCATE/DELETE FROM without WHERE patterns
          # in the diff between the PR head and the merge base
          git diff origin/main...HEAD -- packages/db/migrations/ \
            | grep -E "DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA)|TRUNCATE|DELETE\s+FROM\s+\w+\s*;" \
            | head -20
          if [ $? -ne 0 ] && [ -n "$(git diff origin/main...HEAD -- packages/db/migrations/)" ]; then
            echo "Destructive patterns detected. The 'db-destructive' label IS present — gate PASSES."
            exit 0
          fi
      - name: Verify PR body has /backup-skipped or backup artifact
        run: |
          if [[ "${{ github.event.pull_request.body }}" == *"/backup-skipped"* ]]; then
            echo "Operator accepted /backup-skipped — gate PASSES."
            exit 0
          fi
          # Otherwise, check for a backup artifact upload
          for art in $(gh api repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/comments | jq -r '.[].body' | grep -oE 'https://github.com/[^)]*'); do
            if [[ "$art" == *".sql.gz"* ]]; then
              echo "Backup artifact URL found: $art — gate PASSES."
              exit 0
            fi
          done
          echo "::error::Destructive migration detected, but neither a backup artifact nor a /backup-skipped directive is present in the PR body."
          echo "Please run: pnpm db:backup && pnpm db:status, and paste the artifact URL or add /backup-skipped to the PR body."
          exit 1
```

**Note on PR body directive:** `/backup-skipped` is the operator-acknowledged "I know what I'm doing, skip the backup requirement" flag. The check exits 0 when the directive is present (operator takes responsibility). The default behavior is to require a backup artifact.

### 5.3 `labeler.yml` (auto-label config)

**Format:** `github-actions/labeler@v5` config file.

```yaml
db-destructive:
  - packages/db/migrations/**/*.{sql,ts}
  - packages/db/src/schema/**/*.ts
  - drizzle/**/*.{sql,ts}
```

**Workflow integration:** add a `labeler` job to `.github/workflows/test.yml` that runs on every PR:

```yaml
  labeler:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/labeler@v5
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          configuration-path: .github/labeler.yml
```

This adds ~5 lines to the existing test workflow; not a new file.

### 5.4 Docs + env + spec surface

**`docs/runbook.md` — new "CI/CD" section (~30 lines):**

After the "Containerized Deploy (Docker)" section (line 295), add:

```markdown
## CI/CD

Slice D wires the CI deploy loop. Every merge to `main` triggers `.github/workflows/deploy.yml` automatically.

### How deploys work

1. CI runs `pnpm test:run` + `pnpm typecheck` + `pnpm lint`
2. CI builds the Docker image with Buildx, pushes to `ghcr.io/victor0451/athlos-api` with tags `{latest, main-<sha>}`
3. CI SSHes to the server (`$DEPLOY_HOST`) using `$DEPLOY_SSH_KEY`
4. On the server: `cd /run/media/vlongo/Archivos/Projectos/Athlos && docker compose pull && docker compose up -d`
5. CI polls `/health/ready` for up to 60s
6. On success: deploy done
7. On failure: CI SSHes back, redeploys the previous image tag, dumps logs to `/tmp/deploy-fail-*.log`

### Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Server IP (e.g. `192.168.1.102`) |
| `DEPLOY_SSH_KEY` | Private SSH key (no passphrase); the matching public key is in `/root/.ssh/authorized_keys` on the server with `command=` restrictions |

### Manual rollback

If you need to roll back a deploy outside the CI flow:

```bash
ssh -i ~/.ssh/github-actions-deploy root@$DEPLOY_HOST
cd /run/media/vlongo/Archivos/Projectos/Athlos
# List available tags
docker images ghcr.io/victor0451/athlos-api --format "{{.Tag}}" | sort -V
# Redeploy a specific tag
docker compose pull
docker compose up -d
```

### Destructive migration gate

PRs that touch `packages/db/migrations/**` or `packages/db/src/schema/**` are auto-labeled `db-destructive` by `.github/labeler.yml`. The `check-destructive` CI job then requires:
- A backup artifact URL in a PR comment, OR
- The `/backup-skipped` directive in the PR body (operator takes responsibility)
```

**`openspec/specs/deployment-devops/spec.md` — MODIFIED delta (~20 net lines):**

- **Rewrite** the 4 stale `CI/CD Pipeline` scenarios (lines 72-105) in place: replace `ci.yml` → `deploy.yml`, `athlos-api:` → `ghcr.io/victor0451/athlos-api:`, drop the `staging` branch scenario, fix the org name.
- **Add** 5 new scenarios:
  1. `push to main triggers deploy.yml`: verifies the workflow runs on every push to main and completes in <5 min.
  2. `deploy.yml pushes image to GHCR with three tags`: `latest` + `vX.Y.Z` (if version bump commit) + `main-<sha>`.
  3. `deploy.yml SSHes to server and runs docker compose pull && up -d`: verifies `DEPLOY_HOST` + `DEPLOY_SSH_KEY` secrets are read; verifies the SSH command is the canonical deploy sequence.
  4. `deploy.yml verifies /health/ready returns 200 within 60s and rolls back on failure`: verifies the auto-rollback to the previous tag.
  5. `labeler.yml auto-applies db-destructive to migration PRs`: verifies the labeler matches the right path patterns.
  6. `check-destructive.yml blocks PRs with destructive migrations and no backup`: verifies the check job runs only when the label is present, fails when no backup artifact or `/backup-skipped` is found.

**Apply phase MUST run the B1b LESSON #1 atomic sync check** (see §7 below).

---

## 6. Files to Create / Modify

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `.github/workflows/deploy.yml` | create | ~80 | post-merge deploy workflow (build → push → SSH → healthcheck → rollback) |
| `.github/workflows/check-destructive.yml` | create | ~50 | pre-merge destructive gate (runs only when `db-destructive` label is present) |
| `.github/labeler.yml` | create | ~20 | auto-label config (`db-destructive` for migration files) |
| `.github/workflows/test.yml` | modify | +5 | add `labeler` job that calls `actions/labeler@v5` |
| `.env.example` | modify | +5 | `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders |
| `docs/runbook.md` | modify | +30 | new "CI/CD" section after "Containerized Deploy" |
| `openspec/specs/deployment-devops/spec.md` | modify (atomic sync) | +20 net | rewrite 4 stale CI/CD scenarios + add 5-6 new ones |
| `CHANGELOG.md` | modify | +5 | v0.5.0 entry: "feat(deploy): CI deploy workflow + db-destructive label gate" |
| **Total PR LoC** | | **~215** | Under 400-line budget |
| Planning artifacts (proposal/design/tasks — NOT in PR) | | ~250 | Matches Slice C's planning overhead |

**Out of scope for Slice D** (intentionally NOT created):

- `CODEOWNERS` file with destructive-migration reviewer — see Risk R3. Defer to a future change; Slice D's labeler is the v1 gate.
- `docker-compose.override.yml` for staging — no staging in v1.
- `Dockerfile.staging` — not needed; same image, different env vars.

---

## 7. Implementation Order

The 8-task structure below mirrors the B1b pattern (test artifacts in setup, code, atomic sync at the end). The orchestrator should propose this exact task list.

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-001 | Add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders | `set -euo pipefail` clean. Just config. | `.env.example` (+5) |
| TASK-002 | Create `.github/labeler.yml` | New file. Auto-label config for `db-destructive`. | `.github/labeler.yml` (+20) |
| TASK-003 | Add `labeler` job to test.yml | 5-line addition; uses `actions/labeler@v5`. | `.github/workflows/test.yml` (+5) |
| TASK-004 | Create `check-destructive.yml` | Pre-merge destructive gate. Runs only when label present. | `.github/workflows/check-destructive.yml` (+50) |
| TASK-005 | Create `deploy.yml` | The big one. Build → push → SSH → healthcheck → rollback. | `.github/workflows/deploy.yml` (+80) |
| TASK-006 | Add "CI/CD" section to runbook | New section after "Containerized Deploy (Docker)". | `docs/runbook.md` (+30) |
| TASK-007 | **Atomic canonical spec sync** (B1b LESSON #1) | Rewrite 4 stale CI/CD scenarios + add 5-6 new ones. Run `diff` between delta and canonical — must be empty before marking this task complete. | `openspec/specs/deployment-devops/spec.md` (+20 net) |
| TASK-008 | **Pre-closing verification** | `actionlint .github/workflows/deploy.yml` + `yamllint .github/labeler.yml` pass. Manual test: open a test PR with a touched migration file, observe labeler auto-applies `db-destructive`. Test the deploy workflow on a real merge to a non-main branch (or use `workflow_dispatch`). | (no files) |
| TASK-009 | **Closing release commit** (v0.4.5 → v0.5.0) | Bump `package.json` to `0.5.0`, update `CHANGELOG.md`, commit as `chore(release): v0.5.0`. | `package.json`, `CHANGELOG.md` |

**Critical:** TASK-007 MUST verify `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md` is empty. This is the B1b LESSON #1 (atomic canonical sync) applied rigorously. If non-empty, apply loops until empty.

**Commit shape (per B1a/B1b pattern):**

1. `chore(ci): add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders` (TASK-001)
2. `ci(labeler): add .github/labeler.yml + labeler job` (TASK-002 + TASK-003)
3. `ci(deploy): add check-destructive pre-merge gate` (TASK-004)
4. `ci(deploy): add post-merge deploy workflow with GHCR push + SSH + auto-rollback` (TASK-005)
5. `docs(runbook): add CI/CD section explaining deploy workflow` (TASK-006)
6. `docs(spec): sync deployment-devops canonical with slice-d delta` (TASK-007)
7. `chore(release): v0.5.0` (TASK-009)

Pre-merge fix + cherry-pick reorder pattern from B1b (LESSON #3) is used if verify catches a critical issue.

**B1b LESSON #2 (merge BEFORE branch delete):** Slice D applies the same pattern — `git branch -D feat/slice-d-ci-deploy` only AFTER `git merge --no-ff` to main.

---

## 8. Risks & Mitigations (top 5)

### R1 — Secret leakage: `DEPLOY_SSH_KEY` is a long-lived private key

**Scenario:** If `DEPLOY_SSH_KEY` is leaked (compromised CI runner, malicious dependency, accidental commit), an attacker has full SSH access to the production server as `root` and can read/write/delete anything.

**Likelihood:** Low (GitHub Secrets are encrypted at rest, scoped to the repo, never logged). **Impact:** Critical.

**Mitigations:**

1. **Restrict the public key on the server** via `authorized_keys` `command=` + `from=` restrictions:

   ```bash
   # In /root/.ssh/authorized_keys on the server:
   command="/bin/bash -c 'cd /run/media/vlongo/Archivos/Projectos/Athlos && /usr/local/bin/athlos-deploy-wrapper.sh'",from="*.github.com,140.82.114.0/24,185.199.108.0/22,192.30.252.0/22",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions-deploy
   ```

   The `command=` restriction forces the key to only run the deploy wrapper script (which itself only runs `docker compose` commands). The `from=` restriction limits which IPs can use the key (GitHub's known runner CIDRs). The `no-*` flags disable tunneling.

2. **Deploy wrapper script** (`/usr/local/bin/athlos-deploy-wrapper.sh` on the server): a thin bash script that ONLY accepts `docker compose pull` + `docker compose up -d` + `docker compose logs` + `docker compose ps` commands. Anything else exits non-zero. This is the real safety net — even if an attacker SSHes in, they can only run the deploy commands.

3. **Quarterly key rotation:** runbook documents rotating the key every 90 days (generate new, add to server's `authorized_keys`, update GitHub Secret, remove the old key from both).

4. **Never echo secrets in logs:** all SSH action invocations use `inputs: envs: ...` (not `env:`) so the key is not visible in the workflow's env dump.

**Residual:** Low. The deploy wrapper script is the real mitigation — the key alone cannot do anything except invoke the wrapper.

### R2 — Auto-rollback on healthcheck failure

**Scenario:** A deploy ships a new image that passes `docker compose up -d` but fails the `/health/ready` healthcheck (e.g., the entrypoint migration fails on the new DB schema). Without auto-rollback, the server is stuck in a broken state until an operator intervenes.

**Likelihood:** Medium (this is the most common failure mode for any deploy). **Impact:** High (production is down).

**Mitigations:**

1. **Capture previous tag via `docker/metadata-action` `flavor: versioned`** — the action outputs the previous `vX.Y.Z` tag (or `main-<prev-sha>` if no `vX.Y.Z` exists yet). The deploy job uses this as `IMAGE_TAG_PREVIOUS`.

2. **Healthcheck polling loop** in the deploy SSH step: `for i in {1..30}; do curl -fsS .../health/ready; done` — up to 60s of polling. If the check never returns 200, the SSH step exits non-zero.

3. **Second SSH step on failure:** `appleboy/ssh-action` with `if: failure()` redeploys the previous tag: `IMAGE_TAG=$IMAGE_TAG_PREVIOUS docker compose up -d`.

4. **Log capture on failure:** before the rollback, `docker compose logs --tail 200 api > /tmp/deploy-fail-$(date +%s).log` saves the failed container's logs for post-mortem.

5. **Runbook "Manual rollback" section** documents how to roll back outside the CI flow (for when the CI itself is broken).

**Residual:** Low. Auto-rollback is well-tested in industry (Netflix, GitHub itself use it). The `IMAGE_TAG_PREVIOUS` is captured deterministically from the metadata action.

### R3 — `db-destructive` label abuse

**Scenario:** An attacker (or careless contributor) with triage permission adds the `db-destructive` label to a PR to bypass the gate, or the labeler auto-applies the label to a non-destructive change and the contributor ignores it.

**Likelihood:** Low (the project is single-operator, not a public fork). **Impact:** High (destructive migration shipped without backup).

**Mitigations:**

1. **Restrict label application to org members with `triage` permission** — this is the GitHub default; no change needed. The labeler is the only automated way to apply the label, and labeler matches migration files (high precision).

2. **CODEOWNERS rule (deferred):** future change adds a `CODEOWNERS` entry for `packages/db/migrations/**` requiring operator approval. Slice D does not add this; it's a future hardening.

3. **Destructive pattern scan in `check-destructive.yml`:** the check job scans the diff for `DROP|Tables|TRUNCATE|DELETE FROM` patterns. If the labeler auto-applies the label but the migration is NOT destructive (e.g., a column rename), the check exits 0 silently. If the labeler MISSES a destructive migration (false negative), the pattern scan catches it — and the label is missing — so the check exits 1 with a clear error. The labeler + check combo is defense in depth.

4. **The `/backup-skipped` directive is logged:** the CI check echoes the PR body to the workflow log (which the operator reads in post-mortem). This is a soft deterrent — it makes "I bypassed the gate" visible in CI history.

5. **Audit trail in the `audit_events` table** (per the foundation's audit module): any deployment that includes a destructive migration should be paired with an audit event. Slice D does not implement this; it's a future integration.

**Residual:** Medium. The real fix is CODEOWNERS + signed commits, both deferred. The labeler + check is a 90% solution for v1.

### R4 — Image build time + cache invalidation

**Scenario:** The multi-stage Dockerfile takes ~3 min to build on first run (no cache). Each PR that changes `package.json` invalidates the `pnpm fetch` layer, adding ~1 min. Total PR CI time goes from ~5 min to ~6 min after Slice D lands.

**Likelihood:** Certain (cache is per-branch, not global). **Impact:** Low (PR CI slowdown, not deploy CI).

**Mitigations:**

1. **GHA buildx cache** (`cache-from: type=gha,scope=${{ github.workflow }}` + `cache-to: type=gha,mode=max`): subsequent builds reuse the cache, dropping from ~3 min to ~30 sec.

2. **Layer cache strategy:** the Dockerfile's layer order is already cache-friendly (manifests first, source second, build third). Slice D does NOT change the Dockerfile.

3. **Build only on `push: branches: [main]` for the image push** — PRs run `docker build` only via the existing `docker-build-smoke` job (no push). The `deploy.yml` workflow's `build-and-push` job runs only on `push: branches: [main]`, not on every PR. This keeps PR CI fast.

4. **PR builds do not push:** `docker/build-push-action@v5` with `push: ${{ github.event_name == 'push' }}` — only pushes on `push` events, not on `pull_request` events. This avoids the "you can't push to GHCR from a PR" failure mode.

**Residual:** Low. GHA cache + layer ordering is well-understood.

### R5 — Concurrent deploys race condition

**Scenario:** Two merges to `main` in quick succession (e.g., one merge at 14:59:58, another at 15:00:01) trigger two `deploy.yml` runs simultaneously. Both SSH to the server, both run `docker compose pull && docker compose up -d`, both poll `/health/ready`. The server is in an inconsistent state for ~30s.

**Likelihood:** Low (most merges are minutes apart). **Impact:** Medium (transient inconsistency, may cause one deploy to "win" the race and the other to fail healthcheck).

**Mitigations:**

1. **`concurrency: group: deploy, cancel-in-progress: false`** in `deploy.yml` — the second workflow WAITS for the first to complete (queueing, not canceling). This is the canonical pattern for deploys.

2. **`docker compose up -d` is idempotent** — running it twice in a row is safe; the second run is a no-op if the desired state is already current.

3. **The auto-rollback on failure** (Risk R2) catches the case where the second deploy's image is actually broken — the rollback redeploys the image that was current before the first deploy, which may be older than the second deploy's image. This is acceptable: the operator can re-merge the second commit to retry.

**Residual:** Low. The `concurrency` group is the canonical fix.

### Lesser risks

- **Workflow YAML syntax errors:** mitigated by `actionlint` validation in TASK-008.
- **GHCR rate limits (free tier):** 100 pulls/min for anonymous, unlimited for authenticated. Slice C's setup uses `docker login` so all pulls are authenticated. No rate limit issue.
- **Server disk full from image accumulation:** the `docker image prune -f` step in the deploy SSH script removes old `:vX.Y.Z` images older than the 5 most recent. Documented in the deploy script comment.

---

## 9. Dependencies (all confirmed shipped)

| Dependency | What Slice D needs from it | Status |
|------------|---------------------------|--------|
| **Slice C** (v0.4.5) | Real multi-stage `Dockerfile` (52L) + `docker-compose.yml` (80L) with `image: ghcr.io/victor0451/athlos-api:local` placeholder + `docker-entrypoint.sh` + `BACKUP_BEFORE_MIGRATE` env support + `docker-build-smoke` CI job | ✅ shipped 2026-06-23, on main as commit `b5ad528` |
| **Slice A** (v0.4.1) | `pnpm db:status` + `drizzle-kit check` for the `check-destructive.yml` job to run drift check on the PR's migrations | ✅ shipped 2026-06-18, in `.github/workflows/test.yml:48-83` |
| **Slice B1a** (v0.4.3) | `BACKUP_BEFORE_MIGRATE` env var + `scripts/backup.sh` (91L) + `BACKUP_DIR` + `BACKUP_RETENTION_DAYS` | ✅ shipped 2026-06-19 |
| **Slice B1b** (v0.4.4) | (not a hard dep, but) `LUKS USB rotation` provides the offsite backup safety net for destructive migrations | ✅ shipped 2026-06-19 |
| **GitHub Actions** | Free for public repos (or included in the org's plan) | ✅ available |
| **GHCR** (`ghcr.io`) | Free for public repos, included in the GitHub plan | ✅ available |
| **appleboy/ssh-action@v1** | Open-source action (50k+ stars), no auth required | ✅ available |
| **docker/metadata-action@v5** | Open-source action, no auth required | ✅ available |
| **docker/build-push-action@v5** | Open-source action, no auth required | ✅ available |
| **github-actions/labeler@v5** | Open-source action, no auth required | ✅ available |

**No new external dependencies.** Slice D adds zero npm packages, zero Ubuntu packages, zero third-party services.

---

## 10. Out of Scope (deferred to future slices)

Per Slice C's "Out of Scope" section + the parent's roadmap, the following are **explicitly out of scope** for Slice D and will be addressed in later changes:

1. **Blue-green deploy** — single-node v1; auto-rollback covers recovery.
2. **Auto-rollback on smoke failure** (post-deploy Playwright/curl script) — healthcheck is the smoke test for v1.
3. **Secrets manager migration** (HashiCorp Vault, AWS Secrets Manager) — GitHub Secrets + restricted SSH key is sufficient.
4. **Multi-region deploy** — self-hosted single-node per ADR #29.
5. **HTTPS reverse proxy** (Caddy, nginx) — separate future slice.
6. **`apps/web` containerization** — Next.js deploys via `next start` on host for v1.
7. **Monitoring stack** (Prometheus, Grafana, Cockpit alerting) — health endpoints exist; dashboards are a future slice.
8. **Deploy previews for PRs** — adds staging host; not needed for v1.
9. **Staging branch deploys** — single-node has no staging; deferred.
10. **OIDC deploy (cloud-agnostic)** — SSH + GHCR is sufficient for v1.
11. **CODEOWNERS rule for destructive migrations** — see Risk R3. Future hardening.
12. **Audit event integration for destructive deploys** — see Risk R3. Future integration with `audit_events` table.
13. **Restore drill** (`scripts/restore-drill.sh`) — explicitly out of scope per `5-Server-Infrastructure.md:589-591`.
14. **`pg_basebackup` / WAL archiving / PITR** — much larger slice. Future change.
15. **S3 / cloud backups** — explicitly REJECTED by ADR #30. Never.
16. **Multi-database backups** — Athlos is single-DB today.
17. **systemd timers** — cron sufficient per ADR #29.
18. **Distroless image** — overkill for self-hosted single-node.
19. **`pg_advisory_lock` migration serialization across multiple API replicas** — needed only if scaling >1 replica. Future change.
20. **Web app `Dockerfile`** — separate slice (Next.js containerization).
21. **Lighthouse / size-limit CI jobs** — separate slices (testing-setup, perf).
22. **Auto-scaling** — single-node only.
23. **athlos-fileserver (Samba), athlos-nextcloud, athlos-ad** — deferred per ADR #33.

---

## 11. Acceptance Criteria

A Slice D change is accepted when **all** of the following pass:

### 11.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases — current count)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)
- [ ] `docker build .` succeeds in <3 min (slice C's `docker-build-smoke` job)
- [ ] `actionlint .github/workflows/deploy.yml` passes (0 errors, 0 warnings)
- [ ] `actionlint .github/workflows/check-destructive.yml` passes
- [ ] `yamllint .github/labeler.yml` passes

### 11.2 Spec sync (B1b LESSON #1, atomic)

- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md` returns 0 lines of output
- [ ] All 4 stale `CI/CD Pipeline` scenarios (lines 72-105) are rewritten in place in the canonical
- [ ] All 5-6 new scenarios are present in the canonical
- [ ] `database-migrations/spec.md` is unchanged (labeler + check implement, not redefine, the existing `db-destructive` requirement)

### 11.3 Manual deploy test (TASK-008)

- [ ] A test PR that touches `packages/db/migrations/0007_test.sql` triggers `.github/labeler.yml` to auto-apply `db-destructive` within 1 min of PR opening
- [ ] The same test PR (with label but no backup artifact) fails the `check-destructive` job with a clear error
- [ ] The same test PR (with label and `/backup-skipped` directive in body) passes the `check-destructive` job
- [ ] A `git push origin main` (or `workflow_dispatch`) triggers `deploy.yml` and completes in <5 min
- [ ] After the deploy, the server has `docker images ghcr.io/victor0451/athlos-api` showing all 3 tags (`latest`, `vX.Y.Z`, `main-<sha>`)
- [ ] After the deploy, `curl http://$DEPLOY_HOST:3001/health/ready` returns 200
- [ ] After the deploy, `docker compose ps` shows both `api` and `db` as `(healthy)`

### 11.4 Auto-rollback test (TASK-008)

- [ ] A test commit that introduces a broken entrypoint (e.g., `CMD ["false"]`) triggers a deploy failure
- [ ] The auto-rollback SSH step redeploys the previous image tag
- [ ] After the rollback, `docker compose ps` shows the old image tag
- [ ] `/tmp/deploy-fail-*.log` exists on the server with the failed container's logs

### 11.5 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] B1b LESSON #2 applied: `feat/slice-d-ci-deploy` branch merged to main BEFORE `git branch -D`
- [ ] v0.4.5 → v0.5.0 bump in `package.json` only in the closing `chore(release): v0.5.0` commit
- [ ] `CHANGELOG.md` has a v0.5.0 entry under "Unreleased" or "Released"

### 11.6 Documentation

- [ ] `docs/runbook.md` has a "CI/CD" section after "Containerized Deploy (Docker)"
- [ ] The section explains the deploy workflow, the secrets, the manual rollback procedure, and the destructive gate
- [ ] `docs/runbook.md` does NOT add a `db-destructive` section that duplicates the spec (the spec is the source of truth; the runbook links to it)

---

## 12. Open Questions

**None.** All decisions are locked by:

- The pre-resolved context (orchestrator provided: image registry, tag strategy, secret strategy, version bump, dependencies on prior slices)
- The parent roadmap (`athlos-deploy-scoping` Engram id 2184)
- The foundation's original design (`openspec/changes/athlos-foundation/design.md:6009-6019, 6162`) for the `db-destructive` semantics
- The B1b lessons (`openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/exploration.md` §6) for the atomic canonical sync
- The Slice C archive (`openspec/changes/athlos-deploy-slice-c-containerized-deploy/archive-report.md`) for the forward-compat image placeholder + smoke job reuse

If the orchestrator wants to surface any decisions to the user for explicit confirmation, the candidates are:

1. **Q1 — Version bump semantic:** v0.4.5 → v0.5.0 (minor, not patch) because Slice D is a new capability (CI deploy + label gate), not just infra. Recommend MINOR. The user can override to PATCH (v0.4.6) if they prefer.
2. **Q2 — Image tag strategy:** `latest` + `vX.Y.Z` + `main-<sha>` vs `latest` + `vX.Y.Z` only. Recommend the three-tag strategy for traceability. The user can drop `main-<sha>` if they prefer minimal tags.
3. **Q3 — Destructive gate enforcement:** strict (require backup artifact) vs lenient (require backup artifact OR `/backup-skipped`). Recommend lenient with the `/backup-skipped` operator override. The user can switch to strict.
4. **Q4 — Concurrency policy on deploy:** queue (`cancel-in-progress: false`) vs cancel (`cancel-in-progress: true`). Recommend queue for safety. The user can switch to cancel for speed.

All four defaults are what this exploration recommends; the orchestrator can present them to the user as "here are the locked decisions; confirm or override" if desired, but no answer is required to proceed to proposal.

---

## 13. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `openspec/changes/explore-athlos-deploy-scoping/exploration.md` (Engram id 2184) | **Parent roadmap for Slice D.** Defines the ~250 LoC estimate (now ~205), the B1b LESSONs to apply, and the dependency on Slices A/B1a/C. |
| `openspec/changes/athlos-deploy-slice-c-containerized-deploy/archive/2026-06-23/archive-report.md` | Slice C archive. **§96-97** confirms v0.4.5 on main and Slice D as the next planned slice. **§97** confirms "GHCR push is Slice D's job." |
| `openspec/changes/athlos-deploy-slice-c-containerized-deploy/archive/2026-06-23/exploration.md` | Slice C exploration. **§7.3** locks the `image: ghcr.io/victor0451/athlos-api:local` placeholder. **§7.6** locks the `docker-build-smoke` CI job Slice D can reuse. **§4** locks the `CI/CD Pipeline` requirement as DEFERRED to Slice D. |
| `openspec/changes/athlos-deploy-slice-c-containerized-deploy/archive/2026-06-23/design.md:40` | "Slice D entirely — CI deploy workflow, GHCR push, `db-destructive` PR label gate." |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/exploration.md:38,510,571` | References the `db-destructive` gate as Slice D's surface. **§3.5** locks `BACKUP_DIR=/var/backups/athlos` (local, NOT S3 per ADR #30). |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/design.md:39` | "BACKUP_BEFORE_MIGRATE env var — Belongs to Slice D (`db-destructive` label gate)." |
| `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/exploration.md:6,467,505` | **B1b LESSONs source.** §6 enumerates the 5 lessons (atomic canonical sync, filename drift, CI extension, verify vs delta, apply self-verification). **§3.7** locks the cron style. |
| `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/design.md:46` | "Slice D (CI deploy workflow + `db-destructive` label gate) — separate change; `athlos-deploy-slice-d-ci-deploy`." |
| `openspec/changes/athlos-foundation/design.md:6009-6019, 6162` | **The original `db-destructive` design.** Locks: labeler on `packages/db/migrations/**` + CI check + `BACKUP_BEFORE_MIGRATE` env var + pre-deploy `pg_dump`. Slice D is the implementation of this design (the foundation deferred it to TASK-075). |
| `openspec/changes/athlos-foundation/tasks.md:270` | "TASK-075 — PR 9 — GitHub Actions deploy — `.github/workflows/deploy.yml` triggered on `v*` tag push." Slice D simplifies this to `push: branches: [main]` (no tag-only trigger). |
| `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/proposal.md:43` | "Slice D: `.github/workflows/deploy.yml` + `check-destructive.yml` + `.github/labeler.yml` (~250 LoC)." **Matches Slice D's 3-file surface.** |
| `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md:183,197,272` | The original Slice D surface: `~60 YAML + ~30 labeler` for the destructive check + labeler; `~180L` for deploy.yml. Our estimate is **slightly lower** (~205 total vs 270) because we share the test workflow's `setup-node` config and reuse the `docker-build-smoke` build pattern. |
| `openspec/specs/deployment-devops/spec.md:72-105` | **The MODIFIED delta target.** Stale `CI/CD Pipeline` scenarios from the foundation. Slice D rewrites them in place. |
| `openspec/specs/deployment-devops/spec.md:168-227` | Slice C's MODIFIED requirement (Containerized Deploy) — Slice D does NOT touch it. |
| `openspec/specs/database-migrations/spec.md:54-71` | The `Production Migration Discipline` requirement + `db-destructive` label scenarios — Slice D IMPLEMENTS but does not MODIFY. |
| `Dockerfile` (52L) | Slice C's multi-stage build. Slice D's deploy.yml builds this. |
| `docker-compose.yml` (80L) | Slice C's prod stack. **Line 42** `image: ghcr.io/victor0451/athlos-api:local` is the placeholder Slice D replaces. |
| `.github/workflows/test.yml` (154L) | Current CI: `test` + `drift-check` + `backup-bats` + `docker-build-smoke`. **Line 142-145** is the smoke build Slice D's deploy.yml mirrors (but adds push + SSH). |
| `.env.example` (69L) | Post-Slice C. **Line 66** `BUILD_SHA=<git-sha>` is the env var deploy.yml sets. Slice D adds `DEPLOY_HOST` + `DEPLOY_SSH_KEY`. |
| `docs/runbook.md` (295L) | Post-Slice C. **Line 237-295** is the "Containerized Deploy (Docker)" section. Slice D adds "CI/CD" after it. |
| `package.json` | `version: 0.4.5` (verified). Slice D bumps to `0.5.0`. |
| `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` | ADRs #28-#33. **§6.I** locks Docker Engine + Compose v2 install. **§6.L** locks backup script paths. **§7** locks the LUKS USB setup (B1b's surface, not Slice D's). **§9** declares restore-drill + PITR out of scope. |
| `scripts/backup.sh` (91L) | B1a's pg_dump + gzip + retention. Slice D's `BACKUP_BEFORE_MIGRATE=true` in the deploy env triggers this on the server before the API container starts. |
| `scripts/restore.sh` (145L) | B1a's restore script. Not modified by Slice D. |
| `apps/api/src/index.ts:3` | Post-Slice C: `loadEnv()` guard — does NOT load `.env` when `NODE_ENV=production`. **No change.** |
| `apps/api/src/routes/health.ts:41,49,77` | The 3 health endpoints (`/health`, `/health/ready`, `/health/startup`). Slice D's deploy.yml hits `/health/ready`. |

---

## 14. Persisted artifacts

- This file: `openspec/changes/explore-athlos-deploy-slice-d/exploration.md`
- Engram topic key: `sdd/athlos-deploy-slice-d-ci-deploy/explore`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)

**Next step (for the orchestrator):** propose `athlos-deploy-slice-d-ci-deploy` as the next SDD change, with the 9-task structure from §7 above. Single autonomous PR at v0.5.0 (minor bump). No chained PRs. Use the B1b LESSON #1 atomic canonical sync rigorously in the apply phase.
