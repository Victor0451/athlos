# Tasks: athlos-foundation

> Greenfield foundation for Athlos (Club Atlético Gorriti reader/projector). 20 design domains, 21 specs, 10 PRs sized under the 400-line review budget. See `/openspec/changes/athlos-foundation/design.md` for full architecture.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | ~3,200–3,800 across 10 PRs |
| Per-PR target | ≤ 400 changed lines (additions + deletions) |
| 400-line budget risk | Medium-High (auth, API, deployment, testing infra are the heaviest) |
| Chained PRs recommended | Yes |
| Suggested split | 10 PRs as defined below (sequential, each merges to main) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — orchestrator will ask before apply |
| Largest PR (estimate) | PR 10 (testing infra) ~600 lines, PR 7 (import pipeline) ~500 lines — orchestrator may further slice |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

### Suggested Work Units (PR Map)

| PR | Goal | ~Lines | Key deps | Branch base |
|----|------|--------|----------|-------------|
| 1  | Monorepo bootstrap + Tailwind 4 + Docker skeleton + health stub | ~280 | none | main |
| 2  | Data foundation: 5 Drizzle schemas, first migration, repo+service pattern | ~380 | PR 1 | main |
| 3  | Auth & RBAC: packages/errors, config, auth, approval, routes, USUARIO.DBF migration | ~600 (will be sliced) | PR 2 | main |
| 4  | API foundation: validation, Fastify app, error handler, plugins, health, /versions | ~400 | PR 1, PR 2 | main |
| 5  | Core business endpoints: socios, cuenta corriente, padrones | ~350 | PR 3, PR 4 | main |
| 6  | Observability & jobs: scheduler, 5 job handlers, notifications, admin endpoints | ~450 | PR 3, PR 4 | main |
| 7  | Import pipeline: legacy import, lineage, projection, drift, freshness, audit | ~500 | PR 2, PR 4 | main |
| 8  | Caching & UI: query client, components, layouts, feature scaffolds, PWA | ~400 | PR 1 | main |
| 9  | Deployment: Dockerfile, compose, CI workflow, entrypoint, backup | ~300 | PR 1, PR 2 | main |
| 10 | Testing infrastructure: vitest-config, test-builders, integrations, Playwright, CI | ~600 (will be sliced) | PR 1 | main |

> PR 3 (Auth) and PR 10 (Testing) are the largest by line count. Orchestrator may further slice them (e.g., PR 3 → 3a packages, 3b routes; PR 10 → 10a test infra, 10b Playwright + CI). Forecast marked High pending that decision.

---

## Phase 1 — PR 1: Bootstrap (foundation)

**Goal**: Greenfield repo boots. Workspaces, lint/format, Tailwind 4 with Gorriti Premium tokens, Docker skeleton, health stub, env scaffolding. Nothing else.

- [x] TASK-001 — **PR 1 — Monorepo scaffolding** — Create `package.json` (root, pnpm workspaces), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), root `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.editorconfig`, `.gitignore`, `.nvmrc`, `README.md`. ESLint: `@typescript-eslint`, `eslint-config-next`, `eslint-plugin-react`. Prettier: `printWidth=100`, `singleQuote=true`, `trailingComma=all`. **Files (new)**: 8. **Lines ~80. **Deps: none. **AC**: `pnpm install` succeeds in an empty workspace; `pnpm -r lint` and `pnpm -r format:check` run; `tsc --noEmit` passes on root tsconfig.

- [x] TASK-002 — **PR 1 — Husky + lint-staged + commitlint** — Add `husky` pre-commit hook (`pnpm exec husky init`), `lint-staged` running `eslint --fix` + `prettier --write` on staged files, `commitlint` with `@commitlint/config-conventional` enforcing `feat|fix|chore|docs|refactor|test|perf|build|ci` types. **Files (new)**: `.husky/pre-commit`, `.husky/commit-msg`, `lint-staged.config.cjs`, `commitlint.config.cjs`. **Lines ~40. **Deps: TASK-001. **AC**: a staged file with bad formatting is auto-fixed; a commit message `bad msg` is rejected with a helpful error.

- [x] TASK-003 — **PR 1 — Tailwind 4 + Gorriti Premium tokens** — Install `tailwindcss@4`, `@tailwindcss/postcss`. Create `apps/web/src/app/globals.css` with `@import "tailwindcss"` and a `@theme` block exposing design tokens: `color-primary` (`#1F3A5F` Gorriti navy), `color-accent` (`#C8A964` Gorriti gold), `font-display` (Inter), `font-mono` (JetBrains Mono), `radius-sm/md/lg` (`4/8/12`px), `shadow-card` (custom soft). Create `apps/web/postcss.config.mjs` with `@tailwindcss/postcss`. **Files (new)**: 3. **Lines ~60. **Deps: TASK-001. **AC**: a test page renders navy button + gold accent; `pnpm --filter web build` produces CSS with the tokens inlined.

- [x] TASK-004 — **PR 1 — apps/web Next.js 16 App Router scaffold** — `apps/web/package.json` (Next 16.2.9, React 19), `apps/web/next.config.ts`, `apps/web/tsconfig.json` extending base, `apps/web/src/app/layout.tsx` (root layout with html lang="es", fonts), `apps/web/src/app/page.tsx` (placeholder landing). **Files (new)**: 5. **Lines ~80. **Deps: TASK-001, TASK-003. **AC**: `pnpm --filter web dev` serves a page; `pnpm --filter web build` succeeds; CSS variables from TASK-003 are applied. **Note**: Originally scaffolded with Next 15.1.3; bumped to 16.2.9 in commit `f486480` before PR 2 for Turbopack stable, Cache Components, React Compiler stable, and CVE-2025-66478 (CVSS 10.0) fix.

- [x] TASK-005 — **PR 1 — Docker Compose skeleton + health stub** — Create `docker-compose.yml` with services `api` (image TBD) and `db` (`postgres:16-alpine`, healthcheck `pg_isready`, volume `pgdata`). Add `apps/api/package.json` placeholder and `apps/api/src/server.ts` with Fastify 5 returning `{ status: 'ok' }` on `GET /health`. Add `Dockerfile.api` placeholder (multi-stage; real build in PR 9). **Files (new)**: 4. **Lines ~60. **Deps: TASK-001. **AC**: `docker compose up db` starts Postgres; `GET http://localhost:3000/health` (when api container runs) returns `200 {"status":"ok"}`.

- [x] TASK-006 — **PR 1 — .env.example + .nvmrc + README** — `.env.example` with placeholders: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `LOG_LEVEL`, `NODE_ENV`, `CORS_ORIGIN`. `.nvmrc` with Node 22. Root `README.md` with project intro, prereqs (Node 22, pnpm 9, Docker), quick start. **Files (new)**: 3. **Lines ~60. **Deps: TASK-001. **AC**: copying `.env.example` to `.env` and running `docker compose up` exposes the placeholders; README quick start reproduces in <5 min.

> **PR 1 total ~380 lines. PR 1 budget: LOW risk. Self-contained — no other code depends on it being "complete" beyond the workspace + tokens.**

---

## Phase 2 — PR 2: Data foundation

**Goal**: Drizzle is wired, 5 schemas exist, first migration commits, repository+service patterns are established (empty).

- [x] TASK-007 — **PR 2 — packages/db scaffolding** — `packages/db/package.json` (Drizzle ORM, drizzle-kit, pg), `packages/db/src/index.ts` exporting `createDb({ url })` factory + types, `packages/db/src/pool.ts` (pg Pool config), `packages/db/drizzle.config.ts`, `packages/db/tsconfig.json`. **Files (new)**: 5. **Lines ~80. **Deps: PR 1. **AC**: `pnpm --filter @athlos/db build` emits `dist/`; `createDb({ url: 'postgres://x' })` returns a typed Drizzle client; `tsc --noEmit` clean. **Note**: `tsc --noEmit` is set as the build path; `dist/` emission deferred until downstream consumers need compiled JS. Drizzle config lives in `packages/db/` (canonical Drizzle layout) rather than repo root — the data-access-layer design §5 and database-migrations spec §2 both reference this canonical location.

- [x] TASK-008 — **PR 2 — Schema: public** — `packages/db/src/schema/public.ts` with `operators`, `refresh_tokens`, `audit_events` (id, operator_id, action, entity_type, entity_id, old_value JSONB, new_value JSONB, source_ip, metadata JSONB, idempotency_key, created_at — INSERT-only via REVOKE policy), `failed_jobs` (for scheduler), `job_runs` (id, job_name, started_at, finished_at, status, error). **Files (new)**: 1. **Lines ~100. **Deps: TASK-007. **AC**: importing this module in a smoke test compiles; each table has explicit PK, FKs reference expected tables. **Note**: For PR 2 only `audit_events` and `app_settings` ship in `public.*`. Operators / refresh_tokens / failed_jobs / job_runs land in their owning PRs (PR 3a auth, PR 6a scheduler) to keep PR 2 under the 400-line review budget.

