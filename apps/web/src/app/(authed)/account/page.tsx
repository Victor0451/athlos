'use client'

import { useQuery } from '@tanstack/react-query'
import { getMe } from '@/lib/api/auth'

export default function AccountPage() {
  const profile = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: 0 })
  return (
    <main className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Cuenta</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Mi cuenta</h1>
        <p className="mt-1 text-sm text-ink-500">Consultá la identidad y el acceso del operador.</p>
      </header>
      {profile.isPending && (
        <section
          role="status"
          aria-live="polite"
          aria-label="Cargando perfil"
          className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
        >
          <div aria-hidden="true" className="h-5 w-48 animate-pulse rounded bg-surface-sunken" />
          <div
            aria-hidden="true"
            className="mt-2 h-4 w-24 animate-pulse rounded bg-surface-sunken"
          />
          <span className="sr-only">Cargando…</span>
        </section>
      )}
      {profile.isError && (
        <div role="alert" className="rounded-lg border border-danger bg-surface p-3 text-sm">
          No se pudo cargar el perfil.
        </div>
      )}
      {profile.data && (
        <section
          aria-label="Perfil del operador"
          className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
        >
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Operador</p>
          <p className="mt-2 font-display text-lg font-semibold text-ink-900">
            {profile.data.username}
          </p>
          <p className="mt-1 text-sm text-ink-500">Rol: {profile.data.role}</p>
        </section>
      )}
    </main>
  )
}
