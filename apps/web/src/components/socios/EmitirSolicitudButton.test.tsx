import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ApiModule from '@/lib/api'

/**
 * `EmitirSolicitudButton` tests (PR 8d.2, task B.2).
 *
 * **2026-07-09 fix (chore):** updated for the fetch-then-blob flow.
 * The button no longer `window.open`s the API URL directly. It now
 * fetches the PDF via `apiFetchBlob` (which carries the
 * `Authorization: Bearer <token>` header), wraps the response in a
 * blob URL, and `window.open`s that.
 *
 * Mock the three side effects:
 *   - `@/lib/api.apiFetchBlob` → synchronous factory returning a
 *     Blob; we don't want to hit the real `apiFetch` refresh logic.
 *   - `URL.createObjectURL` / `URL.revokeObjectURL` → fake the
 *     browser API (jsdom doesn't implement them).
 *   - `window.open` → spy on the jsdom global + replace with a no-op.
 *   - `@/lib/notifications.notify` → synchronous factory per design
 *     D8+R4.
 *
 * `getFormUrl()` is read via the env var. With `NEXT_PUBLIC_API_BASE_URL`
 * unset (the production default after the 2026-07-09 fix), the URL
 * collapses to a relative path — the test exercises that.
 */

const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock-emit')
const apiFetchBlobMock = vi.fn(
  async (..._args: unknown[]) => new Blob(['fake-pdf-bytes'], { type: 'application/pdf' }),
)
const createObjectURLMock = vi.fn(() => 'blob:http://localhost/fake-uuid')
const revokeObjectURLMock = vi.fn()
const openSpy = vi.fn(() => null)

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('@/lib/api')
  return {
    ...actual,
    apiFetchBlob: (...args: unknown[]) => apiFetchBlobMock(...args),
  }
})

const { EmitirSolicitudButton } = await import('./EmitirSolicitudButton')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

describe('EmitirSolicitudButton', () => {
  beforeEach(() => {
    notifyMock.mockReset()
    notifyMock.mockReturnValue('toast-mock-emit')
    apiFetchBlobMock.mockReset()
    apiFetchBlobMock.mockResolvedValue(new Blob(['fake-pdf-bytes'], { type: 'application/pdf' }))
    createObjectURLMock.mockReset()
    createObjectURLMock.mockReturnValue('blob:http://localhost/fake-uuid')
    revokeObjectURLMock.mockReset()
    openSpy.mockReset()
    openSpy.mockReturnValue(null)
    // jsdom's window.open returns null silently — replace with our spy.
    window.open = openSpy as unknown as typeof window.open
    Object.assign(URL, {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('renders a button labeled "Emitir Solicitud" with a Printer icon', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    const btn = screen.getByRole('button', { name: /emitir solicitud/i })
    expect(btn).toBeInTheDocument()
    expect(btn.querySelector('svg')).toBeInTheDocument()
  })

  it('fetches the PDF with apiFetchBlob and opens the blob URL in a new tab on click', async () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))

    await waitFor(() => {
      expect(apiFetchBlobMock).toHaveBeenCalledTimes(1)
    })
    expect(apiFetchBlobMock).toHaveBeenCalledWith(
      `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
    )
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    const call = openSpy.mock.calls[0] as readonly unknown[]
    const [url, target, features] = call
    expect(url).toBe('blob:http://localhost/fake-uuid')
    expect(target).toBe('_blank')
    expect(features).toBe('noopener,noreferrer')
  })

  it('fires an info toast on click so the operator gets immediate feedback', async () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    expect(notifyMock).toHaveBeenCalledWith('info', expect.stringMatching(/generando pdf/i))
    await waitFor(() => {
      expect(apiFetchBlobMock).toHaveBeenCalledTimes(1)
    })
  })

  it('fires an error toast when apiFetchBlob throws', async () => {
    apiFetchBlobMock.mockRejectedValueOnce(new Error('boom'))
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/boom/i))
    })
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('disables the button while loading to prevent double-click', async () => {
    // Make the fetch hang so we can observe the loading state.
    let resolveApi!: (b: Blob) => void
    apiFetchBlobMock.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveApi = resolve
        }),
    )
    render(<EmitirSolicitudButton socioId={SOCIO_ID} />)
    const btn = screen.getByRole('button', { name: /emitir solicitud/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(btn).toBeDisabled()
    })
    expect(btn.textContent).toMatch(/generando/i)
    // Resolve so the test cleans up.
    resolveApi(new Blob(['ok'], { type: 'application/pdf' }))
  })

  it('does not call apiFetchBlob or notify when the disabled prop is set', () => {
    render(<EmitirSolicitudButton socioId={SOCIO_ID} disabled />)
    const btn = screen.getByRole('button', { name: /emitir solicitud/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(apiFetchBlobMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('passes the socioId through to the apiFetchBlob path (different id → different path)', async () => {
    const OTHER_ID = 'Z9X8Y7W6-V5U4-T3S2-R1Q0-9876FE543210'
    render(<EmitirSolicitudButton socioId={OTHER_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /emitir solicitud/i }))
    await waitFor(() => {
      expect(apiFetchBlobMock).toHaveBeenCalledWith(
        `/api/v1/socios/${OTHER_ID}/forms/solicitud-inscripcion.pdf`,
      )
    })
  })
})
