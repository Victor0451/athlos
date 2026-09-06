import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CondonationActions } from './CondonationActions'

// prettier-ignore
const obligations = [{ id: 'b', period_start: '2026-02-01', outstanding_cents: 2000, currency: 'ARS' }, { id: 'a', period_start: '2026-01-01', outstanding_cents: 1000, currency: 'ARS' }]
describe('CondonationActions', () => {
  // prettier-ignore
  it('requires an explicit selection and submits only the selected canonical obligations', async () => {
    const request = vi.fn().mockResolvedValue({ id: 'request-1', status: 'pending', expires_at: '2026-09-01', decided_at: null })
    const user = userEvent.setup()
    render(<CondonationActions memberId="member-1" obligations={obligations} canDecide={false} onRequest={request} />)
    await user.type(screen.getByLabelText('Contexto de la solicitud'), 'Debt review')
    await user.type(screen.getByLabelText('Motivo de la solicitud'), 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    const submit = screen.getByRole('button', { name: 'Enviar solicitud de condonación' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('0 de 2 obligaciones seleccionadas')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Período enero de 2026/i }))
    expect(screen.getByText('1 de 2 obligaciones seleccionadas')).toBeInTheDocument()
    await user.click(submit)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ obligation_ids: ['a'] }))
    expect(await screen.findByRole('status')).toHaveTextContent(/pendiente.*no modifica la deuda/i)
    expect(screen.queryByText(/deuda perdonada/i)).not.toBeInTheDocument()
  })

  it('prunes selections when eligibility refreshes and when the member changes', async () => {
    const request = vi.fn().mockResolvedValue({
      id: 'request-1',
      status: 'pending',
      expires_at: '2026-09-01',
      decided_at: null,
    })
    const user = userEvent.setup()
    const { rerender } = render(
      <CondonationActions
        memberId="member-1"
        obligations={obligations}
        canDecide={false}
        onRequest={request}
      />,
    )
    const january = screen.getByRole('checkbox', { name: /Período enero de 2026/i })
    await user.click(january)
    expect(january).toBeChecked()
    await user.click(january)
    expect(january).not.toBeChecked()
    await user.click(january)
    await user.click(screen.getByRole('checkbox', { name: /Período febrero de 2026/i }))
    rerender(
      <CondonationActions
        memberId="member-1"
        obligations={[obligations[1]!]}
        canDecide={false}
        onRequest={request}
      />,
    )
    await user.type(screen.getByLabelText('Contexto de la solicitud'), 'Debt review')
    await user.type(screen.getByLabelText('Motivo de la solicitud'), 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ obligation_ids: ['a'] }))

    rerender(
      <CondonationActions
        memberId="member-2"
        obligations={[obligations[1]!]}
        canDecide={false}
        onRequest={request}
      />,
    )
    expect(await screen.findByText('0 de 1 obligaciones seleccionadas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar solicitud de condonación' })).toBeDisabled()
  })

  it('keeps the entered reason after a failed request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(
      <CondonationActions
        memberId="member-1"
        obligations={obligations}
        canDecide={false}
        onRequest={request}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: /Período enero de 2026/i }))
    await user.type(screen.getByLabelText('Contexto de la solicitud'), 'Debt review')
    const reason = screen.getByLabelText('Motivo de la solicitud')
    await user.type(reason, 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo enviar/i)
    expect(reason).toHaveValue('Hardship')
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

  it('uses localized periods without exposing obligation identifiers while retaining callback IDs', async () => {
    const request = vi.fn().mockResolvedValue({
      id: 'request-1',
      status: 'pending',
      expires_at: '2026-09-01',
      decided_at: null,
    })
    const user = userEvent.setup()
    const obligationIds = [
      'f62b8a95-2ef4-4e43-95fe-76e791bf7f8f',
      'c9a4e0a8-26d7-4180-879e-6067483c93d7',
    ]
    render(
      <CondonationActions
        memberId="member-1"
        obligations={[
          {
            id: obligationIds[0]!,
            period_start: '2026-07-01',
            outstanding_cents: 2000,
            currency: 'ARS',
          },
          {
            id: obligationIds[1]!,
            period_start: '2026-06-01',
            outstanding_cents: 1000,
            currency: 'ARS',
          },
        ]}
        canDecide={false}
        onRequest={request}
      />,
    )

    expect(screen.getByText('Período julio de 2026')).toBeInTheDocument()
    expect(screen.getByText('Período junio de 2026')).toBeInTheDocument()
    for (const sentinel of [...obligationIds, '2026-07-01', '2026-06-01'])
      expect(screen.queryByText(sentinel, { exact: false })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Contexto de la solicitud'), 'Debt review')
    await user.type(screen.getByLabelText('Motivo de la solicitud'), 'Hardship')
    await user.type(screen.getByLabelText('Evidencia de la solicitud'), 'Minutes 12')
    await user.click(screen.getAllByRole('checkbox')[0]!)
    await user.click(screen.getAllByRole('checkbox')[1]!)
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ obligation_ids: obligationIds.sort() }),
    )
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
    await user.click(screen.getByRole('checkbox', { name: /Período enero de 2026/i }))
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud de condonación' }))
    expect(screen.getByRole('button', { name: 'Enviando solicitud…' })).toBeDisabled()
    expect(context).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Período enero de 2026/i })).toBeDisabled()
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
