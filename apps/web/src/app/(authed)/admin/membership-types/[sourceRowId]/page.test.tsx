import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getMembersMock = vi.fn()
const setUrlStateMock = vi.fn()
let authValue: { user: unknown } = { user: null }
vi.mock('next/navigation', () => ({ useParams: () => ({ sourceRowId: 'type-1' }) }))
vi.mock('nuqs', () => ({
  parseAsString: { withDefault: (defaultValue: string) => ({ defaultValue }) },
  parseAsInteger: { withDefault: (defaultValue: number) => ({ defaultValue }) },
  useQueryStates: () => [{ q: '', page: 1 }, setUrlStateMock],
}))
vi.mock('@/lib/api/membership-types', () => ({
  getMembershipTypeMembers: (...args: unknown[]) => getMembersMock(...args),
}))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => authValue }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super()
    }
  },
}))

const { ApiError } = await import('@/lib/api')
const { default: Page } = await import('./page')
const response = {
  snapshot: { catalog_state: 'applied' as const, snapshot_batch_id: 'batch-1' },
  membership_type: {
    source_row_id: 'type-1',
    snapshot_batch_id: 'batch-1',
    code: 'A',
    name: 'Adulto',
    letter: 'A',
    catalog_state: 'applied' as const,
  },
  items: [
    {
      member_id: 'member-1',
      member_number: 12,
      credential_ref: 'CARD-12',
      lifecycle_state: 'validated' as const,
      association_sources: ['validated', 'resolved'] as const,
    },
  ],
  total: 21,
  page: 1,
  limit: 20,
  has_more: true,
}
function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <Page />
    </QueryClientProvider>,
  )
}

describe('Membership type detail page', () => {
  beforeEach(() => {
    getMembersMock.mockReset()
    setUrlStateMock.mockReset()
    authValue = { user: { role: 'OPERADOR', permissions: { data_steward: true } } }
    getMembersMock.mockResolvedValue(response)
  })

  it('shows only safe member fields and translated association sources', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'A · Adulto' })).toBeInTheDocument()
    expect(screen.getByText('Evidencia validada')).toBeInTheDocument()
    expect(screen.getByText('Corrección aplicada')).toBeInTheDocument()
    expect(screen.queryByText('member-1')).not.toBeInTheDocument()
    expect(screen.queryByText(/DNI|contacto|motivo/i)).not.toBeInTheDocument()
    expect(getMembersMock).toHaveBeenCalledWith('type-1', { page: 1, limit: 20 })
  })

  it('submits search and pagination through stable URL state', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: 'A · Adulto' })
    await user.type(screen.getByLabelText('Buscar por número o referencia de credencial'), '12')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(setUrlStateMock).toHaveBeenCalledWith({ q: '12', page: 1 })
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(setUrlStateMock).toHaveBeenCalledWith({ page: 2 })
  })

  it('explains historical sources and permission failures without loading members', async () => {
    getMembersMock.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'historical'))
    renderPage()
    expect(await screen.findByText(/tipo no disponible en el catálogo actual/i)).toBeInTheDocument()
    cleanup()
    getMembersMock.mockReset()
    authValue = { user: { role: 'OPERADOR', permissions: { data_steward: false } } }
    renderPage()
    expect(screen.getByText('Sin permisos')).toBeInTheDocument()
    expect(getMembersMock).not.toHaveBeenCalled()
  })
})
