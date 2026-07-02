# Proposal: Athlos Operator Console (Slice 8)

## Intent
Ship the first operator-facing web UI. Deployed Fastify API v0.5.8 already exposes 25+ endpoints against 16k+ socios and 200k+ ctacte movements — Slice 8 turns that into a daily console replacing `psql`/`curl` for ADMIN, TESORERO, OPERADOR, CONSULTA. UI-only: consumes existing endpoints, defers 7 backend gaps.

## Scope

**In:** API client + auth · AppShell (Sidebar/Topbar) · Dashboard · Socios list/detail · Ctacte + CSV · Padrones · Scheduler admin · Approvals (read-only STUB) · Operator profile · PWA manifest + app-shell SW.

**Out:** Caja + Gastos · Approval executor backend · File storage · Receipt reprint · Socio CRUD · Audit / Drift / Import / Promote / Operators-admin (Slice 8d+) · Mobile-first responsive · E2E Playwright tests.

### New Capabilities
- `web-frontend` — operator console end-to-end (API client, auth, shell, Slice 8 pages)
- `auth-cookies` — httpOnly refresh-cookie transport contract (backend slice ships separately; UI consumes)
- `scheduler-ui` — operator surface for scheduler (list, detail, manual trigger, enable/disable)

### Modified Capabilities
None. `api-design` and `deployment-devops` are referenced but spec-level unchanged — pure consumer-side change; web is not yet containerised (deploy is a separate slice).

## Approach
**Stack:** Next.js 16.2.9 (App Router) + React 19 + Tailwind 3.4 + Gorriti Premium tokens (already mapped in `tailwind.config.ts`).
**Data:** TanStack Query v5 (5-min stale, retry-once, focus-refetch, ~12 kB gzip). Native `fetch` wrapper — no axios. **Single-flight `refreshInFlight` Promise** prevents concurrent stale-token requests from invalidating the new refresh token.
**Auth (USER-LOCKED):** 15-min JWT access token in module-scope variable — never `localStorage`/`sessionStorage`. 7-day refresh token = httpOnly + Secure + SameSite=Lax cookie set by API. Silent `/auth/refresh` probe on boot + 14-min interval. Tab close = logout (accepted trade-off for 3-5 person operator console). Next.js `/api/auth/login` route proxies Fastify login so the refresh cookie stays first-party.
**Forms / locale:** react-hook-form + zod · `Intl.NumberFormat('es-AR')` for ARS · `dd/mm/yyyy HH:mm` for dates · URL state via `useSearchParams`.
**PR strategy:** 8 chained PRs, stacked-to-main, each ≤400 LoC review budget. 8a.3 + 8b.1 flagged for re-split at task-planning time if LoC exceeds 400.

## Slice 8a — Foundation

| PR | Goal | New files | LoC |
|----|------|-----------|-----|
| 8a.1 | Auth against live API | `lib/{api,auth,query-client}.ts`, `app/login/page.tsx`, `app/api/auth/login/route.ts`, `.env.local.example` | ~350 |
| 8a.2 | Protected shell | `components/layout/{Sidebar,Topbar}.tsx`, `app/(authed)/layout.tsx`, `lib/{use-auth,protected-route}.{ts,tsx}` | ~400 |
| 8a.3 | Dashboard overview | `app/(authed)/dashboard/page.tsx`, `lib/api/{health,freshness}.ts`, `components/cards/{MetricCard,StatusBadge}.tsx` | ~350 |

## Slice 8b — Read-only workflows

| PR | Goal | New files | LoC |
|----|------|-----------|-----|
| 8b.1 | Browse 16k socios | `app/(authed)/socios/{page,[id]/page}.tsx`, `components/tables/DataTable.tsx`, `lib/api/socios.ts` | ~400 |
| 8b.2 | Ctacte movements | `app/(authed)/ctacte/{page,[cuenta]/page}.tsx`, `components/ledger/MovementList.tsx`, `lib/{api/ctacte,csv-export}.ts` | ~400 |
| 8b.3 | Padrones | `app/(authed)/padrones/{page,[id]/page}.tsx`, `lib/api/padrones.ts` | ~400 |

## Slice 8c — Admin surfaces

