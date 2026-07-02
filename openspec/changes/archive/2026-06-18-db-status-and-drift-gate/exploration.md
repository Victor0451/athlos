# Exploration: athlos-deploy-scoping

**Date:** 2026-06-18
**Scope:** What it would take to automate the steps described in `docs/runbook.md`.
**Mode:** Standalone exploration (not tied to a named change yet).
**Verdict:** Significant scope (~900–1100 LoC across 4 natural slices). Recommend a
chained-PR delivery, with **Slice A (Status + Drift Gate)** as the first autonomous
slice — no external dependencies, smallest blast radius, unblocks the runbook
immediately.

---

## 1. Runbook location & content

**File:** `/run/media/vlongo/Archivos/Projectos/Athlos/docs/runbook.md` (94 lines).
Created at TASK-091 of `athlos-import-completion` (commit `092d38d`).

### Manual steps described

| # | Section | Step | What it actually does |
|---|---------|------|-----------------------|
| 1 | Pre-deploy | `pnpm db:migrate:status` | **Does not exist** in any `package.json` — referenced but unimplemented |
| 2 | Pre-deploy | `pnpm test:run` | Exists — runs Vitest |
| 3 | Pre-deploy | `pnpm typecheck` | Exists — `tsc --noEmit` per workspace |
| 4 | Pre-deploy | `pnpm lint` | Exists — ESLint per workspace |
| 5 | Post-deploy API | `GET /health` returns `{"status":"ok"}` | **Implemented** in `apps/api/src/routes/health.ts:41` (TASK-034, PR 4b) |
| 6 | Post-deploy API | `GET /health/ready` returns `{"status":"ready"}` | **Implemented** — `apps/api/src/routes/health.ts:49` (pings Postgres with `SELECT 1`) |
| 7 | Post-deploy DATA_STEWARD | `SELECT id, username FROM operators WHERE role = 'A'` then `INSERT INTO role_permissions (...) VALUES (...)` | **Manual SQL only** — zero automation. Required because `role_permissions` starts empty (no auto-grants per 7b.2 design) |
| 8 | Post-deploy Import | `POST /api/v1/import/trigger` returns 202 + batchId | Manual via curl — no smoke script |
| 9 | Post-deploy Reconciliation | `GET /api/v1/admin/jobs/runs?job_name=reconciliation` | Manual via curl |
| 10 | Rollback | `pnpm db:migrate:rollback` (with `--to <name>`) | **Does not exist** — Drizzle has no `migrate:rollback` script. Per `database-migrations/spec.md` rollback is **forward-only** — the runbook is misleading here |
| 11 | Rollback | Re-deploy previous image/tag, verify `/health`, check `GET /api/v1/admin/jobs/runs` | Manual — no rollback automation |

### DATA_STEWARD grant step (lines 26–43)

```sql
-- Find the operator
SELECT id, username FROM operators WHERE role = 'A' AND is_active = true;
-- Grant data_steward permission
INSERT INTO role_permissions (operator_id, permission_key, granted_by)
VALUES ('<operator-uuid>', 'data_steward', '<granting-operator-uuid>');
```

Composite PK `(operator_id, permission_key)` on `role_permissions` (migration 0010) makes
the INSERT naturally idempotent on retry — the second `INSERT` will error with
`unique_violation`, so any automation MUST use `INSERT ... ON CONFLICT DO NOTHING`.

### pg_dump step

**Not in the runbook.** The runbook talks about migration rollback but says nothing
about backing up the database before destructive changes. The spec
(`openspec/specs/database-migrations/spec.md:65-70`) defines a pre-deploy `pg_dump`
to `s3://athlos-backups/pre-deploy-<sha>.sql.gz` when the PR has the `db-destructive`
label — but this is spec-only, no script exists.

### Rollback step

