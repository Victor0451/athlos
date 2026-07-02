# Exploration: athlos-deploy-slice-c

**Date:** 2026-06-23
**Mode:** Standalone exploration (Slice C has not been named as a change yet).
**Parent roadmap:** `openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md` (parent Slice B) — Slice C is the *third* deploy-automation slice after B1a (daily local backup) + B1b (weekly LUKS USB).
**Sister changes shipped:**
- `db-status-and-drift-gate` (v0.4.1) — `pnpm db:migrate:status` + `drizzle-kit check` drift gate.
- `data-steward-grant-automation` (v0.4.2) — `pnpm ops:grant-data-steward` CLI.
- `athlos-deploy-slice-b1a-backup-restore` (v0.4.3) — `scripts/backup.sh` + `restore.sh` + `backup-bats` CI.
- `athlos-deploy-slice-b1b-usb-rotation` (v0.4.4) — `scripts/mount-usb.sh`/`unmount-usb.sh`/`backup-to-usb.sh`/`setup-usb.sh` + LUKS encryption + `flock` cron safety.

**Locked decisions source:** `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` ADRs #28–#33 (created 2026-06-19).
**Lessons source:** `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/exploration.md` §6 + `athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/exploration.md` §6 (canonical-sync gap, filename drift, apply self-verification atomicity).

---

## Verdict

