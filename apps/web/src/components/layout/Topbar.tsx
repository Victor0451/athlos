'use client'

import { useRef, useState, type RefObject } from 'react'
import { useAuth } from '@/lib/use-auth'
import NotificationBell from '@/components/notifications/NotificationBell'
import PersonalMenu from './PersonalMenu'

/**
 * Topbar — the dark chrome strip at the top of every authed page.
 *
 * Per `web-frontend/spec.md` (Logout from topbar) + `ui-design/spec.md`
 * (Topbar night-900, 56px), the Topbar shows the institutional title
 * on the left and the operator profile (username + role badge) with a
 * logout button on the right.
 *
 * The Topbar itself does NOT call `redirect('/login')` after logout —
 * the AppShell's auth gate handles the redirect. The Topbar's only
 * responsibility is to expose the logout action and surface the
 * operator's identity.
 */

const ROLE_LABEL: Record<'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA', string> = {
  ADMIN: 'ADMIN',
  TESORERO: 'TESORERO',
  OPERADOR: 'OPERADOR',
  CONSULTA: 'CONSULTA',
}

interface TopbarProps {
  drawerOpen?: boolean
  onDrawerOpen?: (open: boolean) => void
  drawerTriggerRef?: RefObject<HTMLButtonElement | null>
}

export default function Topbar({ drawerOpen, onDrawerOpen, drawerTriggerRef }: TopbarProps) {
  const { user } = useAuth()
  const [uncontrolledDrawerOpen, setUncontrolledDrawerOpen] = useState(false)
  const internalTriggerRef = useRef<HTMLButtonElement>(null)
  const isDrawerOpen = drawerOpen ?? uncontrolledDrawerOpen
  const triggerRef = drawerTriggerRef ?? internalTriggerRef
  const openDrawer = () => (onDrawerOpen ?? setUncontrolledDrawerOpen)(true)

  return (
    <header
      role="banner"
      className="bg-night-900 text-white h-14 flex items-center justify-between px-4"
    >
      <div className="flex items-center gap-3">
        <button
          ref={triggerRef}
          aria-controls="mobile-navigation"
          aria-expanded={isDrawerOpen}
          aria-label="Abrir navegación"
          className="rounded-md p-2 lg:hidden"
          onClick={openDrawer}
          type="button"
        >
          Menú
        </button>
        <span className="font-display text-lg font-semibold tracking-wide">Athlos</span>
        <span className="text-ink-300 text-xs hidden sm:inline">Consola de operaciones</span>
      </div>

      {user ? (
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium" data-testid="topbar-username">
              {user.username}
            </span>
            <span
              className="text-[10px] uppercase tracking-wider text-ink-300"
              data-testid="topbar-role"
            >
              {ROLE_LABEL[user.role]}
            </span>
          </div>
          <span
            className="inline-flex items-center rounded-md bg-night-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
            aria-label="Rol del operador"
            data-testid="topbar-role-badge"
          >
            {ROLE_LABEL[user.role]}
          </span>
          <NotificationBell />
          <PersonalMenu />
        </div>
      ) : (
        <span className="text-sm text-ink-300">Sin sesión</span>
      )}
    </header>
  )
}
