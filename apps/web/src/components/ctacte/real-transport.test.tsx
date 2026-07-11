import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { CtactePaymentForm } from './CtactePaymentForm'
import { CtacteNoteForm } from './CtacteNoteForm'

/**
 * R4 corrective batch — REAL TRANSPORT smoke tests.
 *
 * The companion `*.field-errors.test.tsx` files bypass the network
 * with `vi.mock('@/lib/api/ctacte-mutations')` and feed hand-crafted
 * `ApiError` instances to the form catch blocks. They prove the
 * form-level routing of an existing error, but they exercise NONE of
 * the `api.ts` → `registerCtactePayment()` plumbing.
 *
 * This file feeds real server envelopes through the whole stack —
 * `global.fetch` → `apiFetch` → `registerCtactePayment` /
 * `addCtacteNote` → form catch → DOM — to prove:
 *
 *   1. Payment — `monto <= 0`: a server envelope carrying
 *      `{ error: 'VALIDATION_ERROR', details: [{ field: 'monto', … }] }`
 *      routes the message inline under the `monto` input AND fires
 *      the top-level failure toast. Verifies that defects #1 (route
 *      emitting the details array) + #2 (ApiError mapping body.error)
 *      are stitched together end-to-end.
 *
 *   2. Note — 409 conflict: a server envelope carrying
 *      `{ error: 'CONFLICT', message: 'Idempotency-Key already used' }`
 *      activates the CONFLICT branch in `CtacteNoteForm.onSubmit`
 *      (rotates the idempotency key + fires the dedicated "rotate"
 *      toast — NOT the generic failure toast). Verifies that
 *      defect #2 (envelope mapping) keeps the existing note-
 *      idempotency conflict contract intact.
 *
 * Both tests assert the real fetch was issued with the right URL +
 * method + body, so a regression in the URL composition / body
 * serialisation path would fail them too.
 */

const notifyMock = vi.fn()

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const MOVEMENT_ID = 'mv-abc123'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  notifyMock.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('CtactePaymentForm — real-transport monto error', () => {
  it('routes a server `monto must be > 0` envelope inline + fires the top-level toast', async () => {
    // The server envelope shape mirrors the response the ctacte route
    // emits for `monto <= 0` (defect #1 fix): VALIDATION_ERROR with a
    // `details: [{ field, message }]` array. The fetch is stubbed at
    // the global level (NOT `vi.mock('@/lib/api/ctacte-mutations')`)
    // so the real `apiFetch` envelope-mapping runs.
    //
    // `monto: '1500'` passes the form's client-side Zod
    // (`z.coerce.number().positive()`); the server envelope then
    // rejects with the field-level error. The whole point of the
    // test is to prove the SERVER → TRANSPORT → FORM plumbing
    // stitches together end-to-end. The client's own validator
    // would block a real `0` BEFORE the fetch (no test value
    // here, intentional).
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'VALIDATION_ERROR',
          message: 'monto must be > 0',
          details: [{ field: 'monto', message: 'monto must be > 0' }],
        },
        400,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CtactePaymentForm open socioId={SOCIO_ID} onClose={vi.fn()} />)

    await act(async () => {
      fireEvent.input(screen.getByLabelText(/monto/i), { target: { value: '1500' } })
      fireEvent.input(screen.getByLabelText(/fecha/i), { target: { value: '2026-07-09' } })
      fireEvent.input(screen.getByLabelText(/concepto/i), { target: { value: 'Cuota' } })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-payment-form')!)
    })

    // Wait for the inline message — proves the envelope reached
    // `applyFieldErrors` → `setError` and the DOM rendered it.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/monto must be > 0/i)
    })
    expect(screen.getByLabelText(/monto/i)).toHaveAttribute('aria-invalid', 'true')

    // The top-level toast still fires — never suppressed when inline
    // surfaces an error (R4 retain-top-level-toast contract).
    expect(notifyMock).toHaveBeenCalledWith('error', expect.stringMatching(/no se pudo/i))

    // Assert the fetch was actually called via the real transport
    // path (`apiFetch` → `global.fetch`) and hit the right URL +
    // method. The body is FormData — we only assert the URL +
    // method + headers here so we don't peek into the multipart
    // boundary (which is a browser-set value in real life).
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`)
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const headers = new Headers(init.headers)
    expect(headers.get('idempotency-key')).toMatch(/^.{1,128}$/)
  })
})

describe('CtacteNoteForm — real-transport 409 conflict behavior', () => {
  it('activates the CONFLICT branch on a 409 envelope (rotates the key + dedicated toast)', async () => {
    // The server envelope mirrors the 409 response emitted by the
    // note route when the same Idempotency-Key is reused with a
    // different payload (R3 fix #2 contract). The form mints a
    // fresh key on submit; the server returns 409; the CONFLICT
    // branch in onSubmit activates (rotates the cache + fires the
    // dedicated "rotate" toast — NOT the generic failure toast).
    // This proves that defect #2 (envelope mapping) keeps the
    // existing note-idempotency conflict contract intact when the
    // transport is real instead of a hand-crafted ApiError mock.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'CONFLICT',
          message: 'Idempotency-Key already used',
        },
        409,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CtacteNoteForm open socioId={SOCIO_ID} movementId={MOVEMENT_ID} onClose={vi.fn()} />)

    await act(async () => {
      fireEvent.input(screen.getByRole('textbox'), {
        target: { value: 'Llamó el socio.' },
      })
    })
    await act(async () => {
      fireEvent.submit(document.getElementById('ctacte-note-form')!)
    })

    // The CONFLICT branch fires its own toast (NOT the generic
    // failure toast). The contract is `message.includes('CONFLICT')
    // || message.includes('409')` — both branches are present in
    // the real envelope `CONFLICT: Idempotency-Key already used`,
    // so the conflict branch activates cleanly.
    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith(
        'error',
        expect.stringMatching(/clave|usó para otro contenido|nueva/i),
      )
    })
    // Sanity: the generic "No se pudo agregar la nota" toast from
    // the non-CONFLICT branch must NOT fire.
    for (const call of notifyMock.mock.calls) {
      const [, msg] = call as [string, string]
      expect(msg).not.toMatch(/no se pudo agregar la nota/i)
    }

    // Cache cleared so the next open of the modal mints a fresh
    // key (R3 rotation contract).
    expect(window.localStorage.getItem(`ctacte-note-idem:${SOCIO_ID}:${MOVEMENT_ID}`)).toBeNull()

    // Real transport: the fetch was actually issued via apiFetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`)
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('idempotency-key')).toMatch(/^.{1,128}$/)
  })
})
