import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Sidebar tests (TASK-011).
 *
 * Covers the `web-frontend/spec.md` AppShell Layout scenarios:
 *   - All roles see Dashboard, Socios, Ctacte, Padrones
 *   - ADMIN sees Admin items (Scheduler, Settings); CONSULTA does not
 *   - TESORERO and OPERADOR see the same items as CONSULTA (no admin)
 *   - The active item is visually marked (a "current page" link)
 */

const authState = vi.hoisted(() => {
  return {
    user: null as null | {
      operator_id: string
      role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
      username: string
      permissions: { can_reprint: boolean; can_anulate: boolean }
    },
    token: null as string | null,
  }
})

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => authState.user,
  getAccessToken: () => authState.token,
}))

let mockPathname = '/dashboard'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  redirect: vi.fn(),
}))

const { default: Sidebar } = await import('./Sidebar.tsx')

function seedUser(role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA') {
  authState.user = {
    operator_id: 'op-1',
    role,
    username: 'op_user',
    permissions: { can_reprint: true, can_anulate: false },
  }
  authState.token = 'seeded.token'
}

describe('Sidebar', () => {
  beforeEach(() => {
    authState.user = null
    authState.token = null
    mockPathname = '/dashboard'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders inside a complementary landmark (the <aside>)', () => {
    seedUser('ADMIN')
    render(<Sidebar />)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })

  it('always shows Dashboard, Socios, Ctacte, and Padrones for every role', () => {
    seedUser('CONSULTA')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /socios/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /ctacte/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /padrones/i })).toBeInTheDocument()
  })

  it('shows Scheduler, Approvals, Settings and Gastos for ADMIN', () => {
    seedUser('ADMIN')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: /scheduler/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /approvals/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /settings/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /gastos/i })).toBeInTheDocument()
  })

  it('hides Scheduler, Approvals, Settings and Gastos for non-ADMIN roles', () => {
    seedUser('CONSULTA')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).queryByRole('link', { name: /scheduler/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /gastos/i })).not.toBeInTheDocument()
  })

  it('hides Scheduler, Approvals and Settings for TESORERO and OPERADOR too', () => {
    seedUser('TESORERO')
    render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /scheduler/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument()

    authState.user = { ...authState.user!, role: 'OPERADOR' }
    render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /scheduler/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument()
  })

  it('marks the active item with aria-current="page"', () => {
    seedUser('ADMIN')
    mockPathname = '/socios'
    render(<Sidebar />)
    const activeLink = screen.getByRole('link', { name: /socios/i })
    expect(activeLink).toHaveAttribute('aria-current', 'page')
  })
})
