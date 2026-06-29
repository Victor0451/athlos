import type { ReactNode } from 'react'

/**
 * Server-component layout for the `(authed)` route group.
 *
 * Per `web-frontend/spec.md` (Protected Routing) + `design.md` §3, the
 * design target is a server component that reads the `athlos_refresh`
 * cookie from the incoming request and either calls the API to refresh
 * the session or redirects to `/login?from=...`.
 *
 * PR 8a.2a status: this is a pass-through that renders children. The
 * actual auth gate ships in PR 8a.2b via the client-side `AppShell`,
 * which performs a silent body-based refresh and redirects to `/login`
 * on failure. PR 8a.2c keeps the same pass-through and adds the
 * `<AppShell>` wrapper.
 *
 * TODO(PR 9 — auth-cookies backend slice): when the backend cookie
 * slice lands, this layout will own the cookie check (server component
 * reads the `athlos_refresh` cookie + forwards to the API) and the
 * `AppShell` will keep a fallback path for tab-restore scenarios.
 */
export default function AuthedLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
