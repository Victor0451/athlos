import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityWorkApprovalLifecycle as Lifecycle } from '@/lib/api/community-work-approval'
import {
  CommunityWorkApprovalLifecycle,
  type CommunityWorkApprovalStatus,
} from './CommunityWorkApprovalLifecycle'

const uuids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
]
const lifecycle = (state: Lifecycle['state'] = 'pending'): Lifecycle => ({
  id: uuids[0]!,
  state,
  expires_at: '2026-09-01T00:00:00.000Z',
  decided_at: state === 'pending' ? null : '2026-08-31T00:00:00.000Z',
  execution_id: state === 'pending' ? null : uuids[1]!,
  execution_status:
    state === 'approved_awaiting_execution'
      ? 'recoverable'
      : state === 'executed'
        ? 'executed'
        : 'unavailable',
  snapshot: {
    member_id: uuids[2]!,
    obligations: [
      {
        obligation_id: uuids[3]!,
        currency: 'ARS',
        outstanding_amount_cents: 1250,
      },
    ],
  },
})

describe('CommunityWorkApprovalLifecycle', () => {
  it.each<[Lifecycle['state'], RegExp]>([
    ['pending', /pendiente.*deuda no cambia/i],
    ['rejected', /rechazada.*deuda no cambia/i],
    ['expired', /vencida.*deuda no cambia/i],
    ['approved_awaiting_execution', /aprobada.*todavía no fue aplicada/i],
    ['executed', /ejecutada.*deuda autorizada se redujo/i],
  ])('renders the financial-inertia copy for %s without any action on the debt', (state, copy) => {
    render(<CommunityWorkApprovalLifecycle lifecycle={lifecycle(state)} role="OPERADOR" />)
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ejecutar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /solicitar/i })).not.toBeInTheDocument()
  })

  it('marks a recoverable execution without offering the execution action', () => {
    render(
      <CommunityWorkApprovalLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="TESORERO"
      />,
    )
    expect(screen.getByText('Recuperación requerida')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /recuperar/i })).not.toBeInTheDocument()
  })

  it('renders nothing without a lifecycle and without a request action', () => {
    const { container } = render(
      <CommunityWorkApprovalLifecycle lifecycle={null} role="OPERADOR" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the request action to the operator when no lifecycle exists', async () => {
    const user = userEvent.setup()
    const onRequest = vi.fn().mockResolvedValue(undefined)
    function Host() {
      const [actionStatus, setActionStatus] = useState<CommunityWorkApprovalStatus>('idle')
      return (
        <CommunityWorkApprovalLifecycle
          lifecycle={null}
          role="OPERADOR"
          actionStatus={actionStatus}
          onRequest={async (draft) => {
            await onRequest(draft)
            setActionStatus('requested')
          }}
        />
      )
    }
    render(<Host />)
    await user.click(screen.getByRole('button', { name: /solicitar trabajo comunitario/i }))
    await user.type(screen.getByLabelText('Contexto'), 'Debt review')
    await user.type(screen.getByLabelText('Motivo'), 'Community plan')
    await user.type(screen.getByLabelText('Evidencia'), 'Minutes 12')
    await user.click(screen.getByRole('button', { name: /enviar solicitud/i }))
    expect(onRequest).toHaveBeenCalledWith({
      context: 'Debt review',
      reason: 'Community plan',
      evidence: 'Minutes 12',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      /solicitud registrada.*la deuda no cambia/i,
    )
  })

  it('passes an optional agreement context only when provided', async () => {
    const user = userEvent.setup()
    const onRequest = vi.fn().mockResolvedValue(undefined)
    render(
      <CommunityWorkApprovalLifecycle lifecycle={null} role="OPERADOR" onRequest={onRequest} />,
    )
    await user.click(screen.getByRole('button', { name: /solicitar trabajo comunitario/i }))
    await user.type(screen.getByLabelText('Contexto'), 'Con acuerdo')
    await user.type(screen.getByLabelText('Motivo'), 'Plan')
    await user.type(screen.getByLabelText('Evidencia'), 'Acta 3')
    await user.type(
      screen.getByLabelText('Acuerdo (opcional)'),
      '00000000-0000-4000-8000-000000000009',
    )
    await user.click(screen.getByRole('button', { name: /enviar solicitud/i }))
    expect(onRequest).toHaveBeenCalledWith({
      context: 'Con acuerdo',
      reason: 'Plan',
      evidence: 'Acta 3',
      agreement_id: '00000000-0000-4000-8000-000000000009',
    })
  })

  it('does not call the request action twice while one request is in flight', async () => {
    const user = userEvent.setup()
    let release: (() => void) | undefined
    const onRequest = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    render(
      <CommunityWorkApprovalLifecycle lifecycle={null} role="OPERADOR" onRequest={onRequest} />,
    )
    await user.click(screen.getByRole('button', { name: /solicitar trabajo comunitario/i }))
    await user.type(screen.getByLabelText('Contexto'), 'X')
    await user.type(screen.getByLabelText('Motivo'), 'Y')
    await user.type(screen.getByLabelText('Evidencia'), 'Z')
    const submit = screen.getByRole('button', { name: /enviar solicitud/i })
    await user.click(submit)
    await user.click(submit)
    release?.()
    expect(onRequest).toHaveBeenCalledTimes(1)
  })

  it('reports denied and transactional failures without color-only distinctions', () => {
    const { rerender } = render(
      <CommunityWorkApprovalLifecycle
        lifecycle={null}
        role="OPERADOR"
        onRequest={vi.fn()}
        actionStatus="denied"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/no te permite solicitar/i)
    rerender(
      <CommunityWorkApprovalLifecycle
        lifecycle={null}
        role="OPERADOR"
        onRequest={vi.fn()}
        actionStatus="transactional_error"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/no se pudo registrar la solicitud/i)
  })

  it('disables the request actions while the request is busy', () => {
    render(
      <CommunityWorkApprovalLifecycle
        lifecycle={null}
        role="OPERADOR"
        onRequest={vi.fn()}
        requestBusy
      />,
    )
    expect(screen.getByRole('button', { name: /solicitar trabajo comunitario/i })).toBeDisabled()
  })
})
