# Exploration: athlos-ui

**Date:** 2026-06-27
**Change:** `athlos-ui` (Slice 8 — Operator Console: API client + Auth + Socios + Ctacte + Scheduler UI + PWA)
**Phase:** explore
**Mode:** both (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/athlos-ui/exploration.md`
**Author:** sdd-explore sub-agent
**Branch:** `explore/athlos-ui` (from `origin/main`)

---

## 1. State of the World

### 1.1 Backend state — API v0.5.8 deployed and verified

The Fastify API is live at `http://192.168.1.102:4001` (API container port 3001, host port 4001, `network_mode: host` per session preflight). Container image is `ghcr.io/victor0451/athlos-api:latest`. It shares PostgreSQL `pgserver` with the legacy import pipeline. All 25+ endpoints from `apps/api/src/server.ts` are mounted and exercised by the v0.5.8 test suite (`apps/api/src/routes/*.test.ts` covers each route module).

Database state (verified by import pipeline, v0.5.10):

| Master table | Rows |
|--------------|------|
| `socios` | 16,383 |
| `escuela` | 61 |
| `disciplinas` | 32 |
| `locacion` | 91 |
| `caja_movimiento` | 8,149 |
| `gastos` | 2,114 |
| `ctacte` | 200,945 |
| `ctacte1` | 152,797 |

Background scheduler runs 6 jobs every 60s–24h cadence (drift-detection, freshness-refresh, token-cleanup, scheduled-import, scheduled-promotion, reconciliation). Auth surface is JWT (15 min access + 7 day refresh, bcrypt-hashed, revocable) with role gates (`ADMIN`, `TESORERO`, `OPERADOR`, `CONSULTA`) plus the cross-cutting `data_steward` permission. CORS allowlist defaults to `http://localhost:3000` (`CORS_ORIGINS` env) with `credentials: true` — the Next.js dev port is already permitted. Approval-link consumption is a STUB at the route level (route docstring: "PR 3b the business action is a STUB") — the UI should NOT yet render "Confirm anulación" affordances against approval links.

### 1.2 Frontend state — greenfield except for tokens

`apps/web/` exists but is essentially empty of feature code:

| File | State |
|------|-------|
| `src/app/layout.tsx` | `lang="es"`, imports `tokens.css` + `globals.css`, body sets `bg-surface text-ink-700 font-body`. No providers. |
| `src/app/page.tsx` | Static placeholder: `<h1>Athlos</h1><p>initializing</p>` — render-once component, no data fetching. |
| `src/app/globals.css` | Tailwind directives + base layer focus ring + tabular-nums for tables. |
| `src/styles/tokens.css` | **All Gorriti Premium tokens defined** (colors, spacing, radius, shadows, motion, font vars). |
| `tailwind.config.ts` | Maps every CSS var to a Tailwind utility (`bg-surface`, `text-ink-900`, `font-display`, `shadow-md`, etc.). |
| `next.config.ts` | Trivial: `reactStrictMode: true`, `poweredByHeader: false`. |
| `public/` | Empty — `openspec/image/logo.jpg` is NOT yet copied into the web public dir. |

`apps/web/package.json` ships with: `next@16.2.9`, `react@19.0.0`, `react-dom@19.0.0`. Dev: `tailwindcss@3.4.17`, `eslint-config-next@16.2.9`, `typescript@5.7.2`, `vitest` (configured but zero tests). No TanStack Query, no SWR, no fetch wrapper, no Zustand, no router beyond Next.js App Router, no API client, no auth flow, no PWA manifest. `apps/web` is at version `0.5.8` (parity with API) but the dependency tree contains zero domain libraries.

### 1.3 Deployment state

The API container runs on `werchow-server` (`192.168.1.102`) via `docker-compose.yml` mapping `4000:3001`. The web app is NOT yet containerised — `docker-compose.yml` has no `web` service. For dev, `pnpm --filter @athlos/web dev` runs Next.js on `localhost:3000` against the API reachable at `localhost:4001` (or the LAN IP). Production deployment of the web app is a separate slice.

---

## 2. Operator Personas

The RBAC model is defined in `openspec/specs/auth-login/spec.md` (folded `user-management-rbac`). Four roles + one cross-cutting permission. Each maps to a distinct daily workflow and pain-point.

### 2.1 Persona — ADMIN ("Sistemas")

- **Role:** `ADMIN` (full access).
- **Who:** Club systems administrator — historically 1 person. Today: the operator who's also a developer.
- **Daily workflow:**
  - Trigger weekly imports of VFP DBF files; verify the 14 master tables land in `master.*`.
  - Investigate `drift` alerts (raw vs master divergence).
  - Manage operators (create, unlock locked accounts, change roles).
  - Restart / inspect scheduler jobs (`scheduled-import`, `scheduled-promotion`, `reconciliation`).
  - Audit log review when a TESORERO reports a suspicious change.
- **Decisions:** "Is the import run safe to trigger?", "Is the drift alert real or a false positive?", "Should I disable `scheduled-promotion` during a maintenance window?"
- **Pain today (without UI):** `psql` queries against `job_runs`, `audit_events`, `domain_freshness`, `drift_*`. Triggers via `curl POST /api/v1/import/trigger`. The 30s confirm-and-wait modal (`ui-design/spec.md:380-445`) was specified precisely because clicking "trigger" from CLI feels reckless.

### 2.2 Persona — TESORERO ("Tesorero")

- **Role:** `TESORERO` (financial operations, can carry `can_reprint` / `can_anulate`).
- **Who:** 1 person, club treasurer.
- **Daily workflow:**
  - Review today's `ctacte` movimientos across the 100+ accounts with movement.
  - Approve / reject `approval links` sent via WhatsApp for high-value anulaciones and payment orders.
  - Print monthly cuenta-corriente reports for board meetings.
  - Void receipts (`anular`) when a member pays in error — creates an approval link, sends via WhatsApp, waits for the OK.
- **Decisions:** "Did socio #4231 pay the cuota this month?", "Should I approve this $50.000 anulación?", "Who owes the most right now?"
- **Pain today:** All account queries go through legacy VFP. Anulación approvals arrive on WhatsApp as `http://...:3001/api/v1/approval/<token>` — the approver opens the link, sees a raw JSON context dump (the approval route returns only `action_type`, `action_id`, `context_summary`, no UI). They cannot preview the impact.

### 2.3 Persona — OPERADOR ("Mesa de entrada")

- **Role:** `OPERADOR` (data entry).
- **Who:** 2-3 front-desk staff.
- **Daily workflow:**
  - Look up a socio by DNI when they walk in.
  - Verify their `cuenta-corriente` saldo ("¿Está al día?").
  - Enroll them in a `disciplina` / `catastro` (padron update — limited UI surface for now).
  - Add new socios (rare — most are imported).
- **Decisions:** "Active member or baja?", "Which disciplina padron are they on?", "Print their cuenta?"
- **Pain today:** `psql` `SELECT * FROM socios WHERE dni = ?`. Slow, error-prone, no print formatting.

### 2.4 Persona — CONSULTA ("Recepción / Secretaría")

- **Role:** `CONSULTA` (read-only).
- **Who:** 1-2 staff who answer phones.
- **Daily workflow:**
  - "Sí, el socio X está al día." → lookup by name + verificar ctacte.
  - "Cuál es el padrón de natación 2026?" → `GET /api/v1/padrones?disciplina=NATACION&ejercicio=2026`.
- **Decisions:** None (read-only by design).
- **Pain today:** Same as OPERADOR — `psql` is the only access path.

### 2.5 Persona — DATA STEWARD (overlay permission)

- **Role:** any role + `data_steward` permission granted via `pnpm ops:grant-data-steward`.
- **Who:** Operators who receive `drift_alert` notifications and triage them.
- **Daily workflow:** Open the drift report (`GET /api/v1/drift`), decide whether each divergence is "expected late-arrival" or "data corruption that needs a re-promotion".
- **Pain today:** No notifications, no triage UI. Drift alerts land in `audit_events` and are invisible unless you `psql`.

### 2.6 Cross-cutting pain (everyone, no UI)

Without a web app, **every persona above runs `psql` or `curl` against the live database**. The current API has 25+ endpoints and 16,383 socios live — the operator console is the highest-value piece still missing. Every Slice A–E investment has zero operator surface until Slice 8.

---

## 3. Feature Inventory (grouped by domain)

Each feature is tagged **MVP** (required for Slice 8 ship), **NICE** (defer to Slice 8b+/9 if budget tight), or **OUT** (deferred to Phase 2 per `offline-pwa/spec.md`).

### 3.1 Auth & Session

| Feature | API endpoints | Auth | Priority | Notes |
|---------|---------------|------|----------|-------|
| Login screen (split 40/60 layout) | `POST /api/v1/auth/login` | public | **MVP** | Per `ui-design/spec.md:291-298`. Escudo on dark left panel. |
| Logout | `POST /api/v1/auth/logout` | auth | **MVP** | Revokes refresh token. |
| Refresh access token silently | `POST /api/v1/auth/refresh` | auth (refresh) | **MVP** | Background timer in API client; 14 min (1 min before 15m expiry). |
| View own profile | `GET /api/v1/auth/me` | auth | **MVP** | Top-bar avatar dropdown. |
| Change own password | `POST /api/v1/auth/change-password` | auth | **MVP** | Settings drawer. |
| Operator management UI (ADMIN creates/locks users) | `/api/v1/admin/operators/*` | ADMIN | **MVP** | TESORERO manages their team — this is operational. |

### 3.2 Dashboard (`/`)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| KPI strip (socios, ctacte, last import) | `GET /api/v1/freshness` + `GET /api/v1/socios?limit=1` | auth | **MVP** |
| Freshness card (14 domains) | `GET /api/v1/freshness` | auth | **MVP** |
| Scheduler health strip | `GET /api/v1/admin/jobs/health` | ADMIN | **MVP** |
| Recent audit events | `GET /api/v1/audit?limit=10` | ADMIN or data_steward | **MVP** |
| Drift alerts banner | `GET /api/v1/drift` | ADMIN or data_steward | **MVP** |

### 3.3 Scheduler (admin/jobs)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Job list + health grid | `GET /api/v1/admin/jobs/health` | ADMIN | **MVP** |
| Job detail (cron + last 5 runs) | `GET /api/v1/scheduler/jobs/:name` | ADMIN | **MVP** |
| Manual trigger | `POST /api/v1/scheduler/jobs/:name/run-now` | ADMIN | **MVP** |
| Enable/disable toggle | `PATCH /api/v1/scheduler/jobs/:name` | ADMIN | **MVP** |
| Run history with filters | `GET /api/v1/admin/jobs/runs?job=&status=&from=&limit=` | ADMIN | **MVP** |

### 3.4 Socios

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Socio list + search + filter | `GET /api/v1/socios?page=&limit=&estado=&search=` | auth | **MVP** |
| Socio detail with tabs (Profile · Ctacte · Deportes · Cuotas) | `GET /api/v1/socios/:id` + `GET /api/v1/socios/:id/cuenta-corriente[+movimientos]` + `GET /api/v1/padrones?disciplina=&ejercicio=` | auth | **MVP** |
| Create socio | `POST /api/v1/socios` | ADMIN | NICE |
| Edit socio | `PATCH /api/v1/socios/:id` | ADMIN | NICE |
| Soft-delete socio | `DELETE /api/v1/socios/:id` | ADMIN | NICE |

The list+detail flows are MVP (everyone needs them). CRUD forms are NICE because the legacy importer is the source of socio records — manual edits are rare and the existing `psql` workflow is acceptable for now.

### 3.5 Cuenta Corriente

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Standalone `/account` view | `GET /api/v1/socios/:id/cuenta-corriente` | auth | **MVP** |
| Movements pagination | `GET /api/v1/socios/:id/cuenta-corriente/movimientos?page=&limit=&desde=&hasta=&incluir_anuladas=` | auth | **MVP** |
| Summary strip (Total Charged / Total Paid / Outstanding) | (computed client-side from response) | auth | **MVP** |
| CSV export | (client-side CSV from movimientos) | auth | **MVP** |
| Receipt reprint | (not in API yet) | — | **OUT** (Phase 2; spec'd but not implemented) |

### 3.6 Import (`/import`)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| History table (last 20 runs) | `GET /api/v1/import/status` | ADMIN | **MVP** |
| Single-run detail | `GET /api/v1/import/status/:batchId` | ADMIN | **MVP** |
| Trigger new import (confirm + 30s countdown modal) | `POST /api/v1/import/trigger` | ADMIN | **MVP** |
| Cancel queued batch | `DELETE /api/v1/import/trigger/:batchId` | ADMIN | **MVP** |
| Promote trigger (sync, E2 ship) | `POST /api/v1/promote/trigger` | ADMIN | **MVP** |
| Promote status (last 20) | `GET /api/v1/promote/status` | ADMIN | **MVP** |
| Dependency graph | (client-side rendering of domain imports) | — | NICE |

### 3.7 Audit (`/audit`)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Filterable audit table | `GET /api/v1/audit?operator=&entity=&entityType=&from=&to=&page=&limit=` | ADMIN or data_steward | **MVP** |
| Row expand diff (before/after) | (client-side formatting of `oldValue`/`newValue`) | ADMIN or data_steward | **MVP** |
| CSV export | (client-side CSV) | ADMIN or data_steward | NICE |

### 3.8 Approvals (`/approvals`)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Pending approvals queue | (no list endpoint — derive from `audit_events` with action `APPROVAL_PENDING` or from a query of `approval_tokens`) | ADMIN or TESORERO | **OUT** (v1) |
| Public approval decision page | `GET /api/v1/approval/:token` + `POST /api/v1/approval/:token` | public (token = auth) | **MVP** (this is what the WhatsApp recipient clicks — needs a branded confirmation page, not raw JSON) |
| Create approval link | `POST /api/v1/internal/approval-links` | ADMIN or TESORERO | **MVP** (otherwise the UI cannot send a confirmation link to anyone) |

Note: the `POST /api/v1/approval/:token` route docstring states "the business action execution is a STUB". The approval UI must NOT yet promise "Your anulación will be processed" — it should say "Approval recorded, action will be applied" until the action executor ships.

### 3.9 Drift / Freshness / Lineage (overlay pages)

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Drift report table | `GET /api/v1/drift` | ADMIN or data_steward | **MVP** |
| Per-domain freshness | `GET /api/v1/freshness` | auth | **MVP** (lives in dashboard already) |
| Entity lineage viewer | `GET /api/v1/lineage/:entityId` | auth | NICE (used by ADMIN to debug "where did this record come from") |

### 3.10 Padrones

| Feature | API endpoints | Auth | Priority |
|---------|---------------|------|----------|
| Padron list (disciplina + ejercicio) | `GET /api/v1/padrones?disciplina=&ejercicio=&page=&limit=` | auth | **MVP** |
| Padron row export to CSV | (client-side CSV) | auth | NICE |

### 3.11 PWA / Offline

| Feature | Priority |
|---------|----------|
| `manifest.webmanifest` (installable home-screen icon) | **MVP** |
| Service worker (app-shell-only, no API cache) | **MVP** |
| Version discovery (`/api/versions` → cache-buster `?v=<hash>`) | **MVP** |
| Read-only offline (cached projections) | **OUT** (Phase 2 per `offline-pwa/spec.md`) |

---

## 4. Existing API Surface (verified against `apps/api/src/routes/`)

The following is the verified, exact endpoint contract — read directly from each route file. Use this table to map features → endpoints without re-reading the code.

### 4.1 Public / unauthenticated

| Method | Path | Auth | Request | Response | Errors |
|--------|------|------|---------|----------|--------|
| `GET` | `/health` | public | — | `{ status, version, uptime, timestamp }` | — |
| `GET` | `/health/ready` | public | — | `{ status, db, latency_ms, error? }` | `503` if DB down or 2s timeout |
| `GET` | `/health/startup` | public | — | `{ status: 'ok' }` | — |
| `GET` | `/api/versions` | public | — | `{ api, db, node, build }` | — |
| `GET` | `/api/v1/approval/:token` | public-by-token | — | `{ action_type, action_id, context_summary, created_by, expires_at, status }` | `410 Gone` if expired/used |
| `POST` | `/api/v1/approval/:token` | public-by-token | `{ decision: 'approve'\|'reject', reason? }` | `{ decision, action_type, action_id, decided_at }` | `400 REASON_REQUIRED` if reject w/o reason; `410` if expired/used |

### 4.2 Authenticated (`requireAuth()`)

| Method | Path | Request | Response | Errors |
|--------|------|---------|----------|--------|
| `POST` | `/api/v1/auth/login` | `{ username, password }` | `{ access_token, refresh_token, expires_in, operator_id, role, permissions }` | `401 INVALID_CREDENTIALS`; `429` if locked |
| `POST` | `/api/v1/auth/refresh` | `{ refresh_token }` | (same shape as login) | `401` on revoked/expired |
| `POST` | `/api/v1/auth/logout` | `{ refresh_token }` | `{ message: 'Logged out' }` | — |
| `GET` | `/api/v1/auth/me` | — | `{ id, username, role, permissions, last_login_at, ... }` | — |
| `POST` | `/api/v1/auth/change-password` | `{ current_password, new_password }` | `{ message: 'Password changed' }` | — |
| `GET` | `/api/v1/socios` | `?page=&limit=&estado=&search=` | `{ items, page, limit, total, has_more }` | — |
| `GET` | `/api/v1/socios/:id` | — | socio DTO (snake_case) | `404` |
| `GET` | `/api/v1/socios/:id/cuenta-corriente` | `?page=&limit=&desde=&hasta=&incluir_anuladas=` | `{ socio_id, saldo, saldo_calculado_at, movimientos, ... }` | — |
| `GET` | `/api/v1/socios/:id/cuenta-corriente/movimientos` | (same) | `{ items, page, limit, total, has_more }` | — |
| `GET` | `/api/v1/padrones` | `?disciplina=&ejercicio=&page=&limit=` (both required) | `{ disciplina, ejercicio, items, page, limit, total, has_more }` | `400` if missing params |
| `GET` | `/api/v1/freshness` | `?domain=` (optional) | `{ items: DomainFreshness[] }` | — |
| `GET` | `/api/v1/lineage/:entityId` | — | lineage DTO | `404` if entity not in lineage |

### 4.3 ADMIN-only (`requireRole('ADMIN')`)

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `POST` | `/api/v1/socios` | socio create body | `201` + socio DTO |
| `PATCH` | `/api/v1/socios/:id` | partial socio | socio DTO |
| `DELETE` | `/api/v1/socios/:id` | — | socio DTO (with `deleted_at`) |
| `POST` | `/api/v1/import/trigger` | `{ domain?: 'all'\|'socios'\|... }` (default `'all'`) | `202 { batchId, status: 'queued', estimatedTables }` |
| `DELETE` | `/api/v1/import/trigger/:batchId` | — | `200 { batchId, status: 'cancelled' }` |
| `GET` | `/api/v1/import/status` | — | `{ runs: JobRun[] }` (last 20 scheduled-import runs) |
| `GET` | `/api/v1/import/status/:batchId` | — | single run w/ progress |
| `POST` | `/api/v1/promote/trigger` | `{ domain?: 'all'\|'socios'\|... }` (sync, 120s timeout) | `200 { status, inserted, skipped, failed, durationMs, domains }` |
| `GET` | `/api/v1/promote/status` | — | `{ runs: AuditRow[] }` (last 20 PROMOTE_TRIGGER rows) |
| `GET` | `/api/v1/admin/jobs/runs` | `?job=&status=&from=&limit=` (default 50, max 200) | `{ items: JobRunDTO[] }` |
| `GET` | `/api/v1/admin/jobs/health` | — | `{ items: JobHealth[] }` (per-job snapshot) |
| `GET` | `/api/v1/scheduler/jobs` | — | `{ items: JobRunDTO[] }` (last 20 runs) |
| `GET` | `/api/v1/scheduler/jobs/:name` | — | `{ name, cronExpr, timezone, cadenceMinutes, enabled, healthy, reason, lastRuns }` |
| `PATCH` | `/api/v1/scheduler/jobs/:name` | `{ enabled: boolean }` | job def |
| `POST` | `/api/v1/scheduler/jobs/:name/run-now` | — | `200 { jobRunId, status: 'pending' }` (rate-limited 1/min/operator) |
| `GET` | `/api/v1/admin/operators` | `?cursor=&limit=&role=&is_active=` | `{ items, next_cursor }` |
| `POST` | `/api/v1/admin/operators` | `{ username, password, role, can_reprint?, can_anulate? }` | `201` operator DTO |
| `PUT` | `/api/v1/admin/operators/:id` | partial operator | operator DTO |
| `DELETE` | `/api/v1/admin/operators/:id` | — | `204` (soft delete + revoke tokens) |
| `POST` | `/api/v1/admin/operators/:id/unlock` | — | `{ unlocked: true }` |
| `GET` | `/api/v1/admin/operators/:id/login-history` | `?cursor=&limit=` | `{ items, next_cursor }` |

### 4.4 ADMIN OR data_steward (OR-gate)

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/v1/drift` | — | drift report (full snapshot) |
| `GET` | `/api/v1/audit` | `?operator=&entity=&entityType=&from=&to=&page=&limit=` | `{ items, total, page, limit, pages }` |

### 4.5 ADMIN OR TESORERO

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `POST` | `/api/v1/internal/approval-links` | `{ action_type, action_id, context_summary, approver_channels: [{ channel, address }], expires_in_hours? }` | `201 { token, link, expires_at, id }` |

### 4.6 API gaps that BLOCK UI features

| Gap | Impacted UI feature | Mitigation |
|-----|---------------------|------------|
| No "list pending approval tokens" endpoint | `/approvals` queue UI cannot fetch a list — would need a new `GET /api/v1/internal/approval-tokens?status=pending` route | Defer queue UI to NICE; ship only the public decision page (`GET/POST /api/v1/approval/:token`) |
| `POST /api/v1/approval/:token` business action is a STUB | The public decision page can record the decision but the underlying anulación does NOT execute | UI must communicate "approval recorded" not "anulación applied"; add the action executor in a follow-up slice |
| No `caja` or `gastos` specific read endpoints | No way to display caja/gastos transactions in the UI | Caja/gastos data lives in the scheduler + audit; show via `GET /api/v1/admin/jobs/runs?job=scheduled-import` and the audit log only. Full caja/gastos ledger UI is a Phase 2 slice. |
| `padrones` returns only `items`, not the spec's `Padrón[]` metadata (id, nombre, descripcion, cantidad_socios, ultima_actualizacion) | Padron selection UI lacks metadata | Acceptable for Slice 8 — the route returns rows; ship the disciplina + ejercicio filter and live with it. |
| No `file-storage` endpoints mounted (POST/GET `/api/v1/files`) | Carnet upload UI is blocked | Defer carnet uploads to Slice 9 (file-storage ships first as backend). |
| No receipt reprint / anulación API | TESORERO's "print cuenta" and "void receipt" UI is blocked | Defer to Phase 2. |
| No realtime push (SSE/WebSocket) for job progress | The dashboard's "active import banner" can only poll | Poll every 2s while an import is in-flight (`status: 'running'`); acceptable for v1. |

### 4.7 Spec drift to flag in proposal

- `api-design/spec.md:308` says `GET /api/v1/padrones` returns `Padrón[]` — actual route returns `items[]` (rows, not padron metadata). The spec was aspirational; the implementation serves the use case without the metadata.
- `api-design/spec.md:394-395` lists `/api/v1/admin/import/reconcile` and `/api/v1/admin/import/rollback` as ADMIN endpoints — these DO NOT EXIST in v0.5.8. The reconciliation job runs on cron; rollback is not implemented. The proposal must NOT promise these in v1 UI.
- `api-design/spec.md:393` lists `/api/v1/admin/roles` — NOT implemented. Operators are managed via `/admin/operators` only.

---

## 5. Existing Design System

The Gorriti Premium design system is **fully tokenized** and ready to consume — every token is a CSS var, every Tailwind utility maps to a var, the typography scale is defined, and the component catalog is specified in `openspec/specs/ui-design/spec.md` (459 lines covering Button, Card, Table, Input, Sidebar, Badge, Modal, Toast/AlertBanner, plus 8 key screens). See §4 of `ui-design/spec.md` for the full token table.

### 5.1 Tokens already defined (verified in `apps/web/src/styles/tokens.css`)

| Category | Tokens | Status |
|----------|--------|--------|
| Surfaces | `--surface`, `--surface-elevated`, `--surface-sunken` | ✅ all defined |
| Ink scale | `--ink-100`, `--ink-200`, `--ink-300`, `--ink-500`, `--ink-700`, `--ink-900` | ✅ all defined |
| Night | `--night-800`, `--night-900` | ✅ |
| Accent (Gorriti red) | `--accent` (`#c1272d`), `--accent-hover`, `--accent-soft`, `--accent-foreground` | ✅ |
| Status | `--success`, `--warning`, `--danger`, `--info` | ✅ |
| Spacing | `--space-1` (4px) through `--space-16` (64px) | ✅ |
| Radius | `--radius-none` (0px), `--radius-sm` (4px), `--radius-md` (6px), `--radius-lg` (8px) | ✅ |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | ✅ |
| Typography (font families) | `--font-display`, `--font-body`, `--font-mono` | ✅ |
| Motion | `--duration-fast` (150ms), `--duration-base` (200ms), `--duration-slow` (300ms), `--ease-standard` | ✅ |
| Type-scale tokens (size/line/tracking) | `display`, `h1`, `h2`, `h3`, `body-lg`, `body`, `body-sm`, `label`, `caption`, `mono-lg`, `mono-md`, `mono-sm` | ❌ **NOT yet defined as CSS vars** — they exist as documented values in `ui-design/spec.md:138-145` but the `tokens.css` file does NOT export them. The proposal must add them (or use raw classes on `<h1>` etc.). |

### 5.2 Tokens that NEED to be added (gaps)

- **Type-scale CSS vars** (above) — `text-display`, `text-h1`, `text-h2`, etc. as utilities OR raw CSS class helpers.
- **Inter Display + Inter + JetBrains Mono font files** — currently the families fall back to `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. The spec mandates Inter Display 700-800 for titles. Need to add `@fontsource/inter` + `@fontsource/jetbrains-mono` (or self-host) to `apps/web/package.json`.
- **Escudo logo asset** at `openspec/image/logo.jpg` is NOT yet copied to `apps/web/public/escudo.jpg`. Needs a one-line copy step.

### 5.3 Components to build (none exist yet)

The 8 base components in `ui-design/spec.md` are **spec-only** — none are implemented. Each needs `apps/web/src/components/<name>.tsx` + tests:

1. `Button` (4 variants: primary, secondary, ghost, destructive)
2. `Card` (header + body + optional divider)
3. `Table` (sticky header, no zebra, tabular-nums, sortable cols in NICE)
4. `Input` (with focus ring + error state)
5. `Sidebar / NavItem` (night-900 bg, accent left-border on active)
6. `Badge` (5 variants)
7. `Modal` (backdrop, fade+slide-down entrance)
8. `Toast / AlertBanner` (4 variants, top-right stack)

Plus layout shells: `TopBar`, `Sidebar`, `PageHeader`, `AppShell`. Plus the confirm-and-wait import modal specifically called out at `ui-design/spec.md:380-445` (30s countdown).

---

## 6. Build Plan Recommendations

### 6.1 Slice breakdown — recommend 3 PRs (matches the original 8a/8b/8c plan, retuned)

The prompt's original plan was 3 PRs (`PR 8a + 8b + 8c`). After verifying the actual surface area, **the 3-PR split is correct** — each is independently shippable, each falls under the 400-line review budget, and each delivers a coherent slice of user value.

#### PR `athlos-ui-8a` — Foundation: API client + auth + tokens + app shell + PWA manifest

**Scope:**

- `apps/web/src/lib/api-client.ts` — typed fetch wrapper, `Authorization: Bearer <jwt>` injection, refresh-on-401 retry, `request_id` capture.
- `apps/web/src/lib/auth-store.ts` — in-memory + `sessionStorage` token persistence, React context provider.
- `apps/web/src/lib/query-client.ts` — TanStack Query v5 setup (5-min stale time, retry-once, 30s window-focus refetch).
- `apps/web/src/components/Button`, `Card`, `Input`, `Badge`, `Modal`, `Toast`, `TopBar`, `Sidebar`, `PageHeader`, `AppShell` (the 8 base components + layout shells).
- `apps/web/src/styles/` — add type-scale CSS vars (text-display, text-h1, etc.), Inter Display + Inter + JetBrains Mono fonts via `@fontsource`.
- `apps/web/src/app/login/page.tsx` — split 40/60 login per spec.
- `apps/web/src/app/page.tsx` — replace placeholder with Dashboard skeleton (KPI strip + freshness card + recent audit; data wired but minimal).
- `apps/web/public/manifest.webmanifest` + `sw.js` — PWA installable, app-shell caching only.
- `apps/web/src/lib/version-buster.ts` — fetch `/api/versions`, append `?v=<hash>` to API calls for cache-busting.
- `openspec/changes/athlos-ui-8a/{proposal,specs,design,tasks}.md` + CI green.

**Why first:** everything downstream depends on auth + tokens + AppShell + the 8 components. Building slices on top of a placeholder app means re-touching every file when the shell lands.

**Estimated size:** ~600-800 LoC raw → ~400 LoC review budget with chained-PR strategy. **CHAINED PRs recommended**: split into `8a.1` (auth + api-client + query-client) and `8a.2` (components + app shell + PWA).

**Review budget risk:** **High** without chaining. Drop to **Medium** with the 8a.1/8a.2 split.

#### PR `athlos-ui-8b` — Operator workflows: Socios + Ctacte + Padrones

**Scope:**

- `apps/web/src/app/socios/page.tsx` — search + filter + table.
- `apps/web/src/app/socios/[id]/page.tsx` — detail with tabs (Profile · Ctacte · Deportes · Cuotas).
- `apps/web/src/app/socios/[id]/cuenta-corriente-tab.tsx` — nested tab content.
- `apps/web/src/app/account/page.tsx` — standalone Ctacte view with socio selector.
- `apps/web/src/components/Table` (rich variant, used across pages).
- Padron list (`/api/v1/padrones`).
- CSV export helper (client-side).
- Skeleton loading + error states per `offline-pwa/spec.md` (full-page error on initial load failure, toast on background action failure).

**Estimated size:** ~500-700 LoC raw → ~400 LoC review budget. **CHAINED PRs recommended**: `8b.1` (Socios list+detail) and `8b.2` (Ctacte standalone + padron).

**Review budget risk:** **Medium-High** without chaining. Drop to **Low** with chained split.

#### PR `athlos-ui-8c` — Admin: Import + Scheduler + Audit + Approvals + Operators + Drift

**Scope:**

- `apps/web/src/app/import/page.tsx` — history table + confirm-and-wait modal (30s countdown per `ui-design/spec.md:380-445`).
- `apps/web/src/app/scheduler/page.tsx` — job grid + enable/disable + manual trigger + run history.
- `apps/web/src/app/audit/page.tsx` — filter bar + results table + row expand diff.
- `apps/web/src/app/drift/page.tsx` — drift report table.
- `apps/web/src/app/admin/operators/page.tsx` — list + create + edit + unlock + login-history.
- `apps/web/src/app/approvals/page.tsx` — public decision page (`/approvals/:token`) + create-link modal.
- `apps/web/src/app/admin/promote/page.tsx` — promote trigger + last 20 runs.
- `apps/web/src/components/` — page-header, advanced table variants, confirm modals, dependency graph (NICE).

**Estimated size:** ~800-1000 LoC raw → **MUST split**. **CHAINED PRs recommended**: `8c.1` (Import + Scheduler) and `8c.2` (Audit + Drift + Approvals) and `8c.3` (Operators admin).

**Review budget risk:** **High** without chaining. **Required to chain** for review budget.

### 6.2 Total delivery

| Slice | PR | Estimated LoC | Chained? |
|-------|-----|---------------|----------|
| 8a — Foundation | `athlos-ui-8a.1` + `8a.2` | 600-800 | YES (2 PRs) |
| 8b — Operator | `athlos-ui-8b.1` + `8b.2` | 500-700 | YES (2 PRs) |
| 8c — Admin | `athlos-ui-8c.1` + `8c.2` + `8c.3` | 800-1000 | YES (3 PRs) |
| **Total** | **7 PRs** | ~2000-2500 raw | **all chained** |

### 6.3 Why 7 chained PRs vs 3 separate PRs vs 1 mega-PR

- **1 mega-PR** violates the 400-line review budget by 5x. Reviewer burnout risk is unacceptable.
- **3 separate PRs (8a/8b/8c as-is)** would each breach the budget (~700 LoC each). Same burnout risk.
- **7 chained PRs** keeps every review under budget, each slice is independently shippable + reversible, and each delivers user value:
  - After `8a.1`: login works against the live API. Internal-only value, but the foundation.
  - After `8a.2`: UI primitives are demoable with placeholder data. Useful for design reviews.
  - After `8b.1`: OPERADOR and CONSULTA can finally do their job without `psql`.
  - After `8b.2`: TESORERO can review movements + print reports without `psql`.
  - After `8c.1`: ADMIN can trigger imports + monitor scheduler without `curl`.
  - After `8c.2`: ADMIN can audit + triages drift without `psql`.
  - After `8c.3`: ADMIN can manage operators without `psql`.

### 6.4 v0.5.x version cadence

| Slice | After PR | Bump |
|-------|----------|------|
| 8a.1 | 0.5.8 → 0.5.9 | PATCH (auth + API client added) |
| 8a.2 | 0.5.9 → 0.6.0 | MINOR (new user-facing shell — first deployable web build) |
| 8b.x | 0.6.0 → 0.6.1 | PATCH (feature pages) |
| 8c.x | 0.6.1 → 0.7.0 | MINOR (admin surfaces) |

---

## 7. Risks + Open Questions

### 7.1 Tech risks

- **Token storage.** `sessionStorage` (default) clears on tab close — UX-regressive for a back-office console. `localStorage` (XSS-exposed). Recommendation: in-memory only with silent refresh; re-login on tab close is acceptable for a 3-5 person operator console. **DECIDE in proposal.**
- **TanStack Query vs SWR vs hand-rolled.** Not present in tree. TanStack Query v5 is the de-facto choice for the cache semantics the spec demands (5-min stale, retry-once, window-focus refetch). 12 kB gzip. **DECIDE in proposal.**
- **CORS allowlist in production.** The dev default is `http://localhost:3000`. Production will need the real web origin (e.g., `https://athlos.werchow.com.ar`). The deploy slice (not this one) will handle. **FLAG in proposal: requires CORS_ORIGINS update at deploy.**
- **JWT refresh race.** 5 concurrent API calls at minute 14:59 → all 5 see a 401 → all 5 trigger a refresh → 4 of the 5 invalidate the new refresh token. TanStack Query middleware + a single-flight `refreshInFlight` Promise fixes this. **MUST be designed carefully in PR 8a.1.**
- **Table sort + pagination URL state.** For deep-linkable filters, URL state (`useSearchParams`) is essential. The `ui-design/spec.md` does not mandate this; default to URL state.
- **PWA service worker + Next.js 16.** Next 16 ships with Turbopack + new caching defaults. Verify SW registration doesn't fight Next's data cache. Test in PR 8a.2.
- **Approval-link UI while the action executor is a STUB.** The public approval page can render + record a decision, but the underlying ctacte.anulación does NOT execute. UI MUST say "Aprobación registrada — la anulación se aplicará en la próxima sincronización" not "Anulación aplicada". **FLAG clearly in PR 8c.2.**
- **Polling vs SSE for job progress.** No SSE exists; the import banner polls `GET /api/v1/import/status/:batchId` every 2s while a batch is in-flight. Acceptable for v1. **FLAG in PR 8c.1.**
- **Caja/Gastos.** No specific routes exist — only via scheduler + audit. **CONFIRM with user: is a Caja/Gastos ledger view in scope, or accept that the UI does not yet surface these?**

### 7.2 UX risks (no operator feedback yet)

- **No operator has seen any UI yet.** Every screen in `ui-design/spec.md` was designed without iteration with TESORERO/OPERADOR. The first slice WILL surface usability issues. **Build with screenshot reviews at the end of 8a.2 (AppShell demo) and 8b.1 (first real workflow).**
- **"Confirm-and-wait" import modal is a behavior, not a screen.** The 30s countdown is a real UX decision. **User should verify before PR 8c.1 starts.**
- **Number formatting (es-AR locale).** All monetary values need `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` — the API returns raw numbers. **Build the formatter in PR 8a.2 as a reusable `formatCurrency` helper.**
- **Date formatting.** API returns ISO timestamps. es-AR locale: `dd/mm/yyyy HH:mm` for most surfaces. **Same — helper in PR 8a.2.**
- **Empty states.** Every screen needs a designed empty state per `ui-design/spec.md`. The "Sin resultados" empty state for Socios lookup is a good test case.
- **Loading states.** Skeleton vs spinner? The spec does not say. Recommendation: skeletons for list pages, spinners for buttons (login, trigger).
- **No mobile use case defined.** The spec says sidebar collapses to drawer below 1024px. Is the operator using a tablet at the front desk? **ASK the user.**
- **No print stylesheet defined.** TESORERO prints monthly reports — `@media print` rules are missing from the spec. **Add to PR 8b.2 as NICE.**

### 7.3 Open questions for user clarification

1. **In-memory vs localStorage token persistence.** Recommendation: in-memory + silent refresh (safer). Confirm?
2. **TanStack Query adoption.** OK to add `+12 kB` and a new dependency? Recommendation: yes (correct tool).
3. **Approval page wording while the executor is a STUB.** Recommendation: "Aprobación registrada — la anulación se aplicará en la próxima sincronización". Confirm?
4. **Caja/Gastos ledger UI.** Out of scope for Slice 8 (no API), or block Slice 8 on backend routes? Recommendation: out of scope, defer to a Slice 9 "caja-gastos-ui".
5. **Mobile / tablet use case.** Is the operator console used on a tablet at the front desk, or desktop-only? Affects sidebar drawer priority + tap target sizes.
6. **Socio CRUD forms.** MVP or NICE? Recommendation: NICE (import is the source of truth; manual edits are rare).
7. **Are TESORERO and OPERADOR using the same console, or does TESORERO need a separate "Tesorero" landing page?** The spec treats them as a single sidebar; role-gated items just hide.
8. **Approval queue (`/approvals`).** The API has no list-pending-tokens endpoint. Recommendation: defer to a backend slice + ship the public decision page only. Confirm?
9. **PWA install prompt UX.** Should the app surface an in-app "Install app" button, or rely on the browser's native prompt? Recommendation: in-app button on the dashboard for ADMIN only (mobile/tablet operators are mostly ADMIN).
10. **CI green required for PR merge.** Current CI runs `pnpm typecheck && pnpm test && pnpm --filter @athlos/api build`. Does the web app need a parallel `pnpm --filter @athlos/web build` + `pnpm --filter @athlos/web test` step? If yes, this is a CI slice change — flag for the deploy-slice owner.

### 7.4 Verdict

**READY FOR PROPOSE.** Backend is complete enough to build the entire UI against. The gaps in §4.6 are well-bounded and the workarounds are clear. The 3-slice / 7-PR plan matches the original 0-Index intent while respecting the 400-line review budget. The user-facing clarifications in §7.3 are the only things that should block the proposal from committing to specifics.

---

**Status**: written — awaiting orchestrator to recommend `sdd-propose`.
**Next**: `sdd-propose` with the 3-slice / 7-chained-PR plan as the recommended approach.
**Open**: §7.3 clarifications (1-10) need user input before proposal commits.
