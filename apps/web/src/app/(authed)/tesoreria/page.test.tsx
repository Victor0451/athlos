// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TreasuryPage from './page'
import { FeatureConfigProvider } from '@/lib/features'
import type { CashShift } from '@/lib/api/treasury'
import { ApiError } from '@/lib/api'

const authState = vi.hoisted(() => ({ user: { role: 'TESORERO', operator_id: 'operator-1' } }))
const navigationMocks = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMocks.push }),
  useSearchParams: () => navigationMocks.params,
}))
const mocks = vi.hoisted(() => ({
  getCashShifts: vi.fn(),
  getCashShiftDetail: vi.fn(),
  ensureOpenCashShift: vi.fn(),
  closeCashShift: vi.fn(),
  forceCloseCashShift: vi.fn(),
  recordCashTender: vi.fn(),
  query: {
    data: { items: [] as CashShift[] } as { items: CashShift[] } | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  detailQuery: {
    data: undefined as
      | {
          opening_tenders?: Record<string, number>
          expected_tenders?: Record<string, number>
          movements?: unknown[]
        }
      | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}))
vi.mock('@/lib/api/treasury', () => ({
  getCashShifts: mocks.getCashShifts,
  getCashShiftDetail: mocks.getCashShiftDetail,
  ensureOpenCashShift: mocks.ensureOpenCashShift,
  closeCashShift: mocks.closeCashShift,
  forceCloseCashShift: mocks.forceCloseCashShift,
  recordCashTender: mocks.recordCashTender,
}))
// The page runs two queries (shift list + corte detail): dispatch by query key so each
// test can arrange them independently.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] }) =>
    Array.isArray(options.queryKey) && options.queryKey[0] === 'cash-shift-detail'
      ? mocks.detailQuery
      : mocks.query,
}))

const openShift = (id = 'shift-1', assigned = 'operator-1'): CashShift => ({
  id,
  desk_id: 'front',
  status: 'OPEN',
  assigned_operator_id: assigned,
  business_date: '2026-01-01',
  opened_at: new Date().toISOString(),
  closed_at: null,
})

