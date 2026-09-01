import { act, render, screen } from '@testing-library/react'
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

  it('does not duplicate lifecycle execution controls', () => {
    render(
      <CondonationActions
        memberId="member-1"
        obligations={obligations}
        canDecide={false}
        onRequest={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /ejecutar|recuperar/i })).not.toBeInTheDocument()
  })

  it('uses premium responsive fields and prevents duplicate requests while busy', async () => {
    let resolveRequest!: (value: {
      id: string
      status: 'pending'
      expires_at: string
      decided_at: null
    }) => void
    const request = vi.fn(
      () =>
        new Promise<{ id: string; status: 'pending'; expires_at: string; decided_at: null }>(
          (resolve) => {
            resolveRequest = resolve
          },
        ),
    )
    const user = userEvent.setup()
    render(
      <CondonationActions
        memberId="member-1"
        obligations={obligations}
        canDecide={false}
        onRequest={request}
      />,
    )
    const context = screen.getByLabelText('Contexto de la solicitud')
    expect(context).toHaveClass('min-h-11', 'border-ink-300')
    await user.type(context, 'Debt review')
    await user.type(screen.getByLabelText('Motivo de la solicitud'), 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))
    expect(screen.getByRole('button', { name: 'Enviando solicitud…' })).toBeDisabled()
    expect(context).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Enviando solicitud…' }))
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveRequest({
        id: 'request-1',
        status: 'pending',
        expires_at: '2026-09-01',
        decided_at: null,
      })
    })
  })
})
