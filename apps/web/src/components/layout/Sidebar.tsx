'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'

/**
 * Sidebar — the dark navigation rail on the left of every authed page.
 *
 * Per `web-frontend/spec.md` (AppShell Layout):
 *   - Every role sees Dashboard, Socios, Ctacte, Padrones
 *   - ADMIN additionally sees Admin → Scheduler + Settings
 *   - Active item is marked with the accent left-border + aria-current
 *
 * The Sidebar is a thin list of <Link>s against `usePathname()` — no
 * nested router state, no collapsible submenu (PR 8c ships nested
 * Admin children: Approvals, etc.). For PR 8a.2 "Admin" is a section
 * header, not a clickable item.
 */

type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

interface NavItem {
  href: string
  label: string
  /** Roles allowed to see this item. Empty = visible to all roles. */
  roles?: Role[]
  permission?: 'data_steward'
}

const ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/socios', label: 'Socios' },
  { href: '/ctacte', label: 'Ctacte' },
  { href: '/padrones', label: 'Padrones' },
  { href: '/admin/scheduler', label: 'Scheduler', roles: ['ADMIN'] },
  { href: '/admin/approvals', label: 'Approvals', roles: ['ADMIN'] },
  { href: '/admin/settings', label: 'Settings', roles: ['ADMIN'] },
  { href: '/admin/gastos', label: 'Gastos', roles: ['ADMIN'] },
  {
    href: '/admin/socios-evidence-exceptions',
    label: 'Socios: excepciones',
    permission: 'data_steward',
  },
  { href: '/admin/membership-types', label: 'Tipos de afiliación', permission: 'data_steward' },
]

export default function Sidebar() {
  const { user } = useAuth()
  const pathname = usePathname()
  const role = user?.role

  const visible = ITEMS.filter(
    (item) =>
      (!item.roles || (role && item.roles.includes(role))) &&
      (!item.permission || role === 'ADMIN' || user?.permissions[item.permission] === true),
  )
  const hasAdmin = visible.some((item) => item.roles?.includes('ADMIN'))

  return (
    <aside
      role="complementary"
      aria-label="Navegación principal"
      className="bg-night-900 text-white w-60 flex-shrink-0 hidden lg:flex flex-col"
    >
      <nav className="flex-1 px-3 py-4" aria-label="Secciones">
        <ul className="space-y-1">
          {visible.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'block rounded-md px-3 py-2 text-sm transition-colors duration-fast',
                    isActive
                      ? 'border-l-2 border-accent bg-night-800 text-white pl-[10px]'
                      : 'border-l-2 border-transparent text-ink-300 hover:text-white hover:bg-night-800',
                  ].join(' ')}
                  data-testid={`sidebar-link-${item.href.replace(/\//g, '-')}`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {hasAdmin ? (
        <div className="px-5 py-3 text-[10px] uppercase tracking-widest text-ink-500">Admin</div>
      ) : null}
    </aside>
  )
}
