import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TreasuryPage from './page'
import { FeatureConfigProvider } from '@/lib/features'
import type { CashShift } from '@/lib/api/treasury'

const authState = vi.hoisted(() => ({ user: { role: 'TESORERO', operator_id: 'operator-1' } }))
vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: authState.user }) }))
const mocks = vi.hoisted(() => ({
  getCashShifts: vi.fn(),
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
    mocks.forceCloseCashShift.mockReset()
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
      fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)

      await waitFor(() => expect(mocks.forceCloseCashShift).not.toHaveBeenCalled())
      expect(screen.getByRole('alert')).toHaveTextContent(/ya no está disponible/i)
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
