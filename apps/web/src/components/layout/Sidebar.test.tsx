import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Sidebar tests (TASK-011).
 *
 * Covers the `web-frontend/spec.md` AppShell Layout scenarios:
 *   - All roles see Panel de control, Socios, Cuenta corriente, Padrones
 *   - ADMIN sees admin items (Tareas programadas, Configuración); CONSULTA does not
 *   - TESORERO and OPERADOR see the same items as CONSULTA (no admin)
 *   - The active item is visually marked (a "current page" link)
 */

const authState = vi.hoisted(() => {
  return {
    user: null as null | {
      operator_id: string
      role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
      username: string
      permissions: { can_reprint: boolean; can_anulate: boolean; data_steward: boolean }
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

function seedUser(role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA', dataSteward = false) {
  authState.user = {
    operator_id: 'op-1',
    role,
    username: 'op_user',
    permissions: { can_reprint: true, can_anulate: false, data_steward: dataSteward },
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

  it('always shows the primary destinations for every role', () => {
    seedUser('CONSULTA')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByRole('link', { name: /panel de control/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /socios/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /cuenta corriente/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /padrones/i })).toBeInTheDocument()
  })

  it('groups ADMIN operations destinations without changing their scheduler target or active state', () => {
    seedUser('ADMIN')
    mockPathname = '/admin/scheduler/daily-summary'
    render(<Sidebar />)
    const operations = screen.getByRole('region', { name: 'Operaciones' })
    const scheduler = within(operations).getByRole('link', { name: /tareas programadas/i })

    expect(scheduler).toHaveAttribute('href', '/admin/scheduler')
    expect(scheduler).toHaveAttribute('aria-current', 'page')
    expect(within(operations).getByRole('link', { name: /aprobaciones/i })).toBeInTheDocument()
    expect(within(operations).getByRole('link', { name: /gastos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /configuración/i })).toBeInTheDocument()
  })

  it('hides admin destinations for non-ADMIN roles', () => {
    seedUser('CONSULTA')
    render(<Sidebar />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).queryByRole('link', { name: /tareas programadas/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /aprobaciones/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /configuración/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /gastos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Operaciones' })).not.toBeInTheDocument()
  })

  it('hides admin destinations for TESORERO and OPERADOR too', () => {
    seedUser('TESORERO')
    render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /tareas programadas/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /aprobaciones/i })).not.toBeInTheDocument()

    authState.user = { ...authState.user!, role: 'OPERADOR' }
    render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /tareas programadas/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /aprobaciones/i })).not.toBeInTheDocument()
  })

  it('shows Socios exceptions only to ADMIN or a granted data steward', () => {
    seedUser('OPERADOR', true)
    let view = render(<Sidebar />)
    expect(screen.getByRole('link', { name: /socios: excepciones/i })).toBeInTheDocument()

    authState.user = {
      ...authState.user!,
      permissions: { ...authState.user!.permissions, data_steward: false },
    }
    view.unmount()
    view = render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /socios: excepciones/i })).not.toBeInTheDocument()

    seedUser('ADMIN')
    view.unmount()
    render(<Sidebar />)
    expect(screen.getAllByRole('link', { name: /socios: excepciones/i })).not.toHaveLength(0)
  })

  it('shows membership types only to ADMIN or a granted data steward', () => {
    seedUser('OPERADOR', true)
    let view = render(<Sidebar />)
    expect(screen.getByRole('link', { name: /tipos de afiliación/i })).toBeInTheDocument()

    authState.user = {
      ...authState.user!,
      permissions: { ...authState.user!.permissions, data_steward: false },
    }
    view.unmount()
    view = render(<Sidebar />)
    expect(screen.queryByRole('link', { name: /tipos de afiliación/i })).not.toBeInTheDocument()

    seedUser('ADMIN')
    view.unmount()
    render(<Sidebar />)
    expect(screen.getByRole('link', { name: /tipos de afiliación/i })).toBeInTheDocument()
  })

  it('marks the active item with aria-current="page"', () => {
    seedUser('ADMIN')
    mockPathname = '/socios'
    render(<Sidebar />)
    const activeLink = screen.getByRole('link', { name: /^socios$/i })
    expect(activeLink).toHaveAttribute('aria-current', 'page')
  })
})