describe('treasury page (unified cash module)', () => {
  beforeEach(() => {
    authState.user = { role: 'TESORERO', operator_id: 'operator-1' }
    mocks.query = { data: { items: [] }, isPending: false, isError: false, refetch: vi.fn() }
    mocks.detailQuery = {
      data: { opening_tenders: { CASH: 0 }, expected_tenders: { CASH: 0 }, movements: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
    mocks.ensureOpenCashShift.mockReset()
    mocks.ensureOpenCashShift.mockResolvedValue(openShift())
    mocks.closeCashShift.mockReset()
    mocks.forceCloseCashShift.mockReset()
    window.sessionStorage.clear()
    navigationMocks.params = new URLSearchParams()
    navigationMocks.push.mockReset()
  })

  it('auto-opens the working period when the operator has no open shift', async () => {
    render(<TreasuryPage />)
    await waitFor(() => expect(mocks.ensureOpenCashShift).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.query.refetch).toHaveBeenCalled())
  })

  it('does not ensure-open again while the own open shift exists', async () => {
    mocks.query.data = { items: [openShift()] }
    render(<TreasuryPage />)
    await waitFor(() => expect(screen.getByText('Tenés un turno abierto en front.')))
    expect(mocks.ensureOpenCashShift).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cortar caja' })).toBeEnabled()
  })

  it('keeps the empty state graceful when ensure-open fails', async () => {
    mocks.ensureOpenCashShift.mockRejectedValueOnce(new Error('offline'))
    render(<TreasuryPage />)
    await waitFor(() => expect(mocks.ensureOpenCashShift).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(
        'No se pudo preparar tu caja. Verificá tu conexión e intentá de nuevo.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Tu caja se abre sola con el primer movimiento del período.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cortar caja' })).not.toBeInTheDocument()
    // The failed auto-open is retryable from the surfaced alert.
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(mocks.ensureOpenCashShift).toHaveBeenCalledTimes(2))
  })

  it('returns only validated cash context when an eligible shift is available', () => {
    const memberId = '00000000-0000-4000-8000-000000000001'
    const obligationId = '00000000-0000-4000-8000-000000000002'
    navigationMocks.params = new URLSearchParams(
      `cash_member=${memberId}&cash_obligations=${obligationId}`,
    )
    mocks.query.data = { items: [openShift()] }
    render(<TreasuryPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a cobranza' }))
    expect(navigationMocks.push).toHaveBeenCalledWith(
      `/collections?cash_member=${memberId}&cash_obligations=${obligationId}`,
    )
  })

  it('renders accessible loading and error states', () => {
    mocks.query = { data: undefined, isPending: true, isError: true, refetch: vi.fn() }
    render(<TreasuryPage />)
    expect(screen.getByText('Cargando turnos de caja…')).toBeInTheDocument()
    expect(screen.getByText('No se pudieron cargar los turnos de caja.')).toBeInTheDocument()
    // The initial-load failure offers a retry instead of a dead end.
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1)
  })

  it('clamps the drawer float when the counted cash drops below the prefill', async () => {
    openCorte()
    const dialog = screen.getByRole('dialog')
    const float = within(dialog).getByLabelText('Dejás en cajón (para vuelto)')
    expect(float).toHaveValue('26,00')
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
        target: { value: '10,00' },
      })
    })
    expect(float).toHaveValue('10,00')
  })

  const openCorte = () => {
    mocks.query.data = { items: [openShift('cash-summary')] }
    mocks.detailQuery.data = {
      opening_tenders: { CASH: 0 },
      expected_tenders: { CASH: 2600 },
      movements: [],
    }
    render(<TreasuryPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Cortar caja' }))
  }

  it('corte shows the server-expected cash and prefills the drawer float with it', () => {
    openCorte()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Efectivo esperado:\s*\$\s*26,00/)).toBeInTheDocument()
    const float = within(dialog).getByLabelText('Dejás en cajón (para vuelto)')
    expect(float).toHaveValue('26,00')
    // Everything stays in the drawer by default: with the counted cash matching the
    // expectation, nothing sweeps until the operator lowers the float.
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '26,00' },
    })
    expect(within(dialog).getByText(/A Valores a Depositar:/)).toHaveTextContent('$ 0,00')
  })

  it('corte sweeps expected minus float and submits exact cents', async () => {
    openCorte()
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '25,50' },
    })
    fireEvent.change(within(dialog).getByLabelText('Dejás en cajón (para vuelto)'), {
      target: { value: '25' },
    })
    expect(within(dialog).getByText(/A Valores a Depositar:/)).toHaveTextContent('$ 0,50')
    // Counted 25,50 vs expected 26,00 is a 0,50 shortage: the reason becomes mandatory.
    expect(screen.getByRole('button', { name: 'Confirmar corte' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/Motivo de diferencia/), {
      target: { value: 'Control manual' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar corte' }))
    await waitFor(() =>
      expect(mocks.closeCashShift).toHaveBeenCalledWith(
        'cash-summary',
        { CASH: 2550 },
        'Control manual',
        expect.any(String),
        2500,
      ),
    )
  })

  it('corte rejects a float above the counted cash before calling the API', () => {
    openCorte()
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '10' },
    })
    fireEvent.change(within(dialog).getByLabelText('Dejás en cajón (para vuelto)'), {
      target: { value: '20' },
    })
    // Counting under the expectation requires a reason before the button enables.
    fireEvent.change(within(dialog).getByLabelText(/Motivo de diferencia/), {
      target: { value: 'Control manual' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar corte' }))
    // Two alerts render: the discrepancy warning plus the command error.
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) =>
          alert.textContent?.includes(
            'El efectivo que dejás en cajón no puede superar lo contado.',
          ),
        ),
    ).toBe(true)
    expect(mocks.closeCashShift).not.toHaveBeenCalled()
  })

  it('corte differentiates an illegible server response from a generic failure', async () => {
    mocks.closeCashShift.mockRejectedValueOnce(
      new ApiError(200, 'MALFORMED_RESPONSE', 'La respuesta del servidor no se pudo interpretar.'),
    )
    openCorte()
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '26,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar corte' }))
    expect(
      await screen.findByText('El servidor respondió con datos ilegibles. Reintentá la operación.'),
    ).toBeInTheDocument()
  })

  it('corte differentiates a connection failure from a server rejection', async () => {
    mocks.closeCashShift.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    openCorte()
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '26,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar corte' }))
    expect(
      await screen.findByText(
        'No hay conexión con el servidor. Verificá tu red e intentá de nuevo.',
      ),
    ).toBeInTheDocument()
  })

  it('formats counted pesos without changing the editable amount inside the corte', async () => {
    openCorte()
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Efectivo contado (pesos)')
    fireEvent.change(input, { target: { value: '15600' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('15.600,00')
    // PesoAmountInput restores the raw value in a queueMicrotask: act flushes it.
    await act(async () => {
      fireEvent.focus(input)
    })
    expect(input).toHaveValue('15600')
  })

  it('surfaces a confirmed corte whose refresh failed and blocks resubmission', async () => {
    mocks.closeCashShift.mockResolvedValueOnce({ discrepancy: {} })
    // Every refetch fails (deterministic: the auto-open effect shares the refetch mock, so
    // Once-chains would race it).
    mocks.query.refetch.mockRejectedValue(new Error('Offline'))
    openCorte()
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '26,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar corte' }))

    const warning = 'La operación está confirmada, pero no se pudieron actualizar los turnos.'
    await screen.findByText(warning)
    expect(screen.queryByText('No se pudo ejecutar la operación de caja.')).not.toBeInTheDocument()
    // Resubmission is blocked: the corte modal closed and the period section is gone until
    // the next auto-open lands.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar corte' })).not.toBeInTheDocument()
    expect(mocks.closeCashShift).toHaveBeenCalledTimes(1)
    // The failed refresh is retryable and stays failed without re-running the command.
    const retry = screen.getByRole('button', { name: 'Actualizar turnos' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(retry).toBeEnabled())
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(mocks.closeCashShift).toHaveBeenCalledTimes(1)
  })

  it('lists only the operator own cortes in the closed history', () => {
    authState.user = { role: 'OPERADOR', operator_id: 'operator-1' }
    mocks.query.data = {
      items: [
        {
          id: 'own-closed',
          desk_id: 'front',
          status: 'CLOSED',
          assigned_operator_id: 'operator-1',
          business_date: '2026-01-01',
          opened_at: '2026-01-01T09:00:00Z',
          closed_at: '2026-01-01T20:00:00Z',
        },
        {
          id: 'foreign-closed',
          desk_id: 'back',
          status: 'CLOSED',
          assigned_operator_id: 'operator-2',
          business_date: '2026-01-01',
          opened_at: '2026-01-01T09:00:00Z',
          closed_at: '2026-01-01T20:00:00Z',
        },
      ],
    }
    render(<TreasuryPage />)
    const history = screen.getByRole('region', { name: 'Cortes del día' })
    expect(within(history).getByText('front')).toBeInTheDocument()
    expect(within(history).queryByText('back')).not.toBeInTheDocument()
    expect(
      within(history).getByRole('button', { name: 'Ver conciliación de front' }),
    ).toBeInTheDocument()
    // Structured card: business date and a short folio instead of the raw shift UUID.
    expect(within(history).getByText(/Turno del 2026-01-01/)).toBeInTheDocument()
    expect(within(history).getByText(/folio own-clos/)).toBeInTheDocument()
    expect(within(history).queryByText(/· own-closed/)).not.toBeInTheDocument()
  })

  it('offers the recovery section to finance roles only', () => {
    mocks.query.data = { items: [openShift()] }
    const firstView = render(<TreasuryPage />)
    expect(
      screen.getByRole('region', { name: 'Recuperación de turnos vencidos' }),
    ).toBeInTheDocument()
    firstView.unmount()

    authState.user = { role: 'OPERADOR', operator_id: 'operator-1' }
    mocks.query.data = { items: [openShift()] }
    render(<TreasuryPage />)
    expect(
      screen.queryByRole('region', { name: 'Recuperación de turnos vencidos' }),
    ).not.toBeInTheDocument()
  })

  it('directs an OPERADOR with an expired Caja to finance without offering recovery', () => {
    authState.user = { role: 'OPERADOR', operator_id: 'operator-1' }
    mocks.query.data = {
      items: [
        {
          ...openShift('own-expired'),
          opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
      ],
    }
    render(<TreasuryPage />)

    expect(
      screen.getByText(/Tu turno en front está vencido\. Pedí la recuperación a Finanzas\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cortar caja' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /recuperar turno vencido/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps a foreign Caja out of an OPERADOR read', async () => {
    authState.user = { role: 'OPERADOR', operator_id: 'operator-1' }
    mocks.query.data = { items: [openShift('foreign-open', 'operator-2')] }
    render(<TreasuryPage />)

    expect(
      await screen.findByText('Tu caja se abre sola con el primer movimiento del período.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/back/)).not.toBeInTheDocument()
  })

  it('keeps expired recovery separate and requires counted cash plus a reason', async () => {
    const shift = {
      ...openShift('expired-1'),
      opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    }
    mocks.query.data = { items: [shift] }
    mocks.forceCloseCashShift.mockResolvedValue({ discrepancy: {} })
    render(<TreasuryPage />)

    expect(screen.getByRole('button', { name: /recuperar turno vencido/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /confirmar recuperación/i })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '0' },
    })
    fireEvent.change(screen.getByLabelText('Motivo de recuperación'), {
      target: { value: 'Sin atención' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() =>
      expect(mocks.forceCloseCashShift).toHaveBeenCalledWith(
        'expired-1',
        { CASH: 0 },
        'Sin atención',
        expect.any(String),
      ),
    )
  })

  it('offers the movement modals with the direction implied by the opening button', () => {
    mocks.query.data = { items: [openShift()] }
    render(<TreasuryPage />)
    expect(screen.getByRole('button', { name: '+ Cargar Ingreso' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Cargar Egreso' })).toBeInTheDocument()
    expect(
      screen.queryByRole('form', { name: 'Registrar movimiento manual' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Cargar Egreso' }))
    expect(screen.getByRole('form', { name: 'Registrar movimiento manual' })).toBeInTheDocument()
    expect(screen.getByText(/no integra con el banco/i)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Egreso' })).not.toBeInTheDocument()
  })

  it('renders an accessible disabled fallback when the server gate is off', () => {
    render(
      <FeatureConfigProvider cashEnabled={false}>
        <TreasuryPage />
      </FeatureConfigProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('deshabilitada')
  })

  it.each([
    [
      'the current user changes',
      () => {
        authState.user = { role: 'TESORERO', operator_id: 'operator-2' }
      },
    ],
    [
      'the shift is no longer open',
      () => {
        mocks.query.data = {
          items: [
            {
              ...openShift('expired-current-1'),
              status: 'CLOSED' as const,
              opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
            },
          ] as CashShift[],
        }
      },
    ],
    [
      'the shift is removed from the current list',
      () => {
        mocks.query.data = { items: [] }
      },
    ],
  ])(
    'does not force-close when %s after recovery confirmation opens',
    async (_scenario, change) => {
      const recoveryShift = {
        ...openShift('expired-current-1'),
        opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }
      mocks.query.data = { items: [recoveryShift] }
      const view = render(<TreasuryPage />)

      fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido/i }))
      fireEvent.change(screen.getByLabelText('Motivo de recuperación'), {
        target: { value: 'Sin atención' },
      })
      fireEvent.change(screen.getByLabelText('Efectivo contado (pesos)'), {
        target: { value: '0' },
      })
      change()
      view.rerender(<TreasuryPage />)
      if (_scenario === 'the current user changes') {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      } else {
        fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
        expect(screen.getByRole('alert')).toHaveTextContent(/ya no está disponible/i)
      }
      await waitFor(() => expect(mocks.forceCloseCashShift).not.toHaveBeenCalled())
    },
  )

  it('shows recovery loading and error states without closing the confirmation dialog', async () => {
    const shift = {
      ...openShift('expired-2'),
      opened_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    }
    let rejectRecovery: (error: Error) => void = () => undefined
    mocks.query.data = { items: [shift] }
    mocks.forceCloseCashShift.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRecovery = reject
      }),
    )
    render(<TreasuryPage />)
    fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido/i }))
    fireEvent.change(screen.getByLabelText('Motivo de recuperación'), {
      target: { value: 'Registro de auditoría' },
    })
    fireEvent.change(screen.getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '0' },
    })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(screen.getByRole('button', { name: /recuperando/i })).toBeDisabled()
    rejectRecovery(new Error('recovery failed'))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'No se pudo ejecutar la operación de caja.',
      ),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
