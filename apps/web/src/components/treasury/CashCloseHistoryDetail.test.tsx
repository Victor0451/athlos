// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CashShift } from '@/lib/api/treasury'
import { CashCloseHistoryDetail } from './CashCloseHistoryDetail'

const { getDetail } = vi.hoisted(() => ({ getDetail: vi.fn() }))
vi.mock('@/lib/api/treasury', () => ({ getCashShiftDetail: getDetail }))
const shift: CashShift = {
  id: 'historic-1',
  desk_id: 'front',
  status: 'CLOSED',
  assigned_operator_id: 'other',
  business_date: '2026-08-19',
  opened_at: '2026-08-19T10:00:00Z',
  closed_at: '2026-08-19T12:00:00Z',
}
const close = {
  id: 'close-1',
  shift_id: shift.id,
  expected_tenders: { CASH: 2600 },
  counted_tenders: { CASH: 2550 },
  discrepancy: { CASH: -50 },
  reason: 'Counted short',
  closed_at: shift.closed_at!,
  force_close: true,
}
const props = { shift, actorId: 'reader', role: 'TESORERO' }
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<CashCloseHistoryDetail {...props} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe('Historical reconciliation', () => {
  beforeEach(() => {
    getDetail.mockReset()
  })

  it.each([false, true, null])(
    'reads a foreign shift on demand, forced=%s, and restores focus',
    async (forceClose) => {
      getDetail.mockResolvedValue({
        shift,
        close: forceClose === null ? null : { ...close, force_close: forceClose },
      })
      const user = userEvent.setup()
      setup()
      const opener = screen.getByRole('button', { name: 'Ver conciliación de front' })
      expect(getDetail).not.toHaveBeenCalled()
      await user.click(opener)
      if (forceClose === null) {
        expect(
          await screen.findByText('El cierre no tiene una conciliación disponible.'),
        ).toBeInTheDocument()
        expect(screen.queryByText(/Efectivo esperado/)).not.toBeInTheDocument()
      } else {
        expect(await screen.findByText('Counted short')).toBeInTheDocument()
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent(/\$\s*26,00/)
        expect(dialog).toHaveTextContent(/\$\s*25,50/)
        expect(dialog).toHaveTextContent(/-\$\s*0,50/)
        expect(Boolean(screen.queryByText('Recuperación de turno vencido.'))).toBe(forceClose)
      }
      expect(getDetail).toHaveBeenCalledTimes(1)
      expect(getDetail).toHaveBeenCalledWith(shift.id)
      await user.click(screen.getByRole('button', { name: 'Cerrar detalle' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    },
  )

  it('allows an OPERADOR to read only an assigned closed shift', async () => {
    const ownShift = { ...shift, assigned_operator_id: 'reader' }
    getDetail.mockResolvedValue({ shift: ownShift, close })
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const { rerender } = render(
      <CashCloseHistoryDetail shift={ownShift} actorId="reader" role="OPERADOR" />,
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    )

    await user.click(screen.getByRole('button', { name: 'Ver conciliación de front' }))
    expect(await screen.findByText('Counted short')).toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledWith('historic-1')

    rerender(<CashCloseHistoryDetail {...props} actorId="next-reader" role="OPERADOR" />)
    expect(
      screen.queryByRole('button', { name: 'Ver conciliación de front' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledTimes(1)
    rerender(<CashCloseHistoryDetail shift={ownShift} actorId="next-reader" role="OPERADOR" />)
    expect(
      screen.queryByRole('button', { name: 'Ver conciliación de front' }),
    ).not.toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledTimes(1)
    rerender(<CashCloseHistoryDetail shift={ownShift} actorId="reader" role="OPERADOR" />)
    expect(screen.getByRole('button', { name: 'Ver conciliación de front' })).toBeInTheDocument()
    expect(getDetail).toHaveBeenLastCalledWith('historic-1')
  })

  it('retries only the failed detail GET on request', async () => {
    getDetail
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ shift, close })
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Ver conciliación de front' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la conciliación histórica.',
    )
    expect(getDetail).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Counted short')).toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledTimes(2)
  })

  it('isolates late responses by actor, role and selected shift', async () => {
    let resolveOld!: (value: unknown) => void
    getDetail
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce({ shift, close: null })
      .mockResolvedValueOnce({ shift, close })
      .mockResolvedValueOnce({ shift: { ...shift, id: 'historic-2' }, close: null })
    const user = userEvent.setup()
    const { rerender } = setup()
    await user.click(screen.getByRole('button', { name: 'Ver conciliación de front' }))
    expect(screen.getByRole('status')).toHaveTextContent('Cargando conciliación histórica')
    rerender(<CashCloseHistoryDetail {...props} actorId="next-reader" />)
    await screen.findByText('El cierre no tiene una conciliación disponible.')
    await act(async () => {
      resolveOld({ shift, close })
    })
    expect(screen.queryByText('Counted short')).not.toBeInTheDocument()
    rerender(<CashCloseHistoryDetail {...props} actorId="next-reader" role="ADMIN" />)
    await screen.findByText('Counted short')
    rerender(
      <CashCloseHistoryDetail
        {...props}
        actorId="next-reader"
        role="ADMIN"
        shift={{ ...shift, id: 'historic-2' }}
      />,
    )
    await screen.findByText('El cierre no tiene una conciliación disponible.')
    expect(screen.queryByText('Counted short')).not.toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledTimes(4)
    expect(getDetail).toHaveBeenLastCalledWith('historic-2')
  })
})
