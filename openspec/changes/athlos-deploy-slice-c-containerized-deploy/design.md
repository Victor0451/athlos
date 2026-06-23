# Design: athlos-deploy-slice-c-containerized-deploy

**Date:** 2026-06-23
**Phase:** Design
**Mode:** Both (Engram + OpenSpec)
**Status:** Draft
**File:** `openspec/changes/athlos-deploy-slice-c-containerized-deploy/design.md`

---

## 1. Context

Slice C delivers the **containerized deploy foundation** for the Athlos API. It replaces the placeholder `Dockerfile` (8 lines, single-stage, `CMD ["echo", "..."]`) and placeholder `docker-compose.yml` (65 lines, no `api` entrypoint, dead `migrations` service) with a real production stack: a 2-stage multi-stage `Dockerfile` (`node:22-alpine`, non-root UID `1001`, `tini` PID-1, ~150 MB final image), a `docker-entrypoint.sh` that conditionally runs `scripts/backup.sh` then `pnpm --filter @athlos/db migrate` before `exec`-ing the API as PID 1, and a real `docker-compose.yml` (`api` + `db` only) with `env_file: .env.production`, `depends_on: condition: service_healthy`, `/health/ready` healthcheck (30s/5s/5/30s), and json-file log rotation (10m × 3). First-deploy contract is `docker compose up -d` — atomic, idempotent, includes migrations.

This PR also fixes **three spec drifts** the explore discovered:

1. **`dotenv/config` unconditional load.** `apps/api/src/index.ts:3` does `import 'dotenv/config'` unconditionally — directly violating `openspec/specs/deployment-devops/spec.md:113` ("the API MUST NOT look for a `.env` file" in production). Fix: guard behind `NODE_ENV !== 'production'`.
2. **`BACKUP_BEFORE_MIGRATE` S3 → local reconciliation.** Foundation design (`design.md:6019`) specified `s3://${BACKUP_BUCKET}/...`. Slice B1a pivoted to local + USB per ADR #30. Slice C reconciles the canonical spec to write to `$BACKUP_DIR`.
3. **Four stale scenarios** in `deployment-devops/spec.md` rewritten IN-PLACE: `Database migrations on startup` (dead `migrations` service), `Rollback procedure` (non-existent `docker-compose run migrations rollback`), `One-off migration execution` (non-existent `migrate run <name>`), `Backup storage location` (no USB rotation reference). All four align with forward-only Drizzle + B1b USB reality.

