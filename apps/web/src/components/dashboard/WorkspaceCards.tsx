'use client'

import Link from 'next/link'
import type { CurrentUser } from '@/lib/auth'

const WORKSPACES = [
  { href: '/socios', label: 'Socios', description: 'Consultá el padrón de asociados.' },
  { href: '/ctacte', label: 'Cuenta corriente', description: 'Revisá movimientos autorizados.' },
  { href: '/padrones', label: 'Padrones', description: 'Accedé a los padrones disponibles.' },
]

export function WorkspaceCards({ role }: Pick<CurrentUser, 'role'>) {
  return (
    <section aria-label="Espacios de trabajo">
      <h2 className="font-display text-sm font-semibold text-ink-900">Espacios de trabajo</h2>
      <p className="mt-1 text-sm text-ink-500">Herramientas disponibles para {role}.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {WORKSPACES.map((workspace) => (
          <Link
            key={workspace.href}
            href={workspace.href}
            className="rounded-lg bg-surface-elevated p-4 shadow-sm transition-colors hover:bg-surface"
          >
            <h3 className="font-display font-semibold text-ink-900">{workspace.label}</h3>
            <p className="mt-1 text-sm text-ink-500">{workspace.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
