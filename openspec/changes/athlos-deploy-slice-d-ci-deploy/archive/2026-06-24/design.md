# Design: athlos-deploy-slice-d-ci-deploy

| Field | Value |
|-------|-------|
| **Change** | `athlos-deploy-slice-d-ci-deploy` |
| **Date** | 2026-06-24 |
| **Phase** | Design |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Ready for tasks (sdd-tasks) |
| **File path** | `openspec/changes/athlos-deploy-slice-d-ci-deploy/design.md` |
| **Source of truth** | `openspec/changes/athlos-deploy-slice-d-ci-deploy/proposal.md` (305 lines, Engram id 2438) + `openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md` (528 lines, 10 scenarios, Engram id 2442) |
| **Exploration** | `openspec/changes/explore-athlos-deploy-slice-d/exploration.md` (684 lines, Engram id 2434) |
| **Sister change (DONE)** | `athlos-deploy-slice-c-containerized-deploy` (v0.4.5, archived 2026-06-23) |
| **Target release** | v0.4.5 → v0.5.0 (MINOR — new CI capability, not just infra fix) |
| **Delivery** | single PR, ~215 LoC, no chained PRs |

---

## 1. Context

**State of deploy automation post-Slice C (v0.4.5).** The Athlos API ships as a real multi-stage `Dockerfile` (51 lines, Alpine + tini PID-1 + non-root `athlos` UID 1001) plus a `docker-entrypoint.sh` (57 lines, conditional backup → conditional migrations → `exec node` as PID 1) and a `docker-compose.yml` (80 lines, `api` + `db` services with healthchecks, `env_file`, json-file log rotation). The compose file references `image: ghcr.io/victor0451/athlos-api:local` — a placeholder, not a real registry push. The runbook (`docs/runbook.md`, 295 lines) documents manual operations only: "First deploy" via `docker compose up -d --build` and manual "Rollback" via SSH.

**State of CI.** `.github/workflows/test.yml` (154 lines, single file with 4 jobs) runs `test` (vitest + typecheck), `drift-check` (drizzle-kit), `backup-bats` (shellcheck + bats on host scripts), and `docker-build-smoke` (builds the image locally and runs 3 smoke assertions: `node --version`, entrypoint file exists, non-root user). The smoke job verifies the Dockerfile builds and the entrypoint is present — but does **not** push to GHCR, does **not** deploy to the server, and does **not** verify the image runs end-to-end.

**Slice D closes both loops.** Three new GitHub-side artifacts are wired: `deploy.yml` (post-merge `push: branches: [main]` → install → lint → typecheck → test → docker buildx → docker login GHCR → metadata-action tags → build-push-action → SSH via appleboy → `docker compose pull && up -d` → 60s healthcheck poll → auto-rollback to previous tag on failure), `check-destructive.yml` (pre-merge PR-time gate that scans migration files for `DROP TABLE|TRUNCATE|DELETE FROM` patterns and requires a backup artifact URL or `/backup-skipped` operator directive), and `labeler.yml` (auto-applies `db-destructive` to PRs touching `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**`). Total: ~215 LoC across 3 new workflow files + 4 modified files.

**B1b LESSON #1 (HIGHEST recurrence risk).** Apply phase MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` atomically and the result MUST be empty before the change is marked complete. The 4 stale `CI/CD Pipeline` scenarios (foundation-era, references `ci.yml`, `staging` branch, `ghcr.io/athlos/...`) are rewritten IN-PLACE (no `_v2` suffix — Slice C pattern) in the canonical spec. 6 new scenarios are added to cover the new capability. The apply prompt's closing checklist MUST include this diff as a hard gate.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | `.github/workflows/deploy.yml` runs on every push to `main`, builds the API image, pushes to GHCR (`ghcr.io/victor0451/athlos-api`), SSHes to the server, runs `docker compose pull && up -d`, polls `/health/ready` for 60s, auto-rolls-back on failure | `git push origin main` triggers a workflow that completes in <5 min; server has new image tag visible via `docker images` |
| G2 | Image is tagged with `:latest` (always on main), `:vX.Y.Z` (when the closing commit is a version bump), and `:main-<sha>` (always) | `docker images ghcr.io/victor0451/athlos-api` on the server shows all 3 tags after a release commit |
| G3 | `.github/workflows/check-destructive.yml` runs on PRs with the `db-destructive` label; requires a backup artifact URL in a PR comment OR `/backup-skipped` directive in PR body | Test PR with the label but no backup + no directive → workflow FAILS with actionable error |
| G4 | `.github/labeler.yml` auto-applies `db-destructive` to PRs touching `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**` | Test PR with a touched migration file → label auto-applies within 1 min |
| G5 | `.env.example` extended with `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders | Operators know which secrets to set in GitHub repo settings |
| G6 | `docs/runbook.md` gets a new "CI/CD" section explaining deploy workflow, secrets, manual rollback, and the destructive gate | Runbook is the single source of truth for operators |
| G7 | `openspec/specs/deployment-devops/spec.md` MODIFIED — rewrite 4 stale `CI/CD Pipeline` scenarios IN-PLACE + add 6 new ones | Apply phase `diff delta vs canonical` is empty (B1b LESSON #1) |

### Non-Goals (deferred)

(a) Blue-green deploy · (b) Auto-rollback on smoke failure (Slice A deferred; healthcheck is the v1 smoke) · (c) Secrets manager migration (GitHub Secrets + restricted SSH key is sufficient) · (d) Multi-region deploy · (e) HTTPS reverse proxy · (f) `apps/web` containerization · (g) Monitoring stack (Prometheus/Grafana/Cockpit) · (h) CODEOWNERS file (separate governance work) · (i) Auto-labeling of non-destructive migrations · (j) OIDC deploy · (k) Deploy previews for PRs · (l) Staging branch deploys.

---

## 3. Architecture / Approach

### 3.1 `.github/workflows/deploy.yml` (~80 lines) — post-merge deploy

**Trigger:** `on: push: branches: [main]` — fires on every merge to main, AFTER PR review.
**Concurrency:** `concurrency: group: deploy, cancel-in-progress: false` — multiple merges queue, none cancelled mid-deploy.
**Permissions:** `contents: read`, `packages: write` (GHCR push), `id-token: write` (declared but unused; reserved for future OIDC cloud deploys).
**Timeout:** `15 min` covers build (~3 min cold, ~30s warm) + push (~1 min) + SSH deploy (~1 min) + healthcheck poll (60s × 12 retries) + buffer.

**Workflow YAML structure (canonical, copy-paste-ready):**

```yaml
name: deploy
on:
  push:
    branches: [main]
