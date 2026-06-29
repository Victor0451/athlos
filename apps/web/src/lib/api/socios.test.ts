import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Socios API tests (TASK-018, PR 8b.1).
 *
 * Covers the read-only contract from the backend route at
 * `apps/api/src/routes/socios.ts`:
 *   - `getSocios(params?)` → `GET /api/v1/socios` → `{ items, page, limit, total, has_more }`
 *   - `getSocio(id)`       → `GET /api/v1/socios/:id` → Socio DTO
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + query serialization) — the auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 *
 * The wrappers are read-only in PR 8b.1 (per the orchestrator's
 * READ-ONLY scope): no create / update / delete yet — those surface
 * in PR 8b.1b (or 8b.2) once the ADMIN role gate UX lands.
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getSocios, getSocio } = await import('./socios')

const SAMPLE_SOCIO = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numero_socio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  fecha_alta: '2020-03-15',
  estado: 'activo' as const,
  categoria: 'TITULAR',
  direccion: 'Av. Siempre Viva 742',
  telefono: '+5491155555555',
  email: 'juan@example.com',
  created_at: '2020-03-15T12:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
  deleted_at: null,
}

describe('socios API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getSocios()', () => {
    it('calls GET /api/v1/socios with no params when invoked without arguments', async () => {
      const payload = {
        items: [SAMPLE_SOCIO],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getSocios()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/socios', { query: {} })
      expect(result).toEqual(payload)
    })

    it('serializes page and limit as query params', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        page: 2,
        limit: 50,
        total: 0,
        has_more: false,
      })

      await getSocios({ page: 2, limit: 50 })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/socios', {
        query: { page: 2, limit: 50 },
      })
    })

    it('serializes search as a query param when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [SAMPLE_SOCIO],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      })

      await getSocios({ search: 'garcia' })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/socios', {
        query: { search: 'garcia' },
      })
    })

    it('serializes estado as a query param when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        has_more: false,
      })

      await getSocios({ estado: 'activo' })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/socios', {
        query: { estado: 'activo' },
      })
    })

    it('returns the parsed list shape with items + pagination metadata', async () => {
      const payload = {
        items: [SAMPLE_SOCIO, { ...SAMPLE_SOCIO, id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012' }],
        page: 1,
        limit: 20,
        total: 42,
        has_more: true,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getSocios()

      expect(result.items).toHaveLength(2)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.total).toBe(42)
      expect(result.has_more).toBe(true)
    })
  })

  describe('getSocio()', () => {
    it('calls GET /api/v1/socios/<id> with the socio id in the path', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_SOCIO)

      const result = await getSocio(SAMPLE_SOCIO.id)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/socios/' + SAMPLE_SOCIO.id, {
        query: {},
      })
      expect(result).toEqual(SAMPLE_SOCIO)
    })

    it('returns the socio with a UUID id (mirrors the backend idSchema)', async () => {
      const uuid = '01234567-89ab-cdef-0123-456789abcdef'
      apiFetchMock.mockResolvedValueOnce({ ...SAMPLE_SOCIO, id: uuid })

      const result = await getSocio(uuid)

      expect(result.id).toBe(uuid)
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })
})
