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
    expect(screen.getByRole('heading', { name: 'Cash desk' })).toBeInTheDocument()
    expect(screen.getByLabelText('Desk')).toBeInTheDocument()
    expect(screen.getByText('No shifts')).toBeInTheDocument()
  })

  it('renders accessible loading and error states', () => {
    mocks.query = { data: undefined, isPending: true, isError: true, refetch: vi.fn() }
    render(<TreasuryPage />)
    expect(screen.getByText('Loading cash shifts…')).toBeInTheDocument()
    expect(screen.getByText('Unable to load cash shifts.')).toBeInTheDocument()
  })

  it('surfaces command failures without an unhandled rejection', async () => {
    mocks.openCashShift.mockRejectedValueOnce(new Error('open failed'))
    render(<TreasuryPage />)
    fireEvent.submit(screen.getByRole('form', { name: 'Open cash shift' }))
    await waitFor(() => expect(screen.getByText('open failed')).toBeInTheDocument())
  })

  it('renders an accessible disabled fallback when the server gate is off', () => {
    render(
      <FeatureConfigProvider cashEnabled={false}>
        <TreasuryPage />
      </FeatureConfigProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('disabled')
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

    expect(screen.getByRole('button', { name: /recover expired shift/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^close front$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /recover expired shift/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /confirm recovery/i })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Recovery reason'), { target: { value: 'Unattended' } })
    expect(confirm).toBeEnabled()
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() =>
      expect(mocks.forceCloseCashShift).toHaveBeenCalledWith(
        'expired-1',
        { CASH: 0 },
        'Unattended',
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
    fireEvent.click(screen.getByRole('button', { name: /recover expired shift/i }))
    fireEvent.change(screen.getByLabelText('Recovery reason'), { target: { value: 'Audit trail' } })
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(screen.getByRole('button', { name: /recovering/i })).toBeDisabled()
    rejectRecovery(new Error('recovery failed'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('recovery failed'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