concurrency:
  group: deploy
  cancel-in-progress: false
permissions:
  contents: read
  packages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:run
      - run: pnpm lint
      - run: pnpm typecheck

      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/victor0451/athlos-api
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=raw,value={{version}},enable={{is_default_branch}}
            type=ref,event=branch
            type=sha,format=long
          flavor: |
            latest=auto
            prefix=
            suffix=

      - id: previous-sha
        run: |
          PREVIOUS=$(git log -1 --format='%H' HEAD~1 2>/dev/null || echo "")
          echo "previous=$PREVIOUS" >> $GITHUB_OUTPUT

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: athlos
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /opt/athlos

            PREVIOUS_TAG="ghcr.io/victor0451/athlos-api:$(git rev-parse --short HEAD~1 2>/dev/null || echo "")"
            echo "Previous tag (rollback anchor): $PREVIOUS_TAG"

            docker compose pull
            docker compose up -d

            for i in $(seq 1 12); do
              if curl -sf http://localhost:3001/health/ready > /dev/null; then
                echo "Deploy successful after ${i} attempts"
                exit 0
              fi
              sleep 5
            done

            echo "Healthcheck failed, rolling back to $PREVIOUS_TAG"
            docker compose logs --tail 200 api > /tmp/deploy-fail-$(date +%s).log 2>&1 || true
            docker compose pull $PREVIOUS_TAG || true
            docker compose up -d
            exit 1
```

**Tag computation rationale (`docker/metadata-action@v5`):**
- `type=raw,value=latest,enable={{is_default_branch}}` — `:latest` only emitted on main merges (not on PR builds)
- `type=raw,value={{version}},enable={{is_default_branch}}` — `:v0.5.0` only emitted on main when the commit has a semver tag (captured by `flavor: latest=auto` regex `^v[0-9]+\.[0-9]+\.[0-9]+$`)
- `type=ref,event=branch` — `:main-<sha>` always emitted; this is the **rollback anchor** captured by the `previous-sha` step
- `type=sha,format=long` — full SHA; redundant with `type=ref,event=branch` but kept for explicit traceability in `docker images` output

**Buildx cache rationale:** `cache-from: type=gha` pulls from the previous build's GHA cache; `cache-to: type=gha,mode=max` saves full layer set including intermediate stages. First build: ~3 min. Subsequent builds with unchanged `pnpm-lock.yaml` and `Dockerfile`: ~30s.

**Healthcheck rationale:** `/health/ready` is the readiness endpoint defined in `apps/api/src/routes/health.ts` (returns 503 if DB down, 200 when ready). The compose `healthcheck` uses `wget -q --spider http://localhost:3001/health/ready` with `interval: 30s`, `timeout: 5s`, `retries: 5`, `start_period: 30s` — but the deploy workflow's own poll is faster (5s × 12 = 60s) so we don't wait for compose's full 5+30 = 35s × 5 = 175s readiness window.

