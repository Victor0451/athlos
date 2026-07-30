import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getMembershipTypesMock = vi.fn()
const setUrlStateMock = vi.fn()
const pushMock = vi.fn()
let authValue: { user: unknown } = { user: null }

vi.mock('nuqs', () => ({
  parseAsString: { withDefault: (defaultValue: string) => ({ defaultValue }) },
  parseAsInteger: { withDefault: (defaultValue: number) => ({ defaultValue }) },
  useQueryStates: () => [{ q: '', page: 1 }, setUrlStateMock],
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
vi.mock('@/lib/api/membership-types', () => ({
  getMembershipTypes: (...args: unknown[]) => getMembershipTypesMock(...args),
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
const { default: MembershipTypesPage } = await import('./page')

const response = {
  snapshot: { catalog_state: 'applied' as const, snapshot_batch_id: 'batch-1' },
  items: [
    {
      source_row_id: 'type-1',
      snapshot_batch_id: 'batch-1',
      code: 'A',
      name: 'Adulto',
      letter: 'A',
      catalog_state: 'applied' as const,
      validated_count: 4,
      applied_resolution_count: 2,
      member_count: 6,
    },
  ],
  total: 21,
  page: 1,
  limit: 20,
  has_more: true,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MembershipTypesPage />
    </QueryClientProvider>,
  )
}

describe('Membership types page', () => {
  beforeEach(() => {
    getMembershipTypesMock.mockReset()
    setUrlStateMock.mockReset()
    pushMock.mockReset()
    authValue = {
      user: {
        role: 'OPERADOR',
        permissions: { data_steward: true },
      },
    }
    getMembershipTypesMock.mockResolvedValue(response)
  })

  it('lists only catalog-safe columns for a data steward', async () => {
    renderPage()

    expect(await screen.findByText('Adulto')).toBeInTheDocument()
    expect(screen.getByText('Aplicado')).toBeInTheDocument()
    expect(screen.getByText(/referencia de lote: batch-1/i)).toBeInTheDocument()
    expect(screen.queryByText(/DNI|credencial|tarifa/i)).not.toBeInTheDocument()
    expect(getMembershipTypesMock).toHaveBeenCalledWith({ page: 1, limit: 20 })
  })

  it('submits a search and changes pages through URL state', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Adulto')

    await user.type(screen.getByLabelText('Buscar por código, nombre o letra'), 'adulto')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(setUrlStateMock).toHaveBeenCalledWith({ q: 'adulto', page: 1 })

    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(setUrlStateMock).toHaveBeenCalledWith({ page: 2 })
  })

  it('opens the selected type detail by its machine key', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByTestId('membership-types-table-row-type-1'))
    expect(pushMock).toHaveBeenCalledWith('/admin/membership-types/type-1')
  })

  it('shows loading, empty, unavailable, error, and permission states', async () => {
    getMembershipTypesMock.mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = renderPage()
    expect(screen.getByLabelText('Cargando')).toBeInTheDocument()
    unmount()

    getMembershipTypesMock.mockResolvedValueOnce({ ...response, items: [], total: 0 })
    renderPage()
    expect(await screen.findByText(/sin resultados para los filtros/i)).toBeInTheDocument()
    cleanup()

    getMembershipTypesMock.mockResolvedValueOnce({
      ...response,
      snapshot: { catalog_state: 'unavailable', reason: 'no_current_catalog' },
      items: [],
      total: 0,
    })
    renderPage()
    expect(await screen.findByText(/catálogo aún no disponible/i)).toBeInTheDocument()
    cleanup()

    getMembershipTypesMock.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar el catálogo/i)).toBeInTheDocument()
    cleanup()

    getMembershipTypesMock.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden'))
    renderPage()
    expect(await screen.findByText('Sin permisos')).toBeInTheDocument()
    await waitFor(() => expect(getMembershipTypesMock).toHaveBeenCalled())
    cleanup()

    getMembershipTypesMock.mockReset()
    authValue = { user: { role: 'OPERADOR', permissions: { data_steward: false } } }
    renderPage()
    expect(screen.getByText('Sin permisos')).toBeInTheDocument()
    expect(getMembershipTypesMock).not.toHaveBeenCalled()
  })
})
