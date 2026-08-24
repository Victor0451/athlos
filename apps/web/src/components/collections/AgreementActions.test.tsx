import { render, screen, within } from '@testing-library/react'
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

  it('renders ascending immutable history and only the active agreement can be revised', () => {
    const previous = { ...agreement, id: 'agreement-previous', status: 'SUPERSEDED' as const }
    const current = { ...agreement, id: 'agreement-current', revision_number: 2 }
    renderActions({
      state: state({ active: current, revisions: [current, previous] }),
      onRevise: vi.fn(),
    })

    const history = screen.getByRole('list', { name: /historial de revisiones/i })
    const entries = within(history).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent(/revisión 1/i)
    expect(entries[0]).toHaveTextContent('Anterior')
    expect(entries[1]).toHaveTextContent(/revisión 2/i)
    expect(entries[1]).toHaveTextContent('Actual')
    expect(screen.getByRole('button', { name: 'Revisar acuerdo activo' })).toBeInTheDocument()
    expect(within(entries[0]!).queryByRole('button', { name: /revisar/i })).not.toBeInTheDocument()
  })

  it('communicates an active agreement with no prior revisions', () => {
    renderActions({ state: state({ active: agreement, revisions: [] }), onRevise: vi.fn() })

    expect(screen.getByText('No hay revisiones anteriores.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revisar acuerdo activo' })).toBeInTheDocument()
  })

  it('renders a long history completely after sorting it by revision number', () => {
    const ordered = Array.from({ length: 12 }, (_, index) => ({
      ...agreement,
      id: `agreement-${index + 1}`,
      revision_number: index + 1,
      status: index === 11 ? ('ACTIVE' as const) : ('SUPERSEDED' as const),
    }))
    renderActions({
      state: state({ active: ordered[11]!, revisions: [...ordered].reverse() }),
      onRevise: vi.fn(),
    })

    const entries = within(screen.getByRole('list', { name: /historial/i })).getAllByRole(
      'listitem',
    )
    expect(entries).toHaveLength(12)
    expect(entries[0]!).toHaveTextContent(/revisión 1/i)
    expect(entries[11]!).toHaveTextContent(/revisión 12/i)
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

  it('preserves the revision draft when refreshing the conflict fails', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const onCreate = vi.fn().mockRejectedValue(new DuesOperationError('conflict', 'conflict'))
    renderActions({ onCreate, onRefresh })

    await user.click(screen.getByRole('button', { name: /registrar acuerdo/i }))
    const narrative = screen.getByLabelText(/narrativa del acuerdo/i)
    await user.type(narrative, 'Borrador conservado')
    await user.type(screen.getByLabelText(/motivo del acuerdo/i), 'Motivo')
    await user.click(screen.getByRole('button', { name: /guardar acuerdo/i }))
    await user.click(screen.getByRole('button', { name: /revisar acuerdo actualizado/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/no se pudo actualizar/i)
    expect(narrative).toHaveValue('Borrador conservado')
  })

  it('revises the active agreement and announces replay separately', async () => {
    const user = userEvent.setup()
    const onRevise = vi
      .fn()
      .mockResolvedValueOnce({ replayed: false })
      .mockResolvedValueOnce({ replayed: true })
    const current = { ...agreement, revision_number: 2 }
    const view = renderActions({ state: state({ active: current }), onRevise })

    await user.click(screen.getByRole('button', { name: 'Revisar acuerdo activo' }))
    await user.clear(screen.getByLabelText(/narrativa del acuerdo/i))
    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Nueva narrativa')
    await user.type(screen.getByLabelText(/motivo de la revisión/i), 'Actualización acordada')
    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/acuerdo actualizado/i)
    expect(onRevise).toHaveBeenCalledWith(current.id, {
      narrative: 'Nueva narrativa',
      reason: 'Actualización acordada',
    })

    view.unmount()
    renderActions({ state: state({ active: current }), onRevise })
    await user.click(screen.getByRole('button', { name: 'Revisar acuerdo activo' }))
    await user.type(screen.getByLabelText(/narrativa del acuerdo/i), 'Repetición')
    await user.type(screen.getByLabelText(/motivo de la revisión/i), 'Mismo pedido')
    await user.click(screen.getByRole('button', { name: /actualizar acuerdo/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/ya había sido registrado/i)
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