**Auto-rollback rationale:** If `/health/ready` doesn't return 200 within 60s, the deploy script:
1. Dumps the failed container's last 200 log lines to `/tmp/deploy-fail-<unix-ts>.log` on the server (post-mortem audit trail)
2. Pulls the previous image tag (captured in the SSH step's `PREVIOUS_TAG` env var)
3. Runs `docker compose up -d` to restart with the old image
4. Exits non-zero so the GitHub Actions run shows red

This is **best-effort**: if the previous image is also broken (rare), the operator must intervene manually. The runbook documents manual rollback as the fallback.

**Server-side hardening (referenced from runbook, NOT modified by Slice D):**
- `~/.ssh/authorized_keys` entry for the deploy key uses `command="/opt/athlos/scripts/deploy-wrapper.sh"` + `from="140.82.112.0/20,185.199.108.0/22,192.30.252.0/22"` (GitHub Actions IP ranges) + `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`
- `/opt/athlos/scripts/deploy-wrapper.sh` only accepts `docker compose pull && docker compose up -d` and rejects other commands (defense-in-depth against key compromise)
- GitHub Secrets: `DEPLOY_SSH_KEY` restricted to `production` environment on `main` branch only (uses GitHub Environments feature)

### 3.2 `.github/workflows/check-destructive.yml` (~50 lines) — pre-merge destructive gate

**Trigger:** `on: pull_request: types: [opened, synchronize, labeled, unlabeled]` — runs on every PR state change so label toggles re-trigger the check.

**Single job `check-destructive`:**

```yaml
name: check-destructive
on:
  pull_request:
    types: [opened, synchronize, labeled, unlabeled]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - id: changed
        run: |
          MIGRATION_FILES=$(git diff --name-only origin/main...HEAD | grep -E 'packages/db/migrations/.*\.sql$' || true)
          DESTRUCTIVE=$(echo "$MIGRATION_FILES" | xargs -I{} grep -lE 'DROP TABLE|TRUNCATE|DELETE FROM' {} 2>/dev/null || echo "")
          echo "migrations<<EOF" >> $GITHUB_OUTPUT
          echo "$MIGRATION_FILES" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
          echo "destructive<<EOF" >> $GITHUB_OUTPUT
          echo "$DESTRUCTIVE" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
          echo "has_destructive=$([ -n "$DESTRUCTIVE" ] && echo true || echo false)" >> $GITHUB_OUTPUT

      - name: Check destructive migration
        if: steps.changed.outputs.has_destructive == 'true'
        env:
          PR_LABELS: ${{ join(github.event.pull_request.labels.*.name, ',') }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          if echo "$PR_LABELS" | grep -q 'db-destructive'; then
            HAS_BACKUP=$(gh pr view ${{ github.event.pull_request.number }} --json comments \
              --jq '[.comments[] | select(.body | test("https://.*\\.sql\\.gz"))] | length')
            HAS_SKIP=$(echo "$PR_BODY" | grep -c '/backup-skipped' || true)

            {
              echo "## Destructive migration gate"
              echo ""
              echo "- **Migration files:** ${{ steps.changed.outputs.destructive }}"
              echo "- **Backup artifact posted:** $([ "$HAS_BACKUP" -gt 0 ] && echo yes || echo no)"
              echo "- **/backup-skipped directive:** $([ "$HAS_SKIP" -gt 0 ] && echo yes || echo no)"
            } >> "$GITHUB_STEP_SUMMARY"

            if [ "$HAS_BACKUP" -eq 0 ] && [ "$HAS_SKIP" -eq 0 ]; then
              echo "::error::Destructive migration detected. Either:"
              echo "  1. Run \`pnpm db:backup && pnpm db:status\` and paste the backup URL as a PR comment, OR"
              echo "  2. Add \`/backup-skipped\` directive to PR body with justification"
              exit 1
            fi
            echo "Destructive migration acknowledged"
          else
            echo "::error::Destructive migration in PR but missing \`db-destructive\` label. Add it manually or wait for the labeler."
            exit 1
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Detection rationale:** `grep -E 'DROP TABLE|TRUNCATE|DELETE FROM'` catches the 99% case of destructive SQL. NOT a full SQL parser — documented as a known limitation.

**Lenient gate rationale:** requires EITHER a backup artifact URL (matching `https://.*\.sql\.gz` regex in a PR comment) OR `/backup-skipped` directive in PR body. Both paths log a workflow summary via `$GITHUB_STEP_SUMMARY` so the audit trail is visible in the Actions UI.

**Pattern limitations (documented in runbook):**
- Cannot detect `ALTER TABLE ... DROP COLUMN` (requires column-context awareness)
- Cannot detect `UPDATE ... SET` mass changes (no DDL marker)
- Cannot detect data-only migrations via `INSERT INTO` + `DELETE FROM` chains
- Operates on the **file**, not the migration system; a multi-statement migration where the destructive line is buried in a comment block is still flagged

The labeler is the precision backstop: it auto-applies `db-destructive` only on schema files (`packages/db/src/schema/**`) or migrations (`packages/db/migrations/**`), so a developer who touches a non-destructive file does NOT get the label.

### 3.3 `.github/labeler.yml` (~5 lines) — auto-label config

```yaml
db-destructive:
  - packages/db/migrations/**
  - packages/db/src/schema/**
  - drizzle/**
```

**Wiring (added to existing `.github/workflows/test.yml`, +5 lines):**

```yaml
  labeler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with:
          configuration-path: .github/labeler.yml
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

**Pattern rationale:** any file change in `packages/db/migrations/**` (forward-only Drizzle migrations), `packages/db/src/schema/**` (Drizzle schema definitions that generate migrations), or `drizzle/**` (Drizzle config + snapshots) auto-applies the label. Matches the project's "schema change is destructive" policy from B1a (`openspec/specs/database-migrations/spec.md` line 56).

### 3.4 `.env.example` (modify, +5 lines)

Append under existing `─── Containerized Deploy (PR Slice C) ───` block:

```bash
# ─── CI Deploy (PR Slice D) ───
# DEPLOY_HOST: server IP/hostname reachable from GitHub Actions runners
# (use the dev server 192.168.1.102 for current work; switch to definitive prod host when provisioned)
DEPLOY_HOST=192.168.1.102
# DEPLOY_SSH_KEY: long-lived ed25519 private key, stored as GitHub Secret
# (NEVER commit a real key; placeholder only — set in GitHub repo settings → Secrets)
DEPLOY_SSH_KEY=<paste-private-key-here>
```

### 3.5 `docs/runbook.md` (modify, +30 lines)

New `## CI/CD` section after "Containerized Deploy (Docker)":

```markdown
## CI/CD

### Deploy flow
Push to `main` → GitHub Actions `deploy.yml` runs:
1. Install + lint + typecheck + test (fail fast on regression)
2. Build image with buildx + GHA cache (~30s warm)
3. Push to GHCR with tags `:latest`, `:vX.Y.Z` (release commits), `:main-<sha>`
4. SSH to server → `docker compose pull && docker compose up -d`
5. Poll `/health/ready` every 5s for 60s
6. On pass: done. On fail: dump logs to `/tmp/deploy-fail-<ts>.log`, redeploy previous tag, exit red.

### GitHub Secrets
| Secret | Purpose | Rotation |
|--------|---------|----------|
| `DEPLOY_HOST` | Server IP (current: `192.168.1.102`; switch when prod host is provisioned) | When server changes |
| `DEPLOY_SSH_KEY` | Long-lived ed25519 deploy key, restricted via `authorized_keys` `command=` + `from=` GitHub IPs | Quarterly |
| `GITHUB_TOKEN` | Automatic (used for GHCR push) | Automatic |

### db-destructive label
Auto-applied by `actions/labeler@v5` when a PR touches `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**`. `check-destructive.yml` then requires either a backup URL (matching `https://.*\.sql\.gz` in a PR comment) OR `/backup-skipped` directive in PR body. Both paths log to the workflow summary for audit.

### Manual rollback
When auto-rollback fails or operator needs to roll back further:
```bash
ssh athlos@$DEPLOY_HOST
cd /opt/athlos
docker images ghcr.io/victor0451/athlos-api    # pick previous tag
docker compose pull ghcr.io/victor0451/athlos-api:previous-sha
docker compose up -d
curl -sf http://localhost:3001/health/ready   # verify
```

### Server hardening (one-time setup, NOT automated by CI)
- `authorized_keys` entry for deploy key uses `command="/opt/athlos/scripts/deploy-wrapper.sh"` + `from="140.82.112.0/20,185.199.108.0/22,192.30.252.0/22"` (GitHub Actions IPs) + `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`
- Wrapper script only accepts `docker compose pull && docker compose up -d`; rejects other commands
- Quarterly key rotation: `ssh-keygen -t ed25519` on server, update GitHub Secret, remove old public key from `authorized_keys`
```

### 3.6 Atomic canonical spec sync (B1b LESSON #1 — HIGHEST)

**Files to compare:**
- Delta: `openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md` (528 lines, 10 scenarios)
- Canonical: `openspec/specs/deployment-devops/spec.md` (post-Slice C: 395 lines, 8 requirements, 23 scenarios)

**The `CI/CD Pipeline` requirement (canonical lines 72-105) has 4 stale scenarios to rewrite IN-PLACE:**

| Stale scenario (line) | Stale content | Rewritten content (in-place, no `_v2` suffix) |
|---|---|---|
| GitHub Actions workflow structure (76-82) | `.github/workflows/ci.yml`, runs on `push or pull_request`, stages `lint, test, build, push` | `.github/workflows/deploy.yml` (post-merge) + `check-destructive.yml` (PR-time) + `labeler.yml` (PR-time), runs `lint, test, typecheck, build, push, ssh-deploy, healthcheck, rollback` |
| Branch-based deployment (85-90) | branch `main` → tag `athlos-api:latest` + `athlos-api:<git-sha>` → production | branch `main` → GHCR tag `ghcr.io/victor0451/athlos-api:latest` + `:main-<sha>` → production (post-merge) |
| Staging deployment (93-97) | branch `staging` → tag `athlos-api:staging` → staging | **DELETED** — staging branch deploys are explicitly deferred (Slice D non-goal `l`) |
| Docker image tagging (100-104) | tag `ghcr.io/athlos/athlos-api:abc1234` + `:latest` | tag `ghcr.io/victor0451/athlos-api:abc1234` + `:latest` + `:vX.Y.Z` (when version-bump commit) |

**6 new scenarios to ADD to the canonical `CI/CD Pipeline` requirement (after the rewrites):**

1. `push to main triggers deploy.yml` — `on: push: branches: [main]` fires after every merge
2. `deploy.yml pushes image to GHCR with three tags` — `:latest` (always on main), `:vX.Y.Z` (release commits), `:main-<sha>` (always)
3. `deploy.yml SSHes to server and runs docker compose pull && up -d` — `appleboy/ssh-action@v1` + `DEPLOY_HOST` + `DEPLOY_SSH_KEY`
4. `deploy.yml verifies /health/ready returns 200 within 60s and rolls back on failure` — 12 retries × 5s = 60s window; on fail, log dump + redeploy previous tag
5. `labeler.yml auto-applies db-destructive to migration PRs` — `actions/labeler@v5` matches `packages/db/migrations/**`, `packages/db/src/schema/**`, `drizzle/**`
6. `check-destructive.yml blocks PRs with destructive migrations and no backup` — scan for `DROP TABLE|TRUNCATE|DELETE FROM` + require backup URL or `/backup-skipped`

**Atomic sync command (apply phase MUST run before task complete):**

```bash
diff <(awk '/^### Requirement: CI\/CD Pipeline$/,/^### Requirement: /{ if (!/^### Requirement: / || /^### Requirement: CI\/CD Pipeline$/) print }' openspec/specs/deployment-devops/spec.md) \
     <(awk '/^### Requirement: CI\/CD Pipeline$/,/^### Requirement: /{ if (!/^### Requirement: / || /^### Requirement: CI\/CD Pipeline$/) print }' openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md)

# MUST return zero output (delta exactly matches canonical after sync)
```

**Acceptance:** `diff` returns empty (or shows ONLY the intended delta — same content, whitespace differences are failures).

**5 new success criteria** to ADD to canonical `Success Criteria` section (after line 395's current 25 criteria, becoming 30 total):

26. `.github/workflows/deploy.yml` runs on every push to `main` and completes in <5 min
27. After deploy, `docker images ghcr.io/victor0451/athlos-api` on the server shows `:latest`, `:vX.Y.Z`, and `:main-<sha>`
28. Auto-rollback redeploys the previous image tag within 60s of healthcheck failure
29. `.github/labeler.yml` auto-applies `db-destructive` to PRs touching `packages/db/migrations/**` or `packages/db/src/schema/**`
30. `.github/workflows/check-destructive.yml` blocks PRs with destructive migrations and no backup artifact or `/backup-skipped` directive

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|---|---|---:|---|
| `.github/workflows/deploy.yml` | create | ~80 | post-merge build → GHCR push → SSH → healthcheck → auto-rollback |
| `.github/workflows/check-destructive.yml` | create | ~50 | pre-merge destructive gate (runs only when `db-destructive` label present) |
| `.github/labeler.yml` | create | ~5 | auto-label config for `db-destructive` |
| `.github/workflows/test.yml` | modify | +5 | add `labeler` job (uses `actions/labeler@v5`) |
| `.env.example` | modify | +5 | `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders under `─── CI Deploy (PR Slice D) ───` |
| `docs/runbook.md` | modify | +30 | new "CI/CD" section after "Containerized Deploy (Docker)" |
| `openspec/specs/deployment-devops/spec.md` | modify (atomic sync) | +20 net | 4 stale scenarios rewritten IN-PLACE + 6 new scenarios + 5 new success criteria |
| 19 `package.json` files (root + 18 `packages/*/package.json`) | modify | +1 line each | bump v0.4.5 → v0.5.0 (only in release commit per B1b LESSON #2) |
| `CHANGELOG.md` | modify | +5 | v0.5.0 entry under Released |
| **Total PR LoC** | | **~215** | **Under 400-line budget (~54%)** |

**Out of scope (intentionally NOT created):** `CODEOWNERS` file (separate governance work), `docker-compose.override.yml` for staging, `Dockerfile.staging`.

---

## 5. Implementation Order (9 work-units)

Slice D is **pure YAML infra** — NO TDD code. The 9 work-units mirror B1b's pattern (config first, infra next, atomic sync at the end, release commit last).

### 3-Commit Shape (per work-unit-commits skill + B1b LESSON #2)

The 7 work-unit commits collapse into **3 logical commits** for the PR:

| Commit | Work-units | Content | Reason |
|---|---|---|---|
| `chore(ci): add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders` | TASK-001 | `.env.example` (+5) | First action — gives operator a checklist of secrets to provision |
| `feat(ci): deploy workflow + db-destructive label gate` | TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | All workflow YAML, labeler config, runbook section | The deliverable; this is the single PR |
| `docs(spec): sync deployment-devops canonical with slice-d delta` | TASK-007 | `openspec/specs/deployment-devops/spec.md` (+20 net) | Atomic sync per B1b LESSON #1 — kept separate so the diff is reviewable |
| `chore(release): v0.5.0` | TASK-009 | 19 `package.json` files, `CHANGELOG.md` | SEPARATE from feat per B1b LESSON #2 — version bump + CHANGELOG in own commit |

**TASK-008 (verification)** runs continuously during apply — `actionlint` + `yamllint` + `pnpm test:run` + manual labeler test. No commit, no file change.

### Work-Unit Detail

| # | Task | Description | Files | TDD? |
|---|------|-------------|-------|------|
| TASK-001 | Add `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders | Pure config; no logic | `.env.example` (+5) | N/A |
| TASK-002 | Create `.github/labeler.yml` | Auto-label config for `db-destructive` | `.github/labeler.yml` (+5) | N/A |
| TASK-003 | Add `labeler` job to `test.yml` | 5-line addition; uses `actions/labeler@v5` | `.github/workflows/test.yml` (+5) | N/A |
| TASK-004 | Create `check-destructive.yml` | Pre-merge destructive gate. Runs only when label present | `.github/workflows/check-destructive.yml` (+50) | N/A |
| TASK-005 | Create `deploy.yml` | The big one. Build → push → SSH → healthcheck → rollback | `.github/workflows/deploy.yml` (+80) | N/A |
| TASK-006 | Add "CI/CD" section to runbook | New section after "Containerized Deploy (Docker)" | `docs/runbook.md` (+30) | N/A |
| TASK-007 | **Atomic canonical spec sync** (B1b LESSON #1) | Rewrite 4 stale `CI/CD Pipeline` scenarios IN-PLACE + add 6 new ones + 5 new success criteria. Run `diff` — MUST be empty before marking complete | `openspec/specs/deployment-devops/spec.md` (+20 net) | N/A |
| TASK-008 | **Pre-closing verification** | `actionlint` on both workflows + `yamllint` on labeler.yml + `pnpm test:run` (468+ cases) + manual labeler test via draft PR. NO file changes | (no files) | N/A |
| TASK-009 | **Closing release commit** (v0.4.5 → v0.5.0) | Bump 19 `package.json` files to `0.5.0`, add `CHANGELOG.md` entry. SEPARATE from feat commit per B1b LESSON #2 | 19 `package.json`, `CHANGELOG.md` | N/A |

### Strict TDD

**None.** Slice D is GitHub Actions YAML + config files. There is no application code to test RED-first. The verification is:
- `actionlint` validates workflow syntax (pre-merge gate)
- `yamllint` validates labeler.yml (pre-merge gate)
- `pnpm test:run` confirms no regression in existing 468+ vitest cases
- Manual deploy test in staging before main merge

---

## 6. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| R1 | **Secret leakage (`DEPLOY_SSH_KEY` is long-lived private key with full server SSH access)** | Low / Critical | (a) Server-side `authorized_keys` uses `command="/opt/athlos/scripts/deploy-wrapper.sh"` to restrict to `docker compose pull/up` only + `from="140.82.112.0/20,185.199.108.0/22,192.30.252.0/22"` (GitHub Actions CIDRs) + `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty`. (b) Wrapper script rejects any non-`docker compose` command. (c) GitHub Secret restricted to `production` environment on `main` branch only. (d) Quarterly key rotation documented in runbook. |
| R2 | **Auto-rollback on healthcheck failure** | Medium | `docker compose pull && up -d` is the happy path; on `/health/ready` non-200 for 60s (12 × 5s polls), the SSH step (a) dumps logs to `/tmp/deploy-fail-<unix-ts>.log`, (b) redeploys previous tag captured via `git rev-parse --short HEAD~1`, (c) exits non-zero so the Actions run shows red. **Best-effort:** if previous image is also broken (rare), operator intervenes via manual rollback documented in runbook. |
| R3 | **`db-destructive` label abuse / false negatives** | Low | (a) `actions/labeler@v5` is the only auto-applier — matches file paths (high precision, can't be fooled by manually adding the label without changing schema files). (b) `check-destructive.yml` scans the actual migration SQL for `DROP TABLE|TRUNCATE|DELETE FROM` patterns as defense in depth (so a label without destructive content doesn't fail). (c) `/backup-skipped` directive is logged to `$GITHUB_STEP_SUMMARY` for audit. (d) CODEOWNERS file deferred to separate governance work. |
| R4 | **Image build time + cache invalidation** | Certain / Low | `docker/setup-buildx-action@v3` + `cache-from: type=gha` (pulls previous build's layers) + `cache-to: type=gha,mode=max` (saves full layer set including intermediate stages) drops first build from ~3 min to ~30s after warmup. `pnpm-lock.yaml` and `Dockerfile` rarely change so cache hit rate is high. |
| R5 | **Concurrent deploys race condition** | Low | `concurrency: group: deploy, cancel-in-progress: false` queues deploys; only one runs at a time. `docker compose up -d` is idempotent — the latest image wins, the in-flight deploy finishes its healthcheck (or fails and rolls back to its own previous), and the next deploy picks up. No data corruption because migrations are forward-only. |

---

## 7. Dependencies (all confirmed shipped)

| Dependency | What Slice D needs | Status |
|------------|-------------------|--------|
| **Slice C** (v0.4.5) | Real multi-stage `Dockerfile` (51L) + `docker-entrypoint.sh` (57L) + `docker-compose.yml` (80L, `api+db`) + `BACKUP_BEFORE_MIGRATE` env support + `docker-build-smoke` CI job | ✅ shipped 2026-06-23 (Engram id 2385) |
| **Slice A** (v0.4.1) | `pnpm db:status` + `drizzle-kit check` (referenced in labeler patterns + check-destructive reasoning) | ✅ shipped 2026-06-18 |
| **Slice B1a** (v0.4.3) | `BACKUP_BEFORE_MIGRATE` env var + `scripts/backup.sh` (91L) + `BACKUP_DIR=/var/backups/athlos` + `db-destructive` label spec at `openspec/specs/database-migrations/spec.md` line 56 | ✅ shipped 2026-06-19 |
| **Slice B1b** (v0.4.4) | B1b LESSONs #1-#4 (methodology, not code dep) — atomic canonical sync, release commit separation, pre-merge fix + cherry-pick reorder, merge-before-delete | ✅ shipped 2026-06-19 |
| **GitHub Actions** | Free for public repos | ✅ available |
| **GHCR** (`ghcr.io`) | Free for public repos, integrated with `${{ secrets.GITHUB_TOKEN }}` | ✅ available |
| **`appleboy/ssh-action@v1`** | Open-source action, 50k+ stars, no auth | ✅ available |
| **`docker/metadata-action@v5`** + `docker/build-push-action@v5` + `docker/setup-buildx-action@v3` + `docker/login-action@v3` | Open-source actions, no auth | ✅ available |
| **`actions/labeler@v5`** | Open-source action, no auth | ✅ available |
| **`rhysd/actionlint`** (local CLI) | Used in TASK-008 verification | ✅ standard dev tool |
| **Server**: Ubuntu 24.04 LTS + Docker Engine 29 + Compose v2 + SSH key setup | Per `5-Server-Infrastructure.md` ADRs #28-#33 | ✅ verified |

**No new external dependencies.** Slice D adds zero npm packages, zero Ubuntu packages, zero third-party services.

---

## 8. Acceptance Criteria (binary pass/fail)

### 8.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases — current count, no regression)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)
- [ ] `actionlint .github/workflows/deploy.yml` passes (0 errors)
- [ ] `actionlint .github/workflows/check-destructive.yml` passes
- [ ] `yamllint .github/labeler.yml` passes

### 8.2 Spec sync (B1b LESSON #1 — atomic, hard gate)

- [ ] `diff <(awk '/^### Requirement: CI\/CD Pipeline$/,/^### Requirement: /{ if (!/^### Requirement: / || /^### Requirement: CI\/CD Pipeline$/) print }' openspec/specs/deployment-devops/spec.md) <(awk '/^### Requirement: CI\/CD Pipeline$/,/^### Requirement: /{ if (!/^### Requirement: / || /^### Requirement: CI\/CD Pipeline$/) print }' openspec/changes/athlos-deploy-slice-d-ci-deploy/specs/deployment-devops/spec.md)` returns 0 lines of output
- [ ] All 4 stale `CI/CD Pipeline` scenarios are rewritten IN-PLACE in the canonical (no `_v2` suffix)
- [ ] All 6 new scenarios are present in the canonical
- [ ] 5 new success criteria (26-30) are added to canonical
- [ ] `database-migrations/spec.md` is unchanged (labeler + check IMPLEMENT, don't REDEFINE, the existing `db-destructive` requirement)

### 8.3 Manual deploy test

- [ ] A test PR touching `packages/db/migrations/0007_test.sql` triggers `.github/labeler.yml` to auto-apply `db-destructive` within 1 min
- [ ] Same test PR (label + no backup + no `/backup-skipped`) → `check-destructive` FAILS with `::error::` actionable message
- [ ] Same test PR (label + `/backup-skipped` directive in body) → `check-destructive` PASSES with summary in `$GITHUB_STEP_SUMMARY`
- [ ] A `git push origin main` (or `workflow_dispatch`) triggers `deploy.yml` and completes in <5 min
- [ ] After deploy: `docker images ghcr.io/victor0451/athlos-api` shows all 3 tags (`:latest`, `:vX.Y.Z` on release commits, `:main-<sha>`)
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
- [ ] B1b LESSON #2: v0.4.5 → v0.5.0 bump in `package.json` ONLY in the closing `chore(release): v0.5.0` commit (verify `git show HEAD~1 -- package.json | grep version` returns `0.4.5` and `git show HEAD -- package.json | grep version` returns `0.5.0`)
- [ ] B1b LESSON #4: `feat/slice-d-ci-deploy` branch merged to main BEFORE `git branch -D`
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
| Delivery strategy | **single-pr** (per session preflight) |
| Chain strategy | N/A |
| Work-unit count | **9** (TASK-001..TASK-009) |
| Largest single change | TASK-005 `.github/workflows/deploy.yml` (~80 LoC) |
| Estimated reviewer time | ~15-25 min (one pass — focus on `deploy.yml` step logic + labeler paths + atomic canonical sync diff) |

**Commit shape (per work-unit-commits skill):**

1. `chore(ci): add DEPLOY_HOST + DEPLOY_SSH_KEY placeholders` (TASK-001)
2. `feat(ci): deploy workflow + db-destructive label gate` (TASK-002 + TASK-003 + TASK-004 + TASK-005 + TASK-006) — the deliverable
3. `docs(spec): sync deployment-devops canonical with slice-d delta` (TASK-007) — atomic sync per B1b LESSON #1
4. `chore(release): v0.5.0` (TASK-009) — separate release commit per B1b LESSON #2

---

## 10. Strict TDD Verification Checklist

Slice D has NO TDD code — pure YAML infra. The TDD checklist is therefore **N/A**, replaced by infra-specific verification:

- [x] **N/A — Slice D is GitHub Actions YAML + config; no application code**
- [x] `actionlint .github/workflows/deploy.yml` passes (0 errors)
- [x] `actionlint .github/workflows/check-destructive.yml` passes (0 errors)
- [x] `yamllint .github/labeler.yml` passes (0 errors)
- [x] `pnpm test:run` passes (no regression to existing 468+ vitest cases)
- [x] `pnpm typecheck` passes (0 errors)
- [x] `pnpm lint` passes (0 errors, 0 warnings)
- [x] Manual deploy test in staging before merge to main (via `workflow_dispatch` or push to non-main branch first)
- [x] No AI co-author; Conventional Commits throughout
- [x] PR title: `feat(ci): deploy workflow + db-destructive label gate (v0.5.0)`
- [x] `apply-progress.md` ends with: TASK-008 verification → TASK-008 ATOMIC CANONICAL SYNC (diff empty) → TASK-009 release commit (v0.4.5 → v0.5.0)

---

## 11. Out of Scope (deferred)

| Deferred item | Reason | Future slice |
|---------------|--------|-------------|
| Blue-green deploy | Overkill for v1; compose `up -d` is idempotent enough | Future |
| Auto-rollback on smoke failure | Slice A smoke deferred; healthcheck is the v1 smoke | Slice A follow-up |
| Secrets manager migration (Vault, AWS SM) | GitHub Secrets + restricted SSH key is sufficient | When GH Secrets rotation becomes operationally painful |
| Multi-region | Single-server deployment for now | When scale demands |
| HTTPS reverse proxy | Caddy/Traefik not yet chosen | When web deploys (apps/web) |
| `apps/web` containerization | apps/web deploy is separate work | Slice E (web deploy) |
| Monitoring stack (Prometheus/Grafana/Cockpit) | Operational gap | Slice F (observability) |
| Deploy previews for PRs | Cost/benefit unclear | When requested |
| Staging branch deploys | Slice D non-goal `l`; staging can be done manually | Future |
| OIDC deploy | SSH is sufficient; OIDC needed only for cloud (AWS/GCP) | When migrating to cloud |
| CODEOWNERS file | Governance work separate from infra | Open governance PR |
| Audit event integration for destructive deploys | Audit retention is in place (PR 6a); just need a hook | When audit team requests |
| `pg_basebackup` / WAL archiving / PITR | Recovery gap; current model is "redeploy previous image" | Slice G (data ops) |
| S3/cloud backups | REJECTED per ADR #30 (local + USB rotation is sufficient) | Never (by ADR) |
| Distroless image | Alpine is small enough (~150 MB); distroless requires multi-arch rework | When image size becomes a real problem |
| Auto-scaling | Single-server deployment for now | When scale demands |

---

## 12. Ready for Tasks?

**Yes.** Design is concrete, actionable, and under the 400-line budget. All dependencies are shipped, all risks have mitigations, and the 3-commit shape preserves B1b LESSON #2 (release commit separation). TASK-008 (atomic canonical sync verification) is the hard gate — apply phase MUST run the diff and confirm it's empty before marking the change complete.

**Next step:** `sdd-tasks` → `sdd-apply` (with B1b LESSON #1 atomic sync in the apply prompt) → `sdd-verify` → `sdd-archive`.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-d-ci-deploy/design.md`*
- *Engram topic `sdd/athlos-deploy-slice-d-ci-deploy/design`*