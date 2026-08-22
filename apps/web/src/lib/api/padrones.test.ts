import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Padrones API tests (TASK-027, PR 8b.3).
 *
 * Covers the read-only contract from the backend route at
 * `apps/api/src/routes/padrones.ts`:
 *
 *   - `getPadrones({ disciplina, ejercicio, page?, limit? })`
 *       → `GET /api/v1/padrones?disciplina=NATACION&ejercicio=2026`
 *       → `{ disciplina, ejercicio, items: PadronRow[], page, limit, total, has_more }`
 *
 * Both `disciplina` and `ejercicio` are REQUIRED by the backend
 * zod schema (per `apps/api/src/routes/padrones.ts:22-27`). The
 * wrapper takes them as a single typed argument so the caller
 * can't forget one.
 *
 * IMPORTANT — wire shape: the padrones route does NOT transform
 * the repository output to snake_case (unlike `socios.ts` which
 * has an explicit `toSocioDTO` mapper). The wire shape is
 * camelCase: `inscripcionId, socioId, numeroSocio, nombre,
 * apellido, dni, estado, fechaAlta, disciplinaCodigo,
 * disciplinaNombre, ejercicioAnio`. Mirrored verbatim from
 * `apps/api/src/modules/padrones/repository.ts:103-119`.
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + query serialization). The auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 *
 * PR 8b.3 is **read-only**: no create / update / delete wrappers
 * ship here (per the orchestrator brief).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getDisciplinas, getPadrones } = await import('./padrones')

const SAMPLE_DISCIPLINA_CODIGO = 'NATACION'
const SAMPLE_EJERCICIO = 2026

const SAMPLE_PADRON_ROW = {
  inscripcionId: 'i-1',
  socioId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numeroSocio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  estado: 'activa',
  fechaAlta: '2026-03-01',
  disciplinaCodigo: SAMPLE_DISCIPLINA_CODIGO,
  disciplinaNombre: 'Natación',
  ejercicioAnio: SAMPLE_EJERCICIO,
}

const SAMPLE_PADRON_RESPONSE = {
  disciplina: SAMPLE_DISCIPLINA_CODIGO,
  ejercicio: SAMPLE_EJERCICIO,
  items: [SAMPLE_PADRON_ROW],
  page: 1,
  limit: 20,
  total: 1,
  has_more: false,
}

describe('padrones API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getDisciplinas()', () => {
    it('loads discipline ids and human-readable names from the padrones source', async () => {
      const response = {
        items: [{ id: 'd-1', codigo: 'NATACION', nombre: 'Natación' }],
      }
      apiFetchMock.mockResolvedValueOnce(response)

      await expect(getDisciplinas()).resolves.toEqual(response)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/padrones/disciplinas', {
        query: {},
      })
    })
  })

  describe('getPadrones()', () => {
    it('calls GET /api/v1/padrones with disciplina + ejercicio in the query', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_PADRON_RESPONSE)

      const result = await getPadrones({
        disciplina: SAMPLE_DISCIPLINA_CODIGO,
        ejercicio: SAMPLE_EJERCICIO,
      })

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/padrones', {
        query: { disciplina: SAMPLE_DISCIPLINA_CODIGO, ejercicio: SAMPLE_EJERCICIO },
      })
      expect(result).toEqual(SAMPLE_PADRON_RESPONSE)
    })

    it('serializes page and limit as query params when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        ...SAMPLE_PADRON_RESPONSE,
        page: 2,
        limit: 50,
        total: 73,
        has_more: true,
      })

      await getPadrones({
        disciplina: 'FUTBOL',
        ejercicio: 2025,
        page: 2,
        limit: 50,
      })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/padrones', {
        query: { disciplina: 'FUTBOL', ejercicio: 2025, page: 2, limit: 50 },
      })
    })

    it('coerces ejercicio (number) to its string form for the query', async () => {
      // The backend zod schema uses z.coerce.number() — the wire
      // value can arrive as either a number or a string, and the
      // apiFetch query builder stringifies everything. Verify
      // the wrapper hands the API a stable shape (number, not
      // pre-stringified) so the server's coerce step runs once.
      apiFetchMock.mockResolvedValueOnce(SAMPLE_PADRON_RESPONSE)

      await getPadrones({ disciplina: 'HOCKEY', ejercicio: 2024 })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/padrones', {
        query: { disciplina: 'HOCKEY', ejercicio: 2024 },
      })
    })

    it('returns the parsed list shape with disciplina + ejercicio + items + pagination', async () => {
      const payload = {
        disciplina: 'BASQUET',
        ejercicio: 2023,
        items: [
          SAMPLE_PADRON_ROW,
          {
            ...SAMPLE_PADRON_ROW,
            inscripcionId: 'i-2',
            socioId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
            numeroSocio: '00002',
            nombre: 'Ana',
            apellido: 'Pérez',
          },
        ],
        page: 1,
        limit: 20,
        total: 142,
        has_more: true,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getPadrones({ disciplina: 'BASQUET', ejercicio: 2023 })

      expect(result.disciplina).toBe('BASQUET')
      expect(result.ejercicio).toBe(2023)
      expect(result.items).toHaveLength(2)
      expect(result.items[0]?.disciplinaCodigo).toBe(SAMPLE_DISCIPLINA_CODIGO)
      expect(result.items[1]?.apellido).toBe('Pérez')
      expect(result.total).toBe(142)
      expect(result.has_more).toBe(true)
    })

    it('preserves the camelCase wire shape (no DTO transformation)', async () => {
      // The padrones route does NOT snake_case the items — it
      // forwards the repository's camelCase output verbatim.
      // Verify the wrapper exposes the exact field names the
      // backend sends (inscripcionId, socioId, numeroSocio,
      // fechaAlta, disciplinaCodigo, disciplinaNombre,
      // ejercicioAnio) without renaming them.
      apiFetchMock.mockResolvedValueOnce(SAMPLE_PADRON_RESPONSE)

      const result = await getPadrones({
        disciplina: SAMPLE_DISCIPLINA_CODIGO,
        ejercicio: SAMPLE_EJERCICIO,
      })

      const row = result.items[0]
      expect(row).toBeDefined()
      if (!row) return
      expect(row.inscripcionId).toBe('i-1')
      expect(row.socioId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect(row.numeroSocio).toBe('00001')
      expect(row.fechaAlta).toBe('2026-03-01')
      expect(row.disciplinaCodigo).toBe(SAMPLE_DISCIPLINA_CODIGO)
      expect(row.disciplinaNombre).toBe('Natación')
      expect(row.ejercicioAnio).toBe(SAMPLE_EJERCICIO)
      expect(row.estado).toBe('activa')
    })

    it('propagates ApiError when the backend rejects (unknown disciplina/ejercicio)', async () => {
      // The backend throws BusinessError(NOT_FOUND) when the
      // disciplina codigo or ejercicio anio doesn't exist —
      // apiFetch turns that into ApiError(404). The wrapper
      // doesn't swallow it.
      const notFound = Object.assign(new Error('NOT_FOUND: Disciplina not found'), {
        status: 404,
        code: 'NOT_FOUND',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(notFound)

      await expect(getPadrones({ disciplina: 'NOEXISTE', ejercicio: 2099 })).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      })
    })
  })
})
