import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Gastos ↔ Ctacte mapping API tests (TASK-010, PR n16b-web).
 *
 * Wraps the ADMIN-only mapping + heuristic endpoints shipped in
 * v0.5.19:
 *   GET    /api/v1/gastos/:id/ctacte-links
 *   POST   /api/v1/gastos/:id/ctacte-links
 *   DELETE /api/v1/gastos-ctacte-links/:linkId
 *   PATCH  /api/v1/gastos-ctacte-links/:linkId/anular
 *   GET    /api/v1/ctacte/:cuenta/gastos-links
 *   GET    /api/v1/admin/gastos-ctacte-candidates
 *
 * Response shapes come from `apps/api/src/routes/admin/gastos-ctacte.ts`:
 *   - list/detail use `toLinkDTO()` → camelCase
 *   - GET /ctacte/:cuenta/gastos-links returns the repo row shape raw
 *     (joined: linkId, gastoId, ctacteId, montoCubierto, motivo, anulado,
 *      gastoFecha, gastoImporte, gastoConcepto, gastoCuentaPrincipal)
 *   - GET candidates returns { items: HeuristicCandidate[] }
 *
 * Mock `apiFetch` and assert path + method + body shape.
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getGastoLinks, createLink, deleteLink, anularLink, getCtacteGastosLinks, getCandidates } =
  await import('./gastos-ctacte')

const LINK_ID = 'link-1'
const GASTO_ID = '11111111-2222-3333-4444-555555555555'

describe('gastos-ctacte API', () => {
  beforeEach(() => apiFetchMock.mockReset())

  describe('getGastoLinks()', () => {
    it('GETs /api/v1/gastos/:id/ctacte-links with active=true when activeOnly is true', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })
      await getGastoLinks(GASTO_ID, true)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + GASTO_ID + '/ctacte-links', {
        query: { active: 'true' },
      })
    })

    it('omits the active filter when activeOnly is false', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })
      await getGastoLinks(GASTO_ID, false)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + GASTO_ID + '/ctacte-links', {
        query: {},
      })
    })
  })

  describe('createLink()', () => {
    it('POSTs /api/v1/gastos/:id/ctacte-links with snake_case body', async () => {
      apiFetchMock.mockResolvedValueOnce({ id: LINK_ID })
      await createLink(GASTO_ID, {
        ctacteId: 'ctacte-1',
        montoCubierto: '5000.00',
        motivo: 'manual',
      })
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos/' + GASTO_ID + '/ctacte-links', {
        method: 'POST',
        body: {
          ctacte_id: 'ctacte-1',
          monto_cubierto: '5000.00',
          motivo: 'manual',
        },
      })
    })
  })

  describe('deleteLink()', () => {
    it('DELETEs /api/v1/gastos-ctacte-links/:linkId', async () => {
      apiFetchMock.mockResolvedValueOnce({ ok: true })
      const result = await deleteLink(LINK_ID)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/gastos-ctacte-links/' + LINK_ID, {
        method: 'DELETE',
      })
      expect(result).toEqual({ ok: true })
    })
  })

  describe('anularLink()', () => {
    it('PATCHes /api/v1/gastos-ctacte-links/:linkId/anular with { motivo }', async () => {
      const anulado = { id: LINK_ID, anulado: true }
      apiFetchMock.mockResolvedValueOnce(anulado)
      const result = await anularLink(LINK_ID, 'Duplicado')
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/gastos-ctacte-links/' + LINK_ID + '/anular',
        { method: 'PATCH', body: { motivo: 'Duplicado' } },
      )
      expect(result.anulado).toBe(true)
    })
  })

  describe('getCtacteGastosLinks()', () => {
    it('GETs /api/v1/ctacte/:cuenta/gastos-links and returns the joined items', async () => {
      const row = {
        linkId: LINK_ID,
        gastoId: GASTO_ID,
        ctacteId: 'ctacte-1',
        montoCubierto: '1500.00',
        motivo: 'manual',
        anulado: false,
        gastoFecha: '2024-03-15',
        gastoImporte: '5000.00',
        gastoConcepto: 'Sueldos marzo',
        gastoCuentaPrincipal: '6003009',
      }
      apiFetchMock.mockResolvedValueOnce({ items: [row] })
      const result = await getCtacteGastosLinks('8198')
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/ctacte/8198/gastos-links', { query: {} })
      expect(result.items[0]?.gastoCuentaPrincipal).toBe('6003009')
    })
  })

  describe('getCandidates()', () => {
    it('GETs /api/v1/admin/gastos-ctacte-candidates with gasto_id + limit', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })
      await getCandidates(GASTO_ID, 25)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/gastos-ctacte-candidates', {
        query: { gasto_id: GASTO_ID, limit: 25 },
      })
    })
  })
})
