import type { ReactNode } from 'react'
import AppShell from '@/components/AppShell'

/**
 * Server-component layout for the `(authed)` route group.
 *
 * Per `web-frontend/spec.md` (Protected Routing) + `design.md` §3, the
 * design target is a server component that reads the `athlos_refresh`
 * cookie from the incoming request and either calls the API to refresh
 * the session or redirects to `/login?from=...`.
 *
 * PR 8a.2 status: the backend cookie slice is deferred (see TODO in
 * `lib/auth.ts`). The auth gate runs client-side in `AppShell`
 * (silent body-based refresh + redirect on failure). When the backend
 * cookie slice ships, this layout will own the cookie check and the
 * `AppShell` will keep a fallback path for tab-restore scenarios.
 */
export default function AuthedLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
