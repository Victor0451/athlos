import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TreasuryPage from './page'
import { FeatureConfigProvider } from '@/lib/features'
import type { CashShift } from '@/lib/api/treasury'

vi.mock('@/lib/use-auth', () => ({ useAuth: () => ({ user: { role: 'TESORERO' } }) }))
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

  it('keeps expired recovery separate and requires confirmation plus a reason', async () => {
    const shift = {
      id: 'expired-1',
      desk_id: 'front',
      status: 'OPEN' as const,
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
    expect(screen.queryByRole('button', { name: /^cerrar front$/i })).not.toBeInTheDocument()
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

  it('shows recovery loading and error states without closing the confirmation dialog', async () => {
    const shift = {
      id: 'expired-2',
      desk_id: 'back-office',
      status: 'OPEN' as const,
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
