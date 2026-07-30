import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const detail = vi.fn()
const resolve = vi.fn()
const members = vi.fn()
const types = vi.fn()
const preview = vi.fn()
const confirmApplication = vi.fn()
let role: 'ADMIN' | 'TESORERO' = 'ADMIN'
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'evidence-id' }) }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super()
    }
  },
}))
vi.mock('@/lib/api/socios-evidence-exceptions', () => ({
  confirmSociosEvidenceClosure: (...args: unknown[]) => confirmApplication(...args),
  getSociosEvidenceException: (...args: unknown[]) => detail(...args),
  previewSociosEvidenceClosure: (...args: unknown[]) => preview(...args),
  resolveSociosEvidenceException: (...args: unknown[]) => resolve(...args),
  searchMemberOptions: (...args: unknown[]) => members(...args),
  searchMembershipTypeOptions: (...args: unknown[]) => types(...args),
}))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: { role } }) }))

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
  socios_batch_id: '00000000-0000-4000-8000-000000000011',
  catalog_batch_id: '00000000-0000-4000-8000-000000000010',
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
    preview.mockReset()
    confirmApplication.mockReset()
    role = 'ADMIN'
    members.mockResolvedValue({ items: [member] })
    types.mockResolvedValue({
      items: [{ source_row_id: 'type-id', code: 'A', name: 'Adulto', letter: 'A' }],
    })
    resolve.mockResolvedValue({ application_status: 'pending_application' })
    preview.mockResolvedValue({
      previewId: '00000000-0000-4000-8000-000000000012',
      fingerprint: 'a'.repeat(64),
      resolutionSetFingerprint: 'b'.repeat(64),
      counts: { catalog: 2, socios: 3, resolutions: 1 },
    })
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

  it('lets only ADMIN preview then confirm a pending application', async () => {
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      status: 'resolved',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
      current_resolution: { application_status: 'pending_application' },
    })
    confirmApplication.mockResolvedValue({ status: 'accepted', jobRunId: 'new-run' })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByTestId('prepare-application'))
    expect(preview).toHaveBeenCalledWith({
      catalogBatchId: base.catalog_batch_id,
      sociosBatchId: base.socios_batch_id,
    })
    expect(confirmApplication).not.toHaveBeenCalled()
    await user.click(await screen.findByTestId('confirm-application'))
    await waitFor(() =>
      expect(confirmApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          previewId: expect.any(String),
          fingerprint: 'a'.repeat(64),
          resolutionSetFingerprint: 'b'.repeat(64),
        }),
        expect.any(String),
      ),
    )
    expect(await screen.findByText(/Se programó una nueva ejecución/)).toBeInTheDocument()
  })

  it('hides application execution from data stewards', async () => {
    role = 'TESORERO'
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      status: 'resolved',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
      current_resolution: { application_status: 'pending_application' },
    })
    renderPage()
    expect(await screen.findByText(/Pendiente de aplicación por un ADMIN/)).toBeInTheDocument()
    expect(screen.queryByTestId('prepare-application')).not.toBeInTheDocument()
  })

  it('does not present a replay as a new execution', async () => {
    detail.mockResolvedValue({
      ...base,
      kind: 'unknown_type',
      status: 'resolved',
      deterministic_type_candidate_source_row_id: null,
      known_member: member,
      current_resolution: { application_status: 'pending_application' },
    })
    confirmApplication.mockResolvedValue({ status: 'replay' })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByTestId('prepare-application'))
    await user.click(await screen.findByTestId('confirm-application'))
    expect(await screen.findByText(/no se programó una ejecución duplicada/)).toBeInTheDocument()
  })
})
