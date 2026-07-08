import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * `EmitirSolicitudButton` tests (PR 8d.2, task B.2).
 *
 * Mock both side effects the component triggers on click:
 *   - `window.open` → spy on the jsdom global + replace with a
 *     no-op stub so the test runner doesn't crash (jsdom's
 *     `window.open` returns `null` by default).
 *   - `@/lib/notifications.notify` → synchronous factory per design
 *     D8+R4 from the `athlos-toast-primitivo` change, so we don't
 *     render a real `<ToasterMount />` or rely on sonner portals.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is stubbed to a deterministic value so
 * the URL assertion reads cleanly. The component reads it via the
 * `getFormUrl()` helper (B.1), not directly, so stubbing the env
 * is sufficient.
 *
 * Disabled-state coverage: a single truth-table assertion (click
 * on disabled button does NOT call `window.open` nor `notify`) —
 * sufficient because the underlying DOM `disabled` behavior is
 * provided by React/Testing Library.
 */

const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock-emit')
const openSpy = vi.fn(() => null)

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const { EmitirSolicitudButton } = await import('./EmitirSolicitudButton')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const API_BASE = 'http://localhost:3000'

describe('EmitirSolicitudButton', () => {
  beforeEach(() => {
    notifyMock.mockReset()
    notifyMock.mockReturnValue('toast-mock-emit')
    openSpy.mockReset()
    openSpy.mockReturnValue(null)
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', API_BASE)
    // jsdom's window.open returns null silently — replace so the
    // button's call lands in our spy without warnings.
    window.open = openSpy as unknown as typeof window.open
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('renders a button labeled "Emitir Solicitud" with a Printer icon', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    const btn = screen.getByRole('button', { name: /emitir solicitud/i })
    expect(btn).toBeInTheDocument()
    // The Printer icon must render as an SVG inside the button
    // (matching the lucide-react convention used elsewhere).
    expect(btn.querySelector('svg')).toBeInTheDocument()
  })

  it('opens the form PDF URL in a new tab on click', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    expect(openSpy).toHaveBeenCalledTimes(1)
    const call = openSpy.mock.calls[0] as readonly unknown[]
    const [url, target, features] = call
    expect(url).toBe(`${API_BASE}/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`)
    expect(target).toBe('_blank')
    expect(features).toBe('noopener,noreferrer')
  })

  it('fires an info toast on click so the operator gets immediate feedback', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    expect(notifyMock).toHaveBeenCalledWith('info', expect.stringMatching(/generando pdf/i))
  })

  it('does not call window.open or notify when the disabled prop is set', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} disabled />)
    const btn = screen.getByRole('button', { name: /emitir solicitud/i })
    expect(btn).toBeDisabled()
    // fireEvent.click skips disabled buttons (React suppresses the
    // event), so the side-effect counters stay zero.
    fireEvent.click(btn)
    expect(openSpy).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('passes the socioId through to the URL helper (different id → different URL)', () => {
    const OTHER_ID = 'Z9X8Y7W6-V5U4-T3S2-R1Q0-9876FE543210'
    render(<EmitirSolicitudButton socioId={OTHER_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    const call = openSpy.mock.calls[0] as readonly unknown[]
    const [url] = call
    expect(url).toBe(`${API_BASE}/api/v1/socios/${OTHER_ID}/forms/solicitud-inscripcion.pdf`)
  })
})