**B1a/B1b LESSONS applied:** apply MUST self-verify canonical sync atomically via `diff` BEFORE marking task complete (LESSON #1 + #5). 2-commit shape (`TDD` + `chore(release): v0.4.5`) preserved via pre-merge fix + cherry-pick reorder (LESSON #2). Archive MUST commit all planning artifacts to `archive/2026-06-23/` (LESSON #3). Every path uses `$BACKUP_DIR`/`$LEGACY_DB_PATH` env vars, not literals (LESSON #4).

---

## 2. Goals / Non-Goals

### Goals

- `Dockerfile` builds a clean multi-stage `node:22-alpine` image, non-root UID 1001, ≤ 300 MB final size, runs `tini` as PID-1 supervisor.
- `docker-compose.yml` brings up `api` + `db`; both `healthy` within 60s of `up -d`; `curl /health/ready` returns 200.
- `docker-entrypoint.sh` sources `scripts/lib/common.sh`, waits for `pg_isready`, conditionally runs `BACKUP_BEFORE_MIGRATE=true` then `RUN_MIGRATIONS=true`, then `exec`s the API process as PID 1.
- `apps/api/src/index.ts` does NOT load `dotenv/config` when `NODE_ENV === 'production'` — verified by `apps/api/test/dotenv-guard.test.ts` (strict TDD: RED → GREEN → REFACTOR).
- 3 spec drifts fixed (`dotenv/config` guard, S3→local `$BACKUP_DIR` reconciliation, 4 in-place scenario rewrites).
- CI `docker-build-smoke` job builds the image (regression guard, no push).
- Canonical sync verified atomically via `diff` BEFORE merge (B1a/B1b LESSON #1).
- 2-commit shape preserved: TDD + `chore(release): v0.4.5`.

### Non-Goals

- **Slice D entirely** — CI deploy workflow, GHCR push, `db-destructive` PR label gate.
- **`apps/web` containerization** — Next.js 16.2.9 has different container needs (`next build` + `next start`).
- **HTTPS reverse proxy** — API listens on `:3001` HTTP for v1.
- **Monitoring stack** — Prometheus / Grafana / Cockpit deferred.
- **Samba / Nextcloud / AD** — ADR #33 deferral.
- **Multi-host orchestration** — single-node only per Server Infra doc §6.
- **Restore drill, pg_basebackup, WAL archiving, PITR** — separate future slices.
- **S3 backups** — explicitly rejected by ADR #30; this PR reconciles the spec.
- **Systemd timers** — cron sufficient per ADR #29.
- **Distroless image** — overkill for self-hosted single-node.
- **AWS CLI in image** — not needed (S3 rejected).
- **`logrotate` for Docker logs** — driver options (`max-size: 10m, max-file: 3`) cover it.

---

## 3. Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Base image | `node:22-alpine` | `node:22-slim` (~300 MB), distroless | Smaller (~150 MB), multi-arch, Fastify + pino tested, single CVE surface |
| D2 | Multi-stage | 2-stage (`builder` + `runner`) | 3-stage (+prod-deps), single-stage | Layer caching sufficient; `pnpm deploy --filter @athlos/api --prod` prunes devDeps |
| D3 | Image registry | `ghcr.io/victor0451/athlos-api` | Docker Hub, none (local only) | Forward-compat with Slice D; Slice C builds locally, Slice D pushes |
| D4 | Compose services | `api` + `db` only | `+ migrations` (separate), `+ backup` | Migrations in `api` entrypoint — atomic, race-free; backups already on host via cron |
| D5 | Migration strategy | `RUN_MIGRATIONS=true` in entrypoint | separate `migrations` service (one-shot) | Atomic, no `service_completed_successfully` complexity |
| D6 | `BACKUP_BEFORE_MIGRATE` target | local `$BACKUP_DIR` (host-mounted volume) | S3 (rejected by ADR #30) | Reconciles S3→local drift; matches B1a `backup.sh` |
| D7 | Secrets | `.env.production` via compose `env_file:` | Docker secrets, Vault | Single-node, simple, host-mounted (NOT baked into image) |
| D8 | API healthcheck | `/health/ready` 30s interval / 5s timeout / 5 retries / 30s start_period | `/health` (liveness, weak signal) | `/health/ready` confirms DB migration applied + scheduler started |
| D9 | Logging driver | `json-file` with `max-size: 10m, max-file: 3` | journald, fluentd | Self-contained, rotates via driver options, no extra daemon |
| D10 | CI image job | `docker-build-smoke` (build + smoke, no push) | no CI, push from CI | Regression guard without external secrets; ~3 min |
| D11 | First deploy | `docker compose up -d` | `docker-compose` (v1, deprecated) | Atomic; v2 CLI; matches Server Infra §6.I |
| D12 | PID 1 signal handling | `tini` + `exec node dist/index.js` | `node` direct, dumb-init | `tini` reaps zombies; `exec` makes Node PID 1 so SIGTERM hits Fastify's graceful handler |
| D13 | dotenv guard | `await import('dotenv/config')` inside `if (process.env.NODE_ENV !== 'production')` | runtime `if` on `process.env.NODE_ENV` at module init | Dynamic import avoids early side effect in ESM; lazy enough that production never loads |
| D14 | Spec delta shape | REPLACE 4 stale scenarios IN-PLACE | append `_v2` versions | Matches B1a/B1b pattern; keeps canonical clean |
| D15 | Version bump | patch `v0.4.4 → v0.4.5` | minor `v0.5.0` | Operational infra, no user-facing change; matches B1a/B1b patch pattern |
| D16 | Backup mount | `./backups:/var/backups/athlos` (host path) | named volume `backup_data` | Host path is visible to operator (`ls ./backups/`), easier restore |

---

## 4. Architecture / Approach

### 4.1 `Dockerfile` (rewrite, ~50 bash, real multi-stage)

```dockerfile
# syntax=docker/dockerfile:1.7
# ── Stage 1: builder ─────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./
RUN corepack enable
RUN pnpm fetch
RUN pnpm install --frozen-lockfile --offline
COPY . .
RUN pnpm --filter @athlos/api build
RUN pnpm --filter @athlos/db build || true
RUN pnpm deploy --filter @athlos/api --prod /app/deploy

# ── Stage 2: runner ──────────────────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache tini bash postgresql-client
WORKDIR /app
RUN addgroup -g 1001 athlos && adduser -D -G athlos -u 1001 athlos
COPY --from=builder --chown=athlos:athlos /app/deploy/node_modules ./node_modules
COPY --from=builder --chown=athlos:athlos /app/deploy/package.json ./package.json
COPY --from=builder --chown=athlos:athlos /app/deploy/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=athlos:athlos /app/deploy/packages/db ./packages/db
COPY --from=builder --chown=athlos:athlos /app/deploy/apps/api/src/index.ts ./apps/api/src/index.ts
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER athlos
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
```

Key: `pnpm deploy --filter @athlos/api --prod /app/deploy` is pnpm's official prod-only bundler — produces a single directory with prod deps resolved, no devDeps, no workspace symlinks. The runner stage copies only what's needed at runtime (no `devDependencies`, no `tests/`, no `coverage/`). The `chmod +x` on the entrypoint is mandatory because `--chown` resets mode to 0644 unless we re-execute.

### 4.2 `docker-entrypoint.sh` (new, ~40 bash)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load shared helpers (B1a/B1b pattern — mirrors scripts/backup.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../scripts/lib/common.sh"

log INFO "athlos-api entrypoint starting (pid=$$ uid=$(id -u))"

# Wait for Postgres (belt-and-suspenders for cold starts)
for i in {1..60}; do
  if pg_isready -h db -p 5432 -U "${POSTGRES_USER:-athlos}" >/dev/null 2>&1; then
    log INFO "Postgres ready after ${i}s"
    break
  fi
  sleep 1
done

if ! pg_isready -h db -p 5432 -U "${POSTGRES_USER:-athlos}" >/dev/null 2>&1; then
  log ERROR "Postgres not ready after 60s; aborting"
  exit 1
fi

# Pre-migration backup (S3→local reconciliation per ADR #30)
if [[ "${BACKUP_BEFORE_MIGRATE:-false}" == "true" ]]; then
  log INFO "BACKUP_BEFORE_MIGRATE=true — running scripts/backup.sh to \$BACKUP_DIR"
  bash /app/scripts/backup.sh || { log ERROR "backup.sh failed; aborting"; exit 2; }
fi

# Migrations (forward-only Drizzle)
if [[ "${RUN_MIGRATIONS:-false}" == "true" ]]; then
  log INFO "RUN_MIGRATIONS=true — running pnpm --filter @athlos/db migrate"
  pnpm --filter @athlos/db migrate || { log ERROR "migrations failed; aborting"; exit 3; }
fi

# exec makes Node PID 1 so SIGTERM hits Fastify's graceful handler
log INFO "exec $@"
exec "$@"
```

Notes:
- `exec "$@"` replaces the shell, so SIGTERM (from `docker stop`) goes directly to the Node process — Fastify's `SIGTERM` handler (lines 39-52 of `apps/api/src/index.ts`) runs.
- Exit codes: 0 = success, 1 = Postgres not ready, 2 = backup failed, 3 = migration failed. These propagate to Docker, which restarts the container (compose `restart: unless-stopped`) — operator sees clear exit code in `docker inspect`.
- `set -euo pipefail` + `require_*` helpers from `common.sh` mean any unexpected failure exits cleanly with a logged reason.

### 4.3 `docker-compose.yml` (rewrite, ~110 YAML, real prod)

```yaml
# Docker Compose v2 (no top-level `version:` key by convention)
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env.production
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-athlos}
      POSTGRES_USER: ${POSTGRES_USER:-athlos}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-athlos} -d ${POSTGRES_DB:-athlos}']
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: 3

  api:
    build:
      context: .
      dockerfile: Dockerfile
    image: ghcr.io/victor0451/athlos-api:local
    restart: unless-stopped
    env_file: .env.production
    environment:
      NODE_ENV: production
      RUN_MIGRATIONS: "true"
      BACKUP_BEFORE_MIGRATE: "true"
      DATABASE_URL: postgresql://${POSTGRES_USER:-athlos}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-athlos}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - '3001:3001'
    volumes:
      - ./backups:/var/backups/athlos
      - ${LEGACY_DB_PATH:-./legacy}:/legacy:ro
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3001/health/ready']
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 30s
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: 3

volumes:
  pgdata:
```

Key choices:
- **NO `migrations` service** — migrations run inside `api` entrypoint (per locked Q4 decision).
- **`depends_on: condition: service_healthy`** — not just `service_started`, so `db` is fully ready before `api` starts.
- **`./backups:/var/backups/athlos`** — host-mounted bind so operator can `ls ./backups/` from outside the container (B1a's daily cron writes here too).
- **`./legacy:/legacy:ro`** — read-only mount of the legacy DBF share (matches Slice A import flow).
- **Explicit `RUN_MIGRATIONS: "true"` and `BACKUP_BEFORE_MIGRATE: "true"`** — compose `environment:` overrides `env_file` so these are guaranteed on every `up -d`, even if operator forgets to set them in `.env.production`.

### 4.4 `.env.example` (+10 lines)

Append (before the closing line):

```bash
# ── Containerized Deploy (PR Slice C) ─────────────────────────
# Run migrations automatically when api container starts
RUN_MIGRATIONS=true
# Run a pre-migration backup to $BACKUP_DIR (reconciles S3→local per ADR #30)
BACKUP_BEFORE_MIGRATE=true
# Git SHA of the deploy (set by CI in Slice D; defaults to `local` for first deploy)
BUILD_SHA=local
# Postgres credentials (used by compose db + api DATABASE_URL)
POSTGRES_DB=athlos
POSTGRES_USER=athlos
POSTGRES_PASSWORD=CHANGE_ME_USE_OPENSSL_RAND_HEX_32
# DATABASE_URL for the api container — uses compose service name `db`
DATABASE_URL=postgresql://athlos:CHANGE_ME@db:5432/athlos
```

NOTE: real `.env.production` is created from `.env.example` via `cp` + edit (runbook step). The file is `.gitignore`-d; only `.env.example` is committed.

### 4.5 `.dockerignore` (+5 lines)

Current 19 lines already exclude `openspec`, `docs`, `coverage`. Additions for Slice C:

```
.atl/
**/.nyc_output/
.husky/
.dockerignore
.git
```

(`openspec/`, `coverage/` already present; `**/coverage/` adds recursive coverage dirs in sub-packages.)

### 4.6 `docs/runbook.md` (+25 lines)

Append after `## USB Rotation (weekly)`:

```markdown
## Containerized Deploy (Docker)

Slice C delivers the production containerized deploy stack.

### First-time setup (Ubuntu 24.04 server with Docker installed)

\`\`\`bash
# 1. Copy env template and edit secrets
cp .env.example .env.production
$EDITOR .env.production  # set POSTGRES_PASSWORD, JWT_SECRET, SMTP_PASS

# 2. Verify Docker Engine + Compose v2
docker --version && docker compose version

# 3. Bring up the stack
docker compose up -d

# 4. Verify
docker compose ps              # both `api` and `db` should be `(healthy)` within 60s
curl http://localhost:3001/health/ready  # returns 200 {"status":"ready"}
\`\`\`

### Day-to-day operations

- **Logs:** `docker compose logs -f api` (json-file driver, 10m × 3 rotation)
- **Restart only:** `docker compose restart api` (env changes, no rebuild)
- **Rebuild + restart:** `docker compose up -d --build api` (code change)
- **Migrations:** automatic on `docker compose up -d` when `RUN_MIGRATIONS=true`. Manual:
  `docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'`
- **Pre-migration backups:** automatic when `BACKUP_BEFORE_MIGRATE=true`. Dumps appear in
  host `./backups/athlos-<timestamp>.sql.gz` (NOT inside the container).
- **Rollback:** re-deploy previous image tag: `docker compose pull && docker compose up -d`
  (forward-only migration model — see `docs/runbook.md` Rollback section)
```

### 4.7 `.github/workflows/test.yml` (+10 YAML, `docker-build-smoke` job)

Append as a new job after `backup-bats`:

```yaml
  docker-build-smoke:
    runs-on: ubuntu-latest
    needs: backup-bats
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image (regression guard — no push)
        run: docker build -t athlos-api:smoke .
      - name: Smoke: node version
        run: docker run --rm athlos-api:smoke node --version
      - name: Smoke: entrypoint copied
        run: docker run --rm athlos-api:smoke ls /usr/local/bin/docker-entrypoint.sh
      - name: Smoke: non-root UID 1001
        run: docker run --rm athlos-api:smoke id -u | grep -q '^1001$'
```

No push. Blocks merge on failure (like the other 3 jobs).

### 4.8 `apps/api/src/index.ts` (+3 LoC, dotenv guard — THE spec violation fix)

Replace line 3 (`import 'dotenv/config'`) with:

```typescript
// `dotenv/config` MUST be loaded ONLY in non-production environments.
// In production, env vars come from compose `env_file: .env.production`
// (per openspec/specs/deployment-devops/spec.md requirement
//  "Environment Variables in Production > Production env var injection").
// We use a dynamic import so the side effect never runs at module-init
// time in production — the rest of the file never sees dotenv's noop
// in production and never reads a .env file that may be in CWD.
if (process.env['NODE_ENV'] !== 'production') {
  await import('dotenv/config')
}
```

NOTE: the surrounding `async function main()` makes `await import(...)` legal. The dynamic import returns a Promise that resolves after dotenv's side effect (reading `.env` if present) completes.

### 4.9 `apps/api/test/dotenv-guard.test.ts` (new, ~30 LoC vitest — RED → GREEN → REFACTOR)

Three test cases:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('dotenv guard in apps/api/src/index.ts', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv
    vi.resetModules()
    vi.unmock('dotenv/config')
  })

  it('does NOT load dotenv/config when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production'
    const dotenvSpy = vi.fn()
    vi.doMock('dotenv/config', dotenvSpy)
    // Trigger index.ts module-init
    await import('../src/index.js')
    expect(dotenvSpy).not.toHaveBeenCalled()
  })

  it('loads dotenv/config when NODE_ENV=development', async () => {
    process.env['NODE_ENV'] = 'development'
    const dotenvSpy = vi.fn()
    vi.doMock('dotenv/config', dotenvSpy)
    await import('../src/index.js')
    expect(dotenvSpy).toHaveBeenCalledTimes(1)
  })

  it('loads dotenv/config when NODE_ENV is unset', async () => {
    delete process.env['NODE_ENV']
    const dotenvSpy = vi.fn()
    vi.doMock('dotenv/config', dotenvSpy)
    await import('../src/index.js')
    expect(dotenvSpy).toHaveBeenCalledTimes(1)
  })
})
```

### 4.10 `openspec/specs/deployment-devops/spec.md` (MODIFIED delta)

Already authored by sdd-spec (395 lines). 1 new requirement (`Containerized Deploy`) with 5 new scenarios, plus 4 rewrites IN-PLACE:

| Scenario | Rewrite summary |
|----------|-----------------|
| `Database Setup > Database migrations on startup` | Removes the dead `migrations` service reference. Specifies `RUN_MIGRATIONS=true` triggers `pnpm --filter @athlos/db migrate` in the `api` entrypoint. Manual path: `docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'` |
| `Database Migrations in Production > Rollback procedure` | Replaces `docker-compose run migrations rollback` (doesn't exist) with re-deploy of previous image tag + forward-fix migration (per Slice A's forward-only model) |
| `Database Migrations in Production > One-off migration execution` | Replaces `docker-compose run migrations run <name>` (doesn't exist) with `pnpm --filter @athlos/db migrate:status` to list pending + `drizzle-kit migrate` applies ALL pending in order |
| `Backup Strategy > Backup storage location` | Replaces "SHOULD be replicated to offsite storage" with "MUST be written to local `$BACKUP_DIR`" + reference to B1b USB Rotation (offsite = LUKS-encrypted USB rotation, not cloud) |

**CRITICAL B1a/B1b LESSON #1 (canonical sync gap):** apply phase MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md` atomically BEFORE marking the canonical-sync task complete. Exhaustive diff (every section, every scenario) — not partial. Verify phase MUST `grep -c` each new scenario title in canonical. Archive phase MUST do final diff.

---

## 5. File-by-File Changes

| File | Action | Est. lines | TDD? | Notes |
|------|--------|-----------|------|-------|
| `Dockerfile` | rewrite | ~50 | no | 2-stage `node:22-alpine`, `pnpm deploy`, non-root UID 1001, `tini` PID-1 |
| `docker-entrypoint.sh` | create | ~40 | no | sources `common.sh`, `pg_isready` wait, conditional backup+migration, `exec "$@"` |
| `docker-compose.yml` | rewrite | ~110 | no | `api` + `db` only, `env_file`, `/health/ready` healthcheck, json-file logs |
| `.env.example` | modify | +10 | no | RUN_MIGRATIONS, BACKUP_BEFORE_MIGRATE, BUILD_SHA, POSTGRES_*, DATABASE_URL |
| `.dockerignore` | modify | +5 | no | `.atl/`, `**/.nyc_output/`, `.husky/`, `.dockerignore`, `.git` |
| `docs/runbook.md` | modify | +25 net | no | `## Containerized Deploy (Docker)` section |
| `.github/workflows/test.yml` | modify | +10 YAML | no | `docker-build-smoke` job (no push) |
| `apps/api/src/index.ts` | modify | +3 | **YES** | `dotenv/config` conditional dynamic import (THE spec violation fix) |
| `apps/api/test/dotenv-guard.test.ts` | create | +30 | **YES** | vitest regression test (3 cases: prod / dev / unset) |
| `openspec/specs/deployment-devops/spec.md` | modify (canonical sync) | already written | no | 1 new requirement + 5 new scenarios + 4 in-place rewrites |
| `openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md` | commit | already written | no | The delta spec from sdd-spec |
| 24 `package.json` files | modify | +1 each | no | bump `0.4.4 → 0.4.5` (closing commit only) |
| `CHANGELOG.md` | modify | +1 section | no | `[0.4.5]` entry (closing commit only) |

Total estimated PR LoC: **~315** (under 400-line review budget by ~21%).

---

## 6. Implementation Order

The strict-TDD chain (RED → GREEN → REFACTOR) applies ONLY to the `dotenv/config` guard. Everything else is infra (Dockerfile, entrypoint, compose) — no TDD per `openspec/config.yaml` `rules.apply.tdd` interpretation for infra files.

### TDD chain (only)

1. **`apps/api/test/dotenv-guard.test.ts`** (RED) — write 3 test cases asserting dotenv loads when `NODE_ENV !== 'production'` and does NOT load when `NODE_ENV=production`. Verify vitest FAILS (current code loads dotenv unconditionally).
2. **`apps/api/src/index.ts`** (GREEN) — replace `import 'dotenv/config'` with `if (process.env['NODE_ENV'] !== 'production') await import('dotenv/config')`. Verify vitest PASSES (all 3 cases).
3. **REFACTOR** — clean up any redundant comments; ensure `dotenv` is still in `apps/api/package.json` `dependencies` (it is — `^16.4.7`).

### Wiring + infra (no TDD)

4. **`Dockerfile`** rewrite (real multi-stage; validate with `docker build -t athlos-api:test .`)
5. **`docker-entrypoint.sh`** create (`bash -n` syntax check + `shellcheck`)
6. **`docker-compose.yml`** rewrite (`docker compose config` parses + interpolates)
7. **`.env.example`** additions
8. **`.dockerignore`** additions
9. **`docs/runbook.md`** `## Containerized Deploy (Docker)` section
10. **`.github/workflows/test.yml`** `docker-build-smoke` job

### Pre-closing verification

11. Run all design §8 acceptance commands + commit planning artifacts (proposal, design, tasks, exploration)
12. **CRITICAL — ATOMIC CANONICAL SYNC SELF-VERIFY (B1a/B1b LESSON #1):** apply MUST run `diff delta vs canonical` for the 4 rewrites + 5 new scenarios. If diff is not empty, fix BEFORE marking task complete. Verify phase MUST `grep -c` each new scenario title in canonical.

### Closing commit (separate)

13. **`chore(release): v0.4.5`** — bump `version` in 24 `package.json` files (`0.4.4 → 0.4.5`) + add `[0.4.5]` section to `CHANGELOG.md` in a SEPARATE commit from the feature commit.

---

## 7. Data Flow (cold start)

```
operator → ssh ubuntu@server
       → cp .env.example .env.production && $EDITOR .env.production
       → docker compose up -d
              │
              ├─→ compose creates `db` container
              │     ├─→ postgres:16-alpine initializes at /var/lib/postgresql/data (pgdata volume)
              │     └─→ healthcheck: pg_isready (10s/5s/5)
              │
              └─→ compose builds+runs `api` container
                    ├─→ tini (PID 1) → docker-entrypoint.sh
                    │     ├─→ source scripts/lib/common.sh
                    │     ├─→ pg_isready wait (60s timeout, belt-and-suspenders)
                    │     ├─→ [BACKUP_BEFORE_MIGRATE=true]
                    │     │     └─→ scripts/backup.sh → ./backups/athlos-<ts>.sql.gz
                    │     │           (host-visible via bind mount, S3→local per ADR #30)
                    │     ├─→ [RUN_MIGRATIONS=true]
                    │     │     └─→ pnpm --filter @athlos/db migrate
                    │     │           (Drizzle migrator, forward-only)
                    │     └─→ exec node apps/api/dist/index.js
                    │           (Node becomes PID 1, SIGTERM hits Fastify directly)
                    ├─→ healthcheck: wget /health/ready (30s/5s/5/30s-start_period)
                    └─→ json-file logs rotated 10m × 3

operator → curl http://localhost:3001/health/ready → {"status":"ready"} 200 OK
```

Three key invariants:

- **`exec "$@"`** in entrypoint replaces the shell — Node becomes PID 1, so `docker stop` → SIGTERM → Fastify's `SIGTERM` handler (index.ts:39-52) runs scheduler drain + graceful close.
- **`BACKUP_BEFORE_MIGRATE` order is observable** — entrypoint logs `backup.sh ... starting` BEFORE `pnpm ... migrate ... starting`. If backup exits non-zero, entrypoint exits 2 (migrations never run). If migration exits non-zero, entrypoint exits 3. Docker restart loop backs off per `restart: unless-stopped`.
- **`dotenv/config` guard is a static-time gate.** In production (`NODE_ENV=production`), `await import('dotenv/config')` never executes — even if a stray `.env` file exists in the container CWD (it won't, but defense in depth). Env vars come ONLY from compose `env_file: .env.production` (host-mounted).

---

## 8. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | **`dotenv/config` guard breaks local dev or test env** | Low | Vitest regression test (`dotenv-guard.test.ts`) explicitly asserts `NODE_ENV=production` skips dotenv. `packages/config/src/index.ts:12-15` documents the architectural decision. `container.ts:151` `validateEnv()` throws clear error on missing `JWT_SECRET`. Runbook documents: "Production requires `.env.production` mounted via compose `env_file` (not `.env`)." If operator runs `NODE_ENV=production pnpm dev`, they see a clear error from `validateEnv()`, not silent corruption. |
| R2 | **Entrypoint race: `pg_isready` passes but `drizzle-kit migrate` fails** | Low | `set -euo pipefail` kills container on any non-zero exit. `depends_on: db: condition: service_healthy` ensures Postgres is fully ready. Drizzle migrator uses internal advisory-lock semantics (single replica only — `pg_advisory_lock` race documented in runbook for future multi-replica). Compose `restart: unless-stopped` retries 3× before giving up. Runbook documents: "if api container keeps restarting, run `docker compose logs api`." |
| R3 | **Image size + build time** (~150 MB, ~3 min CI build) | Medium | `pnpm fetch` uses lockfile cache (re-runs are fast if lockfile unchanged). Buildx cache (`docker/setup-buildx-action@v3` with `cache-from: type=gha`) drops subsequent builds to ~30s. 150 MB Alpine is small for self-hosted single-node. Slice D can add registry cache for further reduction. |
| R4 | **Canonical spec sync gap (B1a/B1b LESSON #1 — HIGH recurrence)** | **HIGH** | Apply phase MUST run `diff openspec/changes/.../specs/deployment-devops/spec.md openspec/specs/deployment-devops/spec.md` atomically BEFORE marking canonical-sync task complete (exhaustive — covers every new + rewritten scenario). Verify phase MUST `grep -c` for each new scenario title in canonical. Archive phase MUST do final diff. 2-commit shape preserved via pre-merge fix + cherry-pick reorder pattern if verify catches drift. **This is the most likely failure mode if lessons are forgotten.** |
| R5 | **`./backups:/var/backups/athlos` host path missing** | Low | Runbook documents: "Create `./backups/` on the host before `docker compose up -d` (mkdir -p ./backups && chmod 700 ./backups)." Compose will create the directory but not the parent — explicit mkdir in runbook. Alternatively, switch to a named volume `backup_data` if the operator prefers. |
| R6 | **Image non-root + file permissions** | Low | `RUN addgroup -g 1001 athlos && adduser -D -G athlos -u 1001 athlos` creates the user. `--chown=athlos:athlos` on every COPY ensures the user owns the app files. `RUN chmod +x /usr/local/bin/docker-entrypoint.sh` ensures the entrypoint is executable (otherwise `--chown` resets mode to 0644). `USER athlos` at the end. |
| R7 | **Closing commit slippage (B1a/B1b LESSON #2)** | Medium | Version bump (`0.4.4 → 0.4.5`) + `CHANGELOG.md` `[0.4.5]` entry MUST be in the closing commit, NOT mixed with feature commit. Strict 2-commit shape. If verify catches drift, apply uses pre-merge fix commit + cherry-pick reorder to preserve shape. |
| R8 | **`wget` missing in api container for healthcheck** | Low | `node:22-alpine` includes `wget` by default (busybox). Verify with `docker run --rm athlos-api:test wget --version` during docker-build-smoke. If missing, fall back to `CMD-SHELL` with `node -e "require('http').get(...)"` (adds ~5 lines to compose). |

---

## 9. Acceptance / Verification

After `sdd-apply` runs the implementation, the user can run:

### Docker build + smoke

```bash
cd /run/media/vlongo/Archivos/Projectos/Athlos

# Real multi-stage build
docker build -t athlos-api:test .

# Image checks
docker run --rm athlos-api:test node --version           # → v22.x.x
docker run --rm athlos-api:test id                       # → uid=1001(athlos)
docker run --rm athlos-api:test ls /usr/local/bin/docker-entrypoint.sh  # → /usr/local/bin/docker-entrypoint.sh
docker run --rm athlos-api:test apk info -e tini         # → (exits 0)
docker run --rm athlos-api:test apk info -e postgresql-client  # → (exits 0)
docker images athlos-api:test --format '{{.Size}}'       # → < 300 MB (Alpine target ~150 MB)

# Compose syntax
docker compose config                                     # → (parses + interpolates, exit 0)

# Bring up the stack
cp .env.example .env.production
# (edit .env.production to set POSTGRES_PASSWORD, JWT_SECRET, SMTP_PASS)
docker compose up -d

# Verify both healthy within 60s
docker compose ps                                         # → api (healthy)  db (healthy)
curl http://localhost:3001/health/ready                   # → {"status":"ready"} 200 OK

# Logs and backups
docker compose logs --tail 100 api                        # → migration + backup messages in order
ls -la ./backups/                                         # → athlos-<ts>.sql.gz present

# Manual migration
docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'

# Tear down (preserves volumes)
docker compose down
```

### Vitest + lint + typecheck

```bash
pnpm test:run          # → 464 + 3 new vitest tests pass (dotenv guard)
pnpm lint              # → 0 errors
pnpm typecheck         # → 0 errors
bats scripts/tests/*.test.bats  # → all B1a/B1b tests pass (no regression)
shellcheck scripts/*.sh scripts/lib/*.sh  # → clean
```

### CI docker-build-smoke job

```bash
# (on push to PR) GitHub Actions runs docker-build-smoke job
# → docker build -t athlos-api:smoke . exits 0
# → smoke commands all exit 0
# → blocks merge on failure
```

### Spec drift reconciliation (B1a/B1b LESSON #1 — atomic sync self-verify)

```bash
# 1. No S3 references in canonical (S3→local reconciliation)
grep -c "s3://" openspec/specs/deployment-devops/spec.md      # → 0

# 2. New env vars + requirement present in canonical
for kw in RUN_MIGRATIONS BACKUP_DIR BACKUP_BEFORE_MIGRATE "Containerized Deploy" dotenv; do
  c=$(grep -c "$kw" openspec/specs/deployment-devops/spec.md)
  [[ "$kw" == "Containerized Deploy" ]] && [[ "$c" != "1" ]] && { echo "FAIL: $kw count=$c (expected 1)"; exit 1; }
  [[ "$c" -lt 1 ]] && { echo "FAIL: $kw not found in canonical"; exit 1; }
done

# 3. ATOMIC canonical sync — diff delta vs canonical for every changed section (MUST be empty)
canonical=openspec/specs/deployment-devops/spec.md
delta=openspec/changes/athlos-deploy-slice-c-containerized-deploy/specs/deployment-devops/spec.md
for section in "Containerized Deploy" "Database migrations on startup" "Rollback procedure" "One-off migration execution" "Backup storage location"; do
  if ! diff <(grep -A 200 "$section" "$canonical" | head -100) \
            <(grep -A 200 "$section" "$delta"      | head -100); then
    echo "FAIL: canonical sync gap in section '$section' (B1a/B1b LESSON #1)"
    exit 1
  fi
done
echo "OK: canonical sync verified (all 5 sections)"
```

### Version bump (2-commit structure preserved)

```bash
git log --oneline -3
# → <sha> chore(release): v0.4.5
# → <sha> feat(deploy): containerized deploy — Dockerfile + entrypoint + compose + 3 spec drift fixes

git show HEAD~1:package.json | grep '"version"'           # → "version": "0.4.4"
git show HEAD:package.json | grep '"version"'             # → "version": "0.4.5"
```

---

## 10. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines | **~315** (per proposal §Review Workload Forecast) |
| 400-line review budget risk | **LOW (~79%)** |
| Chained PRs recommended | **No** (single autonomous unit; Slice D is separate) |
| Suggested split | N/A |
| 2-commit structure | `feat(deploy): containerized deploy ...` + `chore(release): v0.4.5` |
| Work-unit count | 13 (1 TDD chain (3 steps) + 7 infra files + 1 verify + 1 release + 1 canonical sync self-verify + planning artifacts commit) |

Per `openspec/config.yaml` rules and the SDD design size budget, this artifact is concise (~430 lines) and uses tables for architecture decisions (D1-D16) and risks (R1-R8).

---

## 11. Strict TDD Verification Checklist

This is the **only** TDD chain in Slice C. Everything else is infra.

- [ ] **`dotenv-guard.test.ts` (TDD-001)** written and committed BEFORE `apps/api/src/index.ts` guard impl
- [ ] Vitest test cases FAIL before implementation (RED) — current `import 'dotenv/config'` always loads
- [ ] **`apps/api/src/index.ts` guard (TDD-002)** — implementation passes all 3 test cases (GREEN)
  - [ ] `NODE_ENV=production` → `dotenv/config` NOT loaded
  - [ ] `NODE_ENV=development` → `dotenv/config` loaded
  - [ ] `NODE_ENV` unset → `dotenv/config` loaded
- [ ] **REFACTOR pass** — no behavior change, comment is clear, no syntax issues
- [ ] Final test count: 464 + 3 new vitest = **467 total**, no regression
- [ ] No AI co-author; Conventional Commits throughout
- [ ] PR title: `feat(deploy): containerized deploy — Dockerfile + entrypoint + compose + 3 spec drift fixes (v0.4.5)`
- [ ] `apply-progress.md` ends with: GREEN → REFACTOR → ATOMIC CANONICAL SYNC SELF-VERIFY (all diffs empty)
- [ ] CI: `docker-build-smoke` job builds the image (regression guard, no push)
- [ ] `apply-progress.md` documents each TDD step (RED output → GREEN output → REFACTOR diff)
- [ ] `apply-progress.md` documents the canonical sync self-verify step (B1a/B1b LESSON #1)
- [ ] Closing commit (`chore(release): v0.4.5`) is in a SEPARATE commit from the feature commit

---

*Persisted to:*
- *`openspec/changes/athlos-deploy-slice-c-containerized-deploy/design.md`*
- *Engram topic `sdd/athlos-deploy-slice-c-containerized-deploy/design`*
