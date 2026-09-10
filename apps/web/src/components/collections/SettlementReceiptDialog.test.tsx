import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettlementDetail } from '@/lib/api/settlement-detail'
import { SettlementReceiptDialog } from './SettlementReceiptDialog'

const { getSettlementDetail } = vi.hoisted(() => ({ getSettlementDetail: vi.fn() }))
vi.mock('@/lib/api/settlement-detail', () => ({ getSettlementDetail }))
const memberId = '00000000-0000-4000-8000-000000000010'
const settlementId = '00000000-0000-4000-8000-000000000014'
const actorId = '00000000-0000-4000-8000-000000000001'
const nextId = '00000000-0000-4000-8000-000000000020'
const facts = (overrides: Partial<SettlementDetail> = {}): SettlementDetail => ({
  settlement_id: settlementId,
  socio_id: memberId,
  member: { id: memberId, numero_socio: '42', nombre: 'Ana', apellido: 'Pérez' },
  confirmed_at: '2026-08-19T12:30:00.000Z',
  amount_cents: 2600,
  currency: 'ARS',
  tender: 'CASH',
  allocations: [
    {
      id: nextId,
      obligation_id: nextId,
      period_start: '2026-07-01',
      period_end: '2026-08-01',
      amount_cents: 2600,
    },
  ],
  reversal: null,
  ...overrides,
})
const props = { open: true, onClose: vi.fn(), memberId, settlementId, actorId, role: 'TESORERO' }
function setup(overrides: Partial<typeof props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <>
      <main>Administración privada</main>
      <SettlementReceiptDialog {...props} {...overrides} />
    </>,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
}

function mockPrintDocument(width = () => 160) {
  vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockImplementation(function (
    this: HTMLIFrameElement,
  ) {
    return new DOMParser().parseFromString(this.srcdoc, 'text/html')
  })
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(width)
}

