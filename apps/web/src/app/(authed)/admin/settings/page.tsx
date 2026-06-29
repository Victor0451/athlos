'use client'

import { useQuery } from '@tanstack/react-query'
import { getMe } from '@/lib/api/auth'
import { useAuth } from '@/lib/use-auth'
import { OperatorProfile } from '@/components/admin/OperatorProfile'

/**
 * Settings page — `/admin/settings` (TASK-038, PR 8c.2).
 *
 * ADMIN-only settings surface. Two cards:
 *   1. Operator profile (via `<OperatorProfile>`) — pulls the
 *      current user from `GET /api/v1/auth/me`. Read-only in
 *      v0.5.x; the username + role + permissions are visible
 *      but not editable (editing the profile lands in a
 *      follow-up slice).
 *   2. Change-password placeholder card — the form lands in a
 *      follow-up slice. For PR 8c.2 the button is disabled with
 *      a "Próximamente" copy; the backend endpoint
 *      `POST /api/v1/auth/change-password` already exists (see
 *      `apps/api/src/routes/auth.ts:74-87`) and is wired in
 *      `lib/api/auth.ts:changePassword()`.
 *
 * State management:
 *   - `useQuery(['auth', 'me'])` fetches the profile
 *   - `useAuth()` provides the role gate (ADMIN-only)
 *   - Non-ADMIN operators see "Sin permisos" + no fetch fires
 *   - 5-min stale time (default from QueryProvider)
 *   - `retry: 0` so a transient 401 doesn't retry silently (the
 *     shared wrapper's single-flight refresh handles token
 *     rotation; a retry on this query would mask real errors)
 */

export default function SettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => getMe(),
    enabled: isAdmin,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  })

  // Role gate first (no fetch fires if not ADMIN).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold text-ink-900">Configuración</h1>
        </header>
        <div
          role="alert"
          data-testid="settings-no-permission"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Configuración</h1>
        <p className="mt-1 text-sm text-ink-500">Datos del operador actual y opciones de cuenta.</p>
      </header>

      {meQuery.isPending ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Cargando"
          data-testid="settings-loading"
          className="space-y-3"
        >
          <div aria-hidden="true" className="h-32 animate-pulse rounded-lg bg-surface-sunken" />
          <div aria-hidden="true" className="h-48 animate-pulse rounded-lg bg-surface-sunken" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : meQuery.isError ? (
        <div
          role="alert"
          data-testid="settings-error"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">
            No se pudo cargar el perfil
          </p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Verificá la conectividad con el API o intentá nuevamente más tarde.
          </p>
        </div>
      ) : (
        <>
          <OperatorProfile profile={meQuery.data ?? null} />

          <section
            aria-label="Cambiar contraseña"
            data-testid="change-password-placeholder"
            className="rounded-lg border border-ink-100 bg-surface p-6"
          >
            <h2 className="font-display text-base font-semibold text-ink-900">
              Cambiar contraseña
            </h2>
            <p className="mt-1 font-body text-sm text-ink-500">
              El formulario de cambio de contraseña se habilita en una próxima versión. Por ahora,
              contactá al administrador del sistema para resetear tu clave.
            </p>
            <button
              type="button"
              disabled
              data-testid="change-password-button"
              className="mt-4 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-white opacity-50"
            >
              Cambiar contraseña
            </button>
            <p
              className="mt-2 font-display text-[10px] font-semibold uppercase tracking-widest text-warning"
              data-testid="change-password-soon"
            >
              Próximamente
            </p>
          </section>
        </>
      )}
    </div>
  )
}
