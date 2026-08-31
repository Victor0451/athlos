import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CondonationActions } from './CondonationActions'

// prettier-ignore
const obligations = [{ id: 'b', period_start: '2026-02-01', outstanding_cents: 2000, currency: 'ARS' }, { id: 'a', period_start: '2026-01-01', outstanding_cents: 1000, currency: 'ARS' }]

describe('CondonationActions', () => {
  // prettier-ignore
  it('submits the complete canonical eligible selection and only reports a pending request', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'request-1', status: 'pending', expires_at: '2026-09-01', decided_at: null })
    const user = userEvent.setup()
    render(<CondonationActions memberId="member-1" obligations={obligations} canDecide={false} onRequest={request} />)
    await user.type(screen.getByLabelText('Contexto de la solicitud'), 'Debt review')
    await user.type(screen.getByLabelText('Motivo de la solicitud'), 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ obligation_ids: ['a', 'b'] }))
    expect(await screen.findByRole('status')).toHaveTextContent(/pendiente.*no modifica la deuda/i)
    expect(screen.queryByText(/deuda perdonada/i)).not.toBeInTheDocument()
  })

  // prettier-ignore
  it('allows only an approver to record a decision and surfaces its server error', async () => {
    const decide = vi.fn().mockRejectedValue(new Error('self decision'))
    const user = userEvent.setup()
    render(<CondonationActions memberId="member-1" obligations={obligations} canDecide request={{ id: 'request-1', status: 'pending', expires_at: '2026-09-01', decided_at: null }} onRequest={vi.fn()} onDecision={decide} />)
    await user.selectOptions(screen.getByLabelText('Decisión'), 'approved')
    await user.type(screen.getByLabelText('Motivo de la decisión'), 'Verified')
    await user.type(screen.getByLabelText('Evidencia de la decisión'), 'Minutes 13')
    await user.click(screen.getByRole('button', { name: 'Registrar decisión' }))
    expect(decide).toHaveBeenCalledWith('request-1', expect.objectContaining({ decision: 'approved' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo registrar la decisión/i)
  })

  it('only exposes persisted approved execution to Treasury roles', () => {
    const lifecycle = {
      id: 'request-1',
      state: 'approved_awaiting_execution' as const,
      execution_id: 'execution-1',
    }
    const props = { memberId: 'member-1', obligations, onRequest: vi.fn(), lifecycle }
    const { rerender } = render(<CondonationActions {...props} canDecide={false} />)
    expect(screen.queryByRole('button', { name: /ejecutar condonación/i })).not.toBeInTheDocument()
    rerender(<CondonationActions {...props} canDecide canExecute onExecute={vi.fn()} />)
    expect(screen.getByRole('button', { name: /ejecutar condonación/i })).toBeInTheDocument()
  })
})
