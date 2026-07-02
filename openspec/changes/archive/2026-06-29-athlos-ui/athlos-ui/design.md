# Design: Athlos Operator Console (Slice 8)

## 1. Architecture overview

Next.js 16.2.9 App Router in `apps/web/`, consuming the deployed Fastify API v0.5.8 (no backend code touched). Three route zones: public (`/login`), authed (`(authed)/...` group wrapped by an auth-checking layout), and Next.js API routes (`/api/auth/*`) that proxy auth calls so the refresh cookie stays first-party to the browser origin. Server state flows through TanStack Query v5; client state is minimal (Zustand only for the in-memory token); URL state via `useSearchParams`.

```
apps/web/                          Next.js 16.2.9 (App Router)
├── app/
│   ├── (authed)/                 ← route group, requires auth
│   │   ├── layout.tsx            ← wraps with AppShell
│   │   ├── dashboard/page.tsx
│   │   ├── socios/page.tsx
│   │   ├── ctacte/page.tsx
│   │   ├── padrones/page.tsx
│   │   └── admin/
│   │       ├── scheduler/page.tsx
│   │       └── approvals/page.tsx
│   ├── login/page.tsx            ← public
│   └── api/auth/                  ← first-party proxy (same-origin cookies)
│       ├── refresh/route.ts
│       └── logout/route.ts
├── lib/
│   ├── api.ts                    ← fetch + interceptor + refreshInFlight
│   ├── auth.ts                   ← memory-only token state + login/logout
│   ├── use-auth.ts               ← React hook
│   ├── protected-route.tsx       ← HOC/wrapper
│   └── api/{socios,ctacte,scheduler,health}.ts
├── components/
│   ├── AppShell.tsx
│   ├── layout/{Sidebar,Topbar}.tsx
│   ├── cards/{MetricCard,StatusBadge}.tsx
│   ├── tables/DataTable.tsx
│   └── scheduler/{JobCard,RunList}.tsx
└── providers/{QueryProvider,AuthProvider}.tsx
```

## 2. Auth flow

Two tokens: a 15-min JWT **access token** kept in a module-scope variable inside `lib/auth.ts`, and a 7-day **refresh token** owned by an httpOnly `athlos_refresh` cookie (set by the API in a separate backend slice). Access lives in-memory because any XSS that reads it has ≤15 min of damage; the refresh cookie is httpOnly because XSS cannot read it at all. **Tab close = logout** (in-memory token dies with the tab) — accepted trade-off for a 3–5 person console.

The first-party proxy keeps the cookie bound to the browser origin: the browser always calls `/api/auth/{login,refresh,logout}` (same origin), and the Next.js route handler forwards to `${API_BASE_URL}/api/v1/auth/*`, copying the `Set-Cookie` header back unchanged. This works for dev (different ports) and prod (subdomain) without CORS preflights on auth.

### Single-flight refresh

When the access token expires, multiple in-flight requests 401 simultaneously. The naive fix (each request triggers a refresh) invalidates the new refresh token after the first use. `lib/api.ts` solves it with one Promise:

```ts
let refreshInFlight: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST', credentials: 'include',
    })
      .then(r => { if (!r.ok) throw new Error('refresh_failed'); return r.json() })
      .then(j => { setAccessToken(j.access_token); return j.access_token })
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}
```

All concurrent 401s `await` the same Promise; only one refresh request hits the API. The original request is retried exactly once; on second 401 the user is bounced to `/login` with a "Sesión expirada" toast.

**Migration path:** PR 8a.1 ships **body-based** refresh (no cookie yet, matching v0.5.8 API behavior). PR 8a.2 switches the proxy routes to **cookie-only** once the backend cookie slice lands, and `refreshAccessToken()` drops its body, calling `/api/auth/refresh` with `credentials: 'include'` only. Per the `auth-cookies` spec, this is a documented migration — the UI consumes the contract, not the implementation.

## 3. Routing + auth guard

`(authed)/layout.tsx` is a **server component** that reads the refresh cookie server-side, calls `POST ${API_BASE_URL}/api/v1/auth/refresh` with the cookie forwarded, and either redirects to `/login?from=...` or renders `<AppShell>` + children. This makes the auth check happen before any client JS executes — important because the access token must never be visible in HTML.

Client-side `useAuth()` (Zustand-backed) holds the access token + user role for the tab lifetime and powers role-aware `Sidebar` items. `lib/protected-route.tsx` is a thin client wrapper for client-only navigation guards (e.g., modal-protected transitions); it reads `useAuth()` and returns the login redirect if no token.

## 4. API client architecture

`lib/api.ts` is a typed `fetch` wrapper (no axios — keeps bundle lean):

| Concern | Implementation |
|---|---|
| Base URL | `NEXT_PUBLIC_API_BASE_URL` (dev: `http://localhost:4001`) |
| Auth header | Request interceptor injects `Authorization: Bearer <access_token>` from `lib/auth.ts` |
| 401 handling | Response interceptor awaits `refreshAccessToken()`, retries original request once, then fails |
| Cache | TanStack Query v5: `staleTime: 5min`, `retry: 1`, `refetchOnWindowFocus: true` |
| Server-side refresh | `(authed)/layout.tsx` forwards cookie in raw `fetch` to API |
| Version buster | Append `?v=<api-hash>` (from `/api/versions`) for cache-busting |

First-party proxy routes (`app/api/auth/{refresh,logout}/route.ts`) are 15-line Next.js Route Handlers that forward `cookie` in and `set-cookie` out:

