import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CtacteComprobanteButton } from './CtacteComprobanteButton'

/**
 * CtacteComprobanteButton tests (PR A2 — athlos-ctacte-mutations).
 *
 * Tests:
 *   - click opens date-range modal
 *   - submit happy path → getCtacteComprobanteUrl called with correct args
 *     → window.open invoked with '_blank' + 'noopener,noreferrer' + blob URL
 *   - submit error → notify('error')
 *   - missing from/to → inline error
 *   - from > to → inline error
 *   - vi.mock synchronous factory
 */

const getCtacteComprobanteUrlMock = vi.fn()
const apiFetchBlobMock = vi.fn()
const notifyMock = vi.fn()
const windowOpenMock = vi.fn()
const urlCreateObjectURLMock = vi.fn()
const urlRevokeObjectURLMock = vi.fn()

vi.mock('@/lib/api/ctacte-mutations', () => ({
  getCtacteComprobanteUrl: (...args: unknown[]) => getCtacteComprobanteUrlMock(...args),
}))

vi.mock('@/lib/api', () => ({
  apiFetchBlob: (...args: unknown[]) => apiFetchBlobMock(...args),
}))

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const CUENTA = 'cta-001'

describe('CtacteComprobanteButton', () => {
  beforeEach(() => {
    // Reset only the mocks that all tests need fresh; tests that want specific
    // behaviors (like rejection) set their own mockReturnValueOnce / mockRejectedValueOnce
    notifyMock.mockReset()
    urlCreateObjectURLMock.mockReset()
    urlRevokeObjectURLMock.mockReset()
    windowOpenMock.mockReset()

    // Default returns for shared mocks (tests override as needed)
    getCtacteComprobanteUrlMock.mockReturnValue(
      'http://localhost:3000/api/v1/socios/' +
        SOCIO_ID +
        '/ctacte/comprobante.pdf?from=2026-01-01&to=2026-06-30&cuenta=cta-001',
    )
    apiFetchBlobMock.mockReturnValue(
      Promise.resolve(new Blob(['PDF content'], { type: 'application/pdf' })),
    )
    urlCreateObjectURLMock.mockReturnValue('blob:http://localhost:3000/generated-url')
    urlRevokeObjectURLMock.mockResolvedValue(undefined)

    // jsdom's window.open returns null silently — replace with our spy.
    // @ts-expect-error — replacing a readonly property in test environment
    window.open = windowOpenMock as typeof window.open
    // jsdom doesn't implement URL.createObjectURL — polyfill directly.
    // @ts-expect-error — augmenting the URL global in test environment
    ;(
      URL as {
        createObjectURL: typeof urlCreateObjectURLMock
        revokeObjectURL: typeof urlRevokeObjectURLMock
      }
    ).createObjectURL = urlCreateObjectURLMock
    // @ts-expect-error — augmenting the URL global in test environment
    ;(
      URL as {
        createObjectURL: typeof urlCreateObjectURLMock
        revokeObjectURL: typeof urlRevokeObjectURLMock
      }
    ).revokeObjectURL = urlRevokeObjectURLMock
  })

  it('renders the button with Printer icon and correct text', () => {
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    const btn = screen.getByTestId('ctacte-comprobante-btn')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent(/reimprimir comprobante/i)
  })

  it('click opens the date-range modal', async () => {
    const user = userEvent.setup()
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    expect(screen.getByTestId('ctacte-comprobante-modal')).toBeInTheDocument()
  })

  it('shows inline error when from date is missing', async () => {
    const user = userEvent.setup()
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    // Fill only "to"
    await user.type(screen.getByLabelText(/hasta/i), '2026-06-30')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/desde.*obligatoria/i)
    })
  })

  it('shows inline error when to date is missing', async () => {
    const user = userEvent.setup()
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-01-01')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/hasta.*obligatoria/i)
    })
  })

  it('shows inline error when from > to', async () => {
    const user = userEvent.setup()
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-06-30')
    await user.type(screen.getByLabelText(/hasta/i), '2026-01-01')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/mayor o igual/i)
    })
  })

  it('calls getCtacteComprobanteUrl and window.open with blob URL on success', async () => {
    const user = userEvent.setup()
    apiFetchBlobMock.mockResolvedValueOnce(new Blob(['PDF content'], { type: 'application/pdf' }))
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-01-01')
    await user.type(screen.getByLabelText(/hasta/i), '2026-06-30')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(getCtacteComprobanteUrlMock).toHaveBeenCalledWith(
        SOCIO_ID,
        CUENTA,
        '2026-01-01',
        '2026-06-30',
      )
    })
    await waitFor(() => {
      expect(windowOpenMock).toHaveBeenCalledWith(
        'blob:http://localhost:3000/generated-url',
        '_blank',
        'noopener,noreferrer',
      )
    })
    expect(notifyMock).toHaveBeenCalledWith('success', 'Comprobante generado')
  })

  it('calls notify("error") on network failure', async () => {
    const user = userEvent.setup()
    apiFetchBlobMock.mockRejectedValueOnce(new Error('Network error'))
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-01-01')
    await user.type(screen.getByLabelText(/hasta/i), '2026-06-30')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith(
        'error',
        'No se pudo generar el comprobante. Intentá de nuevo.',
      )
    })
    expect(windowOpenMock).not.toHaveBeenCalled()
  })
})
