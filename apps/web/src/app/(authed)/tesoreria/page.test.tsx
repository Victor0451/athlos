import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TreasuryPage from './page'
import { FeatureConfigProvider } from '@/lib/features'
import type { CashClose, CashShift } from '@/lib/api/treasury'

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
  openCashShift: vi.fn(),
  closeCashShift: vi.fn(),
  forceCloseCashShift: vi.fn(),
  query: {
    data: { items: [] as CashShift[] } as { items: CashShift[] } | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}))
vi.mock('@/lib/api/treasury', () => ({
  getCashShifts: mocks.getCashShifts,
  getCashShiftDetail: mocks.getCashShiftDetail,
  openCashShift: mocks.openCashShift,
  closeCashShift: mocks.closeCashShift,
  forceCloseCashShift: mocks.forceCloseCashShift,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.query,
}))

describe('treasury page', () => {
  beforeEach(() => {
    authState.user = { role: 'TESORERO', operator_id: 'operator-1' }
    mocks.query = { data: { items: [] }, isPending: false, isError: false, refetch: vi.fn() }
    mocks.openCashShift.mockReset()
    mocks.closeCashShift.mockReset()
    mocks.forceCloseCashShift.mockReset()
    window.sessionStorage.clear()
    navigationMocks.params = new URLSearchParams()
    navigationMocks.push.mockReset()
  })

  it('returns only validated cash context when an eligible shift is available', () => {
    const memberId = '00000000-0000-4000-8000-000000000001'
    const obligationId = '00000000-0000-4000-8000-000000000002'
    navigationMocks.params = new URLSearchParams(
      `cash_member=${memberId}&cash_obligations=${obligationId}`,
    )
    mocks.query.data = {
      items: [
        {
          id: 'shift-1',
          desk_id: 'front',
          status: 'OPEN',
          assigned_operator_id: 'operator-1',
          business_date: '2026-01-01',
          opened_at: new Date().toISOString(),
          closed_at: null,
        },
      ],
    }
    render(<TreasuryPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a cobranza' }))
    expect(navigationMocks.push).toHaveBeenCalledWith(
      `/collections?cash_member=${memberId}&cash_obligations=${obligationId}`,
    )
  })

  it('exposes labeled shift controls and a meaningful empty state', () => {
    render(<TreasuryPage />)
    expect(screen.getByRole('heading', { name: 'Caja' })).toBeInTheDocument()
    expect(screen.getByLabelText('Puesto')).toBeInTheDocument()
    expect(screen.getByText('No hay turnos.')).toBeInTheDocument()
  })

  it('renders accessible loading and error states', () => {
    mocks.query = { data: undefined, isPending: true, isError: true, refetch: vi.fn() }
    render(<TreasuryPage />)
    expect(screen.getByText('Cargando turnos de caja…')).toBeInTheDocument()
    expect(screen.getByText('No se pudieron cargar los turnos de caja.')).toBeInTheDocument()
  })

  it('surfaces command failures without an unhandled rejection', async () => {
    mocks.openCashShift.mockRejectedValueOnce(new Error('open failed'))
    render(<TreasuryPage />)
    fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
    await waitFor(() =>
      expect(screen.getByText('No se pudo ejecutar la operación de caja.')).toBeInTheDocument(),
    )
  })

  it.each(['resolved error', 'rejected promise'])(
    'keeps confirmed cash opening and return available after a %s refresh',
    async (failure) => {
      const memberId = '00000000-0000-4000-8000-000000000001'
      const obligationId = '00000000-0000-4000-8000-000000000002'
      navigationMocks.params = new URLSearchParams(
        `cash_member=${memberId}&cash_obligations=${obligationId}`,
      )
      mocks.openCashShift.mockResolvedValueOnce({
        id: 'shift-confirmed',
        desk_id: 'front-desk',
        status: 'OPEN',
        assigned_operator_id: 'operator-1',
        business_date: '2026-01-01',
        opened_at: new Date().toISOString(),
        closed_at: null,
      } satisfies CashShift)
      const error = new Error('Refresh unavailable')
      if (failure === 'resolved error') {
        mocks.query.refetch.mockResolvedValueOnce({ isError: true, error })
      } else {
        mocks.query.refetch.mockRejectedValueOnce(error)
      }
      render(<TreasuryPage />)
      fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))

      expect(
        await screen.findByText(
          'La operación está confirmada, pero no se pudieron actualizar los turnos.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('No se pudo ejecutar la operación de caja.'),
      ).not.toBeInTheDocument()
      const returnButton = screen.getByRole('button', { name: 'Volver a cobranza' })
      expect(returnButton).toBeEnabled()
      fireEvent.click(returnButton)
      expect(navigationMocks.push).toHaveBeenCalledWith(
        `/collections?cash_member=${memberId}&cash_obligations=${obligationId}`,
      )
      expect(mocks.openCashShift).toHaveBeenCalledTimes(1)
    },
  )

  it('blocks concurrent opening and reuses the key after an ambiguous failure', async () => {
    let reject!: (error: Error) => void
    mocks.openCashShift.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    render(<TreasuryPage />)
    const form = screen.getByRole('form', { name: 'Abrir turno de caja' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mocks.openCashShift).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeDisabled()
    const key = mocks.openCashShift.mock.calls[0]![2]
    reject(new Error('Connection lost'))
    await screen.findByText('No se pudo ejecutar la operación de caja.')
    mocks.openCashShift.mockRejectedValueOnce(new Error('Connection lost again'))
    fireEvent.submit(form)
    await waitFor(() => expect(mocks.openCashShift).toHaveBeenCalledTimes(2))
    expect(mocks.openCashShift.mock.calls[1]![2]).toBe(key)
  })

  it('does not let an older operator completion unlock a newer opening', async () => {
    let resolveOld!: (result: object) => void
    let rejectNew!: (error: Error) => void
    mocks.openCashShift
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectNew = reject
        }),
      )
    const view = render(<TreasuryPage />)
    fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
    authState.user = { role: 'TESORERO', operator_id: 'operator-2' }
    view.rerender(<TreasuryPage />)
    fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
    const oldKey = mocks.openCashShift.mock.calls[0]![2]
    expect(mocks.openCashShift.mock.calls[1]![2]).not.toBe(oldKey)
    await act(async () => {
      resolveOld({})
    })
    expect(screen.queryByText('Turno abierto.')).not.toBeInTheDocument()
    expect(mocks.query.refetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeDisabled()
    rejectNew(new Error('Unavailable'))
    await screen.findByText('No se pudo ejecutar la operación de caja.')
    expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeEnabled()
  })

  it.each(['open', 'close', 'recovery'] as const)(
    'reconciles a confirmed %s using GET only and blocks financial resubmission',
    async (action) => {
      const shift: CashShift = {
        id: 'shift-command',
        desk_id: 'front',
        status: 'OPEN',
        assigned_operator_id: 'operator-1',
        business_date: '2026-01-01',
        closed_at: null,
        opened_at: new Date(
          Date.now() - (action === 'recovery' ? 25 * 60 * 60 * 1000 : 0),
        ).toISOString(),
      }
      mocks.query.data = { items: action === 'open' ? [] : [shift] }
      const command =
        action === 'open'
          ? mocks.openCashShift
          : action === 'close'
            ? mocks.closeCashShift
            : mocks.forceCloseCashShift
      command.mockResolvedValueOnce(action === 'open' ? shift : { discrepancy: {} })
      mocks.query.refetch
        .mockResolvedValueOnce({ isError: true, error: new Error('Offline') })
        .mockRejectedValueOnce(new Error('Still offline'))
        .mockResolvedValueOnce({ isError: false })
      render(<TreasuryPage />)
      if (action === 'open')
        fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
      else if (action === 'close')
        fireEvent.click(screen.getByRole('button', { name: /cerrar front/i }))
      else {
        fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido front/i }))
        fireEvent.change(screen.getByLabelText('Motivo de recuperación'), {
          target: { value: 'Fin de turno' },
        })
        fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
      }
      const warning = 'La operación está confirmada, pero no se pudieron actualizar los turnos.'
      await screen.findByText(warning)
      expect(
        screen.queryByText('No se pudo ejecutar la operación de caja.'),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeDisabled()
      fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
      expect(mocks.openCashShift).toHaveBeenCalledTimes(action === 'open' ? 1 : 0)
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar turnos' }))
      await waitFor(() => expect(mocks.query.refetch).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Actualizar turnos' })).toBeEnabled(),
      )
      expect(screen.getByText(warning)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar turnos' }))
      await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument())
      expect(command).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: /cerrar front/i })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /recuperar turno vencido front/i }),
      ).not.toBeInTheDocument()
    },
  )

  it('does not use an opening snapshot after a fresh query reports it closed', async () => {
    navigationMocks.params = new URLSearchParams(
      'cash_member=00000000-0000-4000-8000-000000000001&cash_obligations=00000000-0000-4000-8000-000000000002',
    )
    const opened: CashShift = {
      id: 'recent',
      desk_id: 'front',
      status: 'OPEN',
      assigned_operator_id: 'operator-1',
      business_date: '2026-01-01',
      opened_at: new Date().toISOString(),
      closed_at: null,
    }
    mocks.openCashShift.mockResolvedValueOnce(opened)
    mocks.query.refetch.mockImplementationOnce(async () => {
      const data = { items: [{ ...opened, status: 'CLOSED' as const }] }
      mocks.query.data = data
      return { isError: false, data }
    })
    render(<TreasuryPage />)
    fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
    await screen.findByText('Turno abierto.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Volver a cobranza' })).not.toBeInTheDocument()
    expect(mocks.openCashShift).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['25,50', 2550],
    ['25.50', 2550],
    ['0,29', 29],
    ['0', 0],
  ])('converts opening pesos %s to %i cents without rounding', async (value, cents) => {
    mocks.openCashShift.mockRejectedValueOnce(new Error('Request interrupted'))
    render(<TreasuryPage />)
    fireEvent.change(screen.getByLabelText('Efectivo inicial (pesos)'), { target: { value } })
    fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
    await screen.findByText('No se pudo ejecutar la operación de caja.')
    expect(mocks.openCashShift).toHaveBeenCalledWith(
      'front-desk',
      { CASH: cents },
      expect.any(String),
    )
  })

  it.each(['', '-1', '1.001', '1e3', 'NaN', '90071992547409.92'])(
    'rejects invalid opening pesos %s before POST',
    (value) => {
      render(<TreasuryPage />)
      fireEvent.change(screen.getByLabelText('Efectivo inicial (pesos)'), { target: { value } })
      fireEvent.submit(screen.getByRole('form', { name: 'Abrir turno de caja' }))
      expect(screen.getByRole('alert')).toHaveTextContent(/importe.*pesos/i)
      expect(mocks.openCashShift).not.toHaveBeenCalled()
    },
  )

  it('shows server-confirmed cash reconciliation in pesos with its reason', async () => {
    mocks.query.data = {
      items: [
        {
          id: 'cash-summary',
          desk_id: 'front',
          status: 'OPEN',
          assigned_operator_id: 'operator-1',
          business_date: '2026-01-01',
          opened_at: new Date().toISOString(),
          closed_at: null,
        },
      ],
    }
    mocks.closeCashShift.mockResolvedValueOnce({
      id: 'close-summary',
      shift_id: 'cash-summary',
      expected_tenders: { CASH: 2600 },
      counted_tenders: { CASH: 2550 },
      discrepancy: { CASH: -50 },
      reason: 'Control manual',
      closed_at: '2026-01-01T20:00:00Z',
    } satisfies CashClose)
    render(<TreasuryPage />)
    fireEvent.change(screen.getByLabelText('Efectivo contado (pesos)'), {
      target: { value: '25,50' },
    })
    fireEvent.change(screen.getByLabelText('Motivo de diferencia'), {
      target: { value: 'Control manual' },
    })
    fireEvent.click(screen.getByRole('button', { name: /cerrar front/i }))
    const summary = await screen.findByRole('region', { name: 'Resumen de conciliación' })
    expect(within(summary).getByText(/\$\s*26,00/)).toBeInTheDocument()
    expect(within(summary).getByText(/\$\s*25,50/)).toBeInTheDocument()
    expect(within(summary).getByText(/-\$\s*0,50/)).toBeInTheDocument()
    expect(within(summary).getByText('Control manual')).toBeInTheDocument()
    expect(summary).toHaveTextContent('close-summary')
    expect(mocks.closeCashShift).toHaveBeenCalledWith(
      'cash-summary',
      { CASH: 2550 },
      'Control manual',
      expect.any(String),
    )
  })

  it('lists persisted closed shifts without inventing historical reconciliation totals', () => {
    mocks.query.data = {
      items: [
        {
          id: 'historical',
          desk_id: 'front-historic',
          status: 'CLOSED',
          assigned_operator_id: 'operator-2',
          business_date: '2026-01-01',
          opened_at: '2026-01-01T09:00:00Z',
          closed_at: '2026-01-01T20:00:00Z',
        },
      ],
    }
    render(<TreasuryPage />)
    const history = screen.getByRole('region', { name: 'Turnos cerrados' })
    expect(within(history).getByText('front-historic')).toBeInTheDocument()
    expect(history).toHaveTextContent('historical')
    expect(
      within(history).getByRole('button', { name: 'Ver conciliación de front-historic' }),
    ).toBeInTheDocument()
    expect(history).toHaveTextContent(/detalle histórico de conciliación/i)
    expect(
      screen.queryByRole('region', { name: 'Resumen de conciliación' }),
    ).not.toBeInTheDocument()
  })

  it('renders an accessible disabled fallback when the server gate is off', () => {
    render(
      <FeatureConfigProvider cashEnabled={false}>
        <TreasuryPage />
      </FeatureConfigProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('deshabilitada')
  })

  it('offers only the treasurer-owned current shift and labels it without naming an operator', () => {
    const opened_at = new Date().toISOString()
    mocks.query = {
      data: {
        items: [
          {
            id: 'own-1',
            desk_id: 'front',
            status: 'OPEN',
            assigned_operator_id: 'operator-1',
            opened_at,
          },
          {
            id: 'foreign-1',
            desk_id: 'back',
            status: 'OPEN',
            assigned_operator_id: 'operator-2',
            opened_at,
          },
        ] as CashShift[],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
    render(<TreasuryPage />)

    expect(screen.getByRole('button', { name: /cerrar front.*tu turno/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cerrar back/i })).not.toBeInTheDocument()
  })

  it('allows an ADMIN to close another responsible operator shift with a neutral label', () => {
    authState.user = { role: 'ADMIN', operator_id: 'operator-1' }
    mocks.query = {
      data: {
        items: [
          {
            id: 'foreign-1',
            desk_id: 'back',
            status: 'OPEN',
            assigned_operator_id: 'operator-2',
            opened_at: new Date().toISOString(),
          },
        ] as CashShift[],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
    render(<TreasuryPage />)

    expect(
      screen.getByRole('button', { name: /cerrar back.*otro responsable/i }),
    ).toBeInTheDocument()
  })

  it('keeps expired recovery separate and requires confirmation plus a reason', async () => {
    const shift = {
      id: 'expired-1',
      desk_id: 'front',
      status: 'OPEN' as const,
      assigned_operator_id: 'operator-1',
      opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    }
    mocks.query = {
      data: { items: [shift] as CashShift[] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
    mocks.forceCloseCashShift.mockResolvedValue({ discrepancy: {} })
    render(<TreasuryPage />)

    expect(screen.getByRole('button', { name: /recuperar turno vencido/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cerrar front/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /confirmar recuperación/i })
    expect(confirm).toBeDisabled()
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

  it.each([
    [
      'the current user changes',
      (_shift: CashShift) => {
        authState.user = { role: 'TESORERO', operator_id: 'operator-2' }
      },
    ],
    [
      'the shift is no longer open',
      (shift: CashShift) => {
        mocks.query.data = {
          items: [{ ...shift, status: 'CLOSED' }] as CashShift[],
        }
      },
    ],
    [
      'the shift is removed from the current list',
      (_shift: CashShift) => {
        mocks.query.data = { items: [] }
      },
    ],
  ])(
    'does not force-close when %s after recovery confirmation opens',
    async (_scenario, change) => {
      const recoveryShift = {
        id: 'expired-current-1',
        desk_id: 'front',
        status: 'OPEN' as const,
        assigned_operator_id: 'operator-1',
        business_date: '2026-02-01',
        opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        closed_at: null,
      }
      mocks.query = {
        data: { items: [recoveryShift] as CashShift[] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      }
      const view = render(<TreasuryPage />)

      fireEvent.click(screen.getByRole('button', { name: /recuperar turno vencido/i }))
      fireEvent.change(screen.getByLabelText('Motivo de recuperación'), {
        target: { value: 'Sin atención' },
      })
      change(recoveryShift)
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
      id: 'expired-2',
      desk_id: 'back-office',
      status: 'OPEN' as const,
      assigned_operator_id: 'operator-1',
      opened_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    }
    let rejectRecovery: (error: Error) => void = () => undefined
    mocks.query = {
      data: { items: [shift] as CashShift[] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
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
