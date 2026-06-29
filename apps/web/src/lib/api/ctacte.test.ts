import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ctacte API tests (TASK-023, PR 8b.2).
 *
 * Covers the read-only contract from the backend route at
 * `apps/api/src/routes/ctacte.ts`:
 *
 *   - `getCtacte(socioId, params?)`
 *       → `GET /api/v1/socios/:id/cuenta-corriente`
 *       → `{ socioId, saldo, saldo_calculado_at, movimientos: [...], page, limit, total, has_more }`
 *
 *   - `getMovimientos(socioId, params?)`
 *       → `GET /api/v1/socios/:id/cuenta-corriente/movimientos`
 *       → `{ items, page, limit, total, has_more }`
 *
 * The actual backend nests the cuenta-corriente endpoints under
 * `/api/v1/socios/:id/...` (per `apps/api/src/routes/ctacte.ts`),
 * not standalone `/api/v1/ctacte/:id`. The wrapper mirrors the
 * real path so the URL builders stay accurate.
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + query serialization). The auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 *
 * PR 8b.2 is **read-only**: no create / update / delete wrappers
 * ship here (per the orchestrator brief).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getCtacte, getMovimientos } = await import('./ctacte')

const SAMPLE_SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const SAMPLE_MOVIMIENTO = {
  id: 'mv-1',
  socio_id: SAMPLE_SOCIO_ID,
  fecha: '2026-01-15',
  tipo: 'DEBITO' as const,
  concepto: 'Cuota enero 2026',
  debe: '1500.00',
  haber: '0.00',
  anulado: false,
  anulado_at: null,
  anulado_motivo: null,
  monto: '1500.00',
  saldo_resultante: null,
  created_at: '2026-01-15T12:00:00.000Z',
}

const SAMPLE_CTACTE = {
  socioId: SAMPLE_SOCIO_ID,
  saldo: '1500.00',
  saldo_calculado_at: '2026-06-29T12:00:00.000Z',
  movimientos: [SAMPLE_MOVIMIENTO],
  page: 1,
  limit: 20,
  total: 1,
  has_more: false,
}

describe('ctacte API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getCtacte()', () => {
    it('calls GET /api/v1/socios/:id/cuenta-corriente with the socio id in the path', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CTACTE)

      const result = await getCtacte(SAMPLE_SOCIO_ID)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente',
        { query: {} },
      )
      expect(result).toEqual(SAMPLE_CTACTE)
    })

    it('serializes page and limit as query params when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({ ...SAMPLE_CTACTE, page: 2, limit: 50, total: 0 })

      await getCtacte(SAMPLE_SOCIO_ID, { page: 2, limit: 50 })

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente',
        { query: { page: 2, limit: 50 } },
      )
    })

    it('serializes date filters (desde / hasta) when provided', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CTACTE)

      await getCtacte(SAMPLE_SOCIO_ID, {
        desde: '2026-01-01T00:00:00Z',
        hasta: '2026-12-31T23:59:59Z',
      })

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente',
        {
          query: {
            desde: '2026-01-01T00:00:00Z',
            hasta: '2026-12-31T23:59:59Z',
          },
        },
      )
    })

    it('serializes incluir_anuladas as "true" / "false" strings (backend zod schema requirement)', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CTACTE)

      await getCtacte(SAMPLE_SOCIO_ID, { incluir_anuladas: true })

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente',
        { query: { incluir_anuladas: 'true' } },
      )
    })

    it('returns the parsed ctacte shape with saldo + movimientos + pagination metadata', async () => {
      const payload = {
        socioId: SAMPLE_SOCIO_ID,
        saldo: '-250.50',
        saldo_calculado_at: '2026-06-29T15:30:00.000Z',
        movimientos: [SAMPLE_MOVIMIENTO],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getCtacte(SAMPLE_SOCIO_ID)

      expect(result.saldo).toBe('-250.50')
      expect(result.movimientos).toHaveLength(1)
      expect(result.movimientos[0]?.concepto).toBe('Cuota enero 2026')
      expect(result.saldo_calculado_at).toBe('2026-06-29T15:30:00.000Z')
      expect(result.has_more).toBe(false)
    })
  })

  describe('getMovimientos()', () => {
    it('calls GET /api/v1/socios/:id/cuenta-corriente/movimientos with the socio id in the path', async () => {
      const payload = {
        items: [SAMPLE_MOVIMIENTO],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getMovimientos(SAMPLE_SOCIO_ID)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente/movimientos',
        { query: {} },
      )
      expect(result).toEqual(payload)
    })

    it('forwards page + limit + date filters to the movimientos endpoint', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        page: 3,
        limit: 10,
        total: 0,
        has_more: false,
      })

      await getMovimientos(SAMPLE_SOCIO_ID, {
        page: 3,
        limit: 10,
        desde: '2026-01-01T00:00:00Z',
        hasta: '2026-12-31T23:59:59Z',
        incluir_anuladas: true,
      })

      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/socios/' + SAMPLE_SOCIO_ID + '/cuenta-corriente/movimientos',
        {
          query: {
            page: 3,
            limit: 10,
            desde: '2026-01-01T00:00:00Z',
            hasta: '2026-12-31T23:59:59Z',
            incluir_anuladas: 'true',
          },
        },
      )
    })

    it('returns the parsed movimientos list shape with items + pagination metadata', async () => {
      const payload = {
        items: [
          SAMPLE_MOVIMIENTO,
          {
            ...SAMPLE_MOVIMIENTO,
            id: 'mv-2',
            tipo: 'CREDITO' as const,
            debe: '0.00',
            haber: '1500.00',
          },
        ],
        page: 1,
        limit: 20,
        total: 42,
        has_more: true,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getMovimientos(SAMPLE_SOCIO_ID)

      expect(result.items).toHaveLength(2)
      expect(result.items[1]?.tipo).toBe('CREDITO')
      expect(result.total).toBe(42)
      expect(result.has_more).toBe(true)
    })
  })
})
