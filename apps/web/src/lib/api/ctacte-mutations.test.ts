import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ctacte-mutations API tests (PR A2 — athlos-ctacte-mutations).
 *
 * Covers the four write wrappers:
 *
 *   registerCtactePayment(socioId, input)
 *     → POST /api/v1/socios/:id/ctacte/movements/payment
 *     → FormData body: monto, fecha, concepto, optional comprobante file
 *     → Returns CtactePaymentResponse
 *
 *   registerCtacteDebit(socioId, input)
 *     → POST /api/v1/socios/:id/ctacte/movements/debit
 *     → JSON body: { monto, fecha, motivo }
 *     → Returns CtacteDebitResponse
 *
 *   addCtacteNote(socioId, movementId, body)
 *     → POST /api/v1/socios/:id/ctacte/movements/:movementId/notes
 *     → JSON body: { body }
 *     → Returns CtacteNoteResponse
 *
 *   getCtacteComprobanteUrl(socioId, cuenta, from, to)
 *     → Composes full URL with query params
 *     → Verifies encodeURIComponent on cuenta
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + body shape). The auth header / 401 retry
 * logic is already covered by `src/lib/api.test.ts`.
 *
 * NOTE: `getCtacteComprobanteUrl` reads `process.env.NEXT_PUBLIC_API_BASE_URL`
 * at module scope (not at call time), so each test that changes the env var
 * must call `vi.resetModules()` and re-import the function to pick up the new value.
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { registerCtactePayment, registerCtacteDebit, addCtacteNote, deleteCtacteNote } =
  await import('./ctacte-mutations')

// getCtacteComprobanteUrl is re-imported per-test below (see note above)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getCtacteComprobanteUrl: (...args: any[]) => any

const SAMPLE_SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const SAMPLE_MOVEMENT_ID = 'mv-abc123'
const IDEMPOTENCY_KEY = 'payment-retry-key-1'

