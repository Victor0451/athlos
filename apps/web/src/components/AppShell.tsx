'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'
import Sidebar from './layout/Sidebar'
import Topbar from './layout/Topbar'
import MobileDrawer from './layout/MobileDrawer'
import { FeatureConfigProvider } from '@/lib/features'

/**
 * AppShell — wraps every page rendered under the `(authed)` route
 * group with the institutional chrome (Sidebar + Topbar) and enforces
 * the auth gate.
 *
 * Auth flow on mount (per `web-frontend/spec.md` Protected Routing +
 * Silent Token Refresh):
 *   1. If `useAuth().isAuthenticated` is true → render the shell
 *   2. Otherwise → call `useAuth().refresh()` once (silent body-based
 *      refresh, with TODO to migrate to cookie transport when the
 *      `auth-cookies` backend slice ships)
 *   3. If refresh succeeds → re-read auth state, render the shell
 *   4. If refresh fails → `router.replace('/login?from=<path>')`
 *
 * NOTE — server-side cookie check (TASK-012 / design §3): the
 * `(authed)/layout.tsx` is documented in the design as a SERVER
 * component that reads the `athlos_refresh` cookie before any client
 * JS runs. The backend cookie slice is deferred, so for PR 8a.2 the
 * gate runs client-side here. When the backend lands, the (authed)
 * layout will own the cookie check; this component will keep the same
 * fallback path for tab-restore scenarios.
 */

export default function AppShell({
  children,
  cashEnabled = true,
}: {
  children: ReactNode
  cashEnabled?: boolean
}) {
  const { isAuthenticated, refresh } = useAuth()
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (isAuthenticated) return
    let cancelled = false
    refresh().catch(() => {
      if (!cancelled) {
        const from = typeof window !== 'undefined' ? window.location.pathname : '/'
        router.replace(`/login?from=${encodeURIComponent(from)}`)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, refresh, router])

  if (!hydrated || !isAuthenticated) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen items-center justify-center bg-surface text-ink-500"
        data-testid="appshell-loading"
      >
        <span
          aria-hidden="true"
          className="block h-10 w-48 animate-pulse rounded bg-surface-sunken"
        />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  return (
    <FeatureConfigProvider cashEnabled={cashEnabled}>
      <div className="flex h-screen bg-surface-page">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden" data-mobile-drawer-background="true">
          <Topbar
            drawerOpen={drawerOpen}
            drawerTriggerRef={drawerTriggerRef}
            onDrawerOpen={setDrawerOpen}
          />
          <div className="flex-1 overflow-auto p-6" data-testid="appshell-content">
            {children}
          </div>
        </main>
        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          triggerRef={drawerTriggerRef}
        />
      </div>
    </FeatureConfigProvider>
  )
}
