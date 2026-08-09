'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'
import { visibleNavigation } from '@/lib/navigation'

/**
 * Sidebar — the dark navigation rail on the left of every authed page.
 *
 * Per `web-frontend/spec.md` (AppShell Layout):
 *   - Every role sees Dashboard, Socios, Ctacte, Padrones
 *   - ADMIN task and job destinations are grouped under Operations
 *   - Active item is marked with the accent left-border + aria-current
 *
 * The Sidebar is a thin list of <Link>s against `usePathname()`.
 */

export default function Sidebar() {
  const { user } = useAuth()
  const pathname = usePathname()
  const visible = visibleNavigation(user)
  const primary = visible.filter((item) => !item.section)
  const operations = visible.filter((item) => item.section === 'Operations')

  return (
    <aside
      role="complementary"
      aria-label="Navegación principal"
      className="bg-night-900 text-white w-60 flex-shrink-0 hidden lg:flex flex-col"
    >
      <nav className="flex-1 px-3 py-4" aria-label="Secciones">
        <ul className="space-y-1">
          {primary.map((item) => {
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
        {operations.length ? (
          <section aria-label="Operations" className="mt-4">
            <h2 className="px-3 pb-1 text-[10px] uppercase tracking-widest text-ink-500">
              Operations
            </h2>
            <ul className="space-y-1">
              {operations.map((item) => {
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
          </section>
        ) : null}
      </nav>
    </aside>
  )
}
