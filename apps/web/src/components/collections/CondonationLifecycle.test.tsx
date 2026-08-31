import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CondonationLifecycle as Lifecycle } from '@/lib/api/condonation'
import { CondonationLifecycle } from './CondonationLifecycle'

const lifecycle = (state: Lifecycle['state'] = 'pending'): Lifecycle => ({
  id: '00000000-0000-4000-8000-000000000001',
  state,
  expires_at: '2026-02-01T00:00:00.000Z',
  decided_at: '2026-01-31T00:00:00.000Z',
  execution_id: '00000000-0000-4000-8000-000000000002',
  execution_status: state === 'approved_awaiting_execution' ? 'recoverable' : 'executed',
  snapshot: {
    member_id: '00000000-0000-4000-8000-000000000003',
    obligations: [
      {
        obligation_id: '00000000-0000-4000-8000-000000000004',
        currency: 'ARS',
        outstanding_amount_cents: 1250,
      },
    ],
  },
})

describe('CondonationLifecycle', () => {
  it.each([
    ['pending', /pendiente.*deuda no cambia/i],
    ['rejected', /rechazada.*deuda no cambia/i],
    ['expired', /vencida.*deuda no cambia/i],
    ['approved_awaiting_execution', /aprobada.*todavía no fue aplicada/i],
    ['executed', /ejecutada.*deuda autorizada se redujo/i],
  ] as const)('honestly presents %s from the lifecycle DTO', (state, copy) => {
    render(<CondonationLifecycle lifecycle={lifecycle(state)} role="OPERADOR" />)
    expect(screen.getByRole('region', { name: /estado de la condonación/i })).toHaveTextContent(
      copy,
    )
    expect(screen.getByRole('list', { name: /obligaciones seleccionadas/i })).toHaveTextContent(
      '12.50 ARS',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows obligation ordinals without exposing raw identifiers', () => {
    render(<CondonationLifecycle lifecycle={lifecycle()} role="OPERADOR" />)
    expect(screen.getByRole('list', { name: /obligaciones seleccionadas/i })).toHaveTextContent(
      'Obligación 1',
    )
    expect(screen.queryByText('00000000-0000-4000-8000-000000000004')).not.toBeInTheDocument()
  })

  it('offers recovery only to treasury roles for an authoritative recoverable lifecycle', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <CondonationLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="TESORERO"
        onExecute={execute}
      />,
    )
    await user.click(screen.getByRole('button', { name: /recuperar y ejecutar condonación/i }))
    expect(execute).toHaveBeenCalled()
  })

  it.each([
    [
      'recoverable_error',
      /no se pudo ejecutar la condonación.*deuda no cambió.*recargá.*revisá.*ciclo de vida/i,
    ],
    ['denied', /servidor no te permite ejecutar.*deuda no cambió/i],
    ['transactional_error', /no se pudo ejecutar la condonación.*deuda no cambió/i],
  ] as const)('uses operation-aware execution copy for %s', (actionStatus, copy) => {
    render(
      <CondonationLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="ADMIN"
        actionStatus={actionStatus}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(copy)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/decisión|decidir/i)
  })

  it('announces a replay supplied by the explicit action-status seam', () => {
    render(
      <CondonationLifecycle
        lifecycle={lifecycle('executed')}
        role="ADMIN"
        actionStatus="replayed"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /resultado ya confirmado.*no se trató por segunda vez/i,
    )
  })

  it('contains rejected execution at the event boundary and unlocks exactly once for retry', async () => {
    let rejectExecution!: (error: Error) => void
    const execute = vi.fn(
      () => new Promise<never>((_resolve, reject) => (rejectExecution = reject)),
    )
    const user = userEvent.setup()
    render(
      <CondonationLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="TESORERO"
        onExecute={execute}
      />,
    )

    const action = screen.getByRole('button', { name: /recuperar y ejecutar condonación/i })
    await user.click(action)
    await user.click(action)
    expect(execute).toHaveBeenCalledTimes(1)
    rejectExecution(new Error('Condonation operation failed'))
    await Promise.resolve()
    expect(action).toBeEnabled()
    await user.click(action)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('disables execution while an asynchronous recovery is in flight', async () => {
    const execute = vi.fn(() => new Promise<void>(() => undefined))
    const user = userEvent.setup()
    function Fixture() {
      const [actionStatus, setActionStatus] = useState<'idle' | 'executing'>('idle')
      return (
        <CondonationLifecycle
          lifecycle={lifecycle('approved_awaiting_execution')}
          role="TESORERO"
          actionStatus={actionStatus}
          onExecute={async () => {
            setActionStatus('executing')
            await execute()
          }}
        />
      )
    }

    render(<Fixture />)
    const action = screen.getByRole('button', { name: /recuperar y ejecutar condonación/i })
    await user.click(action)
    expect(action).toBeDisabled()
    await user.click(action)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the action or lifecycle target after recoverable or committed feedback', () => {
    const { rerender } = render(
      <CondonationLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="ADMIN"
        onExecute={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const action = screen.getByRole('button', { name: /recuperar y ejecutar condonación/i })
    action.focus()
    rerender(
      <CondonationLifecycle
        lifecycle={lifecycle('approved_awaiting_execution')}
        role="ADMIN"
        actionStatus="recoverable_error"
        onExecute={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(action).toHaveFocus()
    rerender(
      <CondonationLifecycle
        lifecycle={lifecycle('executed')}
        role="ADMIN"
        actionStatus="replayed"
      />,
    )
    expect(screen.getByRole('region', { name: /estado de la condonación/i })).toHaveFocus()
  })

  it('uses explicit status hierarchy and premium snapshot styling without exposing identifiers', () => {
    render(
      <CondonationLifecycle lifecycle={lifecycle('approved_awaiting_execution')} role="OPERADOR" />,
    )
    expect(screen.getByText('Aprobada: pendiente de ejecución')).toBeInTheDocument()
    expect(screen.getByText('Recuperación requerida')).toBeInTheDocument()
    expect(screen.getByText('12.50 ARS')).toHaveClass('font-mono', 'tabular-nums')
    expect(screen.getByText('12.50 ARS').closest('li')).toHaveClass('bg-surface-sunken')
    expect(screen.queryByText('00000000-0000-4000-8000-000000000004')).not.toBeInTheDocument()
  })
})
