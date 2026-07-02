# Proposal: athlos-deploy-slice-c-containerized-deploy

**Date:** 2026-06-23
**Phase:** Propose
**Mode:** Both (Engram + OpenSpec)
**Status:** Draft
**Source of truth:** `openspec/changes/explore-athlos-deploy-slice-c/exploration.md` (726 lines, id 2342)

---

## Intent

Slice C of the deploy-automation roadmap delivers the **containerized deploy foundation** for the Athlos API. It closes the gap left by the placeholder `Dockerfile` (8 lines, single-stage) and placeholder `docker-compose.yml` (65 lines, real `db` healthcheck but no `api` entrypoint, no migration wiring, no backup-before-migrate wiring).

The change produces: a **real multi-stage `Dockerfile`** (2-stage: builder + runtime, `node:22-alpine`, `pnpm deploy --filter @athlos/api --prod`, non-root UID 1001, ~150 MB final image), a **`docker-entrypoint.sh`** (~40 LoC bash) that conditionally runs `scripts/backup.sh` then `pnpm --filter @athlos/db migrate` before `exec node dist/index.js`, and a **real `docker-compose.yml`** (api + db, ~110 LoC) with `env_file: .env.production`, `depends_on: db: condition: service_healthy`, `api` healthcheck hitting `/health/ready` (30s interval / 5s timeout / 5 retries), and json-file log rotation (max-size 10m, max-file 3). The first-deploy contract is `docker compose up -d` — atomic, includes migrations, idempotent.

In addition to the infra deliverables, this PR fixes **three spec drifts** the explore discovered:

1. **`dotenv/config` unconditional load.** `apps/api/src/index.ts:3` does `import 'dotenv/config'`, which silently loads any present `.env` in production — directly violating `openspec/specs/deployment-devops/spec.md:113` (the "MUST NOT look for a `.env` file" requirement). Fix: guard the import behind `process.env.NODE_ENV !== 'production'` + add a vitest regression test.
2. **`BACKUP_BEFORE_MIGRATE` S3 → local reconciliation.** The foundation design (`design.md:6019`) specified `s3://${BACKUP_BUCKET}/pre-deploy-${BUILD_SHA}.dump`. Slice B1a (v0.4.3) explicitly pivoted to local + USB per ADR #30. Slice C's MODIFIED delta reconciles the canonical spec to write to `$BACKUP_DIR`.
3. **Three stale scenarios** in `deployment-devops/spec.md` post-B1a/B1b (rollback, one-off migration, backup storage location) — surgical rewrites aligned with the forward-only Drizzle reality and the B1b USB rotation requirement.

This PR does **NOT** include CI deploy workflow + GHCR push + `db-destructive` PR label gate — that is Slice D. Slice C is the v1 prod-deploy contract the runbook has been promising since Slice A.

---

## Scope (In)

