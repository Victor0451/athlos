import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CommunityWorkApi from '@/lib/api/community-work-approval'
import type { CommunityWorkQueueItem } from '@/lib/api/community-work-approval'

const decideMock = vi.fn()
const executeMock = vi.fn()
const listLifecycleMock = vi.fn()
vi.mock('@/lib/api/community-work-approval', async (importOriginal) => {
  const actual = await importOriginal<typeof CommunityWorkApi>()
  return {
    ...actual,
    decideCommunityWorkRequest: (...args: unknown[]) => decideMock(...args),
    executeCommunityWorkRequest: executeMock,
    listCommunityWorkLifecycle: (...args: unknown[]) => listLifecycleMock(...args),
  }
})
const { CommunityWorkOperationError } = await import('@/lib/api/community-work-approval')
const { CommunityWorkDecisionDialog } = await import('./CommunityWorkDecisionDialog')

const uuids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
]
const requesterId = uuids[1]!
const memberId = uuids[2]!
const obligationId = uuids[3]!
const executionId = uuids[4]!
const request = (state: CommunityWorkQueueItem['state'] = 'pending'): CommunityWorkQueueItem => ({
  id: uuids[0]!,
  state,
  expires_at: '2030-01-01T12:00:00.000Z',
  decided_at: state === 'pending' ? null : '2026-09-01T13:00:00.000Z',
  execution_id: state === 'pending' ? null : executionId,
  execution_status:
    state === 'approved_awaiting_execution'
      ? 'recoverable'
      : state === 'executed'
        ? 'executed'
        : 'unavailable',
  created_at: '2026-09-01T12:00:00.000Z',
  snapshot: {
    member_id: memberId,
    obligations: [{ obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 1250 }],
  },
  current_member: { id: memberId, numero_socio: '42', nombre: 'Ana', apellido: 'Gorriti' },
  requester: { id: requesterId, username: 'operador-turno' },
  context: 'Deuda revisada en mesa',
  reason: 'Plan comunitario',
  evidence: 'Acta 12',
})
const lifecycleItem = (state: CommunityWorkQueueItem['state'], execution = executionId) => ({
  id: uuids[0]!,
  state,
  expires_at: '2030-01-01T12:00:00.000Z',
  decided_at: state === 'pending' ? null : '2026-09-01T13:00:00.000Z',
  execution_id: state === 'pending' ? null : execution,
  execution_status:
    state === 'approved_awaiting_execution'
      ? 'recoverable'
      : state === 'executed'
        ? 'executed'
        : 'unavailable',
  snapshot: {
    member_id: memberId,
    obligations: [{ obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 1250 }],
  },
})
const executionResponse = () => ({
  execution_id: executionId,
  approval_id: uuids[0]!,
  request_id: uuids[0]!,
  work_id: uuids[4]!,
  settlement_id: uuids[0]!,
  allocation_id: uuids[0]!,
  socio_id: memberId,
  obligation_id: obligationId,
  amount_cents: 1250,
  currency: 'ARS',
  status: 'executed',
})
const renderDialog = (
  item = request(),
  overrides: Partial<React.ComponentProps<typeof CommunityWorkDecisionDialog>> = {},
) =>
  render(
    <CommunityWorkDecisionDialog
      request={item}
      operatorId="00000000-0000-4000-8000-000000000009"
      role="TESORERO"
      onRefresh={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  )
const decide = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Motivo de la decisión'), 'Reunión comunitaria')
  await user.type(screen.getByLabelText('Evidencia de la decisión'), 'Acta 15')
  await user.click(screen.getByRole('button', { name: /aprobar y ejecutar/i }))
}