describe('ctacte-mutations API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  // ─── registerCtactePayment ────────────────────────────────────────

  describe('registerCtactePayment()', () => {
    it('POSTs FormData to /api/v1/socios/:id/ctacte/movements/payment', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'mv-new',
        tipo: 'CREDITO' as const,
        monto: '1500.00',
        fecha: '2026-01-15',
        concepto: 'Pago cuota enero',
        comprobante_attachment_id: null,
      })

      const result = await registerCtactePayment(SAMPLE_SOCIO_ID, {
        monto: 1500,
        fecha: '2026-01-15',
        concepto: 'Pago cuota enero',
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      const call = apiFetchMock.mock.calls[0]!
      expect(call[0]).toBe(`/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/movements/payment`)
      expect(call[1]).toMatchObject({
        method: 'POST',
        headers: { 'Idempotency-Key': IDEMPOTENCY_KEY },
      })
      expect(call[1]?.body).toBeInstanceOf(FormData)
      expect(result.id).toBe('mv-new')
    })

    it('appends monto, fecha, concepto to FormData', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'mv-new',
        tipo: 'CREDITO' as const,
        monto: '500.00',
        fecha: '2026-02-01',
        concepto: 'Pago febrero',
        comprobante_attachment_id: null,
      })

      await registerCtactePayment(SAMPLE_SOCIO_ID, {
        monto: 500,
        fecha: '2026-02-01',
        concepto: 'Pago febrero',
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      const formData = apiFetchMock.mock.calls[0]![1]?.body as FormData
      expect(formData.get('monto')).toBe('500')
      expect(formData.get('fecha')).toBe('2026-02-01')
      expect(formData.get('concepto')).toBe('Pago febrero')
    })

    it('includes comprobante file in FormData when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'mv-new',
        tipo: 'CREDITO' as const,
        monto: '2000.00',
        fecha: '2026-03-01',
        concepto: 'Pago marzo con comprobante',
        comprobante_attachment_id: 'att-1',
      })

      const fakeFile = new File(['PDF content'], 'comprobante.pdf', { type: 'application/pdf' })

      await registerCtactePayment(SAMPLE_SOCIO_ID, {
        monto: 2000,
        fecha: '2026-03-01',
        concepto: 'Pago marzo con comprobante',
        comprobante: fakeFile,
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      const formData = apiFetchMock.mock.calls[0]![1]?.body as FormData
      const file = formData.get('comprobante')
      expect(file).toBeInstanceOf(File)
      expect((file as File).name).toBe('comprobante.pdf')
    })

    it('omits comprobante field from FormData when not provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'mv-new',
        tipo: 'CREDITO' as const,
        monto: '1000.00',
        fecha: '2026-04-01',
        concepto: 'Pago abril sin comprobante',
        comprobante_attachment_id: null,
      })

      await registerCtactePayment(SAMPLE_SOCIO_ID, {
        monto: 1000,
        fecha: '2026-04-01',
        concepto: 'Pago abril sin comprobante',
        idempotencyKey: IDEMPOTENCY_KEY,
      })

      const formData = apiFetchMock.mock.calls[0]![1]?.body as FormData
      expect(formData.has('comprobante')).toBe(false)
    })
  })

  // ─── registerCtacteDebit ──────────────────────────────────────────

  describe('registerCtacteDebit()', () => {
    it('POSTs JSON to /api/v1/socios/:id/ctacte/movements/debit', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'mv-debit-1',
        tipo: 'DEBITO' as const,
        monto: '300.00',
        fecha: '2026-01-20',
        motivo: 'Cargo por mora',
      })

      const result = await registerCtacteDebit(SAMPLE_SOCIO_ID, {
        monto: 300,
        fecha: '2026-01-20',
        motivo: 'Cargo por mora',
        idempotencyKey: 'debit-intent-1',
      })

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      const call = apiFetchMock.mock.calls[0]!
      expect(call[0]).toBe(`/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/movements/debit`)
      expect(call[1]).toMatchObject({
        method: 'POST',
        headers: { 'Idempotency-Key': 'debit-intent-1' },
      })
      expect(call[1]?.body).toEqual({
        monto: 300,
        fecha: '2026-01-20',
        motivo: 'Cargo por mora',
      })
      expect(result.tipo).toBe('DEBITO')
    })
  })

  // ─── addCtacteNote ───────────────────────────────────────────────

  describe('addCtacteNote()', () => {
    it('POSTs JSON to /api/v1/socios/:id/ctacte/movements/:movementId/notes', async () => {
      apiFetchMock.mockResolvedValueOnce({
        id: 'note-1',
        ctacte_movement_id: SAMPLE_MOVEMENT_ID,
        body: 'Llamó el socio consultando por el saldo.',
        author_operator_id: 'op-1',
        created_at: '2026-01-15T12:00:00.000Z',
      })

      const result = await addCtacteNote(
        SAMPLE_SOCIO_ID,
        SAMPLE_MOVEMENT_ID,
        'Llamó el socio consultando por el saldo.',
      )

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      const call = apiFetchMock.mock.calls[0]!
      expect(call[0]).toBe(
        `/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/movements/${SAMPLE_MOVEMENT_ID}/notes`,
      )
      expect(call[1]).toMatchObject({ method: 'POST' })
      expect(call[1]?.body).toEqual({ body: 'Llamó el socio consultando por el saldo.' })
      expect(result.id).toBe('note-1')
    })
  })

  // ─── deleteCtacteNote ──────────────────────────────────────────────

  describe('deleteCtacteNote()', () => {
    const SAMPLE_NOTE_ID = 'note-1234'

    it('DELETEs /api/v1/socios/:id/ctacte/movements/:movementId/notes/:noteId', async () => {
      apiFetchMock.mockResolvedValueOnce({ id: SAMPLE_NOTE_ID, deleted: true })

      const result = await deleteCtacteNote(SAMPLE_SOCIO_ID, SAMPLE_MOVEMENT_ID, SAMPLE_NOTE_ID)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      const call = apiFetchMock.mock.calls[0]!
      expect(call[0]).toBe(
        `/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/movements/${SAMPLE_MOVEMENT_ID}/notes/${SAMPLE_NOTE_ID}`,
      )
      expect(call[1]).toMatchObject({ method: 'DELETE' })
      expect(call[1]?.body).toBeUndefined()
      expect(result).toEqual({ id: SAMPLE_NOTE_ID, deleted: true })
    })
  })

  // ─── getCtacteComprobanteUrl ──────────────────────────────────────
  //
  // NOTE: getCtacteComprobanteUrl reads process.env.NEXT_PUBLIC_API_BASE_URL
  // at module scope (const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '').
  // Vitest caches modules, so changes to the env var after module load do NOT
  // affect the cached const. Each test that changes the env var must
  // vi.resetModules() + re-import to force re-evaluation.

  describe('getCtacteComprobanteUrl()', () => {
    const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_BASE_URL

    afterEach(() => {
      // Restore the original env var after each test
      if (ORIGINAL_ENV !== undefined) {
        process.env.NEXT_PUBLIC_API_BASE_URL = ORIGINAL_ENV
      } else {
        delete process.env.NEXT_PUBLIC_API_BASE_URL
      }
    })

    it('composes the base URL with the four query params', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3000'
      vi.resetModules()
      ;({ getCtacteComprobanteUrl } = await import('./ctacte-mutations'))

      const url = getCtacteComprobanteUrl(SAMPLE_SOCIO_ID, 'cta-001', '2026-01-01', '2026-12-31')

      expect(url).toBe(
        `http://localhost:3000/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/comprobante.pdf?from=2026-01-01&to=2026-12-31&cuenta=cta-001`,
      )
    })

    it('uses empty string as API_BASE_URL when env var is not set', async () => {
      delete process.env.NEXT_PUBLIC_API_BASE_URL
      vi.resetModules()
      ;({ getCtacteComprobanteUrl } = await import('./ctacte-mutations'))

      const url = getCtacteComprobanteUrl(SAMPLE_SOCIO_ID, 'cta-002', '2026-01-01', '2026-06-30')

      expect(url).toBe(
        `/api/v1/socios/${SAMPLE_SOCIO_ID}/ctacte/comprobante.pdf?from=2026-01-01&to=2026-06-30&cuenta=cta-002`,
      )
    })

    it('encodes cuenta with special characters via encodeURIComponent', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3000'
      vi.resetModules()
      ;({ getCtacteComprobanteUrl } = await import('./ctacte-mutations'))

      // cuenta contains spaces and a slash — must not corrupt query string
      const url = getCtacteComprobanteUrl(
        SAMPLE_SOCIO_ID,
        'cta 001/principal',
        '2026-01-01',
        '2026-06-30',
      )

      expect(url).toContain('cuenta=cta+001%2Fprincipal')
      // No raw space or slash in the URL
      expect(url).not.toMatch(/cuenta=[^&]*[ /][^&]*(&|$)/)
    })
  })
})