| File | Change | Justification |
|------|--------|---------------|
| `Dockerfile` | **rewrite** (~50 LoC, real multi-stage) | 2-stage: builder (`node:22-alpine` + `pnpm@9.15.9` + `pnpm fetch` + `pnpm install --frozen-lockfile` + `pnpm build` + `pnpm deploy --filter @athlos/api --prod`) + runtime (`node:22-alpine` + `tini` for PID 1 signal handling + `postgresql-client` for `pg_dump`); non-root UID 1001; `ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]`; `CMD ["node", "dist/index.js"]` |
| `docker-entrypoint.sh` | **new** (~40 LoC bash) | Sources `scripts/lib/common.sh`; waits for `pg_isready` (belt-and-suspenders for cold starts); if `BACKUP_BEFORE_MIGRATE=true` runs `scripts/backup.sh` to `$BACKUP_DIR`; if `RUN_MIGRATIONS=true` runs `pnpm --filter @athlos/db migrate`; then `exec node dist/index.js` (PID 1 receives SIGTERM, Fastify's SIGTERM handler runs graceful shutdown) |
| `docker-compose.yml` | **rewrite** (~110 LoC, real prod) | `services.api` (build from `Dockerfile`, `restart: unless-stopped`, `depends_on: db: condition: service_healthy`, `env_file: .env.production`, `RUN_MIGRATIONS=true`, `BACKUP_BEFORE_MIGRATE=true`, healthcheck on `/health/ready` 30s/5s/5/30s-start_period, json-file log rotation, mounts `backup_data` + `legacy_data`) + `services.db` (`postgres:16-alpine`, `pgdata` named volume, `pg_isready` healthcheck 10s/5s/5, json-file log rotation). Removes the placeholder `migrations` service (migrations live in `api` entrypoint) |
| `.env.example` | **modify** (+10 lines) | Add `RUN_MIGRATIONS=true`, `BACKUP_BEFORE_MIGRATE=true`, `BUILD_SHA=local`, plus a `.env.production` example header with `POSTGRES_*` placeholders |
| `.dockerignore` | **modify** (+5 lines) | Add `openspec/`, `.atl/`, `**/coverage/`, `**/.nyc_output/`, `.husky/` (TASK-076 baseline is 19L) |
| `docs/runbook.md` | **modify** (+25 lines) | New `## Containerized Deploy (Docker)` section after `## USB Rotation`: first-time setup (`cp .env.example .env.production` + fill secrets + `docker compose up -d --build`); day-to-day (`docker compose restart api` for env changes, `docker compose up -d --build api` for code); migration flow; pre-migration backup flow; log access; healthcheck interpretation |
| `.github/workflows/test.yml` | **modify** (+10 lines YAML) | New `docker-build-smoke` job (uses `docker/setup-buildx-action@v3`, runs `docker build -t athlos-api:test .` + a `docker run --rm athlos-api:test docker-entrypoint.sh --help` smoke check; no push; catches Dockerfile regressions in <2 min) |
| `apps/api/src/index.ts` | **modify** (+3 lines, +1 guard) | Change `import 'dotenv/config'` → `if (process.env.NODE_ENV !== 'production') await import('dotenv/config')` (lazy dynamic import keeps module init semantics correct in ESM) |
| `apps/api/test/dotenv-guard.test.ts` | **new** (+30 LoC vitest) | Verifies `dotenv/config` loads when `NODE_ENV !== 'production'` AND does NOT load when `NODE_ENV=production`. Strict TDD red-green-refactor |
| `openspec/specs/deployment-devops/spec.md` | **MODIFIED delta** (~30 net lines) | ADD new requirement `### Requirement: Production Container Entrypoint` between line 162 and 165 with 5 new scenarios. REWRITE 3 stale scenarios (`Rollback procedure`, `One-off migration execution`, `Backup storage location`) to match forward-only Drizzle + B1b USB reality. ADD dotenv-guard scenario. **CRITICAL — apply phase MUST self-verify delta vs canonical atomically via `diff` BEFORE marking task complete (B1a/B1b LESSON #1)** |
| `openspec/changes/explore-athlos-deploy-slice-c/exploration.md` → `openspec/changes/athlos-deploy-slice-c-containerized-deploy/archive/2026-06-23/exploration.md` | **move** | Archive-phase commit (per B1a/B1b LESSON #3: planning artifacts MUST be in repo at archive time) |

**Total estimated PR LoC:** ~315 (under 400-line review budget).

---

## Scope (Out)

| Excluded | Reason |
|----------|--------|
| **Slice D entirely** (CI deploy workflow + `db-destructive` PR label gate + GHCR push) | Separate future change; Slice C is infra-only |
| **`apps/web` containerization (Next.js 16.2.9)** | Separate slice; Next.js has different container needs (`next build` + `next start`) |
| **HTTPS reverse proxy (Caddy, nginx)** | Separate slice; API listens on `:3001` over HTTP for v1 |
| **Monitoring stack (Prometheus, Grafana, Cockpit)** | Separate slice; health endpoints exist; dashboards later |
| **`athlos-fileserver` / `athlos-nextcloud` / `athlos-ad`** | Deferred per ADR #33 |
| **Multi-host orchestration (k8s, swarm)** | Single-node only per Server Infra doc §6 |
| **Auto-scaling** | Single-node only; `pg_advisory_lock` race mitigation is a separate future change |
| **Restore drill (`restore-drill.sh`)** | Needs separate test DB; future change |
| **`pg_basebackup` / WAL archiving / PITR** | Much larger slice; future change |
| **S3 backups** | REJECTED by ADR #30 (foundation design's S3 path is dead) |
| **systemd timers** | cron sufficient per ADR #29 |
| **Distroless image** | Overkill for self-hosted single-node |
| **AWS CLI in image** | NOT needed (S3 rejected) |
| **logrotate for docker logs** | Driver options (`max-size: 10m, max-file: 3`) cover rotation |

---

## Approach

### TDD order (strict TDD enabled, RED → GREEN → REFACTOR)

1. **`apps/api/test/dotenv-guard.test.ts`** (RED) — write failing test asserting dotenv loads when `NODE_ENV !== 'production'` and does NOT load when `NODE_ENV=production`. Verify it fails (current code loads dotenv unconditionally).
2. **`apps/api/src/index.ts`** (GREEN) — replace `import 'dotenv/config'` with conditional dynamic import. Verify test passes.
3. **REFACTOR** — extract the guard into a small helper if needed; clean up test fixtures.

### Infra build order (no TDD — bash + docker are infra, scripts already TDD'd in B1a/B1b)

4. **`Dockerfile`** — real multi-stage build. Validate locally with `docker build -t athlos-api:test .`.
5. **`docker-entrypoint.sh`** — bash script. `set -euo pipefail`, sources `scripts/lib/common.sh`. Validate by `bash -n` syntax check + bats-style test if extracted.
6. **`docker-compose.yml`** — real prod stack. Validate with `docker compose config` (parses + interpolates).
7. **`.env.example`** additions.
8. **`.dockerignore`** additions.
9. **`docs/runbook.md`** — new `## Containerized Deploy (Docker)` section.
10. **`.github/workflows/test.yml`** — new `docker-build-smoke` job.
11. **`openspec/specs/deployment-devops/spec.md`** — MODIFIED delta (1 new requirement + 5 new scenarios + 3 rewrites + 1 dotenv scenario).

### B1a/B1b LESSONS applied rigorously

- **LESSON #1 (canonical sync gap):** apply phase MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md` atomically BEFORE marking task complete. If non-empty, loop until empty.
- **LESSON #2 (pre-merge fix + cherry-pick reorder):** if verify catches a critical issue (e.g., dotenv guard breaks test env), apply uses pre-merge fix commit + cherry-pick reorder to preserve 2-commit shape.
- **LESSON #3 (plan artifacts in repo):** archive phase MUST commit `proposal.md` + `design.md` + `tasks.md` + `exploration.md` to `archive/2026-06-23/` before declaring done.
- **LESSON #4 (path/env var completeness):** every `/var/backups/athlos` → `$BACKUP_DIR`; every `/legacy` → `$LEGACY_DB_PATH`; every `athlos-api` tag matches compose `image:`.
- **LESSON #5 (apply self-verification atomicity):** diff check is exhaustive — covers every changed scenario, not just the new section.

---

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `Dockerfile` | Rewrite (8L → ~50L) | Real multi-stage build replaces placeholder |
| `docker-entrypoint.sh` | New (~40L) | Entrypoint wrapper for migrations + backup |
| `docker-compose.yml` | Rewrite (65L → ~110L) | Real prod stack replaces placeholder |
| `.env.example` | Extend (+10L) | New `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BUILD_SHA`, `POSTGRES_*` examples |
| `.dockerignore` | Extend (+5L) | Add `openspec/`, `.atl/`, coverage, `.husky/` |
| `docs/runbook.md` | Extend (+25L) | New `## Containerized Deploy (Docker)` section |
| `.github/workflows/test.yml` | Extend (+10L YAML) | New `docker-build-smoke` job |
| `apps/api/src/index.ts` | Modify (+3L, +1 guard) | `dotenv/config` conditional import (spec fix) |
| `apps/api/test/dotenv-guard.test.ts` | New (~30L) | Vitest regression test for dotenv guard |
| `openspec/specs/deployment-devops/spec.md` | MODIFIED delta (~30 net lines) | New requirement + 5 scenarios + 3 rewrites + 1 dotenv scenario |
| `openspec/changes/explore-athlos-deploy-slice-c/exploration.md` | Move | To `archive/2026-06-23/exploration.md` |
| Server (Ubuntu 24.04 LTS) | Operational | First deploy: `docker compose up -d` (atomic) |

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | **`dotenv/config` guard breaks local dev or test env** | Low | Vitest test explicitly asserts `NODE_ENV=production` skips dotenv; `container.ts:151` `validateEnv()` throws clear error on missing `JWT_SECRET`; runbook documents: "Production requires `.env.production` mounted via compose `env_file` (not `.env`)." If operator runs `NODE_ENV=production pnpm dev`, they see a clear error, not silent corruption. |
| 2 | **Entrypoint race: `pg_isready` passes but `drizzle-kit migrate` fails** | Low | `set -euo pipefail` in entrypoint kills container on any non-zero exit; `depends_on: db: condition: service_healthy` ensures Postgres is fully ready; Drizzle migrator uses internal advisory-lock semantics; compose `restart: unless-stopped` retries 3× before giving up; runbook documents "if api container keeps restarting, run `docker compose logs api`." |
| 3 | **Image size + build time** (~150 MB, ~3 min CI build) | Medium | `pnpm fetch` uses lockfile cache (re-runs are fast if lockfile unchanged); Buildx cache mounts (`--cache-from type=local`) drops subsequent builds to ~30s; 150 MB Alpine is small for self-hosted single-node; Slice D can add registry cache for further reduction. |
| 4 | **Legacy data volume mount** (UNC Samba path not reachable inside container) | Medium | Named volume `legacy_data` mounted at `/legacy:ro`; runbook documents "Operator must mount the Samba share on the host BEFORE `docker compose up` (use `/etc/fstab` for auto-mount)"; Server Infra doc §7 already covers Samba mount strategy; if Samba disconnects mid-deploy, api starts but import job fails at runtime (acceptable, matches current behavior). |
| 5 | **Canonical spec sync gap (B1a/B1b LESSON #1 — HIGH recurrence)** | **HIGH** | Apply phase MUST run `diff delta vs canonical` atomically BEFORE marking canonical-sync task complete (exhaustive — covers every new + rewritten scenario). Verify phase MUST grep for each new scenario title in canonical. Archive phase MUST do final diff. 2-commit shape preserved via pre-merge fix + cherry-pick reorder pattern if verify catches drift. **This is the most likely failure mode if lessons are forgotten.** |

---

## Acceptance Criteria

- [ ] `docker build -t athlos-api:test .` succeeds; final image size ≤ 300 MB (Alpine target ~150 MB).
- [ ] `docker compose up -d` brings up `api` + `db`; `pg_isready` passes within 30s; entrypoint runs migrations when `RUN_MIGRATIONS=true`; API process starts.
- [ ] `docker compose ps` shows both `api` and `db` as `healthy` within 60s of `up -d`.
- [ ] `curl http://localhost:3001/health/ready` returns 200 with `{"status":"ready"}`.
- [ ] `docker compose run --rm api bash -c 'echo $RUN_MIGRATIONS'` returns `true` (env propagated).
- [ ] With `RUN_MIGRATIONS=true` and a new pending migration, `docker compose restart api` applies the migration on restart.
- [ ] With `BACKUP_BEFORE_MIGRATE=true`, a `athlos-<ts>.sql.gz` appears in `$BACKUP_DIR` BEFORE the migration runs (entrypoint order verified in logs).
- [ ] `apps/api/src/index.ts:3` does NOT load `dotenv/config` when `NODE_ENV=production` (vitest test `dotenv-guard.test.ts` verifies).
- [ ] `bats scripts/tests/*.test.bats` still all PASS (B1a + B1b scripts unchanged).
- [ ] `pnpm test:run` passes (464 existing + N new vitest tests for dotenv guard).
- [ ] `pnpm lint` + `pnpm typecheck` pass with zero errors.
- [ ] `grep -c "s3://" openspec/specs/deployment-devops/spec.md` = 0 (S3 drift reconciled).
- [ ] `grep -c "RUN_MIGRATIONS" openspec/specs/deployment-devops/spec.md` ≥ 1.
- [ ] `grep -c "Containerized Deploy" openspec/specs/deployment-devops/spec.md` = 1 (new requirement present).
- [ ] `grep -c "BACKUP_DIR" openspec/specs/deployment-devops/spec.md` ≥ 1 (reconciled from `s3://`).
- [ ] `docker build .` in CI's `docker-build-smoke` job succeeds.
- [ ] `git show HEAD~1:package.json | grep version` = `0.4.4`; `git show HEAD:package.json | grep version` = `0.4.5` (or `0.5.0` — see Open Questions).
- [ ] `diff openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md openspec/specs/deployment-devops/spec.md` is empty (canonical sync verified — B1a/B1b LESSON).
- [ ] Archive phase commits `proposal.md`, `design.md`, `tasks.md`, `exploration.md` to `archive/2026-06-23/` (B1a/B1b LESSON #3).

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | **~315** |
| 400-line review budget risk | **LOW (~79%)** |
| Chained PRs recommended | **No** (single autonomous unit; Slice D is separate) |
| Suggested split | N/A |
| 2-commit structure | `feat: deploy containerization (slice C)` + `chore(release): v0.4.5` (or `v0.5.0`) |
| Work-unit count | ~14 (1 per file/group + planning artifacts + verify + release) |

---

## Key Decisions (locked from explore, do not reopen)

| # | Decision | Locked value | Source |
|---|----------|--------------|--------|
| Q1 | Base image | `node:22-alpine` | explore §5 Q1 |
| Q2 | Multi-stage | 2-stage (deps + runtime) | explore §5 Q2 |
| Q3 | Image registry | `ghcr.io/victor0451/athlos-api` (forward-compat with Slice D; not pushed in Slice C) | explore §5 Q3 |
| Q4 | Compose services | `api + db` only (migrations in api entrypoint) | explore §5 Q4 |
| Q5 | Migration strategy | `RUN_MIGRATIONS=true` in entrypoint (atomic, no race) | explore §5 Q5 |
| Q6 | BACKUP_BEFORE_MIGRATE | yes, entrypoint calls `scripts/backup.sh` to local `$BACKUP_DIR` (reconciles S3→local drift) | explore §5 Q6 + ADR #30 |
| Q7 | Secrets | `.env.production` via compose `env_file:` | explore §5 Q7 |
| Q8 | Health checks | `api` hits `/health/ready` 30s interval, 5s timeout, 5 retries, 30s start_period | explore §5 Q8 |
| Q9 | Logging | json-file driver with rotation `max-size: 10m, max-file: 3` (both services) | explore §5 Q9 |
| Q10 | CI build image + push | no push; add lightweight `docker-build-smoke` CI job for regression guard | explore §5 Q10 |
| Q11 | First deploy | `docker compose up -d` (atomic, includes migrations via entrypoint) | explore §5 Q11 |

---

## Open Questions

1. **Version bump:** patch `v0.4.4 → v0.4.5` (recommended — operational infra, no user-facing change, matches B1a/B1b patch pattern) or minor `v0.5.0` (containerization could be argued as "user-visible new capability" since it changes the deploy story)?
2. **Health check interval tuning:** 30s interval / 5s timeout / 5 retries / 30s start_period (recommended defaults) — different timing for slower servers (e.g., 60s interval for HDD-bound environments)?
3. **First deploy verification strategy:** `docker compose ps` + `curl /health/ready` (recommended) — different check pattern (e.g., `docker compose run --rm api node -e "require('./dist/health')"` smoke test)?
4. **Spec delta shape:** REPLACE the 3 stale scenarios IN-PLACE in `deployment-devops/spec.md` (recommended per B1a/B1b pattern — keeps canonical clean), or APPEND new versions with `_v2` suffix (preserves history but bloats canonical)?
5. **`docker-build-smoke` job scope:** full build + smoke run (recommended, ~3 min) or just `docker build` (~2 min, faster regression loop but weaker signal)?

---

## Rollback Plan

**If the PR has not yet merged:**
- `git reset --hard origin/main` (revert local commits)
- `git push origin :athlos-deploy-slice-c-containerized-deploy` (delete branch)

**If the PR has merged to main but no deploy yet:**
- `git revert <merge-sha> --no-edit`
- `git push origin main`
- Bump `version` in `package.json` back to `0.4.4`

**If the PR has merged AND a `docker compose up -d` has been run on the server:**
- `docker compose down` (stops services, preserves volumes)
- `git revert <merge-sha>` + push
- Rebuild + redeploy from previous image tag (Slice C's image is the first real one; pre-Slice-C was `pnpm dev` in a tmux session, no image to roll back to — manual recovery needed)
- For data safety: `scripts/restore.sh` from B1a can recover from `$BACKUP_DIR`

**Critical data safety:** B1a's `scripts/backup.sh` is INDEPENDENT of Slice C's container stack (it runs on the host via cron, not inside the container). Rolling back Slice C does NOT affect the daily backup pipeline.

---

## Dependencies

- **B1a shipped** (v0.4.3) — `scripts/backup.sh` is callable from inside the container (pure bash + `pg_dump`, no Node deps).
- **B1b shipped** (v0.4.4) — USB rotation pipeline is independent of Slice C.
- **Server Infra §6.I** — Docker Engine + Compose v2 plugin installed on the Ubuntu 24.04 server.
- **`apps/api/dist/index.js`** exists (built artifact, ready to copy into runtime image).
- **`packages/db/drizzle/0000…0011.sql`** — 12 migration files present, ready to copy.
- **`scripts/lib/common.sh`** — shared helpers from B1a/B1b, sourceable from entrypoint.

---

## Success Criteria

- [ ] `docker compose up -d` succeeds on a clean Ubuntu 24.04 server with Docker installed.
- [ ] `docker compose ps` shows both services `healthy` within 60s.
- [ ] API responds `200 OK` on `/health/ready` within 30s of `up -d`.
- [ ] All 3 critical spec drifts reconciled (`dotenv/config` guard, S3→local, 3 stale scenarios).
- [ ] All 5 locked decisions from Q1-Q11 implemented as specified.
- [ ] No existing tests broken (464 TS + B1a/B1b bats all green).
- [ ] CI `docker-build-smoke` job passes.
- [ ] Archive phase commits all 4 planning artifacts to repo (LESSON #3).
- [ ] Canonical spec sync verified by `diff` (LESSON #1).
- [ ] Runbook's `## Containerized Deploy (Docker)` section matches reality.

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-c-containerized-deploy/proposal.md`*
- *Engram topic `sdd/athlos-deploy-slice-c-containerized-deploy/proposal`*