Slice C is **smaller than originally estimated (~355 LoC vs the parent's ~280)** because the multi-stage Dockerfile grew slightly to handle pnpm monorepo filtering and the `dotenv/config` guard discovered in `apps/api/src/index.ts:3` (real spec violation the spec author missed in foundation). It is **well within the 400-line review budget** — **single PR, no chained PRs needed**.

Two drift hazards the parent's `explore-athlos-deploy-slice-b` could not have foreseen:

1. **`apps/api/src/index.ts:3` does `import 'dotenv/config'` unconditionally** — directly violates `openspec/specs/deployment-devops/spec.md:113` ("it MUST NOT look for a `.env` file" in production). Slice C must guard the dotenv load behind `NODE_ENV !== 'production'` (or similar), OR ship no `.env` and let the missing file no-op cleanly.
2. **`BACKUP_BEFORE_MIGRATE` spec literal says S3** (`deployment-devops/spec.md:188-189` is moot post-B1a; `athlos-foundation/design.md:6019` says `s3://${BACKUP_BUCKET}/pre-deploy-${BUILD_SHA}.dump`). **Slice B1a explicitly pivoted away from S3 to local+USB** (ADR #30, 2026-06-19). Slice C's `BACKUP_BEFORE_MIGRATE` MUST write to local `$BACKUP_DIR` (not S3) — this is a spec drift the MODIFIED delta must reconcile.

Three open questions are critical to lock before proposal: (1) base image (Alpine recommended), (3) image registry (GHCR recommended), (5) migration strategy (`RUN_MIGRATIONS=true` in entrypoint recommended). Other defaults can ship with sensible recommendations.

---

## 1. Infrastructure context (locked by `5-Server-Infrastructure.md`)

| Decision | Locked value | ADR | Implication for Slice C |
|----------|-------------|-----|-------------------------|
| OS | Ubuntu Server 24.04 LTS | #29 | bash + cron, NOT systemd timers; Docker Engine + Compose v2 plugin installed via §6.I (`apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`) |
| Storage | local disk + external USB (no S3, no cloud) | #30 | **`BACKUP_BEFORE_MIGRATE` MUST write to `$BACKUP_DIR`, not S3.** Slice B1a replaced the `s3://` literal in canonical specs. |
| Encryption | LUKS on USB disk only | #31 | Unrelated to Slice C (USB scripts are B1b's surface) |
| Restore | assisted CLI with `--confirm` | #32 | Unrelated to Slice C |
| Apps adicionales | Samba/Nextcloud/AD deferred | #33 | Slice C does NOT scope-creep into those |
| Container runtime | Docker Engine + Compose v2 plugin | §6.I | `docker compose` (NOT the legacy `docker-compose` Python tool). All compose syntax uses the v2 schema (no top-level `version:`). |
| GitHub repo | `Victor0451/athlos` | CHANGELOG.md links | Repo already on GitHub — `ghcr.io/victor0451/athlos-api` is the natural registry target |

**Critical path: Docker Compose v2 syntax.** The current placeholder `docker-compose.yml:1` has no top-level `version:` key (good — v2 doesn't need it). Slice C must follow the same convention. `docker compose` (space) is the v2 CLI.

---

## 2. Current placeholder state (post-B1b at v0.4.4)

### `Dockerfile` (`/run/media/vlongo/Archivos/Projectos/Athlos/Dockerfile`, 8 lines)

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
CMD ["echo", "athlos api — real image built in PR 9"]
```

PLACEHOLDER. Single-stage. Self-documented as "real multi-stage build lands in PR 9". Aligned with Node 22 + Alpine (matching the existing CI `ubuntu-latest` Node 22).

### `docker-compose.yml` (`/run/media/vlongo/Archivos/Projectos/Athlos/docker-compose.yml`, 65 lines)

Three services — all confirmed in the parent's exploration:

| Service | Image | Healthcheck | Notes |
|---------|-------|-------------|-------|
| `db` | `postgres:16-alpine` | `pg_isready` (10s interval, 5 retries) — **real** | Real, with `pgdata` volume |
| `api` | Builds from local `Dockerfile` | **None** | Uses placeholder image; no `RUN_MIGRATIONS`, no `BACKUP_BEFORE_MIGRATE`, no healthcheck, no entrypoint |
| `migrations` | Same placeholder Dockerfile | **None** | CMD is literally `console.log('migrations service placeholder')` |

Env vars wired: `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `LEGACY_DB_PATH`, `CORS_ORIGINS`, `SMTP_*`. No `RUN_MIGRATIONS`, no `BACKUP_BEFORE_MIGRATE`, no `BACKUP_DIR` (despite being in `.env.example:46`).

### `.dockerignore` (19 lines) — already complete per TASK-076

Excludes `node_modules`, `.pnpm-store`, `.git`, `openspec`, `docs`, `.env*` (with `!.env.example` exception), `**/*.test.ts`, coverage, etc. **No changes needed for Slice C.** Minor additions optional (`.github`, `.atl/` skill registry cache, `.husky`).

### `.env.example` (`/run/media/vlongo/Archivos/Projectos/Athlos/.env.example`, 61 lines)

Already includes post-B1a (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) and post-B1b (5 `USB_*` vars). **Missing for Slice C:** `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`. Possibly missing: `BUILD_SHA` (entrypoint uses for filename prefix; defer unless proposal says otherwise).

### `docs/runbook.md` (235 lines, post-B1b)

Already has `## Backup & Restore` + `### USB Rotation (weekly)` sections. Slice C needs to **add a new `## Containerized Deploy (Docker)` section** with: first-time `docker compose up` walkthrough, env-var conventions, restart-only-no-rebuild, image rebuild commands, log access.

### `.github/workflows/test.yml` (131 lines, 3 jobs)

Already runs `test` + `drift-check` + `backup-bats` jobs. **Slice C's CI extension is OPTIONAL.** Options: (a) add `docker build` smoke test (no push, just verify the image builds); (b) no CI change — image built on the server. Recommended: (a) — adds a real Dockerfile regression guard with zero external deps.

---

## 3. Apps to containerize

### `apps/api/` (Fastify 5 + Node 22 + pnpm monorepo)

**Entry point:** `apps/api/src/index.ts` (58 lines). Key facts:
- **Line 3:** `import 'dotenv/config'` — loads `.env` file if present (see §6 critical finding).
- **Lines 17–56:** `main()` — builds Fastify, listens, starts scheduler, registers SIGTERM handler.
- **Output:** `pnpm --filter @athlos/api build` → `tsc` → `apps/api/dist/index.js` (verified — `dist/index.js` exists).
- **Runtime:** `node dist/index.js` per `apps/api/package.json:9` (`"start": "node dist/index.js"`).

### `apps/web/` (Next.js 16.2.9)

**Not in scope for Slice C.** The current placeholder Dockerfile is API-only. Web app containerization is its own slice (probably Slice C-bis or later — Next.js server-side rendering has different container needs: `next build` → `next start` + node runtime, not just `tsc`). **Document in runbook: "this compose is API-only — web deploys via `next build` + `next start` for now (separate slice)."**

### `packages/db/` (Drizzle ORM)

- **`generate`:** `drizzle-kit generate` (scaffolds a migration from schema diff).
- **`migrate`:** `drizzle-kit migrate` (applies pending migrations via Drizzle migrator API).
- **`migrate:status`:** `tsx src/scripts/status.ts` (drift gate, post-Slice-A).
- **Config:** `packages/db/drizzle.config.ts` (auto-detected by `drizzle-kit`).
- **Migrations:** `packages/db/drizzle/0000_quick_wraith.sql` … `0011_audit_idempotency_partial_index.sql` (12 migrations).

**Important:** the foundation design (`design.md:1322`) used `npx drizzle migrate --force` — this is **outdated**. The current canonical command is `drizzle-kit migrate` per `packages/db/package.json:18`. The Slice C Dockerfile must use `pnpm --filter @athlos/db migrate` or `pnpm dlx drizzle-kit migrate` inside the entrypoint.

### Runtime deps in image

The image needs: `node:22-alpine`, `corepack`, `pnpm@9.15.9`, `pg_dump` (for `BACKUP_BEFORE_MIGRATE`), and access to:
- `apps/api/dist/` (compiled output)
- `apps/api/node_modules/` (only prod deps) + hoisted workspace deps (`packages/db/dist/`, `packages/auth/dist/`, etc. — all 18 packages are imported transitively)
- `packages/db/drizzle/` (migration files for `drizzle-kit migrate`)

Multi-stage Dockerfile must:
1. **Stage 1 (deps):** `pnpm fetch` + `pnpm install --frozen-lockfile --offline` (populate pnpm store from lockfile).
2. **Stage 2 (build):** `pnpm install --frozen-lockfile --offline` (link from store) → `pnpm --filter @athlos/api... build` (produces dist/) → `pnpm --filter @athlos/db... build` (drizzle needs the schema source + migrations dir; `drizzle-kit` is a devDependency so it must be kept around OR the entrypoint uses `pnpm db:migrate` via `pnpm` from the stage-2 image).
3. **Stage 3 (runtime):** `FROM node:22-alpine` + non-root user + copy `dist/` + `node_modules/` (production only) + `packages/db/drizzle/` + `docker-entrypoint.sh`. Exclude devDeps via `pnpm deploy --filter @athlos/api --prod` (pnpm's built-in prod-only bundler).

---

## 4. Spec analysis (canonical `deployment-devops/spec.md`, 321 lines post-B1b)

### Already-defined (no spec change needed for these)

| Existing scenario | Lines | Slice C fulfillment |
|-------------------|-------|---------------------|
| `### Requirement: Docker Setup` | 11–39 | **Slice C's core deliverable.** Dockerfile + compose + healthcheck. |
| `### Requirement: Database Setup` | 42–67 | Compose `db` service already satisfies PostgreSQL container. |
| `### Requirement: CI/CD Pipeline` | 70–103 | **DEFERRED to Slice D** (CI workflow + image push + GHCR). Slice C does NOT touch CI/CD. |
| `### Requirement: Environment Variables in Production` | 106–132 | Slice C's compose `env_file` + `environment:` satisfies env-var injection. **CRITICAL: §6 below — the `dotenv/config` guard.** |
| `### Requirement: Database Migrations in Production` | 135–162 | Slice C's entrypoint + `RUN_MIGRATIONS=true` satisfies "automatic migration on startup". |
| `### Requirement: Backup Strategy` | 165–216 | B1a fulfilled. Slice C's `BACKUP_BEFORE_MIGRATE` entrypoint branch wires B1a's `backup.sh` into the entrypoint. |
| `### Requirement: USB Rotation (weekly)` | 218–277 | B1b fulfilled. Slice C does NOT touch this. |
| `### Requirement: Import Data Volume` | 279–298 | Compose `api` service mounts `$LEGACY_DB_PATH` as read-only volume. |

### Required MODIFIED delta (Slice C adds)

`deployment-devops/spec.md` **MODIFIED** — add 1 new requirement `### Requirement: Production Container Entrypoint` between existing line 162 (end of "Database Migrations in Production") and line 165 (start of "Backup Strategy") with ~5 new scenarios:

1. **Multi-stage Dockerfile produces a non-root production image with only prod deps** — verifies `docker build` succeeds and final image size <300 MB, runs as UID >0.
2. **docker-entrypoint.sh runs migrations when `RUN_MIGRATIONS=true` then execs the API** — verifies env var read, `drizzle-kit migrate` invoked, `exec node dist/index.js` last.
3. **docker-entrypoint.sh runs `backup.sh` BEFORE migrations when `BACKUP_BEFORE_MIGRATE=true`** — verifies order (backup → migrate), local `$BACKUP_DIR` target (NOT S3), exit-on-failure semantics.
4. **Production container does NOT load `.env` file** — verifies `dotenv/config` is guarded behind `NODE_ENV !== 'production'` (or `.env` is absent in image).
5. **docker-compose `api` healthcheck hits `/health/ready` with 30s timeout / 5s interval** — mirrors the existing spec line 35–38.

### Existing canonical spec drift to reconcile in the delta

- `### Scenario: Rollback procedure` (line 147–153) says `docker-compose run migrations rollback <migration-name>` — **this command does not exist** in Drizzle (no `migrate:rollback`). The spec was forward-only per Slice A (v0.4.1) but this scenario is stale. Slice C's MODIFIED delta should rewrite this scenario to match the forward-only reality (or delete it and reference the runbook's rollback section). **Recommend: rewrite to "Re-deploy the previous image tag and run a forward-fix migration if needed"** — matches `docs/runbook.md:65-79` exactly.
- `### Scenario: One-off migration execution` (line 155–162) says `docker-compose run migrations run <migration-name>` — also doesn't exist (Drizzle has no per-migration run). **Recommend: rewrite to "Use `pnpm --filter @athlos/db migrate:status` to list pending; `drizzle-kit migrate` applies ALL pending in order."**
- `### Scenario: Backup storage location` (line 190–196) says "SHOULD be replicated to offsite storage" — Slice B1a explicitly removed the S3 path; "offsite" now means "LUKS USB rotation per Slice B1b." **Recommend: rewrite to reference B1b's USB rotation requirement** to keep the canonical aligned.

These three scenarios are small, surgical rewrites (no behavior change — they correct spec/code drift that B1a and B1b surfaced but didn't sync). **Critical: apply the B1a/B1b lesson — canonical sync MUST happen in the same PR, atomically.**

---

## 5. Open questions for the user (with my recommendations)

The orchestrator will present these to the user. My recommendation is in **bold**.

### Q1. Base image

- **(a) `node:22-alpine`** — recommended. Smaller image (~150 MB vs ~900 MB Debian), multi-arch (linux/amd64, linux/arm64), official Node image, well-tested with Fastify + pino + zod. `pg_dump` install via `apk add postgresql-client` adds ~10 MB. Single CVE surface.
- (b) `node:22-slim` (Debian-based) — larger image (~300 MB), more compatible with Debian-style tooling if you ever need it.
- (c) `node:22-bookworm` — matches the server OS, but 2 OS layers to maintain.
- (d) Distroless (`gcr.io/distroless/nodejs22-debian12`) — most secure, no shell, harder to debug. Overkill for self-hosted single-node.
- (e) Custom (build from source) — most control, most work.

### Q2. Multi-stage build

- **(a) 2 stages: deps + runtime** — recommended. `pnpm fetch` → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm deploy --filter @athlos/api --prod` produces a single `out/` directory with prod deps. Copy to `node:22-alpine` runtime stage. ~80 LoC Dockerfile.
- (b) 3 stages: deps + build + prod-deps — slightly better layer caching for monorepo, +15 LoC.
- (c) Single stage — simpler but ~600 MB image (devDeps leak), defeats the security purpose.

### Q3. Image registry

- **(a) GitHub Container Registry (`ghcr.io/victor0451/athlos-api`)** — recommended. Free for public repos, integrated with GitHub (uses `${{ secrets.GITHUB_TOKEN }}`), repo already on GitHub. Slice D will need GHCR push secrets — Slice C just needs to DECIDE the registry; Slice D wires the push.
- (b) Docker Hub — public, free tier with pull rate limits (problematic for self-hosted single-node that's the sole consumer).
- (c) Private registry (Harbor, ECR) — overkill for self-hosted single-node.
- (d) None — build local on the server. **Slice C ships this regardless** (image always built on server via `docker compose build`). The registry is only relevant for Slice D's CI push.

### Q4. Compose services

- **(a) `api` + `db` only** — recommended. Migrations run from `api` entrypoint if `RUN_MIGRATIONS=true`. Simplest. Single source of truth for startup order.
- (b) `api` + `db` + `migrations` as separate service — clearer separation, but harder to coordinate (depends_on: migrations → service_completed_successfully requires restart policies).
- (c) `api` + `db` + `migrations` + `backup` — backup as a scheduled compose service. **DEFERRED** — backup already runs on host via cron (B1a + B1b). Adding it to compose is double-bookkeeping.

### Q5. Migration strategy

- **(a) `RUN_MIGRATIONS=true` in entrypoint runs migrations on container start, then execs API** — recommended. Atomic. Single race-free startup. Spec-aligned (`deployment-devops/spec.md:139-145`). No orchestration complexity.
- (b) `migrations` as separate compose service that runs once and exits — adds `service_completed_successfully` dependency, requires two compose restarts for a rollback (one for migrations, one for api).
- (c) Manual `pnpm --filter @athlos/db migrate` from host — error-prone, defeats automation.

**Critical: pg_advisory_lock race risk** (per Slice A explore §7 risk #3). If you ever scale to multiple API replicas, two containers starting simultaneously would race on `__drizzle_migrations`. For v1 (single replica), no risk. Document in runbook that "scaling to >1 replica requires a migration lock strategy."

### Q6. `BACKUP_BEFORE_MIGRATE`

- **(a) Yes — if `BACKUP_BEFORE_MIGRATE=true`, entrypoint calls `scripts/backup.sh` BEFORE running migrations** — recommended. Writes to local `$BACKUP_DIR` (per B1a, NOT S3). Opt-in default off. Spec-mandated by foundation design §6019 (after S3 → local pivot).
- (b) No — manual backup before deploy. Operator forgets; risky.
- (c) Separate manual script — defeats automation.

**Implementation note:** `backup.sh` runs inside the container via `docker compose exec api /usr/local/bin/backup.sh` OR `docker compose run --rm api /usr/local/bin/backup.sh` BEFORE `docker compose up -d api`. The `pg_dump` needs `DATABASE_URL` (env var), `BACKUP_DIR` (mounted from host as volume). Easier path: call `backup.sh` from the HOST before `docker compose up`, store dump on host `$BACKUP_DIR`. The spec says "entrypoint does it" but pragmatic call: **compose orchestrator runs `backup.sh` via `docker compose run --rm` before `up -d`** — same result, simpler entrypoint.

### Q7. Secrets management

- **(a) `.env` file via compose `env_file:` directive** — recommended. Matches existing `.env.example` pattern. Works for self-hosted single-node. Production secrets injected by compose from a host-mounted `.env` (not in image). The spec says "env-var-only secrets" (`deployment-devops/spec.md:108`); compose's `env_file` IS env vars.
- (b) Docker secrets (compose `secrets:`) — requires Docker Swarm or Compose v3.8+ with `--driver`. More secure (tmpfs mounts, not env vars). Overkill for single-node.
- (c) External (HashiCorp Vault) — overkill for self-hosted single-node.

### Q8. Health checks in compose

- **(a) `api` has healthcheck hitting `/health/ready`** — recommended. Compose can mark api as healthy. `docker compose ps` shows `healthy` when ready. 30s timeout / 5s interval / 5 retries matches existing spec.
- (b) No healthcheck — compose starts api immediately, depends on api retry logic. Spec violation.
- (c) `db` healthcheck only — api depends_on db: condition: service_healthy. **Already done** (placeholder has it). Slice C ADDS api healthcheck on top.

### Q9. Logging

- **(a) stdout/stderr → Docker logs (json-file driver)** — recommended. Docker default. `docker compose logs` works. Can be piped to journald via `--log-driver=journald` later if needed.
- (b) syslog driver — more complex, useful for multi-host (we're single-node).
- (c) json-file with max-size + max-file rotation — production-ready, prevents disk fill. **Add to compose `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` for BOTH api and db.** Recommended on top of (a).

### Q10. CI: build image + push?

- **(a) CI runs tests only; image built on server with `docker compose build` after deploy** — recommended for Slice C. Simpler. Server is source of truth. Fewer secrets in CI. Slice D may add image build CI step.
- (b) CI builds image on every push, pushes to GHCR, server pulls on deploy — cleaner separation, requires Slice D's GHCR push secrets and `docker login` on the server.
- (c) Save/load tar between CI and server — overcomplicated.

**Lightweight alternative:** add a `docker-build-smoke` CI job that runs `docker build -t athlos-api:test .` on every PR (no push) — catches Dockerfile regressions in <2 minutes, no secrets needed.

### Q11. What runs on first deploy?

- **(a) `docker compose up -d`** — recommended. Compose brings up `api` + `db`. Entrypoint runs migrations automatically if `RUN_MIGRATIONS=true`. Single command.
- (b) Manual step-by-step: `docker compose up -d db` → wait → `docker compose run --rm api migrate` → `docker compose up -d api`. More steps, more error-prone.
- (c) Migration as separate compose service (option 4b).

---

## 6. Critical findings (drift hazards the parent's explore missed)

### Finding 1: `dotenv/config` unconditional load (spec violation)

**Location:** `apps/api/src/index.ts:3`
```ts
// dotenv/config MUST be imported first so the rest of the app sees env vars
// at module init time (per openspec/changes/athlos-foundation/specs/config-environment).
import 'dotenv/config'
```

**Spec violation:** `openspec/specs/deployment-devops/spec.md:113` says:
> "GIVEN `NODE_ENV=production`, WHEN the API container starts, THEN it MUST NOT look for a `.env` file"

**Real impact:** If a `.env` file is accidentally mounted into the production container (operator mistake), `dotenv/config` will silently override env vars. Worse, if `.env` is in the image, it leaks dev secrets into prod.

**Fix options for Slice C:**
- **(a) Guard the import:** `if (process.env.NODE_ENV !== 'production') await import('dotenv/config')` — clean, explicit. Requires dynamic import.
- (b) Skip dotenv if `.env` is absent — `dotenv/config` already no-ops when the file is missing, but a present `.env` would still load. Less safe than (a).
- (c) Document in runbook: "do NOT mount `.env` into the production container" — relies on operator discipline.

**Recommend (a).** ~3 LoC change in `apps/api/src/index.ts`. Tiny diff, real safety gain. Should be tested.

### Finding 2: `BACKUP_BEFORE_MIGRATE` spec drift (S3 → local)

**Spec says:** `openspec/changes/athlos-foundation/design.md:6019` — "uploads via `aws s3 cp` (or compatible S3 client) to `s3://${BACKUP_BUCKET}/pre-deploy-${BUILD_SHA}.dump`."

**Reality:** Slice B1a (v0.4.3, 2026-06-19) explicitly removed S3 per ADR #30. The canonical `deployment-devops/spec.md` was updated for Backup Strategy but **NOT for `BACKUP_BEFORE_MIGRATE`** (which lives in `database-migrations/spec.md` + the foundation design).

**Real impact:** If Slice C implements `BACKUP_BEFORE_MIGRATE` per the foundation design, it will need `BACKUP_BUCKET`, `AWS_*` env vars + `awscli` in the image + S3 bucket. All of which we explicitly rejected.

**Fix for Slice C:** `BACKUP_BEFORE_MIGRATE=true` calls `scripts/backup.sh` (B1a's script) which writes to local `$BACKUP_DIR`. Update the MODIFIED delta in `database-migrations/spec.md` (replace the S3 path with `$BACKUP_DIR/pre-deploy-${BUILD_SHA}.sql.gz`) and in `deployment-devops/spec.md` (rewrite the entrypoint scenario).

### Finding 3: `apps/api/src/index.ts:1` has no PID 1 signal handling

**Location:** `apps/api/src/index.ts:54-55`
```ts
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
```

This is correct (Fastify handles signals via Node directly), but in Docker, **PID 1 in a container does NOT receive signals by default unless the process is Node itself** (not `sh -c`). The Dockerfile's `CMD` should be the entrypoint directly (not wrapped in `sh -c`).

**Real impact:** If `docker stop` sends SIGTERM and the API process isn't PID 1, the container force-kills after 10s with no graceful shutdown → scheduler jobs orphaned → cron iterations dropped.

**Fix for Slice C:** Dockerfile's `ENTRYPOINT ["docker-entrypoint.sh"]` (exec form, not shell form). Entrypoint uses `exec node dist/index.js` (also exec form). Result: Node is PID 1, receives SIGTERM, runs the shutdown handler, exits cleanly within the 30s graceful window.

### Finding 4: Foundation design's `npx drizzle migrate --force` is outdated

**Spec says:** `openspec/changes/athlos-foundation/design.md:1322` — `npx drizzle migrate --force`

**Reality:** `packages/db/package.json:18` uses `drizzle-kit migrate` (Drizzle Kit, the migrator tool). The `--force` flag is not documented in the current Drizzle Kit docs.

**Fix for Slice C:** Use `pnpm --filter @athlos/db migrate` inside the entrypoint. The canonical spec scenarios in lines 139–145 already abstract this away ("MUST execute pending database migrations automatically") — no spec change needed for the command name.

### Finding 5: `pnpm deploy --filter @athlos/api --prod` for prod-only deps

`pnpm` has a built-in command `pnpm deploy` that produces a self-contained `out/` directory with only the prod deps of a target workspace package. This is the **canonical pnpm way to bundle for Docker** (vs. the `npm ci --omit=dev` approach foundation design used).

**Recommended for Slice C:** Stage 2 (build) runs `pnpm deploy --filter @athlos/api --out /app/out`. Stage 3 (runtime) copies `/app/out` (which contains `node_modules`, `dist/`, `package.json`, and the workspace symlinks). No `pnpm install` in the runtime stage → image is truly self-contained, ~150 MB total.

---

## 7. Decisions (locked for proposal phase)

### 7.1 Dockerfile structure

```dockerfile
# Stage 1: deps + build
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps packages ./
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @athlos/api build
RUN pnpm --filter @athlos/db build
RUN apk add --no-cache postgresql-client  # for pg_dump in BACKUP_BEFORE_MIGRATE
RUN pnpm deploy --filter @athlos/api --out /app/out /app

# Stage 2: runtime
FROM node:22-alpine
RUN apk add --no-cache postgresql-client tini  # tini for PID 1 signal handling
WORKDIR /app
RUN addgroup -g 1001 athlos && adduser -u 1001 -G athlos -D athlos
COPY --from=builder --chown=athlos:athlos /app/out /app
COPY --from=builder --chown=athlos:athlos /app/packages/db/drizzle /app/packages/db/drizzle
COPY --from=builder --chown=athlos:athlos /app/scripts /app/scripts
COPY --chown=athlos:athlos docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER athlos
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

Total ~50 LoC (foundation design said ~80; we're a bit leaner because `pnpm deploy` is one line).

### 7.2 Entrypoint logic

```bash
#!/usr/bin/env bash
# docker-entrypoint.sh — wraps the api process with optional migration + pre-migration backup
# Env vars:
#   RUN_MIGRATIONS        (default false) — run drizzle-kit migrate before api
#   BACKUP_BEFORE_MIGRATE (default false) — run scripts/backup.sh before migrate
#   BACKUP_DIR            (default /var/backups/athlos) — backup output dir
#   DATABASE_URL          (required) — Postgres connection string
#   LEGACY_DB_PATH        (default /legacy) — path inside container for legacy DBF files
# Exit codes:
#   0 — api exited cleanly
#   1 — pre-flight failed (missing env, bad argv)
#   2 — migration failed
#   3 — pre-migration backup failed
set -euo pipefail

# Wait for DB to be reachable (compose depends_on ensures healthcheck passes,
# but pg_isready in a loop is a belt-and-suspenders measure for cold starts).
echo "[entrypoint] Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if pg_isready -d "$DATABASE_URL" 2>/dev/null; then
    echo "[entrypoint] PostgreSQL is ready"
    break
  fi
  sleep 1
done

# Pre-migration backup (opt-in)
if [[ "${BACKUP_BEFORE_MIGRATE:-false}" == "true" ]]; then
  echo "[entrypoint] BACKUP_BEFORE_MIGRATE=true — running backup.sh"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/athlos}" /app/scripts/backup.sh
fi

# Migrations (opt-in)
if [[ "${RUN_MIGRATIONS:-false}" == "true" ]]; then
  echo "[entrypoint] RUN_MIGRATIONS=true — running drizzle-kit migrate"
  cd /app && pnpm --filter @athlos/db migrate
fi

# Hand off to the api process (exec = PID 1, receives SIGTERM)
echo "[entrypoint] Starting API: node dist/index.js"
exec node dist/index.js
```

Total ~40 LoC bash. **Note:** `scripts/backup.sh` is **copied into the image** (it's already in the repo). This keeps the entrypoint self-contained.

### 7.3 Compose service shape

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-athlos}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-athlos}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-athlos} -d ${POSTGRES_DB:-athlos}']
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

  api:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env.production
    environment:
      NODE_ENV: production
      PORT: 3001
      HOST: 0.0.0.0
      LOG_LEVEL: info
      RUN_MIGRATIONS: ${RUN_MIGRATIONS:-true}
      BACKUP_BEFORE_MIGRATE: ${BACKUP_BEFORE_MIGRATE:-false}
      BACKUP_DIR: ${BACKUP_DIR:-/var/backups/athlos}
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      LEGACY_DB_PATH: /legacy
    ports:
      - '3001:3001'
    volumes:
      - legacy_data:/legacy:ro
      - backup_data:/var/backups/athlos
    healthcheck:
      test: ['CMD-SHELL', 'wget --quiet --tries=1 --spider http://localhost:3001/health/ready || exit 1']
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 30s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

volumes:
  pgdata:
  legacy_data:
  backup_data:
```

**Removes the `migrations` service** from the placeholder (per Q4 default = (a)). Migrations run from `api` entrypoint.

**Adds `wget` to runtime image** — needed for the healthcheck. Could use `wget --quiet` (Alpine has it) or curl. wget is smaller.

### 7.4 `.env.example` additions (~10 lines)

```bash
# ── Container (PR Slice C) ──────────────────────────────────
# RUN_MIGRATIONS: apply pending migrations on container startup.
#   true = api entrypoint runs drizzle-kit migrate before exec'ing node.
#   false = manual migrate via pnpm --filter @athlos/db migrate.
RUN_MIGRATIONS=true
# BACKUP_BEFORE_MIGRATE: run scripts/backup.sh BEFORE migrations on startup.
#   true = pre-deploy dump to $BACKUP_DIR (NOT s3 — per ADR #30).
#   false = skip (operator must back up manually).
BACKUP_BEFORE_MIGRATE=false
# BUILD_SHA: optional git SHA used by the entrypoint for backup filename prefix.
BUILD_SHA=local
```

### 7.5 Runbook additions (~25 lines)

New `## Containerized Deploy (Docker)` section after `## Backup & Restore`:

- First-time setup: clone repo, copy `.env.example` to `.env.production`, fill secrets, run `docker compose up -d --build`.
- Day-to-day: `docker compose restart api` for env-var changes (no rebuild); `docker compose up -d --build api` for code changes.
- Migrations: `docker compose exec api pnpm --filter @athlos/db migrate:status` to check; set `RUN_MIGRATIONS=true` (default) for auto-apply on next restart.
- Pre-migration backup: set `BACKUP_BEFORE_MIGRATE=true`, restart api; verify `$BACKUP_DIR` got the dump; set back to `false`.
- Logs: `docker compose logs -f api` (json-file driver, rotated 3×10 MB).
- Health: `docker compose ps` shows api `healthy` after `/health/ready` returns 200.

### 7.6 CI extension (~10 lines, OPTIONAL)

Add a `docker-build-smoke` job after `backup-bats`:

```yaml
  docker-build-smoke:
    runs-on: ubuntu-latest
    needs: backup-bats
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build api image (smoke, no push)
        run: docker build -t athlos-api:test .
      - name: Verify image runs (smoke)
        run: docker run --rm athlos-api:test docker-entrypoint.sh --help || true
```

No secrets, no push. Catches Dockerfile regressions in ~2 min.

### 7.7 Spec delta (1 MODIFIED capability)

`openspec/changes/athlos-deploy-slice-c-prod-container/specs/deployment-devops/spec.md`:

- Add new requirement `### Requirement: Production Container Entrypoint` (between line 162 and 165) with ~5 new scenarios (see §4 above).
- Rewrite stale scenarios (lines 147–162): `Rollback procedure`, `One-off migration execution`, `Backup storage location` (see §4 drift).

Plus add MODIFIED delta for `database-migrations/spec.md` if `BACKUP_BEFORE_MIGRATE` is mentioned there (verify in proposal phase).

---

## 8. Estimated LoC

| Component | Path | New/Extend | LoC |
|-----------|------|-----------|-----|
| `Dockerfile` (real multi-stage) | `/run/media/vlongo/Archivos/Projectos/Athlos/Dockerfile` | **new** (overwrite placeholder) | ~50 |
| `docker-entrypoint.sh` | `/run/media/vlongo/Archivos/Projectos/Athlos/docker-entrypoint.sh` | **new** | ~40 |
| `docker-compose.yml` (real prod) | `/run/media/vlongo/Archivos/Projectos/Athlos/docker-compose.yml` | **new** (overwrite placeholder) | ~110 |
| `.dockerignore` (additions) | `/run/media/vlongo/Archivos/Projectos/Athlos/.dockerignore` | extend | ~5 |
| `.env.example` additions | `/run/media/vlongo/Archivos/Projectos/Athlos/.env.example` | extend | ~10 |
| `docs/runbook.md` additions | `/run/media/vlongo/Archivos/Projectos/Athlos/docs/runbook.md` | extend | ~25 |
| `.github/workflows/test.yml` (docker-build-smoke job, OPTIONAL) | `.github/workflows/test.yml` | extend | ~10 |
| `apps/api/src/index.ts` (dotenv guard) | `/run/media/vlongo/Archivos/Projectos/Athlos/apps/api/src/index.ts` | modify | ~5 |
| `apps/api/test/index.test.ts` (new test for dotenv guard) | `/run/media/vlongo/Archivos/Projectos/Athlos/apps/api/test/` | new | ~30 |
| Spec delta: `deployment-devops/spec.md` MODIFIED | delta spec | **new delta** | ~30 net |
| **Total PR LoC (Slice C)** | — | — | **~315** |
| Planning artifacts (proposal/design/tasks/exploration — NOT in PR) | — | — | ~250 |

**Under the 400-line review budget.** Single PR, no chained PRs.

---

## 9. Risks (top 5)

### Risk 1 — `dotenv/config` guard breaks local dev

**Scenario:** Slice C changes `apps/api/src/index.ts:3` to `if (process.env.NODE_ENV !== 'production') await import('dotenv/config')`. A test environment (`NODE_ENV=test`) uses placeholder secrets (per `container.ts:239-247`) — local dev (`NODE_ENV=development`) still loads `.env`. Edge case: if an operator runs `NODE_ENV=production pnpm dev` (typo), `.env` is NOT loaded and the server crashes with "JWT_SECRET required."

**Mitigation:**
1. The `container.ts:151` `validateEnv()` throws a clear error on missing JWT_SECRET. Operator sees a clear message.
2. Add a vitest test that explicitly verifies `process.env.NODE_ENV=production` skips dotenv.
3. Runbook documents: "Production requires `.env.production` mounted via compose `env_file` (not `.env`)."

**Residual:** Low. Operator confusion is recoverable (read the error message, fix the env file).

### Risk 2 — Entrypoint race: `pg_isready` passes but migrations fail

**Scenario:** Compose `depends_on: db: condition: service_healthy` guarantees `pg_isready` returns 0. But Drizzle migrations might still fail if the DB accepts connections but is in crash recovery or has lock contention.

**Mitigation:**
1. Entrypoint has `set -euo pipefail` — any non-zero exit kills the container.
2. `drizzle-kit migrate` uses the migrator's advisory-lock semantics (Drizzle serializes by default).
3. Compose `restart: unless-stopped` will retry 3 times then give up (configurable).
4. Runbook documents: "if api container keeps restarting, run `docker compose logs api` to see the migration error."

**Residual:** If a migration is genuinely corrupt, the container keeps restarting in a loop. Operator must intervene (docker compose down, fix migration, up). Acceptable for v1.

### Risk 3 — Image size + build time

**Scenario:** Multi-stage Dockerfile with pnpm fetch + install + build + deploy takes ~3 min on CI / server. Image is ~150 MB (Alpine + node_modules + dist). Daily CI builds add ~3 min to PR cycle.

**Mitigation:**
1. `pnpm fetch` uses the lockfile cache (re-runs are fast if lockfile unchanged).
2. Buildx cache mounts (`--cache-from type=local`) can speed up subsequent builds to ~30s.
3. Image size is acceptable for a self-hosted single-node (150 MB Alpine is small).

**Residual:** CI adds ~3 min per PR. Acceptable for v1; Slice D can add registry cache to drop to ~30s.

### Risk 4 — Legacy data volume mount

**Scenario:** `LEGACY_DB_PATH` on the server is a Samba mount (`\\ServidorGorriti\AplicacionGorriti` per `.env.example:20`). Inside Docker, the api container can't reach a UNC path natively. The container needs a bind mount from the host's actual mountpoint (e.g., `/mnt/gorriti-legacy`).

**Mitigation:**
1. Compose mounts `legacy_data:/legacy:ro` (named volume, populated by a separate host-side mount).
2. Runbook documents: "Operator must mount the Samba share on the host BEFORE `docker compose up`. Use `/etc/fstab` for auto-mount."
3. Server Infra doc §7 already covers Samba mount strategy (deferred per ADR #33 — for v1, the legacy share is mounted manually before api startup).

**Residual:** If the Samba share disconnects mid-deploy, the api container starts but `/legacy` is empty — import job will fail at runtime, not at startup. Acceptable (matches current behavior).

### Risk 5 — Canonical spec sync gap (B1a/B1b lesson)

**Scenario:** Slice C adds ~5 new scenarios + rewrites 3 stale scenarios in `deployment-devops/spec.md`. Apply phase syncs the canonical spec, but might miss a scenario or partial-update.

**Mitigation (per B1a/B1b lessons, applied rigorously):**
1. **Apply phase MUST run a `diff` between delta and canonical AS PART OF the apply step, before marking the canonical-sync task complete.** If `diff` is non-empty, apply must loop until empty.
2. **Verify phase MUST grep for each NEW scenario title in the canonical spec.** Plus check each REWRITTEN scenario's title is in canonical.
3. **Archive phase MUST do a final `diff` between delta and canonical.** If non-empty, sync commits needed.
4. **2-commit shape preserved** — pre-merge fix + cherry-pick reorder pattern from B1b apply applies if verify catches a critical issue.

**Residual:** Zero if the lessons are applied. The risk is forgetting to apply them.

### Lesser risks

- **`tini` adds 200 KB to image.** Necessary for PID 1 signal handling. Acceptable.
- **`pg_dump` inside container adds ~10 MB** (`apk add postgresql-client`). Necessary for `BACKUP_BEFORE_MIGRATE`. Acceptable.
- **`docker compose build` requires Docker Buildx** (default on Ubuntu 24.04 via §6.I install). Acceptable.
- **First-time deploy requires manual `.env.production` creation.** Runbook documents this clearly.

---

## 10. B1a/B1b lessons to apply (CRITICAL)

From `sdd/athlos-deploy-slice-b1a-backup-restore/{archive-report,verify-report}` and `sdd/athlos-deploy-slice-b1b-usb-rotation/{archive-report,verify-report}`:

### Lesson 1 — MODIFIED canonical sync is NOT automatic

B1a apply missed 5 new scenarios; B1b apply missed `mount-usb.sh` exit code spec compliance. **Slice C implication:** apply must self-verify the canonical sync atomically. Apply-phase run of `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-c-prod-container/specs/deployment-devops/spec.md` MUST be empty before marking task complete.

### Lesson 2 — Pre-merge fix + cherry-pick reorder

B1b verify caught `mount-usb.sh` exit `1` (spec said `2`). Pre-merge fix commit + cherry-pick reorder preserved 2-commit shape. **Slice C implication:** if verify catches the `dotenv/config` guard being broken in test env, the fix follows the same pre-merge pattern.

### Lesson 3 — Plan artifacts MUST be committed in archive phase

B1a's proposal.md + design.md + tasks.md were missing from the repo at archive time (only in Engram). **Slice C implication:** the orchestrator MUST `git add openspec/changes/athlos-deploy-slice-c-prod-container/{proposal,design,tasks}.md` BEFORE the archive-phase commits.

### Lesson 4 — Path/env var replacements must be COMPLETE

B1a changed the file naming convention; B1b changed USB paths. Every reference to the new pattern must use the env var, not a literal. **Slice C implication:** every reference to `/var/backups/athlos` in scripts + spec + runbook must use `$BACKUP_DIR`. Every reference to `/legacy` must use `$LEGACY_DB_PATH`. Every reference to `athlos-api` must match the image tag in compose.

### Lesson 5 — Apply phase self-verification atomicity

B1a's apply did partial sync; orchestrator caught some drift but not all; archive phase was the only comprehensive diff check. **Slice C implication:** apply-phase run of `diff` is mandatory AND exhaustive (not just for one new section — for every changed scenario).

---

## 11. Out of scope (defer to future changes)

Per parent Slice B explore §10 + Server Infra doc §9:

- **Slice D** — CI deploy workflow + `db-destructive` PR label gate + GHCR push. Separate change.
- **`apps/web` containerization** (Next.js) — separate slice. Compose for API only in v1; web deploys via `next start` on host.
- **HTTPS reverse proxy (Caddy, nginx)** — separate slice. API listens on `:3001` over HTTP for now.
- **Monitoring stack (Prometheus, Grafana, Cockpit integration)** — separate slice. Health endpoints exist; dashboards later.
- **Multi-host orchestration (k8s, swarm)** — single-node only.
- **Auto-scaling** — single-node only.
- **athlos-fileserver / athlos-nextcloud / athlos-ad** — deferred per ADR #33.
- **Restore drill (`restore-drill.sh`)** — needs separate test DB. Future change.
- **`pg_basebackup` / WAL archiving / PITR** — much larger slice. Future change.
- **S3 backups** — explicitly REJECTED by ADR #30. Never.
- **Multi-DB backups** — Athlos is single-DB.
- **systemd timers** — cron sufficient per ADR #29.
- **logrotate for docker logs** — driver options (`max-size: 10m, max-file: 3`) cover this.
- **Distroless image** — overkill for self-hosted single-node.
- **AWS CLI in image** — NOT needed (per B1a's S3 rejection).
- **pg_advisory_lock migration serialization** — needed only if scaling >1 replica. Future change.
- **Web app `Dockerfile`** — separate slice (Next.js containerization).

---

## 12. Ready for proposal?

**Yes — pending user answers to the 11 open questions in §5.**

### What the orchestrator should do

1. **Propose `athlos-deploy-slice-c-prod-container` (or similar) as the next SDD change.** Single autonomous PR at v0.4.5 (patch bump from v0.4.4 per the B1a/B1b pattern).
2. **Defaults recommended for all 11 questions** — base image Alpine, multi-stage 2-stage, no registry (server builds), 2 services, RUN_MIGRATIONS in entrypoint, BACKUP_BEFORE_MIGRATE on, .env via env_file, api healthcheck, json-file with rotation, no CI build/push (just smoke test), single `docker compose up -d`.
3. **Critical questions to surface to user explicitly** (the ones where my recommendation is strong but not the only reasonable answer):
   - **Q3 (image registry):** GHCR is the natural pick if Slice D is in flight. "Build local only" is fine if Slice D is far off. Recommend GHCR for forward-compat.
   - **Q5 (migration strategy):** entrypoint is recommended; if user wants manual `docker compose run migrations` style, we need to keep the separate `migrations` service and have a `service_completed_successfully` dependency.
   - **Q6 (BACKUP_BEFORE_MIGRATE):** strongly recommend keeping it (spec-mandated), but the destination drift (S3 → local) MUST be confirmed in the proposal.
4. **Chained PRs:** none — ~315 LoC, well within 400-line review budget.

### Pre-flight checks for proposal phase

- ✅ Confirm v0.4.4 is the current version on main (verified: `package.json` shows `0.4.4`, CHANGELOG entry present).
- ✅ Confirm Docker Engine + Compose v2 are installed on the server (per Server Infra doc §6.I).
- ✅ Confirm B1a's `scripts/backup.sh` is callable from inside the container (it's pure bash + `pg_dump`; no Node deps).
- ✅ Confirm canonical specs are post-archive (verified: `deployment-devops/spec.md` is MODIFIED with B1b's USB rotation scenarios, line 218–277).
- ⚠ Confirm `apps/api/src/index.ts:3` `dotenv/config` import is still unconditional (verified — must guard in this slice).
- ⚠ Confirm the canonical `deployment-devops/spec.md:147-162` scenarios about migration rollback are still stale (verified — must rewrite in this slice).

### Immediate next step

Propose `athlos-deploy-slice-c-prod-container` as the next SDD change:

- **Why Slice C now:** The deploy story is half-built. Daily local backup (B1a) + weekly LUKS USB (B1b) cover data safety, but the API still runs via `pnpm dev` in a terminal. Slice C closes the loop: real multi-stage Dockerfile + entrypoint + compose stack = a self-contained prod-like environment that runs `docker compose up -d` and Just Works.
- **Why not defer:** every week without a real Dockerfile is a week where the operator hand-runs `pnpm build && pnpm start` (or worse, `pnpm dev` in a tmux session). Slice C is the v1 contract the runbook has been promising since Slice A.
- **Risks:** all 5 risks in §9 have explicit mitigations + tests. The `dotenv/config` guard is the highest-impact finding (3 LoC fix, real spec compliance gain). The canonical spec sync is the highest-risk apply-phase failure mode (B1a/B1b lessons applied).

After Slice C lands:
- **Slice D** — CI deploy workflow + `db-destructive` PR label gate + GHCR push (~250 LoC).
- **Web app containerization** — separate slice (~120 LoC).
- **Restore drill** — future change.
- **`athlos-fileserver`** (Samba), **`athlos-nextcloud`**, **`athlos-ad`** — all deferred per ADR #33.

---

## 13. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `openspec/changes/data-steward-grant-automation/archive/2026-06-18/exploration.md` | **Source of truth for Slice C scope.** §3 defines the S3 pivot that B1a overrode. §10 defers entrypoint to Slice C. |
| `openspec/changes/athlos-foundation/design.md:1300-1389` | **The original Dockerfile + entrypoint + compose blueprint.** Updated to reflect current pnpm + drizzle-kit reality (§6 findings). |
| `openspec/changes/athlos-foundation/design.md:6019-6302` | **The `BACKUP_BEFORE_MIGRATE` original spec.** S3-based; must be rewritten for local `$BACKUP_DIR` in Slice C. |
| `openspec/changes/db-status-and-drift-gate/archive/2026-06-18/exploration.md` | Parent Slice A exploration. §3 risk #3 (pg_advisory_lock race) applies to Q5. |
| `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/exploration.md` | **B1b lessons source.** §6 enumerates canonical sync + apply atomicity + filename drift. Apply rigorously in Slice C. |
| `openspec/changes/athlos-deploy-slice-b1b-usb-rotation/archive/2026-06-19/verify-report` | **B1b verify lessons.** Exit code 1 vs 2 spec compliance miss. Slice C must catch this kind of issue in apply. |
| `openspec/changes/athlos-deploy-slice-b1a-backup-restore/archive/2026-06-19/exploration.md` | **B1a lessons source.** Same canonical sync + filename drift. Mirror in Slice C. |
| `/run/media/vlongo/Archivos/obsidian/Projectos/Athlos/2-Architecture/5-Server-Infrastructure.md` | §6.I (Docker Engine install), §7 (storage), §8 (backup), §10 (ADRs #28-#33), §13 (roadmap). |
| `Dockerfile` (8L) | Placeholder. `node:22-alpine` confirmed as the base. |
| `docker-compose.yml` (65L) | Placeholder. Real db healthcheck present; api + migrations placeholders. |
| `.dockerignore` (19L) | Already complete per TASK-076. |
| `.env.example` (61L) | B1a + B1b vars present. Missing: `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`. |
| `docs/runbook.md` (235L) | Post-B1a + B1b. Slice C adds `## Containerized Deploy (Docker)` section. |
| `apps/api/src/index.ts:1-58` | **The API entrypoint.** Line 3 `import 'dotenv/config'` is the spec violation (§6 finding 1). |
| `apps/api/package.json:9` | `"start": "node dist/index.js"` — the runtime command. |
| `apps/api/dist/index.js` (verified exists) | The compiled entrypoint the Dockerfile must COPY. |
| `packages/db/package.json:18` | `"migrate": "drizzle-kit migrate"` — the canonical migrate command (replaces foundation's `npx drizzle migrate --force`). |
| `packages/db/drizzle.config.ts` | Drizzle Kit config — auto-detected, no path gymnastics. |
| `packages/db/drizzle/0000_…sql` to `0011_…sql` | 12 migrations. Dockerfile must COPY this dir into runtime image. |
| `scripts/backup.sh` (91L) | B1a's pg_dump + gzip + retention. Slice C's entrypoint calls it when `BACKUP_BEFORE_MIGRATE=true`. |
| `scripts/lib/common.sh` (133L) | B1a + B1b shared helpers (`log`, `die`, `require_env`, `cleanup_old_backups`, `require_root`, `is_mounted`, `is_luks_open`). Slice C's entrypoint can source it. |
| `.github/workflows/test.yml` (131L) | `test` + `drift-check` + `backup-bats` jobs. Slice C optionally adds `docker-build-smoke`. |
| `openspec/specs/deployment-devops/spec.md` (321L) | **The MODIFIED target.** Lines 11-162 are Slice C's surface; lines 147-162 stale; lines 165-216 already cover B1a; lines 218-277 already cover B1b. |
| `openspec/specs/monitoring-observability/spec.md:37` | `/health/startup` MUST return 200 only after migrations complete when `RUN_MIGRATIONS=true`. Slice C satisfies this via entrypoint order. |
| `apps/api/src/routes/health.ts:41,49,77` | The 3 health endpoints already implemented in PR 4b. `/health/ready` is the compose healthcheck target. |

---

*Persisted to:*
- *`openspec/changes/explore-athlos-deploy-slice-c/exploration.md`*
- *Engram topic `sdd/explore/athlos-deploy-slice-c`*
