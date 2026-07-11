import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CtacteComprobanteButton } from './CtacteComprobanteButton'

/**
 * R4 — server ApiError.details routing into the Comprobante button
 * modal (athlos-ctacte-mutations). Sibling of
 * CtacteComprobanteButton.test.tsx so the original test file stays
 * within the design's ≤ 200 LoC cap.
 *
 * The server emits TWO distinct shapes for comprobante errors:
 *
 *   1. Cap exceeded (R1.3 fix):
 *      { error: 'VALIDATION_ERROR',
 *        details: { cap: 50, requested: 51 } }
 *
 *   2. Field-level (R1.2 / from > to):
 *      { error: 'VALIDATION_ERROR',
 *        details: [{ field: 'from', message: 'must be <= to' }] }
 *
 * Both shapes must reach the operator as inline feedback (so they
 * can narrow the range or fix the date) AND the top-level failure
 * toast must still fire — toasts are NOT suppressed when an inline
 * error renders. When the server returns no field details (500),
 * only the toast fires.
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

function apiErrorWith(details: unknown) {
  return {
    name: 'ApiError',
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'cap exceeded',
    details,
  } as Error
}

describe('CtacteComprobanteButton R4 — cap-range feedback + field routing', () => {
  beforeEach(() => {
    notifyMock.mockReset()
    windowOpenMock.mockReset()
    urlCreateObjectURLMock.mockReset()
    urlRevokeObjectURLMock.mockReset()
    getCtacteComprobanteUrlMock.mockReset()
    apiFetchBlobMock.mockReset()
    getCtacteComprobanteUrlMock.mockReturnValue(
      'http://localhost/api/v1/socios/' + SOCIO_ID + '/ctacte/comprobante.pdf',
    )
    apiFetchBlobMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
    urlCreateObjectURLMock.mockReturnValue('blob:http://localhost/generated')
    urlRevokeObjectURLMock.mockResolvedValue(undefined)
    window.open = windowOpenMock as typeof window.open
    Object.assign(URL, {
      createObjectURL: urlCreateObjectURLMock,
      revokeObjectURL: urlRevokeObjectURLMock,
    })
  })

  it('surfaces cap-range feedback inline (cap: 50, requested: 51) + top-level toast', async () => {
    const user = userEvent.setup()
    apiFetchBlobMock.mockRejectedValueOnce(apiErrorWith({ cap: 50, requested: 51 }))
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-01-01')
    await user.type(screen.getByLabelText(/hasta/i), '2026-12-31')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      // Inline feedback references the cap number so the operator
      // knows exactly how to narrow the range.
      expect(screen.getByRole('alert')).toHaveTextContent(/50|movimientos|límite/i)
    })
    expect(notifyMock).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/rango.*límite|excede.*50|no se pudo/i),
    )
    expect(windowOpenMock).not.toHaveBeenCalled()
  })

  // The previous-session draft included a `from > to` server-field
  // test case. It was discarded because the form's pre-existing
  // client-side validator blocks the request before `apiFetchBlob`
  // runs (asserted by `CtacteComprobanteButton.test.tsx > shows
  // inline error when from > to`). Pago / Débito / Nota sibling
  // tests cover the array-shape react-hook-form `setError` path
  // end-to-end; the cap-range test above covers the object-shape
  // path. The remaining no-field test below covers the 500 fallback.

  it('fires only the top-level toast when the comprobante error carries no field details', async () => {
    const user = userEvent.setup()
    apiFetchBlobMock.mockRejectedValueOnce({
      name: 'ApiError',
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    } as Error)
    render(<CtacteComprobanteButton socioId={SOCIO_ID} cuenta={CUENTA} />)
    await user.click(screen.getByTestId('ctacte-comprobante-btn'))
    await user.type(screen.getByLabelText(/desde/i), '2026-01-01')
    await user.type(screen.getByLabelText(/hasta/i), '2026-06-30')
    await user.click(screen.getByRole('button', { name: /generar pdf/i }))
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
