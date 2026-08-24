import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DuesOperationError, type DuesAgreement } from '@/lib/api/dues'
import { AgreementActions, type AgreementViewState } from './AgreementActions'

const openObligation = {
  id: 'obligation-open',
  period_start: '2026-01-01',
  period_end: '2026-02-01',
  status: 'OPEN' as const,
}
const closedObligation = { ...openObligation, id: 'obligation-closed', status: 'PAID' as const }
const agreement: DuesAgreement = {
  id: 'agreement-1',
  socio_id: 'socio-1',
  obligation_id: openObligation.id,
  kind: 'NEGOTIATED',
  status: 'ACTIVE',
  revision_number: 1,
  terms_version: 1,
  terms: { narrative: 'Se acuerda una colaboración' },
  reason: 'Situación económica',
  revision_reason: null,
  agreement_date: '2026-01-03',
  revision_of_agreement_id: null,
  replayed: false,
}
const state = (overrides: Partial<AgreementViewState> = {}): AgreementViewState => ({
  status: 'ready',
  active: null,
  ...overrides,
})
const renderActions = (overrides: Partial<React.ComponentProps<typeof AgreementActions>> = {}) =>
  render(
    <AgreementActions
      obligation={openObligation}
      state={state()}
      onCreate={vi.fn().mockResolvedValue({ replayed: false })}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  )

describe('AgreementActions', () => {
  it('shows an entry point only for enabled open obligations', () => {
    renderActions({ enabled: false })
    expect(screen.queryByRole('button', { name: /registrar acuerdo/i })).not.toBeInTheDocument()

    render(
      <AgreementActions
        obligation={closedObligation}
        enabled
        state={state()}
        onCreate={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /registrar acuerdo/i })).not.toBeInTheDocument()
  })

  it('renders an active agreement summary and debt guidance without revision controls', () => {
    renderActions({ state: state({ active: agreement }) })

    expect(screen.getByText(/Se acuerda una colaboración/)).toBeInTheDocument()
    expect(screen.getByText(/Situación económica/)).toBeInTheDocument()
    expect(screen.getByText(/la deuda continúa abierta/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revisar|historial/i })).not.toBeInTheDocument()
  })

  it.each([
    ['loading', 'Cargando el acuerdo…', 'status'],
    ['permission', 'No tenés permiso para registrar o modificar acuerdos.', 'alert'],
    [
      'partial_data',
      'El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.',
      'alert',
    ],
    ['unavailable', 'No se pudo cargar el acuerdo. Intentá nuevamente.', 'alert'],
  ] as const)('communicates the %s state accessibly in Spanish', (status, message, role) => {
    renderActions({ state: state({ status }) })
    expect(screen.getByRole(role)).toHaveTextContent(message)
  })

  it('preserves the draft through a conflict and requires an explicit refreshed review', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const onCreate = vi.fn().mockRejectedValue(new DuesOperationError('conflict', 'conflict'))
    renderActions({ onCreate, onRefresh })

    await user.click(screen.getByRole('button', { name: /registrar acuerdo/i }))
    const narrative = screen.getByLabelText(/narrativa del acuerdo/i)
    await user.type(narrative, 'Borrador en conflicto')
    await user.type(screen.getByLabelText(/motivo del acuerdo/i), 'Motivo conservado')
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/cambió/i)
    expect(narrative).toHaveValue('Borrador en conflicto')
    await user.click(screen.getByRole('button', { name: /revisar acuerdo actualizado/i }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(narrative).toHaveValue('Borrador en conflicto')
  })

  it('announces confirmed and replayed saves as statuses, not alerts', async () => {
    const user = userEvent.setup()
    const onCreate = vi
      .fn()
      .mockResolvedValueOnce({ replayed: false })
      .mockResolvedValueOnce({ replayed: true })
    const first = renderActions({ onCreate })
    await user.click(screen.getByRole('button', { name: /registrar acuerdo/i }))
    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Acuerdo confirmado')
    await user.type(screen.getByLabelText(/motivo del acuerdo/i), 'Motivo')
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/acuerdo registrado/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    first.unmount()
    renderActions({ onCreate, state: state({ status: 'ready' }) })
    await user.click(screen.getByRole('button', { name: /registrar acuerdo/i }))
    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Acuerdo repetido')
    await user.type(screen.getByLabelText(/motivo del acuerdo/i), 'Motivo')
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/ya había sido registrado/i)
  })
})