| PR | Goal | New files | LoC |
|----|------|-----------|-----|
| 8c.1 | Scheduler dashboard | `app/(authed)/admin/scheduler/{page,[name]/page}.tsx`, `components/scheduler/{JobCard,RunList}.tsx`, `lib/api/scheduler.ts` | ~400 |
| 8c.2 | Approvals + settings | `app/(authed)/admin/{approvals,settings}/...tsx`, `components/admin/{ApprovalCard,OperatorProfile}.tsx`, `lib/api/approvals.ts` | ~400 |

**Total:** 8 PRs · ~3,100 LoC · 8a.3 + 8b.1 flagged for re-split at task-planning time.

## Affected Areas

| Area | Impact |
|------|--------|
| `apps/web/src/lib/{api,auth,query-client,use-auth,protected-route,csv-export}.{ts,tsx}` | New |
| `apps/web/src/components/**` | New (Sidebar, Topbar, AppShell, MetricCard, DataTable, JobCard, etc.) |
| `apps/web/src/app/(authed)/**` | New (dashboard, socios, ctacte, padrones, admin) |
| `apps/web/src/app/login/page.tsx` | New (split 40/60 per `ui-design/spec.md`) |
| `apps/web/src/app/api/auth/login/route.ts` | New (first-party proxy so refresh cookie stays first-party) |
| `apps/web/public/{manifest.webmanifest,sw.js}` | New (PWA installable, app-shell-only cache) |
| `apps/web/package.json` | Modified (+@tanstack/react-query, react-hook-form, zod, @fontsource/{inter,jetbrains-mono}) |
| `apps/web/tailwind.config.ts` | Unchanged (Gorriti tokens already mapped) |
| `apps/web/.env.local.example` | New (`NEXT_PUBLIC_API_BASE_URL`) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JWT refresh race (concurrent 401s @ 14:59) | Med | Single-flight `refreshInFlight` Promise in PR 8a.1 |
| Prod CORS allowlist | Med | API `CORS_ORIGINS` must include prod origin (deploy slice owns) |
| Next 16 SW + Turbopack cache interplay | Low | Verify in PR 8a.2 dev/test before PWA ships |
| 7 backend gaps (approval exec, file storage, caja/gastos, etc.) | High (known) | UI shows "Próximamente" badges; backend work = Slice 9 |
| PR 8a.3 / 8b.1 exceed 400 LoC | Med | Re-split at task-planning; orchestrator flags |
| Tab-close logout UX regression | Low | Accepted trade-off (3-5 person console); documented in 8a.1 |

## Rollback Plan
Each PR independently revertible (`git revert <sha> && pnpm install`). Web is **not yet containerised** in `docker-compose.yml` — no docker rollback. API untouched by this slice. Prior PR's state remains deployable if a later PR breaks auth.

## Dependencies
- **Backend (already shipped):** API v0.5.8 at `werchow-server:4001` (verified) · Gorriti Premium tokens + `ui-design` spec (shipped)
- **Backend (separate slice, BLOCKING for 8a.1):** `auth-cookies` capability — httpOnly refresh cookie transport. If it slips, PR 8a.1 ships login-only with body-based refresh and PR 8a.2 migrates to cookie.
- **New npm deps:** `@tanstack/react-query@5`, `react-hook-form`, `zod`, `@fontsource/inter`, `@fontsource/jetbrains-mono`

## Success Criteria
- [ ] **8a.1** — login → "logged in as admin" → logout works against `localhost:4001`
- [ ] **8a.2** — authed pages render inside AppShell with role-aware sidebar
- [ ] **8a.3** — dashboard shows live `/health`, master-table counts, scheduler health strip
- [ ] **8b.1** — paginated search/browse across 16k socios
- [ ] **8b.2** — browse 200k+ ctacte movements + CSV export
- [ ] **8b.3** — padron list by disciplina + ejercicio
- [ ] **8c.1** — scheduler jobs grid + manual trigger + run history
- [ ] **8c.2** — approvals queue (read-only STUB) + change-password works
- [ ] **Per PR:** `pnpm --filter @athlos/web typecheck` + `pnpm test:run` green + visual smoke test of PR's happy-path
- [ ] **Final:** ADMIN/CONSULTA role guards enforced · silent refresh works · token expiry doesn't break UX · PWA installable on Chrome desktop