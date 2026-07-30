import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getExceptionsMock = vi.fn()
vi.mock('@/lib/api/socios-evidence-exceptions', () => ({
  getSociosEvidenceExceptions: (...args: unknown[]) => getExceptionsMock(...args),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super()
    }
  },
}))

const { default: SociosEvidenceExceptionsPage } = await import('./page')
const SAMPLE = {
  items: [
    {
      id: 'evidence-id',
      kind: 'unknown_type',
      status: 'unresolved',
      fingerprint: 'a'.repeat(64),
      legacy_type_code: 'SOC',
      created_at: '2026-07-01T12:00:00.000Z',
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
      <SociosEvidenceExceptionsPage />
    </QueryClientProvider>,
  )
}

describe('Socios evidence exceptions inbox', () => {
  beforeEach(() => {
    getExceptionsMock.mockReset()
    getExceptionsMock.mockResolvedValue(SAMPLE)
  })

  it('lists unresolved cases first with safe evidence references', async () => {
    renderPage()
    expect(await screen.findByText('Tipo de afiliación sin identificar')).toBeInTheDocument()
    expect(screen.getByText('Evidencia aaaaaaaaaaaa')).toBeInTheDocument()
    expect(screen.getAllByText('Sin resolver')).toHaveLength(2)
    expect(getExceptionsMock).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'unresolved' })
  })

  it('resets the page and refetches when a filter changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Tipo de afiliación sin identificar')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'ambiguous_identity')
    await waitFor(() =>
      expect(getExceptionsMock).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        kind: 'ambiguous_identity',
        status: 'unresolved',
      }),
    )
  })

  it('renders loading, empty, and error states', async () => {
    getExceptionsMock.mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = renderPage()
    expect(screen.getByText(/cargando excepciones/i)).toBeInTheDocument()
    unmount()
    getExceptionsMock.mockResolvedValueOnce({ ...SAMPLE, items: [], total: 0 })
    renderPage()
    expect(await screen.findByText(/no hay excepciones/i)).toBeInTheDocument()
    unmount()
    getExceptionsMock.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })
})