The runbook references `pnpm db:migrate:rollback [--to <name>]` (lines 61-67). This
script **does not exist**. The spec (`database-migrations/spec.md:56`) explicitly
mandates **forward-only rollback** ("Rollback SHALL be forward-only — no down
migrations"). The runbook is inconsistent with the spec and must be reconciled
during this change.

---

## 2. Current deploy surface

### `Dockerfile` (`/run/media/vlongo/Archivos/Projectos/Athlos/Dockerfile`, 8 lines)

**PLACEHOLDER.** Single-stage `FROM node:22-alpine`, copies only `package.json` +
workspace files, CMD echoes a placeholder message. Self-documented:
> "Real multi-stage build lands in PR 9 (Deployment)."

### `docker-compose.yml` (`/run/media/vlongo/Archivos/Projectos/Athlos/docker-compose.yml`, 65 lines)

**PLACEHOLDER.** Three services:

| Service | Image | Healthcheck | Notes |
|---------|-------|-------------|-------|
| `db` | `postgres:16-alpine` | `pg_isready` (10s interval, 5 retries) | Real, with `pgdata` volume |
| `api` | Builds from local Dockerfile | **None** | Uses placeholder image; no `RUN_MIGRATIONS`, no `BACKUP_BEFORE_MIGRATE`, no healthcheck |
| `migrations` | Same placeholder Dockerfile | **None** | CMD is literally `console.log('migrations service placeholder')` |

Env vars in compose: `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `LEGACY_DB_PATH`,
`CORS_ORIGINS`, `SMTP_*`. No `BACKUP_BUCKET`, no `RUN_MIGRATIONS`, no `BACKUP_BEFORE_MIGRATE`.

### `.github/workflows/` (1 file)

**Only `test.yml` (46 lines).** Runs Postgres service + `pnpm install --frozen-lockfile` +
`pnpm test:run` + `pnpm typecheck` on PR and push to `main`. **No deploy workflow.**
No labeler config (`.github/labeler.yml` absent).

### `.dockerignore` (19 lines) — already exists with sensible defaults

Excludes `node_modules`, `.pnpm-store`, `.git`, `openspec`, `docs`, `.env*`,
`**/*.test.ts`, coverage, etc. **Already aligned with TASK-076 spec.**

### Existing shell scripts (2 — both are CI guards, not deploy)

| File | LOC | Purpose |
|------|-----|---------|
| `apps/api/scripts/ci-check-audit-fp.sh` | 43 | Verifies `auditPlugin` is `fp()`-wrapped (PR 3a bugfix lesson) |
| `apps/api/scripts/test-ci-guard-negative.sh` | 51 | Negative test for the above guard |

Both are CI guards, not deploy automation.

### Database migrations

- Location: `/run/media/vlongo/Archivos/Projectos/Athlos/packages/db/drizzle/` (drizzle-kit).
- 12 files: 11 SQL migrations (`0000_quick_wraith.sql` … `0011_audit_idempotency_partial_index.sql`) + `meta/_journal.json` + snapshots.
- Toolchain: `drizzle-orm ^0.36.0`, `drizzle-kit ^0.30.0` (`packages/db/package.json`).
- How they run today: **manually** — `pnpm --filter @athlos/db migrate` runs `drizzle-kit migrate`. No auto-apply on startup. No `status`. No `check`. No `rollback`.
- The spec mandates `RUN_MIGRATIONS=true` triggers auto-apply via a `docker-entrypoint.sh` script — neither the env var nor the entrypoint exist.

### Existing package.json scripts (deploy-relevant subset)

| Script | Where | Status |
|--------|-------|--------|
| `pnpm build` | root | Works — `pnpm -r --filter='./apps/*' build` |
| `pnpm test` / `test:run` | root | Works — Vitest |
| `pnpm typecheck` | root | Works — `pnpm -r typecheck` |
| `pnpm lint` | root | Works — ESLint per workspace |
| `pnpm db:generate` | root → `@athlos/db` | Works — `drizzle-kit generate` |
| `pnpm db:migrate` | root → `@athlos/db` | Works — `drizzle-kit migrate` |
| `pnpm db:studio` | root → `@athlos/db` | Works — `drizzle-kit studio` |
| `pnpm db:smoke` | root → `@athlos/db` | Works — runs `src/__smoke__.ts` (SELECT 1 sanity) |
| `pnpm db:migrate:status` | **MISSING** | Referenced in runbook, does NOT exist |
| `pnpm db:check` (drizzle-kit check) | **MISSING** | Spec requires it; CI doesn't run it |

### Env vars needed for deploy (from `.env.example`)

`NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`, `DATABASE_URL`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LEGACY_DB_PATH`,
`SMTP_*` (HOST/PORT/USER/PASS/FROM), `CORS_ORIGINS`, `DRIFT_DETECTION_CRON`,
`FRESHNESS_REFRESH_CRON`, `TOKEN_CLEANUP_CRON`, `RECONCILIATION_CRON`,
`AUDIT_RETENTION_DAYS`. **Not in `.env.example` but spec-required for deploy:**
`RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BACKUP_BUCKET`, `BACKUP_DIR`.

### Health endpoints

All three exist and are tested (`apps/api/src/routes/health.ts:41,49,77` +
`health.test.ts`). Wired in `server.ts:186`. Wire format matches spec exactly:
`/health` (liveness, no DB), `/health/ready` (Postgres `SELECT 1` with 2s timeout,
returns 503 on fail), `/health/startup` (always 200 — reserved for future startup
gating that PR 9 will introduce).

---

## 3. Spec backlog (already defined, just needs implementation)

The OpenSpec specs already define what this change should produce — the gap is
implementation, not specification:

| Spec | Defines | Implemented? |
|------|---------|--------------|
| `deployment-devops/spec.md` | Multi-stage Dockerfile, compose services, healthcheck, env-var-only secrets, manual migration via `docker-compose run migrations` | **PARTIAL** — compose skeleton exists, real Dockerfile/entrypoint/healthcheck missing |
| `deployment-devops/spec.md` §"Backup Strategy" | `scripts/backup.sh` with `pg_dump` + gzip + 7/30-day retention | **NONE** |
| `database-migrations/spec.md` | `pnpm --filter @athlos/db status`, `drizzle-kit check` in CI, `db-destructive` PR label, forward-only rollback | **NONE** — all four need implementation |
| `database-migrations/spec.md` §"Pre-migration backup" | Conditional `pg_dump` to S3 when `db-destructive` label present | **NONE** |
| `monitoring-observability/spec.md` | 3 health endpoints (liveness/readiness/startup) | **DONE** (TASK-034) |
| `file-storage/spec.md` | Storage volume also tar'd into backup (v2 work) | **DEFERRED** — file storage itself not yet implemented |
| `athlos-foundation/design.md:1548-1568` | Backup script shape (`BACKUP_DIR`, retention, pg_dump flags) | **NOT IMPLEMENTED** |
| `athlos-foundation/design.md:6019` | `BACKUP_BEFORE_MIGRATE` env var in entrypoint + `s3://${BACKUP_BUCKET}/pre-deploy-<sha>.dump` upload | **NOT IMPLEMENTED** |
| `athlos-foundation/design.md:6030` | `drizzle-kit check` on every PR + cron drift detection | **NOT IMPLEMENTED** |

---

## 4. Automation gaps vs runbook

| Step | Manual today? | Automatable? | Effort (LoC) |
|------|---------------|--------------|--------------|
| `pnpm db:migrate:status` (runbook step 1) | Yes — script doesn't exist | Yes — TS script + Vitest | ~140 (80 impl + 60 test) |
| `pnpm test:run` / `typecheck` / `lint` (steps 2-4) | Already wired into CI `test.yml` | Already automated | 0 |
| `GET /health` + `/health/ready` smoke (steps 5-6) | Manual curl | Yes — curl/wget in compose healthcheck + CI post-deploy smoke job | ~40 (compose) + ~30 (YAML) |
| DATA_STEWARD grant (step 7) | Yes — manual SQL | Yes — `scripts/grant-data-steward.sh` with `INSERT ... ON CONFLICT DO NOTHING`, takes `OPERATOR_USERNAME` arg | ~60 bash |
| Import / Reconciliation sanity (steps 8-9) | Manual curl | Optional — post-deploy smoke job in CI (`curl /health/ready`, `curl /api/v1/freshness`) | ~50 YAML + ~30 TS helper |
| `pnpm db:migrate:rollback` (step 10) | Referenced but doesn't exist + **inconsistent with forward-only spec** | **NO** — spec mandates forward-only. Fix the runbook to say "forward-fix with new migration" instead | ~0 (doc-only) |
| Re-deploy previous image/tag (step 11) | Manual `docker compose pull && up -d` | Yes — CI deploy workflow + manual rollback job | ~80 YAML |
| `pg_dump` pre-deploy (NOT in runbook but in spec) | Manual / nothing | Yes — `scripts/backup.sh` (gzip, retention) + S3 client | ~120 bash + ~20 compose |
| `RUN_MIGRATIONS=true` auto-apply on startup | Manual today (`pnpm db:migrate` in a terminal) | Yes — `docker-entrypoint.sh` runs `drizzle-kit migrate` then exec node | ~80 bash |
| Docker image build (compose `api` service) | Uses placeholder Dockerfile that just echoes | Yes — real multi-stage Dockerfile | ~80 Dockerfile |
| `drizzle-kit check` drift gate | Never runs | Yes — add step to CI test workflow | ~30 YAML |
| `db-destructive` PR label gate | Never enforced | Yes — `.github/labeler.yml` + CI check job scanning migration diffs for `DROP/TRUNCATE/DELETE FROM` patterns | ~60 YAML + ~30 labeler |
| Auto-backup-before-migrate | Never | Yes — `BACKUP_BEFORE_MIGRATE=true` in entrypoint triggers S3 upload before drizzle-kit migrate | ~40 bash (in entrypoint) |

---

## 5. Estimated total LOC

| Layer | Files | LoC |
|-------|-------|-----|
| Bash scripts (`backup.sh`, `restore.sh`, `grant-data-steward.sh`, `docker-entrypoint.sh`) | 4 new | ~300 |
| TypeScript (`packages/db/src/scripts/status.ts` + tests) | 2 new | ~140 |
| Dockerfile (multi-stage api) | 1 new (overwrite placeholder) | ~80 |
| docker-compose.yml (replace placeholder) + override | 2 modified | ~120 |
| GitHub Actions workflows (`deploy.yml` + destructive-check job) | 2 new | ~250 |
| `.github/labeler.yml` | 1 new | ~30 |
| Docs/runbook updates | 1 modified | ~30 |
| `.env.example` additions | 1 modified | ~10 |
| Tests (vitest for status script, bats or shellcheck for bash) | 4 new | ~150 |
| **Total** | **~18 files** | **~1,110 LoC** |

**Definitely >400 lines.** This is a chained-PR change.

---

## 6. Slicing recommendation

### Slice A — Migration Status + Drift Gate (foundation) — ~250 LoC

**The "first autonomous slice" — smallest path to value.**

- **New:** `packages/db/src/scripts/status.ts` (80L) + `status.test.ts` (60L)
  → implements `pnpm --filter @athlos/db status`. Connects with `DATABASE_URL`,
  reads `__drizzle_migrations` via Drizzle migrator API, lists committed files in
  `packages/db/drizzle/` (excluding `meta/`), computes `applied ∩ local` (OK),
  `applied − local` (DIVERGENCE), `local − applied` (PENDING), exits 0/1 accordingly.
- **Modify:** `packages/db/package.json` — add `"status": "tsx src/scripts/status.ts"`
  script.
- **Modify:** `.github/workflows/test.yml` — add `drizzle-kit check` step before
  `pnpm test:run`.
- **Modify:** `docs/runbook.md` — replace the `pnpm db:migrate:status` reference
  with the now-real command, drop the `pnpm db:migrate:rollback` line and replace
  with the forward-only narrative.
- **External deps:** None. Pure local + CI.
- **Why first:** Gives operators actual visibility into migration state BEFORE
  deploy. The runbook stops lying about rollback. The drift gate prevents the
  most common drift vector (forgetting to commit a generated migration).

### Slice B — Backup + Restore + DATA_STEWARD grant — ~350 LoC

- **New:** `scripts/backup.sh` (~80L) — `pg_dump --format=custom --no-owner --no-acl`,
  gzip output, 7-day minimum retention, 30-day auto-delete. Outputs to
  `${BACKUP_DIR:-/backups}/athlos-${ts}.sql.gz`.
- **New:** `scripts/restore.sh` (~60L) — takes dump path + `DATABASE_URL`, runs
  `pg_restore --clean --if-exists --no-owner --no-acl`, refuses if DB has
  active connections.
- **New:** `scripts/grant-data-steward.sh` (~50L) — takes `OPERATOR_USERNAME`,
  looks up uuid, `INSERT ... ON CONFLICT DO NOTHING` into `role_permissions`.
- **New:** `scripts/grant-data-steward.test.sh` (~40L, bats or shellcheck).
- **Modify:** `docker-compose.yml` — add `backup` service (cron container running
  `backup.sh` daily, mounting `/backups` named volume).
- **External deps:** None for `local` mode (volume only). Optional `aws s3 cp`
  step can be added in Slice D when BACKUP_BUCKET is wired.
- **Why second:** Operators can take + restore backups locally without needing
  a CI deploy to be set up. Also gives DATA_STEWARD a one-line grant script.

### Slice C — Production Dockerfile + Entrypoint + Compose wiring — ~280 LoC

- **New:** `Dockerfile` (~80L) — multi-stage. Stage 1: `pnpm fetch` + `pnpm install --frozen-lockfile --offline` deps. Stage 2: `pnpm --filter @athlos/db deploy` + `pnpm --filter @athlos/api build`, copy `dist/` + prod `node_modules`, run as non-root.
- **New:** `docker-entrypoint.sh` (~80L, bash) — accepts `RUN_MIGRATIONS` (default `false`) and `BACKUP_BEFORE_MIGRATE` (default `false`). Connection retry loop (`until pg_isready`). If `BACKUP_BEFORE_MIGRATE=true`, calls `scripts/backup.sh` and uploads to `s3://${BACKUP_BUCKET}/pre-deploy-${BUILD_SHA}.dump` via `aws s3 cp`. Then if `RUN_MIGRATIONS=true`, runs `drizzle-kit migrate`. Exits non-zero on any failure. `exec node dist/index.js` at the end.
- **Modify:** `docker-compose.yml` — wire `RUN_MIGRATIONS=true`, `BACKUP_BEFORE_MIGRATE=false`, env var passthrough, real `api` build, real `migrations` service that runs `drizzle-kit migrate` once and exits, healthcheck via `wget --spider /health/ready`.
- **New:** `docker-compose.override.yml` (~30L) — dev-mode overrides (bind mounts, log levels, no backups).
- **External deps:** AWS CLI for S3 upload (optional, only if BACKUP_BUCKET set).
- **Why third:** Once A and B exist, this slice wires the deploy mechanics. Local
  `docker compose up` works end-to-end.

### Slice D — CI Deploy Workflow + Pre-deploy Backup + Label Gate — ~250 LoC

- **New:** `.github/workflows/deploy.yml` (~180L) — triggered on `v*` tag push.
  Jobs: `test` (reuses test.yml via workflow_call), `build-and-push` (docker
  buildx, push to `ghcr.io/athlos/athlos-api:vX.Y.Z` + `:latest`), `deploy`
  (SSH to `${{ secrets.DEPLOY_HOST }}`, `docker compose pull && docker compose
  up -d`, runs `pg_dump` if PR had `db-destructive` label), `rollback` (manual
  workflow_dispatch with `ref` input).
- **New:** `.github/workflows/check-destructive.yml` (~60L) — on PR, diffs
  `packages/db/drizzle/*.sql` between PR head and merge base, greps for
  `DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA)`, `TRUNCATE`,
  `DELETE FROM \w+;\s*$` (without WHERE), `ALTER TABLE \w+ DROP`, fails if
  found AND `db-destructive` label missing. Emits warning PR comment when
  label present.
- **New:** `.github/labeler.yml` (~30L) — auto-applies `db-destructive` candidate
  label when `packages/db/drizzle/**` touched (reviewer removes if not actually
  destructive).
- **External deps:** GitHub Secrets (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`,
  `BACKUP_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), GHCR push
  token (built-in via `${{ secrets.GITHUB_TOKEN }}`).
- **Why fourth:** Requires operational infra (host, bucket, GHCR perms). Last
  because it's the highest blast-radius piece.

---

## 7. Risks (top 5)

1. **Backup safety** — `pg_dump` against a live DB without `--single-transaction`
   can produce inconsistent dumps under write load. Mitigation: spec already
   specifies `--format=custom --no-owner --no-acl` (design.md:6019); pair with
   a `pg_isready` wait + a test that pg_restore against a clean DB succeeds.
   Test on a seeded DB (~50k rows) before relying on it.

2. **Grant idempotency** — DATA_STEWARD grant via raw `INSERT` errors on the
   second run with `unique_violation` (composite PK on `(operator_id,
   permission_key)`). The grant script MUST use `INSERT ... ON CONFLICT
   DO NOTHING` AND report whether a row was actually inserted (so operators
   know if the grant was new vs. already-present).

3. **Migration ordering race** — If `RUN_MIGRATIONS=true` is set on multiple
   API replicas that start at the same time, they race on `__drizzle_migrations`
   inserts. Spec mandates `pg_advisory_lock` to serialize (database-migrations/
   spec.md:87-99) — must be implemented via a `drizzle-kit migrate` wrapper that
   acquires/releases the lock. Otherwise concurrent deploys corrupt the migration
   history.

4. **Rollback asymmetry / runbook drift** — The runbook currently references
   `pnpm db:migrate:rollback --to 0009_domain_freshness` (line 66). This
   command doesn't exist AND contradicts the spec's forward-only mandate. If
   an operator follows the runbook during an incident, they will panic when
   the command fails. Must reconcile the runbook in Slice A.

5. **Secret leakage in CI logs** — Deploy workflows commonly leak secrets via
   `echo ${{ secrets.X }}` or `--add-host` debug output. Mitigation: use
   `${{ secrets.X }}` ONLY in env declarations, never in run-steps; add a
   `shellcheck` step to the workflow to catch accidental `echo` of `$SECRET_*`
   vars; require `actions/checkout` with `persist-credentials: false`.

### Lesser risks

- `drizzle-kit check` produces false positives if snapshots are out of date.
  Pin a snapshot version in CI.
- Backup retention in compose requires the volume to survive `docker compose down`
  — must use a named volume, not a bind mount, for prod.
- S3 upload via `aws s3 cp` adds the AWS CLI to the image (~80MB). Consider
  using `awscli` via a sidecar container instead of baking it into the api image.

---

## 8. Out of scope (recommend)

- **Multi-region / blue-green / canary deploys** — Athlos is a single-node
  Postgres setup (spec says so explicitly). Defer until scale demands it.
- **Secrets manager migration (Vault, AWS SM)** — env-var injection is the v1
  contract (deployment-devops/spec.md:108). Add a layered secrets story later.
- **Auto-rollback on smoke failure** — Slice D deploys and exits; a follow-up
  PR can wire `curl /health/ready` post-deploy and rollback the image tag on
  failure.
- **Backup encryption at rest** — the spec stores dumps on a volume; encryption
  is a function of the storage layer, not the backup script. Add when S3 is
  wired (KMS or SSE-S3).
- **S3 backend for `FileStorage`** — separate spec, separate change
  (`openspec/specs/file-storage/spec.md`).
- **Per-tenant backup partitioning** — multi-tenancy spec lists it as
  future work. Not relevant for single-tenant v1.

---

## 9. Recommendation

| Question | Answer |
|----------|--------|
| Is this >400 LoC? | Yes — ~1,100 LoC across 4 slices |
| Stacked or single PR? | Stacked (chained). 4 PRs, each mergeable independently |
| First autonomous slice | **Slice A — Status + Drift Gate (~250 LoC)** |
| External deps in slice A? | None — pure local + CI |
| Does the runbook reference anything that contradicts the spec? | Yes — `pnpm db:migrate:rollback`. Slice A fixes it |
| Ready for proposal? | Yes, but the orchestrator should propose Slice A first; offer the full 4-slice roadmap as the broader scope |

### Immediate next step

The orchestrator should propose Slice A as a separate change (e.g.,
`deploy-automation-foundations` or `db-status-and-drift-gate`), since:
- It delivers value immediately (runbook stops lying, CI catches drift).
- It has no external dependencies (no S3, no GHCR, no deploy host).
- It unblocks the runbook reconciliation.
- It's small enough for a single PR (~250 LoC, well under the 400 review cap).

Slices B/C/D can follow as separate changes once A is merged and operators have
visibility into migration state.

---

## 10. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `docs/runbook.md` | Current runbook (94L) — references `db:migrate:status`, `db:migrate:rollback`, manual SQL grants, curl-based smoke checks |
| `Dockerfile` | Placeholder (8L) — "real multi-stage build lands in PR 9" |
| `docker-compose.yml` | Placeholder (65L) — db healthy, api + migrations placeholder, no healthcheck, no RUN_MIGRATIONS |
| `.github/workflows/test.yml` | Test only (46L) — Postgres service + test + typecheck; no deploy, no drizzle-kit check |
| `.dockerignore` | Already complete (19L) |
| `.env.example` | 42L — missing `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BACKUP_BUCKET` |
| `packages/db/package.json` | Scripts: `generate`, `migrate`, `studio`, `smoke` — no `status`, no `check` |
| `packages/db/src/__smoke__.ts` | DB SELECT 1 sanity (32L) — pattern to follow for `status.ts` |
| `packages/db/drizzle/0000..0011*.sql` | 12 migration files; 0010 created the `role_permissions` table |
| `apps/api/src/routes/health.ts` | 3 health endpoints (80L) — already implemented per spec |
| `apps/api/src/index.ts` | API entrypoint (58L) — no RUN_MIGRATIONS handling |
| `packages/notifications/src/dispatcher.ts` | DATA_STEWARD routing wired (line 198 `fetchDataStewards`) — fixed in commit `29e3746` |
| `apps/api/scripts/ci-check-audit-fp.sh` | CI guard pattern to follow (43L) |
| `apps/api/scripts/test-ci-guard-negative.sh` | Negative-test pattern to follow (51L) |
| `openspec/specs/deployment-devops/spec.md` | 236L — defines the deployment target |
| `openspec/specs/database-migrations/spec.md` | 134L — defines status, check, db-destructive, forward-only |
| `openspec/specs/monitoring-observability/spec.md` | Defines the 3 health endpoints (already done) |
| `openspec/changes/athlos-foundation/design.md:6019` | BACKUP_BEFORE_MIGRATE entrypoint decision |
| `openspec/changes/athlos-foundation/design.md:6030` | drizzle-kit check + label gate decision |
| `openspec/changes/athlos-foundation/design.md:1548` | backup.sh shape (BACKUP_DIR, retention, pg_dump flags) |
| `openspec/changes/athlos-import-completion/verify-report.md` | Last cycle's lessons (no AI co-author, commit + bump + changelog per PR) |
| `openspec/changes/explore-athlos-current-state-analysis/exploration.md` | Prior holistic exploration — defers deploy work to "next cycle" |