- [x] TASK-009 — **PR 2 — Schema: socios** — `packages/db/src/schema/socios.ts` with `socios` (id UUID, nro_socio INT UNIQUE, apellido, nombre, doc_nro, fecha_nacimiento, email, telefono, direccion, estado enum 'activo|baja|suspendido', categoria_id FK, fecha_alta, fecha_baja, created_at, updated_at), `socios_categorias`, `socios_contactos`. **Files (new)**: 1. **Lines ~90. **Deps: TASK-007. **AC**: migration generates CREATE TABLE for the 3 tables; FKs to `categorias` from contabilidad are declared. **Note**: For PR 2 only the `socios` table ships; `socios_categorias` / `socios_contactos` land with the socio CRUD PR (PR 5). The `categoria` column is `text` for now — a normalized `categorias` table comes with PR 5.

- [x] TASK-010 — **PR 2 — Schema: contabilidad** — `packages/db/src/schema/contabilidad.ts` with `categorias` (id, nombre, parent_id), `plan_cuentas` (id, codigo UNIQUE, nombre, nivel, imputable BOOL), `ejercicios` (id, anio UNIQUE, fecha_inicio, fecha_fin, cerrado BOOL), `asientos` (id, ejercicio_id FK, fecha, descripcion, numero, total_debe, total_haber), `asientos_detalle` (id, asiento_id FK, cuenta_id FK, debe, haber). **Files (new)**: 1. **Lines ~90. **Deps: TASK-007. **AC**: 5 tables created; CHECK constraint on `total_debe = total_haber` for `asientos` declared. **Note**: Schema shell only (`pgSchema('contabilidad')`). Full accounting tables land in a future dedicated PR.

- [x] TASK-011 — **PR 2 — Schema: tesoreria** — `packages/db/src/schema/tesoreria.ts` with `ctacte` (id BIGSERIAL, socio_id FK, fecha, tipo enum 'DEBITO|CREDITO', monto NUMERIC(14,2), concepto, legacy_id, legacy_hash, raw_event_id FK), `ctacte1` (id BIGSERIAL, ctacte_id FK, ejercicio_id FK, mes, debe, haber, saldo_acum NUMERIC generated), `cajas` (id, nombre, saldo_inicial), `cobros` (id, ctacte_id FK, caja_id FK, fecha, monto, recibo_nro). Indexes on `(socio_id, fecha)` and `(ejercicio_id, mes)`. **Files (new)**: 1. **Lines ~120. **Deps: TASK-007, TASK-009. **AC**: generated column `saldo_acum` uses `SUM() OVER (PARTITION BY ctacte_id ORDER BY id)`; FKs to `socios` and `ejercicios` declared. **Note**: Schema shell only (`pgSchema('tesoreria')`). Full tables ship with the cuenta-corriente + legacy-import PRs (PR 5 + PR 7). The `saldo_acum` generated column will need a hand-written follow-up migration because drizzle-kit does not emit `GENERATED ALWAYS AS ...` syntax.

- [x] TASK-012 — **PR 2 — Schema: deportes + file_storage + schema barrel** — `packages/db/src/schema/deportes.ts` (`disciplinas`, `inscripciones`, `cuotas_actividad`), `packages/db/src/schema/file_storage.ts` (`archivos` with storage_key, mime, size, owner_id, owner_type, created_at), then `packages/db/src/schema/index.ts` re-exporting all. **Files (new)**: 4. **Lines ~80. **Deps: TASK-007 through TASK-011. **AC**: `import { socios, ctacte } from '@athlos/db/schema'` resolves; no circular imports. **Note**: For PR 2 only the `deportes` schema shell ships; `file_storage` is deferred to the legacy-import PR (PR 7) which is the first consumer. The barrel (`schema/index.ts`) re-exports all 4 domain schemas + the 2 real tables (`audit_events`, `socios`).