describe('SettlementReceiptDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    getSettlementDetail.mockReset()
    props.onClose.mockReset()
  })

  it.each([false, true])(
    'renders current identity and stored facts, reversed=%s',
    async (reversed) => {
      getSettlementDetail.mockResolvedValue(
        facts({
          reversal: reversed
            ? { settlement_id: nextId, confirmed_at: '2026-08-20T09:00:00.000Z' }
            : null,
        }),
      )
      setup()
      expect(screen.getByRole('status')).toHaveTextContent('Cargando constancia de pago')
      expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
      await screen.findByText('Ana Pérez')
      const dialog = screen.getByRole('dialog', { name: 'Constancia de pago no fiscal' })
      expect(dialog).toHaveTextContent('Datos actuales del socio')
      expect(dialog).toHaveTextContent('Club Atlético Gorriti')
      expect(screen.getByRole('img', { name: 'Escudo de Club Atlético Gorriti' })).toHaveAttribute(
        'src',
        '/escudo.jpg',
      )
      expect(screen.getByRole('columnheader', { name: 'Período' })).toBeInTheDocument()
      expect(dialog).toHaveTextContent(settlementId)
      expect(dialog).toHaveTextContent('42')
      expect(dialog).toHaveTextContent(/\$\s*26,00/)
      expect(dialog).toHaveTextContent('Efectivo')
      expect(dialog).toHaveTextContent('01/07/2026')
      expect(dialog).toHaveTextContent('31/07/2026')
      expect(dialog).toHaveTextContent('09:30')
      expect(Boolean(screen.queryByText('Pago revertido'))).toBe(reversed)
      expect(getSettlementDetail).toHaveBeenCalledWith(settlementId, memberId)
    },
  )

  it('keeps failed data hidden and retries only the read', async () => {
    getSettlementDetail
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(facts())
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la constancia de pago.',
    )
    expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    expect(getSettlementDetail).toHaveBeenCalledTimes(1)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument()
    expect(getSettlementDetail).toHaveBeenCalledTimes(2)
  })

  it.each([{ role: 'OPERADOR' }, { actorId: '' }, { open: false }])(
    'does not request unauthorized or closed data: %j',
    (override) => {
      setup(override)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(getSettlementDetail).not.toHaveBeenCalled()
    },
  )

  it.each(['memberId', 'settlementId', 'actorId', 'role'] as const)(
    'isolates a late result after %s changes',
    async (key) => {
      let resolveOld!: (value: SettlementDetail) => void
      const next = { ...props, [key]: key === 'role' ? 'ADMIN' : nextId }
      getSettlementDetail
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve
            }),
        )
        .mockResolvedValueOnce(
          facts({
            settlement_id: next.settlementId,
            socio_id: next.memberId,
            member: { id: next.memberId, numero_socio: '99', nombre: 'Bea', apellido: 'López' },
          }),
        )
      const { rerender } = setup()
      rerender(<SettlementReceiptDialog {...next} />)
      await screen.findByText('Bea López')
      await act(async () => {
        resolveOld(facts())
      })
      expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument()
      expect(getSettlementDetail).toHaveBeenCalledTimes(2)
    },
  )

  it('does not reopen after a pending read resolves on close', async () => {
    let finish!: (value: SettlementDetail) => void
    getSettlementDetail.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { rerender } = setup()
    rerender(<SettlementReceiptDialog {...props} open={false} />)
    await act(async () => {
      finish(facts())
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuses a broken logo and retries printing without reading or charging again', async () => {
    let width = 0
    mockPrintDocument(() => width)
    const print = vi.fn()
    const child = Object.assign(new EventTarget(), { print }) as unknown as Window
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(child)
    getSettlementDetail.mockResolvedValue(facts())
    setup()
    await screen.findByText('Ana Pérez')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir la impresión')
    expect(print).not.toHaveBeenCalled()
    expect(screen.queryByTestId('settlement-receipt-print')).not.toBeInTheDocument()
    width = 160
    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(getSettlementDetail).toHaveBeenCalledTimes(1)
    act(() => {
      child.dispatchEvent(new Event('afterprint'))
    })
  })

  it('reports a stalled print document instead of waiting indefinitely', async () => {
    getSettlementDetail.mockResolvedValue(facts())
    setup()
    await screen.findByText('Ana Pérez')
    // A disconnected frame never loads; emulate a stalled image/document request.
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
      act(() => {
        vi.advanceTimersByTime(8000)
      })
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo abrir la impresión')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['close', 'actor', 'loaded'])(
    'clears the print deadline and ignores stale loads after %s',
    async (transition) => {
      mockPrintDocument()
      const print = vi.fn()
      const child = Object.assign(new EventTarget(), { print }) as unknown as Window
      vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(child)
      getSettlementDetail.mockResolvedValue(facts())
      const { rerender } = setup()
      await screen.findByText('Ana Pérez')
      let frame!: HTMLIFrameElement
      const append = document.body.appendChild.bind(document.body)
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLIFrameElement) {
          frame = node
          return node
        }
        return append(node)
      })
      vi.useFakeTimers()
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
        const load = frame.onload
        await act(async () => {
          if (transition === 'close') rerender(<SettlementReceiptDialog {...props} open={false} />)
          if (transition === 'actor')
            rerender(<SettlementReceiptDialog {...props} actorId={nextId} />)
        })
        act(() => {
          load?.call(frame, new Event('load'))
        })
        act(() => {
          vi.advanceTimersByTime(8000)
        })
        expect(print).toHaveBeenCalledTimes(transition === 'loaded' ? 1 : 0)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('prints only escaped receipt content and removes the owned frame', async () => {
    mockPrintDocument()
    const print = vi.fn()
    const child = Object.assign(new EventTarget(), { print }) as unknown as Window
    vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(child)
    getSettlementDetail.mockResolvedValue(
      facts({
        member: { id: memberId, numero_socio: '<img>', nombre: '<Ana>', apellido: 'Pérez' },
      }),
    )
    const { rerender } = setup()
    await screen.findByText('<Ana> Pérez')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    const frame = screen.getByTestId('settlement-receipt-print') as HTMLIFrameElement
    expect(frame.srcdoc).toContain('Constancia de pago no fiscal')
    expect(frame.srcdoc).toContain('&lt;Ana&gt;')
    expect(frame.srcdoc).not.toContain('Administración privada')
    expect(frame.srcdoc).toContain('&lt;img&gt;')
    const printed = new DOMParser().parseFromString(frame.srcdoc, 'text/html')
    expect(printed.querySelectorAll('img')).toHaveLength(1)
    expect(printed.querySelector('img')?.getAttribute('src')).toBe('/escudo.jpg')
    expect(frame.srcdoc).toContain('Club Atlético Gorriti')
    expect(frame.srcdoc).toContain('size: A4; margin: 18mm;')
    expect(frame.srcdoc).toContain('table-header-group')
    expect(frame.srcdoc).not.toContain('<button')
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    act(() => {
      frame.contentWindow!.dispatchEvent(new Event('afterprint'))
    })
    expect(screen.queryByTestId('settlement-receipt-print')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(screen.getByTestId('settlement-receipt-print')).toBeInTheDocument()
    rerender(<SettlementReceiptDialog {...props} open={false} />)
    expect(screen.queryByTestId('settlement-receipt-print')).not.toBeInTheDocument()
  })
})