```ts
export async function POST(req: Request) {
  const apiRes = await fetch(`${process.env.API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { cookie: req.headers.get('cookie') ?? '' },
  })
  return new Response(await apiRes.text(), {
    status: apiRes.status,
    headers: { 'set-cookie': apiRes.headers.get('set-cookie') ?? '' },
  })
}
```

## 5. Component breakdown (mapped to PRs)

| PR | New files | Modified files | LoC |
|---|---|---|---|
| 8a.1 | `lib/api.ts`, `lib/auth.ts`, `lib/api/auth.ts`, `app/login/page.tsx`, `app/api/auth/{refresh,logout}/route.ts`, `providers/{Query,Auth}Provider.tsx` | `app/layout.tsx`, `package.json` | ~350 |
| 8a.2 | `components/AppShell.tsx`, `components/layout/{Sidebar,Topbar}.tsx`, `app/(authed)/layout.tsx`, `lib/use-auth.ts`, `lib/protected-route.tsx` | `app/api/auth/{refresh,logout}/route.ts` (cookie-only) | ~400 |
| 8a.3 | `app/(authed)/dashboard/page.tsx`, `lib/api/health.ts`, `components/cards/{MetricCard,StatusBadge}.tsx` | `providers/QueryProvider.tsx` (stale time) | ~350 |
| 8b.1 | `app/(authed)/socios/page.tsx`, `app/(authed)/socios/[id]/page.tsx`, `components/tables/DataTable.tsx`, `lib/api/socios.ts` | none | ~400 |
| 8b.2 | `app/(authed)/ctacte/page.tsx`, `app/(authed)/ctacte/[cuenta]/page.tsx`, `components/ledger/MovementList.tsx`, `lib/api/ctacte.ts` | none | ~400 |
| 8b.3 | `app/(authed)/padrones/page.tsx`, `app/(authed)/padrones/[id]/page.tsx`, `lib/api/padrones.ts` | none | ~400 |
| 8c.1 | `app/(authed)/admin/scheduler/page.tsx`, `app/(authed)/admin/scheduler/[name]/page.tsx`, `components/scheduler/{JobCard,RunList}.tsx`, `lib/api/scheduler.ts` | none | ~400 |
| 8c.2 | `app/(authed)/admin/approvals/page.tsx`, `app/(authed)/admin/approvals/[token]/page.tsx`, `app/(authed)/admin/settings/page.tsx`, `components/admin/{ApprovalCard,OperatorProfile}.tsx` | none | ~400 |

PR 8a.3 and 8b.1 are flagged for re-split at task-planning if LoC exceeds 400. All 8 PRs ship stacked-to-main per the `chained-pr` skill; each is independently revertible (`git revert <sha> && pnpm install`).

## 6. State management

| Concern | Tool | Why |
|---|---|---|
| Server state | TanStack Query v5 | Built-in stale/retry/focus-refetch matches spec's 30s + 5min windows |
| Client state | Zustand (`useAuth`) | ~1 kB; zero boilerplate for token + user role + permissions |
| URL state | `useSearchParams` | Deep-linkable filters (socios search, ctacte page, padron disciplina) |
| Form state | react-hook-form + zod | Login + change-password; reuses existing zod schemas where they exist |
| Numbers | `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` | Helper in `lib/format.ts`, used by ctacte + approvals |
| Dates | `Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' })` | Same helper, used across dashboard + scheduler cards |

## 7. CORS + deployment

**Dev:** `NEXT_PUBLIC_API_BASE_URL=http://localhost:4001`. API `CORS_ORIGINS` already allows `http://localhost:3000` (verified in v0.5.8) — no change needed. `pnpm --filter @athlos/web dev` boots Next.js and proxies auth via `/api/auth/*`.

**Prod:** API needs `CORS_ORIGINS` updated to the real web origin (e.g., `https://athlos.werchow.com.ar`). Web containerisation (`docker-compose.yml` `web` service + reverse proxy) is **deploy-slice scope, not Slice 8**. Slice 8 ships a working dev console; prod deployment is a separate, additive change.

## 8. Risks + decisions to validate

| Risk | Mitigation |
|---|---|
| JWT refresh race (concurrent 401s @ 14:59) | `refreshInFlight` Promise in §2 — single request, N retries |
| Prod CORS allowlist missing web origin | Deploy-slice item, flagged in proposal Risks |
| Next 16 SW + Turbopack cache interplay | Verify PWA registration in 8a.2 dev/test before merge |
| Approval executor backend STUB | "Aprobación registrada — la anulación se aplicará en la próxima sincronización" copy in 8c.2; do NOT promise "Anulación aplicada" |
| 7 backend gaps (Caja/Gastos, file storage, receipt reprint, executor, reconcile/rollback) | All UI surfaces show "Próximamente" placeholder; backend work = Phase 9 |
| `requireRole` 401 vs 403 in API | API returns 401 for missing auth, 403 for insufficient role; client treats 403 → redirect to `/dashboard` + "Sin permisos" toast |
| Print stylesheet for TESORERO monthly reports | NICE add to 8b.2; spec'd but not mandated — `@media print` overrides + print-only header |

**Open questions (block tasks, not design):**
- [ ] PWA install prompt UX: in-app button on dashboard for ADMIN, or rely on browser-native prompt?
- [ ] Mobile/tablet use case: is OPERADOR using a tablet at the front desk, or desktop-only? Affects sidebar drawer priority + tap target sizes in 8a.2.
- [ ] Approvals queue: API has no list-pending-tokens endpoint — defer to Phase 9 backend slice and ship public decision page only in 8c.2. Confirm.