'use client'

import Link from 'next/link'
import { ChevronRight, ClipboardList, Users, Wallet } from 'lucide-react'
import type { CurrentUser } from '@/lib/auth'

const WORKSPACES = [
  {
    href: '/socios',
    label: 'Socios',
    description: 'Consultá el padrón de asociados.',
    icon: Users,
  },
  {
    href: '/ctacte',
    label: 'Cuenta corriente',
    description: 'Revisá movimientos autorizados.',
    icon: Wallet,
  },
  {
    href: '/padrones',
    label: 'Padrones',
    description: 'Accedé a los padrones disponibles.',
    icon: ClipboardList,
  },
]

export function WorkspaceCards({ role }: Pick<CurrentUser, 'role'>) {
  return (
    <section aria-label="Espacios de trabajo">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">Accesos operativos</p>
      <h2 className="font-display text-2xl font-bold text-ink-900">Espacios de trabajo</h2>
      <p className="mt-1 text-sm text-ink-500">Herramientas disponibles para {role}.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {WORKSPACES.map((workspace) => (
          <Link
            key={workspace.href}
            href={workspace.href}
            className="group rounded-lg border border-ink-100 bg-surface p-4 shadow-sm transition-colors duration-fast hover:border-ink-200 hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-md bg-accent-soft p-2 text-accent">
                <workspace.icon aria-hidden="true" size={18} />
              </span>
              <ChevronRight
                aria-hidden="true"
                size={18}
                className="mt-1 shrink-0 text-ink-500 transition-transform duration-fast group-hover:translate-x-0.5"
              />
            </div>
            <h3 className="mt-3 font-display text-base font-semibold text-ink-900">
              {workspace.label}
            </h3>
            <p className="mt-1 text-sm text-ink-500">{workspace.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