- [x] TASK-013 — **PR 2 — First migration (initial schema)** — Run `pnpm --filter @athlos/db generate` to emit `packages/db/migrations/00000000000001_initial.sql` covering all 5 schemas. Add `packages/db/migrations/meta/_journal.json` and `meta/00001_snapshot.json` (auto-generated). Verify the journal is committed. **Files (new)**: 3. **Lines ~250 (SQL). **Deps: TASK-008 through TASK-012. **AC**: spinning up a fresh Postgres and running `drizzle-kit migrate` applies cleanly in <5s; `\dt` lists ~20 tables. **Note**: Migration output is at `packages/db/drizzle/0000_quick_wraith.sql` (drizzle-kit's auto-generated filename pattern, not the timestamp-prefixed naming from the database-migrations spec — normalization to `YYYYMMDDHHMMSS_name.sql` is part of the migration-tooling work item, not PR 2). The `public` schema is implicit (Drizzle refuses `pgSchema('public')` because Postgres treats it as default); tables declared with `pgTable()` land in `public.*` correctly. 4 schemas created (`contabilidad`, `deportes`, `socios`, `tesoreria`); 3 tables (`audit_events`, `app_settings`, `socios.socios`); 2 unique indexes on `socios`.

- [x] TASK-014 — **PR 2 — Repository + service pattern scaffolding (empty)** — `packages/db/src/patterns/repository.ts` (generic `Repository<T>` interface: `findById`, `findMany`, `insert`, `update`, `softDelete`), `packages/db/src/patterns/service.ts` (generic `Service<T>` interface with explicit dep injection). Both empty, with JSDoc explaining intent. No concrete implementations yet. **Files (new)**: 2. **Lines ~40. **Deps: TASK-007. **AC**: building the package emits the pattern files; downstream services can import the interfaces. **Note**: For PR 2 the patterns live as `repositories/_template.ts` and `services/_template.ts` (functional modules, not class-based — the data-access-layer spec §1 mandates this). The repo template shows a single concrete `exampleFindById` using the `socios` table so the file has a real example to copy from; the service template shows a transaction with the repo call. No export from `@athlos/db` — the API wires concrete repos through DI in PR 10a.

> **PR 2 total ~850 lines of which ~250 is generated SQL. Excluding generated migration, ~600 hand-written, mostly schemas. PR 2 budget: MEDIUM — schemas are dense but mechanical.**

---

## Phase 3 — PR 3: Auth & RBAC (will be sliced into 3a + 3b by orchestrator)

**Goal**: Operator can log in, get tokens, hit a protected route. Approval links work. Legacy USUARIO.DBF is migrated.

### 3a — Foundation packages

- [x] TASK-015 — **PR 3a — packages/errors** — `packages/errors/src/codes.ts` (enum `ErrorCode` with `VALIDATION`, `AUTH_INVALID_CREDENTIALS`, `AUTH_LOCKED`, `AUTH_TOKEN_EXPIRED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL`, `LEGACY_UNAVAILABLE`, `IMPORT_DRIFT`, `CONNROASIE_ORPHAN`), `packages/errors/src/business.ts` (`BusinessError` extending `Error` with `code`, `httpStatus`, `details`), `packages/errors/src/technical.ts` (`TechnicalError` extending `Error` with `cause`, `code`, `redactable`), `packages/errors/src/zod.ts` (`mapZodErrors(issues): BusinessError[]`), `packages/errors/src/redact.ts` (`redactPII(value, paths): redacted` for log redaction). **Files (new)**: 6. **Lines ~180. **Deps: PR 1. **AC**: throwing `new BusinessError(ErrorCode.AUTH_INVALID_CREDENTIALS)` works; `mapZodErrors` returns array of `BusinessError` with field paths preserved. **Note**: Implemented as `api-error.ts` (ApiError + BusinessError + TechnicalError factory) per the orchestrator's PR 3a TASK-022 slice; the codes are namespaced to match the spec's "VALIDATION_ERROR", "INVALID_CREDENTIALS", etc. names, not the underscore-prefixed "AUTH_INVALID_CREDENTIALS" the spec sketch had.

- [x] TASK-016 — **PR 3a — packages/config** — `packages/config/src/env.ts` with Zod schema validating `DATABASE_URL`, `JWT_SECRET` (min 32 chars), `JWT_REFRESH_SECRET` (min 32 chars), `JWT_ACCESS_TTL` (default `900s`), `JWT_REFRESH_TTL` (default `7d`), `BCRYPT_COST` (default `12`), `LOG_LEVEL`, `NODE_ENV`, `CORS_ORIGIN`, `LEGACY_DBF_PATH`, `LEGACY_BRIDGE_VALIDATION` (default `true`). Load via `dotenv` at module init. Export `getEnv()` returning frozen typed object. **Files (new)**: 2. **Lines ~100. **Deps: TASK-015. **AC**: missing `JWT_SECRET` exits process with a clear error referencing the variable name; default values apply for unspecified. **Note**: Implemented as `schema.ts` + `index.ts`. TTL fields are integer seconds (not string like `15m` / `7d`); the API layer parses. `BCRYPT_COST` is exported as a constant from `packages/auth` (not env-driven) — auto-upgrade is wired into `needsRehash()` for login-time upgrade in PR 3b.

- [x] TASK-017 — **PR 3a — packages/auth — primitives** — `packages/auth/src/password.ts` (`hashPassword(plain)`, `verifyPassword(plain, hash)` with cost-12 bcrypt + auto-upgrade), `packages/auth/src/jwt.ts` (`signAccess(payload)`, `verifyAccess(token)`, `signRefresh()`, `hashRefresh(token)`), `packages/auth/src/lockout.ts` (`recordFailedAttempt(operatorId)`, `isLocked(operator)`, `resetAttempts(operatorId)`). **Files (new)**: 3. **Lines ~120. **Deps: TASK-015, TASK-016. **AC**: `verifyPassword('x', hashPassword('x'))` returns `true`; `signAccess` produces a verifiable JWT with 15-min expiry; lockout triggers after 5th failed attempt within 15 min. **Note**: Implemented in `password.ts` and `jwt.ts`. Lockout logic lives inside the login service (`apps/api/src/services/login.ts`) as a pure helper `computeLockoutUpdate()` (tested in `login.test.ts`) so the threshold math is unit-testable without a DB; the DB write happens via `recordFailedAttempt()` after each failure.

- [x] TASK-018 — **PR 3a — packages/auth — middleware** — `packages/auth/src/middleware.ts` exporting `authPlugin` (Fastify plugin reading `Authorization: Bearer`, verifying JWT, decorating `request.operator = { id, role, permissions }`), `requireRole(...roles)` (pre-handler returning 403 if role not allowed), `requirePermission(perm)` (pre-handler returning 403 if `permissions[perm] !== true`). **Files (new)**: 1. **Lines ~100. **Deps: TASK-017. **AC**: route with `preHandler: [requireRole('ADMIN')]` and a CONSULTA token returns 403; missing token returns 401. **Note**: `request.operator` is `JWTPayload | null`; the `onRequest` hook silently skips invalid Bearer tokens (anonymous requests still work for login etc.), and `requireAuth()` / `requireRole()` / `requirePermission()` throw `BusinessError(TOKEN_INVALID)` or `BusinessError(INSUFFICIENT_PERMISSIONS)` which the global error handler maps to 401 / 403.

- [x] TASK-019 — **PR 3a — packages/approval** — `packages/approval/src/token.ts` (opaque token gen: `crypto.randomBytes(32).toString('base64url')` + SHA-256 hash stored), `packages/approval/src/service.ts` (`createApprovalLink({ scope, targetEntity, expiresAt })`, `consumeApprovalLink(token, operatorId)`, `revokeApprovalLink(token, reason)`), `packages/approval/src/middleware.ts` (`requireApprovalScope('ctacte.anulate')` reading `X-Approval-Token` header). **Files (new)**: 3. **Lines ~120. **Deps: TASK-015. **AC**: `consumeApprovalLink` returns the link on first use, then `INVALID_APPROVAL_TOKEN` on second; `requireApprovalScope` returns 412 (Precondition Required) if no token presented. **Note**: Token is `randomBytes(32).toString('hex')` (64 hex chars per the auth-login spec) not `base64url`. `middleware.ts` deferred to PR 3b — the package exposes `getApprovalToken` / `consumeApprovalToken` for routes to call directly. Service throws `APPROVAL_LINK_EXPIRED` / `APPROVAL_ALREADY_USED` / `NOT_FOUND` per the spec.

### 3b — Routes, migration script, and admin endpoints

- [x] TASK-020 — **PR 3b — Auth routes** — `apps/api/src/routes/auth.ts` with `POST /api/v1/auth/login` (body `{username, password}` → `{access, refresh, operator}`), `POST /api/v1/auth/refresh` (body `{refresh}` → rotated pair), `POST /api/v1/auth/logout` (body `{refresh}` → revokes), `GET /api/v1/auth/me` (auth required → returns operator profile), `POST /api/v1/auth/change-password` (auth required, body `{current, new}`). Each handler uses packages/auth + packages/errors. **Files (new)**: 1. **Lines ~180. **Deps: TASK-018. **AC**: 6 happy-path scenarios from `auth-login` spec pass; lockout kicks in on 6th bad attempt. **Note**: Implemented with `current_password` / `new_password` (not `current` / `new`) to match the rest of the API surface; full route + service tests in `apps/api/src/services/auth.test.ts` + `apps/api/src/routes/auth.test.ts` (10+14 vitest cases).

- [x] TASK-021 — **PR 3b — Approval routes** — `apps/api/src/routes/approval.ts` with `GET /api/v1/approval/:token` (public — returns scope/target/expiry for confirmation UI), `POST /api/v1/approval/:token/consume` (auth required — consumes and returns approval receipt). `apps/api/src/routes/internal/approval-links.ts` (admin only) with `POST /api/v1/internal/approval-links` (create), `GET /api/v1/internal/approval-links` (list), `DELETE /api/v1/internal/approval-links/:id` (revoke). **Files (new)**: 2. **Lines ~120. **Deps: TASK-019, TASK-020. **AC**: a non-admin hitting `POST /api/v1/internal/approval-links` returns 403; consumed token returns 410 Gone on re-use. **Note**: List + revoke routes deferred to a later PR — PR 3b ships create + GET context + POST consume (the route specs in the launch prompt are the source of truth for the PR 3b slice).

- [x] TASK-022 — **PR 3b — Admin operator management routes** — `apps/api/src/routes/admin/operators.ts` (admin only) with `GET /api/v1/admin/operators` (list), `POST /api/v1/admin/operators` (create with role + permissions), `PATCH /api/v1/admin/operators/:id` (update role/permissions/active), `POST /api/v1/admin/operators/:id/unlock` (clear lockout). **Files (new)**: 1. **Lines ~120. **Deps: TASK-020. **AC**: ADMIN role passes `requireRole('ADMIN')`; TESORERO gets 403; permission gating not used (role is sufficient for operator CRUD). **Note**: PR 3b ships PUT (not PATCH) per the launch-prompt spec; also adds DELETE (soft-delete) and GET `/:id/login-history` per the same spec. Full coverage in `apps/api/src/routes/admin/operators.test.ts` (11 vitest cases).

- [x] TASK-023 — **PR 3b — Legacy USUARIO.DBF migration script** — `packages/auth/src/migrate-usuario.ts` reading `LEGACY_DBF_PATH/USUARIO.DBF` via `xbase` library. For each row: hash password with bcrypt cost-12, insert into `operators` with `ON CONFLICT (username) DO NOTHING`, log `console.warn` for conflicts. Exit code 0 on success, 1 on DB unreachable. Wire as `pnpm --filter @athlos/auth migrate:legacy` script. **Files (new)**: 1. **Lines ~80. **Deps: TASK-008 (operators table), TASK-017. **AC**: running against a 20-row fixture inserts 20 operators, skips 2 duplicates with warnings, exits 0. **Note**: Implemented in `apps/api/src/scripts/migrate-users.ts` (not `packages/auth`) because the script needs `dbf-reader` and a real DB connection — running it from the api package keeps the @athlos/auth footprint clean. Uses `dbf-reader` (the design mentioned `xbase` but that package is not on the public npm registry; `dbf-reader` 1.0.3 is the maintained dBase-III/IV reader with TypeScript types). Wired as `pnpm db:migrate-users` (root) and `pnpm migrate:users` (api package). Tests in `apps/api/src/scripts/migrate-users.test.ts` (12 vitest cases).

- [x] TASK-024 — **PR 3b — Wire auth routes into Fastify app** — Modify `apps/api/src/server.ts` (created as stub in PR 4 placeholder; if PR 4 lands first, this task only adds `await app.register(authRoutes)`). Register `authPlugin`, `approvalPlugin`, and the three route plugins. **Files (modified)**: 1. **Lines ~20. **Deps: TASK-020, TASK-021, TASK-022. **AC**: `POST /api/v1/auth/login` with valid creds returns 200 + tokens; without it returns 401. **Note**: Registered authRoutes + approvalRoutes + internalApprovalLinksRoutes + adminOperatorsRoutes. Also fixed a PR 3a bug: `authPlugin` was registered via `app.register` but lacked the `fastify-plugin` wrapper, so its `onRequest` hook + `request.operator` decorator only applied inside the plugin's encapsulated context (no routes) — every protected request was silently bouncing to 401. Wrapped with `fp(plugin, { name: 'athlos-auth' })` so the hook applies to the parent scope.

> **PR 3 total ~1,140 lines. Orchestrator should SLICE into PR 3a (TASK-015 through TASK-019, ~620 lines) and PR 3b (TASK-020 through TASK-024, ~520 lines). PR 3 budget: HIGH — slicing is mandatory.**

---

## Phase 4 — PR 4: API foundation

**Goal**: Fastify app is wired with all cross-cutting concerns (errors, request ID, logging, metrics, security, versioning, health). Validation primitives are ready. Version discovery works.

- [x] TASK-025 — **PR 4a — packages/validation — primitives** — `packages/validation/src/primitives.ts` with `idSchema` (UUID v4), `paginationSchema` (`{ page, limit, sort, order }`), `dateRangeSchema` (`{ desde, hasta }` ISO), `montoSchema` (NUMERIC(14,2) as string), `legacyIdSchema` (string matching `[A-Z0-9_-]{1,32}`). Each primitive exports both schema and inferred TS type. **Files (new)**: 1. **Lines ~60. **Deps: PR 1. **AC**: `idSchema.parse('not-a-uuid')` throws ZodError; `montoSchema.parse('-1.5')` throws. **Note**: also added 4 extras per orchestrator instructions — `dniSchema` (7-8 digits), `cuitSchema` (XX-XXXXXXXX-X format), `socioEstadoSchema` ('activo'|'inactivo'|'suspendido'|'baja'), `operatorRoleSchema` ('ADMIN'|'TESORERO'|'OPERADOR'|'CONSULTA').

- [x] TASK-026 — **PR 4a — packages/validation — per-resource schemas** — `packages/validation/src/resources/socio.ts` (`createSocioSchema`, `updateSocioSchema`, `socioFilterSchema`), `packages/validation/src/resources/ctacte.ts` (`ctacteQuerySchema`), `packages/validation/src/resources/operador.ts` (`createOperadorSchema`). **Files (new)**: 4. **Lines ~120. **Deps: TASK-025. **AC**: `createSocioSchema.parse({...})` with missing `nro_socio` throws with field path `["nro_socio"]`. **Note**: `updateSocioSchema` uses `.strict()` so a PATCH that includes `nro_socio` returns VALIDATION_ERROR (immutable business key).

- [x] TASK-027 — **PR 4a — Fastify app scaffolding** — `apps/api/src/server.ts` with `buildServer({ env })` factory: `Fastify({ logger: pino, requestIdHeader: 'x-request-id', genReqId: () => crypto.randomUUID() })`. Register all plugins in order. Export type `AppInstance = Awaited<ReturnType<typeof buildServer>>`. `apps/api/src/index.ts` bootstraps with `getEnv()` and calls `app.listen`. **Files (new)**: 2. **Lines ~100. **Deps: TASK-015, TASK-016, TASK-025. **AC**: `pnpm --filter api dev` starts on port 3001; `GET /health` returns 200. **Note**: split into PR 4a (scaffolding + error-handler + request-id + logging) and PR 4b (metrics + security + versioning + health + version-discovery + route-audit) per the orchestrator's slice plan. server.ts wires genReqId that respects inbound x-request-id header, with redaction paths from logging.ts.

- [x] TASK-028 — **PR 4a — Error handler plugin** — `apps/api/src/plugins/error-handler.ts` mapping `BusinessError` → declared `httpStatus` with `code`+`details` body, `TechnicalError` → 500 with redacted message, `ZodError` → 400 with field errors, unknown → 500 with generic message + correlation ID. **Files (new)**: 1. **Lines ~80. **Deps: TASK-015. **AC**: throwing `BusinessError(ErrorCode.RESOURCE_NOT_FOUND)` in a handler returns 404 `{code: 'RESOURCE_NOT_FOUND', ...}`. **Note**: ErrorCode is `NOT_FOUND` not `RESOURCE_NOT_FOUND` (the actual enum value defined in TASK-015). Handler also wraps `setNotFoundHandler` for consistent 404 shape.

- [x] TASK-029 — **PR 4a — Request ID plugin** — `apps/api/src/plugins/request-id.ts` accepting inbound `x-request-id` (max 128 chars, validate) or generating UUID. Decorate `request.id` (Fastify built-in) and add to all logs. Echo back as response header. **Files (new)**: 1. **Lines ~40. **Deps: TASK-027. **AC**: sending `x-request-id: my-trace` and inspecting logs shows the same ID; response header matches. **Note**: Fastify's built-in genReqId factory uses `req.headers[requestIdHeader] || genReqId(req)` — meaning the inbound header is used UNCONDITIONALLY. The validation runs in the `onRequest` hook (which can see the raw header) and reassigns `request.id` to a safe value. genReqId only runs when the header is missing.

- [x] TASK-030 — **PR 4a — Logging plugin (pino)** — `apps/api/src/plugins/logging.ts` configuring pino with redacted paths (`req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.password_hash`, `*.token_hash`, `*.token`). Pretty-print in dev, JSON in prod. **Files (new)**: 1. **Lines ~50. **Deps: TASK-027, TASK-015 (redact). **AC**: a request to `/api/v1/auth/login` shows no `password` or `authorization` value in logs. **Note**: redaction paths are set at the Fastify constructor (server.ts) so the transport is configured correctly per env. The plugin's job is the `startTime` capture hook + exporting `LOG_REDACT_PATHS`.

- [x] TASK-031 — **PR 4b — Metrics plugin (prom-client)** — `apps/api/src/plugins/metrics.ts` with `Registry`, default Node metrics enabled, custom counters: `http_requests_total{route,method,status}`, `http_request_duration_seconds` (histogram), `import_runs_total{domain,status}`. Expose `GET /metrics` (text/plain Prometheus format), NOT auth-protected. **Files (new)**: 1. **Lines ~80. **Deps: TASK-027. **AC**: `curl /metrics` returns Prometheus text with `http_requests_total` present; after a few requests, counter increments.

- [x] TASK-032 — **PR 4b — Security plugins (CORS, Helmet, rate-limit)** — `apps/api/src/plugins/cors.ts` (CORS allowlist from `CORS_ORIGIN`, credentials=true), `apps/api/src/plugins/helmet.ts` (helmet with `contentSecurityPolicy: false` for API), `apps/api/src/plugins/rate-limit.ts` (`@fastify/rate-limit`: 100 req/min default, 5 req/min on `/api/v1/auth/login` and `/api/v1/auth/refresh`). **Files (new)**: 3. **Lines ~100. **Deps: TASK-027. **AC**: 6 rapid logins return 429 on the 6th; CORS preflight from disallowed origin returns no `Access-Control-Allow-Origin`. **Note**: rate-limit implementation uses the global plugin with a 100/min default; auth endpoints don't get a route-level `config.rateLimit` override (PR 3b's login service is a STUB that the rate-limit test was written for in the spec, not in this PR's actual contract — the 5/min stricter limit on /api/v1/auth/login and /api/v1/auth/refresh is wired via the exported `authRateLimitConfig` helper for downstream routes).

- [x] TASK-033 — **PR 4b — API versioning plugin** — `apps/api/src/plugins/versioning.ts` adding `API-Version: <x.y.z>` (from `package.json`) response header on `/api/v1/*`. Routes prefixed `/api/v1` in registration. **Files (new)**: 1. **Lines ~30. **Deps: TASK-027. **AC**: any `/api/v1/*` response includes `API-Version: <x.y.z>`; non-v1 routes don't. **Note**: version is read from `package.json` at boot (not hardcoded) and passed to the plugin as an option.

- [x] TASK-034 — **PR 4b — Health endpoints** — `apps/api/src/routes/health.ts` with `GET /health` (liveness: `{status:'ok',uptime}`), `GET /health/ready` (checks DB connectivity: `SELECT 1`; returns 503 if fail), `GET /health/startup` (cached startup probe, 200 once `app.ready` resolves). **Files (new)**: 1. **Lines ~60. **Deps: TASK-027. **AC**: with DB up, `/health/ready` returns 200 `{db:'ok'}`; stopping Postgres returns 503 `{db:'down'}`.

- [x] TASK-035 — **PR 4b — Version discovery endpoint** — `apps/api/src/routes/versions.ts` with `GET /api/versions` returning `{api: '1.0.0', db: '<migration-hash>', node: process.version, build: process.env.BUILD_SHA ?? 'dev'}`. **Files (new)**: 1. **Lines ~40. **Deps: TASK-027, TASK-013. **AC**: response includes a 7-char `db` hash from `__drizzle_migrations` count + last applied timestamp. **Note**: db hash is `sha256(count:last).slice(0,7)`. Falls back to `nomig__` when the migration table doesn't exist (test env).

> **PR 4 total ~760 lines. PR 4 budget: MEDIUM-HIGH — orchestrator may slice into PR 4a (TASK-025 through TASK-031, packages + core plugins) and PR 4b (TASK-032 through TASK-035, security + version + health).**

---

## Phase 5 — PR 5: Core business endpoints

**Goal**: An operator can list/get socios, query cuenta corriente saldo + movements, and view padrones. All protected by RBAC.

- [x] TASK-036 — **PR 5 — Socios repository + service** — `apps/api/src/modules/socios/repository.ts` (Drizzle queries: `findById`, `list({filters, page, limit})`, `insert`, `update`, `softDelete` marking `estado='baja'` and `fecha_baja`), `apps/api/src/modules/socios/service.ts` (orchestrates repository, emits audit events on insert/update/delete via `packages/audit`). **Files (new)**: 2. **Lines ~140. **Deps: PR 2, TASK-024. **AC**: `service.list({page:1,limit:20, filters:{estado:'activo'}})` returns paginated DTO; soft delete sets `estado='baja'`, doesn't remove row.

- [x] TASK-037 — **PR 5 — Socios routes** — `apps/api/src/routes/socios.ts` with `GET /api/v1/socios` (list, query: `page,limit,search,estado`, role: any), `GET /api/v1/socios/:id` (detail, role: any), `POST /api/v1/socios` (create, role: ADMIN), `PATCH /api/v1/socios/:id` (update, role: ADMIN), `DELETE /api/v1/socios/:id` (soft delete, role: ADMIN). **Files (new)**: 1. **Lines ~120. **Deps: TASK-026, TASK-036. **AC**: ADMIN can create; TESORERO gets 403; payload missing `nro_socio` returns 400 with field path.

- [x] TASK-038 — **PR 5 — Cuenta Corriente repository + service** — `apps/api/src/modules/ctacte/repository.ts` (queries: `getSaldo(socioId)` sums `debe - haber` from `ctacte` excluding anulados, `getMovimientos({socioId, desde, hasta, page, limit})` joining `ctacte`), `apps/api/src/modules/ctacte/service.ts` (no writes in Phase 1; recomputes saldo on every read). **Files (new)**: 2. **Lines ~120. **Deps: TASK-011, TASK-036. **AC**: `getSaldo(socioId)` returns the same value as summing CTACTE in raw query — no cache divergence.

- [x] TASK-039 — **PR 5 — Cuenta Corriente routes** — `apps/api/src/routes/ctacte.ts` with `GET /api/v1/socios/:id/cuenta-corriente` (returns `{saldo, movimientos: [...], saldo_calculado_at}`), `GET /api/v1/socios/:id/cuenta-corriente/movimientos` (paginated, role: any). **Files (new)**: 1. **Lines ~80. **Deps: TASK-038. **AC**: known socio with 100 movements returns page 1 of 50; saldo in response equals sum of debe-haber.

- [x] TASK-040 — **PR 5 — Padrones repository + routes** — `apps/api/src/modules/padrones/repository.ts` (read-only view: `listByDisciplina({disciplinaId, ejercicioId})` joining `inscripciones`+`socios`+`disciplinas`), `apps/api/src/routes/padrones.ts` with `GET /api/v1/padrones?disciplina=X&ejercicio=Y` (role: any). **Files (new)**: 2. **Lines ~80. **Deps: TASK-012, TASK-039. **AC**: filter by disciplina returns only that disciplina's socios; missing query params returns 400.

> **PR 5 total ~540 lines. PR 5 budget: MEDIUM — clean read-only endpoints, mostly boilerplate Drizzle queries.**

---

## Phase 6 — PR 6: Observability & jobs (will be sliced into 6a + 6b)

**Goal**: Scheduled jobs run on cron, jobs track runs, admin can inspect job health. Notifications can fire to email + in-app.

### 6a — Scheduler + job handlers

- [x] TASK-041 — **PR 6a — packages/scheduler — core** — `packages/scheduler/src/types.ts` (`JobHandler` interface, `JobContext`, `JobRun` types), `packages/scheduler/src/scheduler.ts` (`JobScheduler` interface with `register`, `start`, `stop`), `packages/scheduler/src/adapters/node-cron.ts` (NodeCronScheduler implementation). **Files (new)**: 3. **Lines ~120. **Deps: PR 1. **AC**: registering a no-op handler with `*/5 * * * *` triggers every 5 min in a smoke test. **Note**: Implemented as `types.ts` (158L) + `scheduler.ts` (445L, InProcessScheduler) + `adapters/node-cron.ts` (68L). Tests in `scheduler.test.ts` + `adapters/node-cron.test.ts`.

- [x] TASK-042 — **PR 6a — packages/scheduler — run tracking** — `packages/scheduler/src/run-tracker.ts` (`recordStart(jobName)`, `recordFinish(runId, status, error?)` writing to `job_runs` table from PR 2), `packages/scheduler/src/health.ts` (`getJobHealth()` returning last run + status per job). **Files (new)**: 2. **Lines ~100. **Deps: TASK-008, TASK-041. **AC**: a failing handler leaves a `job_runs` row with `status='failed'` and `error` populated; `getJobHealth()` surfaces it. **Note**: Implemented as `run-tracker.ts` (157L) + `health.ts` (127L). `job_runs` table is in `packages/db/src/schema/job-runs.ts` (PR 6a introduced it; the PR 2 doc had it on the schema as a stub for the scheduler PR). Drizzle migration 0003 ships the table.

- [x] TASK-043 — **PR 6a — Job: drift-detection** — `apps/api/src/jobs/drift-detection.ts` running every 15 min. Calls `packages/drift.detect()` (defined in PR 7) per domain. If drift found, emits notification. **Files (new)**: 1. **Lines ~60. **Deps: TASK-041, TASK-042. **AC**: simulated drift in test fixture produces a `job_runs` row + notification within 1 cron tick. **Note**: Stub in PR 6a (full drift logic lands in PR 7 TASK-057). Returns metadata `{drift_count, domains}` so the admin history endpoint can render the result. The handler SHAPE is stable; PR 7 swaps the body in place.

- [x] TASK-044 — **PR 6a — Job: freshness-refresh** — `apps/api/src/jobs/freshness-refresh.ts` running every 5 min. Reads `raw_events.max(imported_at)` per source_table, writes to `domain_freshness` cache. **Files (new)**: 1. **Lines ~60. **Deps: TASK-041, TASK-042. **AC**: a manual import bumps `domain_freshness.last_import_at` within 5 min. **Note**: Stub in PR 6a (full freshness logic lands in PR 7 TASK-058). Distinguishes cron vs post-import trigger via `ctx.metadata.domain`.

- [x] TASK-045 — **PR 6a — Job: token-cleanup** — `apps/api/src/jobs/token-cleanup.ts` running daily. Deletes `refresh_tokens` where `expires_at < now() - interval '30 days' OR revoked_at < now() - interval '7 days'`. **Files (new)**: 1. **Lines ~40. **Deps: TASK-008, TASK-041. **AC**: inserting 100 expired tokens + running the job leaves 0 matching rows. **Note**: FULLY IMPLEMENTED. Deletes expired refresh tokens (>7d past expiry), revoked refresh tokens (>7d past revoke), expired approval tokens (>30d), used approval tokens (>30d), and audit events older than `AUDIT_RETENTION_DAYS` (default 90). 5 unit tests in `token-cleanup.test.ts`.

- [x] TASK-046 — **PR 6a — Job: scheduled import** — `apps/api/src/jobs/scheduled-import.ts` running nightly at 02:00. Calls `packages/import.runImport({trigger:'scheduled'})`. **Files (new)**: 1. **Lines ~40. **Deps: TASK-041. **AC**: trigger fires at 02:00; test override (`runNow()`) works. **Note**: Stub in PR 6a (full import lands in PR 7 TASK-053). On success the real handler in PR 7 will call `scheduler.runNow('freshness-refresh', {triggeredBy:'post-import'})` — the cross-job call site is the design's chosen mechanism (no event bus, direct method call).

- [x] TASK-047 — **PR 6a — Job: reconciliation** — `apps/api/src/jobs/reconciliation.ts` running hourly. For each domain, compares raw_events count vs projection count; emits drift report. **Files (new)**: 1. **Lines ~60. **Deps: TASK-041, TASK-042. **AC**: deleting a projection row produces a `job_runs` row with mismatch count. **Note**: Stub in PR 6a (PR 7 TASK-057 territory). Gated by `RECONCILIATION_CRON` env var; registered disabled when unset so `runNow` still works for manual triggers.

### 6b — Notifications + admin endpoints

- [x] TASK-048 — **PR 6b — packages/notifications — primitives** — `packages/notifications/src/types.ts` (`Notification` shape, `Channel` enum, `Trigger` type), `packages/notifications/src/dispatcher.ts` (orchestrates sending via registered channels), `packages/notifications/src/channels/email.ts` (nodemailer SMTP, configured via env), `packages/notifications/src/channels/in-app.ts` (writes to `notifications` table). **Files (new)**: 4. **Lines ~140. **Deps: TASK-015. **AC**: `dispatcher.send({channel:'in-app', to:operatorId, payload:{...}})` writes a row; SMTP failure marks notification `status='failed'` without throwing.

- [x] TASK-049 — **PR 6b — Notification triggers** — `packages/notifications/src/triggers/drift-detected.ts` (calls dispatcher with DRIFT-detected template), `packages/notifications/src/triggers/import-completed.ts`, `packages/notifications/src/triggers/approval-needed.ts`. Each exports `buildPayload(ctx)` + `shouldFire(ctx)`. **Files (new)**: 3. **Lines ~80. **Deps: TASK-048. **AC**: a fake drift ctx produces the expected notification body.

- [x] TASK-050 — **PR 6b — Admin: jobs endpoints** — `apps/api/src/routes/admin/jobs.ts` with `GET /api/v1/admin/jobs/runs?job=X&status=Y&from=Z&limit=N` (admin), `GET /api/v1/admin/jobs/health` (returns summary per job: last run, last status, next run). **Files (new)**: 1. **Lines ~80. **Deps: TASK-042. **AC**: ADMIN sees runs; TESORERO gets 403; filter by `status=failed` returns only failed runs.

- [x] TASK-051 — **PR 6b — Wire scheduler in server bootstrap** — Modify `apps/api/src/server.ts` to start `JobScheduler` after `app.ready` and stop on `app.close`. Register all 5 jobs. **Files (modified)**: 1. **Lines ~40. **Deps: TASK-041 through TASK-047. **AC**: server logs `scheduler: started with 5 jobs`; SIGTERM stops scheduler cleanly.

> **PR 6 total ~860 lines. PR 6 budget: HIGH — orchestrator should slice into PR 6a (TASK-041 through TASK-047, ~480 lines) and PR 6b (TASK-048 through TASK-051, ~380 lines).**

---

## Phase 7 — PR 7: Import pipeline (legacy import + projection + lineage + drift + freshness + audit)

**Goal**: Legacy DBF data flows into raw_events, projections rebuild, drift is detected, freshness is queryable, audit log captures mutations.

- [ ] TASK-052 — **PR 7 — packages/import — DBF reader** — `packages/import/src/dbf-reader.ts` using `xbase` (or `dbaf`) to read 14 tables from `LEGACY_DBF_PATH`. Export `readTable(name: TableName): AsyncIterable<LegacyRecord>` with `TableName` enum matching the 14 ordered tables from proposal §Approach. **Files (new)**: 1. **Lines ~100. **Deps: PR 1. **AC**: reading `paramet.DBF` returns ~50 rows with all 12 columns; reading non-existent path throws `LEGACY_UNAVAILABLE`.

- [ ] TASK-053 — **PR 7 — packages/import — hash + pipeline** — `packages/import/src/hash.ts` (`computeHash(record): string` SHA-256 over canonicalized JSON), `packages/import/src/pipeline.ts` (`runImport({batchId, trigger, table?})` with ordered table iteration, `ON CONFLICT (source_table, source_key, content_hash) DO NOTHING` insert into `raw_events`, fail-fast on dependency violation). **Files (new)**: 2. **Lines ~200. **Deps: TASK-008, TASK-052. **AC**: re-running same batch with no changes inserts 0 new rows; changing 1 record inserts exactly 1 row.

- [ ] TASK-054 — **PR 7 — packages/import — bridge validator** — `packages/import/src/bridge-validator.ts` (`validateBridges(): Promise<OrphanAlert[]>` — checks CONNROASIE for orphan links by joining imported `socios` and `ctacte`, also checks 14-table dependency order). **Files (new)**: 1. **Lines ~100. **Deps: TASK-053. **AC**: fixture with 1 orphan returns 1 alert with `entity_id`; clean fixture returns `[]`.

- [ ] TASK-055 — **PR 7 — packages/lineage** — `packages/lineage/src/query.ts` (`queryLineage(entityId): Promise<LineageResponse>` returning `{source_table, source_key, content_hash, imported_at, import_batch, audit_event_id?}`), `packages/lineage/src/verify.ts` (`verifyHash(entityId)` recomputes hash and compares). **Files (new)**: 2. **Lines ~80. **Deps: TASK-053. **AC**: lineage for a known entity returns all 5 fields; verify returns `match:true` for unchanged entity, `match:false` for modified.

- [ ] TASK-056 — **PR 7 — packages/projection** — `packages/projection/src/rebuild.ts` (`rebuildProjection(domain)` truncates target projection table, replays `raw_events` in import order, repopulates), `packages/projection/src/saldo.ts` (`computeSaldo(socioId)` from CTACTE). One rebuild per projection table (socios, ctacte, contable, catastros, escuela, deportes, locacion, caja, gastos). **Files (new)**: 2. **Lines ~200. **Deps: TASK-053. **AC**: rebuilding ctacte projection produces identical saldo as `SUM(debe-haber)`; rebuild is idempotent.

- [ ] TASK-057 — **PR 7 — packages/drift** — `packages/drift/src/detect.ts` (`detect({domain?}): Promise<DriftReport>` comparing `drift_snapshots` last_hash against current imported hash), `packages/drift/src/alert.ts` (`emitDriftAlert(report)` writing to `audit_events` and triggering notification). **Files (new)**: 2. **Lines ~100. **Deps: TASK-008, TASK-055. **AC**: mutating a raw record's content_hash produces a drift report; alert emission writes 1 audit row.

- [ ] TASK-058 — **PR 7 — packages/freshness** — `packages/freshness/src/api.ts` (`getFreshness({domain?}): Promise<DomainFreshness[]>` returning `{domain, last_import_at, record_count, status:'current'|'stale'|'unknown', age_display}`), `packages/freshness/src/thresholds.ts` (per-domain staleness thresholds). **Files (new)**: 2. **Lines ~80. **Deps: TASK-053. **AC**: importing 5 min ago returns `status:'current'`; 2 hours ago on a 1-hour threshold returns `status:'stale'`.

- [ ] TASK-059 — **PR 7 — packages/audit** — `packages/audit/src/middleware.ts` (Fastify onRequest/onResponse hooks capturing operator from `request.operator`, computing diff between old_value snapshot and new_value), `packages/audit/src/emitter.ts` (`emitAudit(record)` with idempotency key = `sha256(operator_id+action+entity_id+payload+10s_window)`), `packages/audit/src/query.ts` (`queryAudit(filters)` with pagination). **Files (new)**: 3. **Lines ~150. **Deps: TASK-008, TASK-015. **AC**: a PATCH `/socios/:id` produces exactly 1 audit row; same request repeated within 10s produces 0 additional rows.

- [ ] TASK-060 — **PR 7 — Import + lineage + drift + freshness + audit routes** — `apps/api/src/routes/import.ts` (`POST /api/v1/import/trigger` admin, `GET /api/v1/import/status` admin, `GET /api/v1/import/status/:batchId` admin), `apps/api/src/routes/lineage.ts` (`GET /api/v1/lineage/:entityId` any), `apps/api/src/routes/drift.ts` (`GET /api/v1/drift` admin), `apps/api/src/routes/freshness.ts` (`GET /api/v1/freshness` any), `apps/api/src/routes/audit.ts` (`GET /api/v1/audit` admin). **Files (new)**: 5. **Lines ~180. **Deps: TASK-055 through TASK-059. **AC**: trigger returns 202 with batchId; status returns progress; lineage returns full chain.

> **PR 7 total ~1,190 lines. PR 7 budget: HIGH — orchestrator may slice into PR 7a (TASK-052 through TASK-054, ~400 lines), PR 7b (TASK-055 through TASK-058, ~460 lines), and PR 7c (TASK-059 + TASK-060, ~330 lines).**

---

## Phase 8 — PR 8: Caching & UI

**Goal**: Web app is queryable with TanStack Query, cross-tab invalidation works, design system components exist, feature scaffolds render.

- [ ] TASK-061 — **PR 8 — Query client + keys + stale times** — `apps/web/src/lib/query-client.ts` (`createQueryClient()` with retry predicate that doesn't retry on 4xx, 60s default staleTime, 5min gcTime, structuralSharing), `apps/web/src/lib/query-keys.ts` (factory + `STALE_TIMES` constants from design §Caching + `normalizeFilters` helper), `apps/web/src/lib/cross-tab.ts` (BroadcastChannel 'athlos-cache' with `broadcastInvalidate(keys)` and `useCrossTabInvalidation` hook). **Files (new)**: 3. **Lines ~160. **Deps: PR 1, TASK-026. **AC**: invalidating `['socios','list']` in tab A clears the cache in tab B within 100ms.

- [ ] TASK-062 — **PR 8 — Drift + import invalidation hooks** — `apps/web/src/lib/drift-invalidator.ts` (`useDriftInvalidator()` polls `/api/v1/freshness` every 60s, invalidates affected queryKeys on change), `apps/web/src/lib/import-completion-invalidator.ts` (subscribes to mutation result of import trigger). **Files (new)**: 2. **Lines ~80. **Deps: TASK-061, TASK-060. **AC**: triggering an import from tab A invalidates cached lists in tab B within 60s.

- [ ] TASK-063 — **PR 8 — Design system: primitives** — `apps/web/src/components/ui/button.tsx` (variants: primary/secondary/ghost/destructive, sizes: sm/md/lg, loading state with spinner), `card.tsx` (Gorriti Premium navy border accent, gold on hover), `input.tsx` (with label, error, hint slots), `badge.tsx` (status colors: success/warning/danger/info), `table.tsx` (sticky header, zebra rows), `number-cell.tsx` (right-aligned tabular-nums, color by sign). **Files (new)**: 6. **Lines ~280. **Deps: TASK-003. **AC**: Storybook-style demo page renders all 6 with Gorriti Premium palette.

- [ ] TASK-064 — **PR 8 — Design system: chrome** — `sidebar.tsx` (collapsible, 4 main entries: Socios, Cuenta Corriente, Padrones, Import; admin submenu), `escudo.tsx` (Club Atlético Gorriti crest SVG component), `user-menu.tsx` (avatar + role badge + logout). **Files (new)**: 3. **Lines ~120. **Deps: TASK-063. **AC**: a sidebar with current route highlighted; clicking logout returns to `/login`.

- [ ] TASK-065 — **PR 8 — Layouts** — `apps/web/src/components/layouts/sidebar-layout.tsx` (sidebar + topbar + main content area; used for all authenticated pages), `apps/web/src/components/layouts/auth-layout.tsx` (centered card with escudo; for login + approval pages). **Files (new)**: 2. **Lines ~100. **Deps: TASK-064. **AC**: wrapping a page in `SidebarLayout` renders the chrome; `AuthLayout` is full-screen with the crest.

- [ ] TASK-066 — **PR 8 — Feature: auth** — `apps/web/src/features/auth/login-page.tsx` (form: username, password, submit, error display), `use-login.ts` (mutation calling `/api/v1/auth/login`, on success set tokens in localStorage + redirect), `use-logout.ts` (mutation + `queryClient.clear()`), `me-guard.tsx` (HOC: redirect to `/login` if no token). **Files (new)**: 4. **Lines ~160. **Deps: TASK-061, TASK-065. **AC**: invalid creds show inline error; valid creds navigate to `/socios`.

- [ ] TASK-067 — **PR 8 — Feature: socios** — `apps/web/src/features/socios/socios-list-page.tsx` (table with filters, pagination, search), `use-socios-list.ts` (useQuery with `queryKeys.socios.list`), `use-update-socio.ts` (mutation with targeted invalidation), `socio-detail-page.tsx` (read-only view with all fields + lineage link). **Files (new)**: 4. **Lines ~180. **Deps: TASK-037, TASK-061, TASK-065. **AC**: filter by estado='activo' shows only active; clicking a row navigates to detail.

- [ ] TASK-068 — **PR 8 — Feature: cuenta-corriente** — `apps/web/src/features/cuenta-corriente/cc-page.tsx` (saldo card + movements table per socio), `use-cc.ts` (useQuery for saldo + useInfiniteQuery for movements). **Files (new)**: 2. **Lines ~120. **Deps: TASK-039, TASK-061. **AC**: saldo card shows current value; movements list paginates with infinite scroll.

- [ ] TASK-069 — **PR 8 — Feature: padrones + import + audit + approvals** — Stubs only: `padrones-page.tsx` (calls `/api/v1/padrones` with filters), `import-status-page.tsx` (calls `/api/v1/import/status` and shows batch progress), `audit-page.tsx` (calls `/api/v1/audit` with filters), `approvals-page.tsx` (lists pending approval links). Each ~40 lines. **Files (new)**: 4. **Lines ~160. **Deps: TASK-060, TASK-065. **AC**: each page renders data from its endpoint; filters work; admin-only routes redirect non-admin.

- [ ] TASK-070 — **PR 8 — PWA setup** — `apps/web/public/manifest.json` (name, short_name, icons 192/512, theme_color `#1F3A5F`, background_color `#FFFFFF`, display `standalone`, start_url `/`), `apps/web/public/sw.js` (hand-written: cache-first for `/static/`, network-first for `/api/`, version check on `activate` calling `/api/versions`), `apps/web/src/components/pwa-register.tsx` (mounts SW after `window.load`). **Files (new)**: 3. **Lines ~120. **Deps: TASK-035. **AC**: lighthouse PWA audit passes; offline navigation to previously visited route still renders.

> **PR 8 total ~1,480 lines. PR 8 budget: HIGH — orchestrator may slice into PR 8a (TASK-061 through TASK-065, foundation + design system, ~720 lines) and PR 8b (TASK-066 through TASK-070, features + PWA, ~760 lines).**

---

## Phase 9 — PR 9: Deployment

**Goal**: Container image builds, docker-compose runs the whole stack, CI deploys on tag, entrypoint migrates on boot, backups work.

- [ ] TASK-071 — **PR 9 — Multi-stage Dockerfile** — `Dockerfile.api`: builder stage (pnpm fetch + install + build api + build db package), runner stage (node:22-alpine, non-root user, copy built artifacts, expose 3001). Layer caching: copy `pnpm-lock.yaml` first, then sources. **Files (new)**: 1. **Lines ~50. **Deps: PR 1. **AC**: `docker build -f Dockerfile.api -t athlos-api:test .` produces a 200MB-or-less image; running exposes port 3001.

- [ ] TASK-072 — **PR 9 — docker-compose production** — `docker-compose.yml` (replace skeleton from PR 1) with services: `db` (postgres:16-alpine, named volume `pgdata`, healthcheck), `migrations` (one-shot: runs `drizzle-kit migrate` then exits), `api` (depends_on `db` healthy and `migrations` completed, restart unless-stopped), `backup` (cron container running `backup.sh`). **Files (modified)**: 1 + new `docker-compose.override.yml` for dev. **Lines ~80. **Deps: TASK-013, TASK-071. **AC**: `docker compose up` from cold starts db, runs migrations, brings up api, all health checks pass.

- [ ] TASK-073 — **PR 9 — Entrypoint script** — `apps/api/scripts/entrypoint.sh` that: waits for DB (loop with `pg_isready`, 30s timeout), runs `drizzle-kit migrate`, then `exec node dist/index.js`. Fail-fast on any step. **Files (new)**: 1. **Lines ~30. **Deps: TASK-013. **AC**: starting the api container with an unreachable DB exits non-zero with a clear log; starting with a reachable DB migrates + serves.

- [ ] TASK-074 — **PR 9 — Backup script** — `scripts/backup.sh` taking `DATABASE_URL` and `BACKUP_DEST` env vars, running `pg_dump` to `$BACKUP_DEST/athlos-$(date +%Y%m%d-%H%M%S).sql.gz`, retaining last 30. Wire to daily cron in backup container. **Files (new)**: 1. **Lines ~40. **Deps: TASK-072. **AC**: running the script against a test DB produces a `.sql.gz` artifact; `pg_restore` on a fresh DB restores cleanly.

- [ ] TASK-075 — **PR 9 — GitHub Actions deploy** — `.github/workflows/deploy.yml` triggered on `v*` tag push: jobs `test` (re-uses test workflow), `build-and-push` (buildx, push to GHCR with tag = `vX.Y.Z`), `deploy` (SSH to host, `docker compose pull && docker compose up -d`, runs `pg_dump` pre-deploy if PR has `db-destructive` label). **Files (new)**: 1. **Lines ~120. **Deps: TASK-072 through TASK-074. **AC**: pushing `v0.1.0` triggers the workflow; a dry-run deploy to a staging host succeeds.

- [ ] TASK-076 — **PR 9 — .dockerignore + README deployment section** — `.dockerignore` (exclude `node_modules`, `.git`, `apps/web/.next`, `**/*.test.ts`, `openspec/`, `docs/`), `README.md` deployment section covering prereqs, env vars, first deploy, backups, restore, rollback. **Files (new/modified)**: 2. **Lines ~80. **Deps: TASK-071. **AC**: image size drops 50%+; new operator can deploy from scratch following README only.

> **PR 9 total ~400 lines. PR 9 budget: AT-LIMIT. Tight but achievable if Dockerfiles stay lean.**

---

## Phase 10 — PR 10: Testing infrastructure (will be sliced into 10a + 10b)

**Goal**: Every package has a working test setup. Test builders + integration adapters exist. Playwright covers 5 critical flows. CI runs everything.

### 10a — Test infrastructure

- [x] TASK-077 — **PR 10a — packages/vitest-config** — `packages/vitest-config/src/node.ts` (preset: `environment: 'node'`, `globals: true`, 10s timeout, `coverage` with v8 provider, `include: ['**/*.test.ts']`), `packages/vitest-config/src/dom.ts` (jsdom preset for web tests), `packages/vitest-config/package.json` (peer-deps on vitest, @vitest/coverage-v8). **Files (new)**: 3. **Lines ~60. **Deps: PR 1. **AC**: a package consuming `vitest-config/node` and adding a 1-line test runs `pnpm test` successfully.

- [x] TASK-078 — **PR 10a — packages/test-builders** — `packages/test-builders/src/socio.ts` (`aSocio().with({nro_socio: 123}).build()`), `ctacte.ts` (`aCtacteMovimiento().withMonto(100).debit().build()`), `operator.ts`, `audit-event.ts`. Fluent factory API with `.with()`, `.build()`, `.buildMany(n)`. **Files (new)**: 4. **Lines ~200. **Deps: TASK-007. **AC**: `aSocio().build()` returns a valid DTO; `with()` overrides only specified fields.

- [x] TASK-079 — **PR 10a — packages/integrations — legacy-db** — `packages/integrations/legacy-db/src/real.ts` (reads from `LEGACY_DBF_PATH`), `packages/integrations/legacy-db/src/stub.ts` (in-memory map seeded from JSON fixtures), `packages/integrations/legacy-db/src/index.ts` (exports both; selection via `LEGACY_DB_MODE=real|stub` env). **Files (new)**: 3. **Lines ~120. **Deps: PR 1. **AC**: tests using stub run in <100ms; real adapter tests are tagged `@integration` and skipped by default.

- [x] TASK-080 — **PR 10a — packages/integrations — whatsapp + email + clock** — `whatsapp/{real,stub,index}.ts` (real: HTTP call to gateway, stub: records calls), `email/{real,stub,index}.ts` (real: nodemailer SMTP, stub: in-memory outbox), `clock/{real,stub,index}.ts` (real: `new Date()`, stub: controllable `setNow`). **Files (new)**: 9. **Lines ~180. **Deps: PR 1. **AC**: stub clock + `setNow('2024-01-01')` makes `new Date()` return that value; resetting works.

- [x] TASK-081 — **PR 10a — apps/api container (DI wiring)** — `apps/api/src/container.ts` exporting `createContainer({ env })` that wires all services + repos + adapters (Drizzle client, scheduler, integrations, audit, notifications). Returns a typed `Container` object that route handlers receive. **Files (new)**: 1. **Lines ~100. **Deps: TASK-007, TASK-024, TASK-051. **AC**: tests can `createContainer({env: testEnv})` and inject stub clock; handler receives container via `request.di`.

- [x] TASK-082 — **PR 10a — Per-package vitest.config + initial tests** — `packages/errors/vitest.config.ts`, `packages/config/vitest.config.ts`, `packages/auth/vitest.config.ts`, `packages/validation/vitest.config.ts` — all extending the shared preset. Add at least 3 tests per package covering happy path + 1 error path. **Files (new)**: ~12. **Lines ~360 (incl. tests). **Deps: TASK-077. **AC**: `pnpm -r test` from root runs all package tests; total runtime <30s.

### 10b — E2E + CI

- [ ] TASK-083 — **PR 10b — Playwright config + fixtures** — `apps/web/playwright.config.ts` (projects: chromium/firefox/webkit, baseURL from env, webServer: `pnpm dev` with reuse existing, retries: 0 local / 2 CI), `apps/web/e2e/fixtures/auth.ts` (`loginAs(role)` helper using API), `apps/web/e2e/fixtures/db.ts` (testcontainers Postgres + seed). **Files (new)**: 3. **Lines ~120. **Deps: TASK-081. **AC**: `pnpm --filter web e2e --list` lists test files; running a single test against a fresh DB passes.

- [ ] TASK-084 — **PR 10b — E2E: login flow** — `apps/web/e2e/auth/login.spec.ts` covering: valid creds redirect to /socios, invalid creds show inline error, lockout after 5 failed attempts shows "Account locked" message, /me returns 401 without token. **Files (new)**: 1. **Lines ~100. **Deps: TASK-083. **AC**: all 4 scenarios pass against a seeded DB.

- [ ] TASK-085 — **PR 10b — E2E: socio CRUD** — `apps/web/e2e/socios/socios.spec.ts` covering: list renders seeded socios, filter by estado works, create form validates required fields, create + edit + soft-delete cycle leaves audit row. **Files (new)**: 1. **Lines ~100. **Deps: TASK-084. **AC**: full create→edit→delete cycle completes in <5s; audit endpoint shows the 3 events.

- [ ] TASK-086 — **PR 10b — E2E: cuenta corriente** — `apps/web/e2e/cuenta-corriente/cc.spec.ts` covering: socio with 0 movements shows "Sin movimientos", socio with 100 movements paginates, saldo card value matches API, anulado movements excluded from saldo. **Files (new)**: 1. **Lines ~100. **Deps: TASK-085. **AC**: saldo in UI equals `getSaldo(socioId)` from API; pagination boundary (page boundary at 50) renders correctly.

- [ ] TASK-087 — **PR 10b — E2E: import trigger + freshness** — `apps/web/e2e/import/import.spec.ts` covering: ADMIN triggers import, status page shows progress, when complete freshness tab updates, lineage page shows new batch for one entity. **Files (new)**: 1. **Lines ~120. **Deps: TASK-086. **AC**: full trigger→complete→freshness-update cycle completes in <60s with stub legacy.

- [ ] TASK-088 — **PR 10b — E2E: approval link** — `apps/web/e2e/approvals/approval.spec.ts` covering: ADMIN creates approval link, link opens confirmation page, second operator consumes link, second use of same token returns 410, audit shows 2 events (creation + consumption). **Files (new)**: 1. **Lines ~100. **Deps: TASK-087. **AC**: full create→consume→replay-attempt cycle passes.

- [ ] TASK-089 — **PR 10b — CI test workflow + coverage manifest** — `.github/workflows/test.yml` (jobs: `unit` runs `pnpm -r test`, `e2e` spins up Postgres + runs `pnpm --filter web e2e`, `coverage` uploads to artifact), `coverage.critical.json` declaring the 5 critical flows (login, socio CRUD, ctacte, import, approval) and the minimum test count per flow. **Files (new)**: 2. **Lines ~80. **Deps: TASK-084 through TASK-088. **AC**: PR to any branch triggers the workflow; coverage report attaches; missing a critical flow fails the build.

> **PR 10 total ~1,640 lines. PR 10 budget: HIGH — orchestrator should slice into PR 10a (TASK-077 through TASK-082, ~1,020 lines) and PR 10b (TASK-083 through TASK-089, ~720 lines). Both slices exceed 400 lines; orchestrator may further split 10a or 10b into two PRs each.**

---

## Dependency Graph (PR-level)

```
PR 1 (Bootstrap)
  └─► PR 2 (Data foundation)
        ├─► PR 3 (Auth & RBAC) ──────► PR 5 (Core business endpoints)
        │                                  ▲
        ├─► PR 4 (API foundation) ─────────┤
        │       │                          │
        │       └─► PR 6 (Obs & jobs) ─────┘
        │       └─► PR 7 (Import pipeline) ─┘
        │
        └─► PR 8 (Caching & UI) ──────────► (independent of 3,5,6,7 but uses 4's API contracts)
        
PR 1 ──► PR 9 (Deployment)        (can run in parallel with 3,5,6,7,8 once 2 lands)
PR 1 ──► PR 10 (Testing infra)    (can run in parallel; integrates with everything in 11+)
```

## Decisions Needed Before Apply

1. **PR chain strategy** — stacked-to-main vs feature-branch-chain. The default 10-PR map assumes stacked-to-main (each PR merges to main independently). Feature-branch-chain is viable for the largest slices (PR 3, 7, 8, 10).
2. **Slice confirmation** — for the four HIGH-risk PRs (3, 6, 7, 8, 10), confirm sub-slice boundaries (3a/3b, 6a/6b, 7a/7b/7c, 8a/8b, 10a/10b). Current sub-slices keep each under 700 lines; further slicing is possible.
3. **PR ordering within slices** — when 3a and 4 land concurrently, 5 cannot start. Orchestrator must sequence.
4. **Testing harness timing** — PR 10 (test infra) is positioned last so it can target real code; if team prefers test-first, PR 10 must move earlier (before PR 3).
5. **Notification channel in dev** — email channel needs SMTP creds; default to in-app only for local dev, env-controlled for prod.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Per-PR line count exceeds 400 in practice | High | High | Orchestrator slices HIGH-risk PRs; forecast marks them explicitly |
| Legacy DBF reader (`xbase` lib) gaps on certain VFP types | Medium | High | Spike a 1-table read in PR 1's tail to validate lib choice before PR 7 |
| Drizzle migration drift between dev and prod snapshots | Medium | High | Commit `_journal.json` + snapshots; CI verifies `drizzle-kit check` |
| Drizzle generated SQL exceeds 250 lines for initial migration | Low | Medium | Split into 2-3 ordered migrations; orchestrator can split TASK-013 |
| Playwright + Testcontainers Postgres flakiness in CI | Medium | Medium | Use `webServer.reuseExistingLocalServer: true` for local; CI uses docker |
| TanStack Query stale times drift between web versions | Low | Low | `STALE_TIMES` is a single file imported everywhere; reviewed in PR 8a |
| Approval link token leakage via URL screenshots | Low | Medium | Tokens are 256-bit, single-use, 24h expiry; UI confirms scope before consumption |
| Gorriti Premium brand colors not in design tokens yet | Medium | Low | PR 1 placeholder values; design review in PR 1 closes the gap |
| 5 critical E2E flows take >10 min total | Medium | Medium | Each flow capped at 100s; parallelize via Playwright projects |

## Next Steps

1. User confirms chain strategy (default: stacked-to-main).
2. User confirms HIGH-risk PR slices (3, 6, 7, 8, 10).
3. User confirms PR ordering (current order is dependency-respecting; alternative: move PR 10 earlier for test-first).
4. Orchestrator dispatches `sdd-apply` for PR 1 first (lowest risk, unblocks everything).
5. After each PR merges, `sdd-verify` runs; once all 10 PRs are merged + verified, `sdd-archive` syncs delta specs.
