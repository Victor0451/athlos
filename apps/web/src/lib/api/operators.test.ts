import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getOperatorNames` client wrapper tests (PR 8b.1 of
 * `athlos-audit-operator-display`).
 *
 * Pins the contract from the backend route at
 * `apps/api/src/routes/operators.ts`:
 *   - GET /api/v1/operators?ids=<uuid>,...
 *   - returns { operators: OperatorSummary[] }
 *
 * Mocks the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + query serialization) — the auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getOperatorNames } = await import('./operators')

const SAMPLE_OPERATORS = [
  { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', username: 'vlongo', role: 'ADMIN' as const },
  { id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012', username: 'mgarcia', role: 'OPERADOR' as const },
  { id: 'c3d4e5f6-a7b8-9012-cdef-345678901234', username: 'jlopez', role: 'CONSULTA' as const },
]

describe('operators API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getOperatorNames()', () => {
    it('calls GET /api/v1/operators?ids=a,b,c and unwraps the operators array', async () => {
      apiFetchMock.mockResolvedValueOnce({ operators: SAMPLE_OPERATORS })

      const result = await getOperatorNames([
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'b2c3d4e5-f6a7-8901-bcde-f23456789012',
        'c3d4e5f6-a7b8-9012-cdef-345678901234',
      ])

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/operators?ids=a1b2c3d4-e5f6-7890-abcd-ef1234567890,b2c3d4e5-f6a7-8901-bcde-f23456789012,c3d4e5f6-a7b8-9012-cdef-345678901234',
        { query: {} },
      )
      expect(result).toEqual(SAMPLE_OPERATORS)
    })

    it('returns the operators from the response (the wrapper unwraps .operators)', async () => {
      apiFetchMock.mockResolvedValueOnce({ operators: [SAMPLE_OPERATORS[0]] })

      const result = await getOperatorNames(['a1b2c3d4-e5f6-7890-abcd-ef1234567890'])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(SAMPLE_OPERATORS[0])
    })

    it('returns [] without calling apiFetch when the id list is empty', async () => {
      const result = await getOperatorNames([])

      expect(apiFetchMock).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it('propagates errors thrown by apiFetch (e.g. 401, 400 VALIDATION_ERROR)', async () => {
      const apiError = new Error('VALIDATION_ERROR: ids cannot exceed 200 entries')
      apiFetchMock.mockRejectedValueOnce(apiError)

      await expect(getOperatorNames(['a1b2c3d4-e5f6-7890-abcd-ef1234567890'])).rejects.toThrow(
        'VALIDATION_ERROR: ids cannot exceed 200 entries',
      )
    })
  })
})
