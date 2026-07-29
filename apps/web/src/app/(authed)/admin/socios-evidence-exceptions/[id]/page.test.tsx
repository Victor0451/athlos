import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const detail = vi.fn()
const resolve = vi.fn()
const members = vi.fn()
const types = vi.fn()
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'evidence-id' }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super()
    }
  },
}))
vi.mock('@/lib/api/socios-evidence-exceptions', () => ({
  getSociosEvidenceException: (...args: unknown[]) => detail(...args),
  resolveSociosEvidenceException: (...args: unknown[]) => resolve(...args),
  searchMemberOptions: (...args: unknown[]) => members(...args),
  searchMembershipTypeOptions: (...args: unknown[]) => types(...args),
}))

const { default: Page } = await import('./page')
const member = {
  id: 'member-id',
  member_number: 12,
  credential_ref: 'CARD-12',
  lifecycle_state: 'validated',
}
const base = {
  id: 'evidence-id',
  status: 'unresolved' as const,
  fingerprint: 'a'.repeat(64),
  legacy_type_code: 'A',
  created_at: '2026-07-29T12:00:00.000Z',
  current_resolution: null,
}
function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  )
}

describe('Socios evidence exception detail', () => {
  beforeEach(() => {
    detail.mockReset()
    resolve.mockReset()
    members.mockReset()
    types.mockReset()
    members.mockResolvedValue({ items: [member] })
    types.mockResolvedValue({
      items: [{ source_row_id: 'type-id', code: 'A', name: 'Adulto', letter: 'A' }],
    })
    resolve.mockResolvedValue({ application_status: 'pending_application' })
  })

  it('uses the immutable known member for unknown_type and posts only its selection', async () => {
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText(/Miembro validado/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Buscar por número/)).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/código, nombre o letra/), 'ad')
    await user.click(await screen.findByText(/Adulto/))
    await user.type(screen.getByPlaceholderText(/Explicá/), 'Verificado')
    await user.click(screen.getByRole('button', { name: 'Registrar resolución' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith(
        'evidence-id',
        {
          kind: 'unknown_type',
          evidence_fingerprint: 'a'.repeat(64),
          reason: 'Verificado',
          selected_member_id: 'member-id',
          selected_type_candidate_source_row_id: 'type-id',
        },
        expect.any(String),
      ),
    )
  })

  it('requires a member search for ambiguous identity and omits deterministic type', async () => {
    detail.mockResolvedValue({
      ...base,
      kind: 'ambiguous_identity',
      deterministic_type_candidate_source_row_id: 'fixed-type',
      known_member: null,
    })
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByPlaceholderText(/Buscar por número/), '12')
    await user.click(await screen.findByText(/Socio 12/))
    await user.type(screen.getByPlaceholderText(/Explicá/), 'Verificado')
    expect(screen.getByText(/candidato determinista/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registrar resolución' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith(
        'evidence-id',
        expect.objectContaining({ selected_member_id: 'member-id' }),
        expect.any(String),
      ),
    )
    expect(resolve.mock.calls[0]![1]).not.toHaveProperty('selected_type_candidate_source_row_id')
  })

  it('guides refresh after a stale conflict and makes resolved evidence read-only', async () => {
    const { ApiError } = await import('@/lib/api')
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
    })
    resolve.mockRejectedValue(new ApiError(409, 'CONFLICT', 'stale'))
    const user = userEvent.setup()
    const view = renderPage()
    await user.type(await screen.findByPlaceholderText(/código, nombre o letra/), 'ad')
    await user.click(await screen.findByText(/Adulto/))
    await user.type(screen.getByPlaceholderText(/Explicá/), 'Verificado')
    await user.click(screen.getByRole('button', { name: 'Registrar resolución' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/Actualizá el detalle/)).toBeInTheDocument()
    view.unmount()
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      status: 'resolved',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
      current_resolution: {
        id: 'resolution-id',
        evidence_id: 'evidence-id',
        kind: 'unknown_type',
        selected_member_id: 'member-id',
        selected_type_candidate_source_row_id: 'type-id',
        application_status: 'applied',
        created_at: base.created_at,
        applied_at: base.created_at,
      },
    })
    renderPage()
    expect(await screen.findByText(/resolución registrada y aplicada/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar resolución' })).not.toBeInTheDocument()
  })
})
