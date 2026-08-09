'use client'

import { useQuery } from '@tanstack/react-query'
import { getMe } from '@/lib/api/auth'

export default function AccountPage() {
  const profile = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: 0 })
  return (
    <main className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink-900">Mi cuenta</h1>
      {profile.isPending && <p role="status">Cargando perfil…</p>}
      {profile.isError && <p role="alert">No se pudo cargar el perfil.</p>}
      {profile.data && (
        <section
          aria-label="Perfil del operador"
          className="rounded-lg border border-ink-100 bg-surface p-6"
        >
          <p>{profile.data.username}</p>
          <p className="text-sm text-ink-500">{profile.data.role}</p>
        </section>
      )}
    </main>
  )
}
