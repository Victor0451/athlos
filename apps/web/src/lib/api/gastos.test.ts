import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Gastos API tests (TASK-009, PR n16b-web).
 *
 * Wraps the ADMIN-only gastos CRUD endpoints shipped in v0.5.19
 * (PR n16a-backend). Six endpoints, all gated by `requireRole('ADMIN')`:
 *
 *   GET    /api/v1/gastos
 *   GET    /api/v1/gastos/:id
 *   POST   /api/v1/gastos
 *   PATCH  /api/v1/gastos/:id
 *   DELETE /api/v1/gastos/:id
 *   PATCH  /api/v1/gastos/:id/anular
 *
 * The wire shape comes from `apps/api/src/routes/admin/gastos.ts`
 * which uses `toGastoDTO()` — so the response is camelCase
 * (`cuentaPrincipal`, `anulado`, `anuladoAt`, `linkCount`).
 *
 * Mock `apiFetch` and assert path + method + body shape. Auth header /
 * 401 retry logic is covered in `src/lib/api.test.ts` and is not
 * duplicated here (per the ctacte/scheduler wrapper test pattern).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getGastos, getGastoById, createGasto, updateGasto, deleteGasto, anularGasto } =
  await import('./gastos')

const SAMPLE_GASTO = {
  id: '11111111-2222-3333-4444-555555555555',
  tipo: 1,
  tipoCuenta: 0,
  cuentaPrincipal: '6003009',
  cuentaAuxiliar: null,
  secuencia: 0,
  comprobante: '',
  fecha: '2024-03-15',
  concepto: 'Sueldos marzo',
  importe: '5000.00',
  iva: '0.00',
  ingresoBruto: null,
  socioId: null,
  legacyId: null,
  anulado: false,
  anuladoAt: null,
  anuladoMotivo: null,
  createdAt: '2024-03-15T12:00:00.000Z',
  linkCount: 2,
}

describe('gastos API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getGastos()', () => {
    it('GETs /api/v1/gastos with no params when called without arguments', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [SAMPLE_GASTO],
        total: 1,
        page: 1,
        limit: 50,
        has_more: false,
      })

      const result = await getGastos()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos', { query: {} })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.cuentaPrincipal).toBe('6003009')
    })

    it('serializes filters into the query string (cuenta_principal + fechas + anulado)', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        limit: 50,
        has_more: false,
      })

      await getGastos({
        page: 2,
        limit: 25,
        cuentaPrincipal: '6003009',
        fechaDesde: '2024-01-01',
        fechaHasta: '2024-12-31',
        anulado: false,
      })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos', {
        query: {
          page: 2,
          limit: 25,
          cuenta_principal: '6003009',
          fecha_desde: '2024-01-01',
          fecha_hasta: '2024-12-31',
          anulado: 'false',
        },
      })
    })
  })

  describe('getGastoById()', () => {
    it('GETs /api/v1/gastos/:id and returns the detalle + joined links[]', async () => {
      const detail = { ...SAMPLE_GASTO, links: [] }
      apiFetchMock.mockResolvedValueOnce(detail)

      const result = await getGastoById(SAMPLE_GASTO.id)

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + SAMPLE_GASTO.id, { query: {} })
      expect(result.id).toBe(SAMPLE_GASTO.id)
      expect(result.links).toEqual([])
    })
  })

  describe('createGasto()', () => {
    it('POSTs /api/v1/gastos with the snake_case body shape', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_GASTO)

      const result = await createGasto({
        tipo: 1,
        tipoCuenta: 0,
        cuentaPrincipal: '6003009',
        secuencia: 0,
        comprobante: '',
        fecha: '2024-03-15',
        concepto: 'Sueldos marzo',
        importe: '5000.00',
        iva: '0.00',
      })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos', {
        method: 'POST',
        body: {
          tipo: 1,
          tipo_cuenta: 0,
          cuenta_principal: '6003009',
          secuencia: 0,
          comprobante: '',
          fecha: '2024-03-15',
          concepto: 'Sueldos marzo',
          importe: '5000.00',
          iva: '0.00',
        },
      })
      expect(result.id).toBe(SAMPLE_GASTO.id)
    })
  })

  describe('updateGasto()', () => {
    it('PATCHes /api/v1/gastos/:id with only the provided fields', async () => {
      apiFetchMock.mockResolvedValueOnce({ ...SAMPLE_GASTO, concepto: 'Concepto actualizado' })

      await updateGasto(SAMPLE_GASTO.id, { concepto: 'Concepto actualizado' })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + SAMPLE_GASTO.id, {
        method: 'PATCH',
        body: { concepto: 'Concepto actualizado' },
      })
    })
  })

  describe('deleteGasto()', () => {
    it('DELETEs /api/v1/gastos/:id and returns {ok:true}', async () => {
      apiFetchMock.mockResolvedValueOnce({ ok: true })

      const result = await deleteGasto(SAMPLE_GASTO.id)

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + SAMPLE_GASTO.id, {
        method: 'DELETE',
      })
      expect(result).toEqual({ ok: true })
    })
  })

  describe('anularGasto()', () => {
    it('PATCHes /api/v1/gastos/:id/anular with { motivo }', async () => {
      const anulado = { ...SAMPLE_GASTO, anulado: true, anuladoMotivo: 'Error de carga' }
      apiFetchMock.mockResolvedValueOnce(anulado)

      const result = await anularGasto(SAMPLE_GASTO.id, 'Error de carga')

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + SAMPLE_GASTO.id + '/anular', {
        method: 'PATCH',
        body: { motivo: 'Error de carga' },
      })
      expect(result.anulado).toBe(true)
    })
  })
})