describe('CommunityWorkDecisionDialog', () => {
  beforeEach(() => {
    decideMock.mockReset()
    executeMock.mockReset()
    listLifecycleMock.mockReset()
  })

  it('renders the request context and the decision form for a pending request', () => {
    renderDialog()
    expect(screen.getByText('Ana Gorriti · N.º 42')).toBeInTheDocument()
    expect(screen.getByText('operador-turno')).toBeInTheDocument()
    expect(screen.getByText('Deuda revisada en mesa')).toBeInTheDocument()
    expect(screen.getByText('Plan comunitario')).toBeInTheDocument()
    expect(screen.getByText('Acta 12')).toBeInTheDocument()
    expect(screen.getByLabelText('Decisión')).toHaveValue('approved')
    expect(screen.getByLabelText('Motivo de la decisión')).toBeEnabled()
    expect(screen.getByLabelText('Evidencia de la decisión')).toBeEnabled()
  })

  it('does not offer the decision form to the requesting operator', () => {
    renderDialog(request(), { operatorId: requesterId })
    expect(screen.getByText(/otro admin o tesorero debe decidir/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Decisión')).not.toBeInTheDocument()
  })

  it('approves, refreshes the lifecycle, executes, and confirms from the refreshed state', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    decideMock.mockResolvedValue({
      id: uuids[0]!,
      status: 'approved',
      expires_at: '2030-01-01T12:00:00.000Z',
      decided_at: '2026-09-01T13:00:00.000Z',
    })
    listLifecycleMock
      .mockResolvedValueOnce({
        items: [lifecycleItem('approved_awaiting_execution')],
      })
      .mockResolvedValueOnce({ items: [lifecycleItem('executed')] })
    executeMock.mockResolvedValue(executionResponse())
    renderDialog(request(), { onRefresh })
    await decide(user)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/ejecución confirmada/i),
    )
    expect(decideMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock).toHaveBeenCalledWith(uuids[0]!, executionId, expect.any(String))
    expect(listLifecycleMock).toHaveBeenCalledTimes(2)
    expect(onRefresh).toHaveBeenCalled()
  })

  it('registers a rejection without executing anything', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    decideMock.mockResolvedValue({
      id: uuids[0]!,
      status: 'rejected',
      expires_at: '2030-01-01T12:00:00.000Z',
      decided_at: '2026-09-01T13:00:00.000Z',
    })
    renderDialog(request(), { onRefresh })
    await user.type(screen.getByLabelText('Motivo de la decisión'), 'No corresponde')
    await user.type(screen.getByLabelText('Evidencia de la decisión'), 'Acta 16')
    await user.selectOptions(screen.getByLabelText('Decisión'), 'rejected')
    await user.click(screen.getByRole('button', { name: /registrar decisión/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/rechazo registrado/i))
    expect(executeMock).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('locks the review and asks for a refreshed queue on conflict', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    decideMock.mockRejectedValue(new CommunityWorkOperationError('conflict', new Error('409')))
    renderDialog(request(), { onRefresh })
    await decide(user)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cambió/i))
    expect(onRefresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /registrar decisión|aprobar/i })).toBeDisabled()
  })

  it('keeps the draft when the server denies permission', async () => {
    const user = userEvent.setup()
    decideMock.mockRejectedValue(new CommunityWorkOperationError('permission', new Error('403')))
    renderDialog()
    await user.type(screen.getByLabelText('Motivo de la decisión'), 'Reunión comunitaria')
    await user.type(screen.getByLabelText('Evidencia de la decisión'), 'Acta 15')
    await user.click(screen.getByRole('button', { name: /aprobar y ejecutar/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no te permite/i))
    expect(screen.getByLabelText('Motivo de la decisión')).toHaveValue('Reunión comunitaria')
    expect(screen.getByLabelText('Evidencia de la decisión')).toHaveValue('Acta 15')
  })

  it('locks the review when the request already expired', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    const expired = {
      ...request(),
      expires_at: '2020-01-01T12:00:00.000Z',
    }
    renderDialog(expired, { onRefresh })
    await user.type(screen.getByLabelText('Motivo de la decisión'), 'Tarde')
    await user.type(screen.getByLabelText('Evidencia de la decisión'), 'Acta 17')
    await user.click(screen.getByRole('button', { name: /aprobar y ejecutar/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/venció/i))
    expect(decideMock).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it('offers the retry-application path when execution fails after an approval', async () => {
    const user = userEvent.setup()
    decideMock.mockResolvedValue({
      id: uuids[0]!,
      status: 'approved',
      expires_at: '2030-01-01T12:00:00.000Z',
      decided_at: '2026-09-01T13:00:00.000Z',
    })
    listLifecycleMock.mockResolvedValue({
      items: [lifecycleItem('approved_awaiting_execution')],
    })
    executeMock.mockRejectedValue(new CommunityWorkOperationError('unavailable', new Error('500')))
    renderDialog()
    await decide(user)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/reintentá la ejecución/i),
    )
    expect(screen.getByRole('button', { name: /reintentar ejecución/i })).toBeEnabled()
  })
})
