import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Health API tests (TASK-013).
 *
 * Covers the contract from `web-frontend/spec.md` (Dashboard Cards —
 * API Health and Master Counts):
 *   - `getHealth()` calls `GET /health` (no auth) and returns
 *     `{ status, version, uptime, timestamp }` parsed from JSON
 *   - `getFreshness()` calls `GET /api/v1/freshness` and returns the
 *     freshness list (per-domain row counts + last update)
 *
 * We mock the shared `apiFetch` client so the test stays focused on the
 * health module's contract — the auth header / 401 retry logic is
 * already covered by `src/lib/api.test.ts`.
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getHealth, getFreshness } = await import('./health')

describe('health API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getHealth()', () => {
    it('calls GET /health and returns the parsed payload', async () => {
      const fakeResponse = {
        status: 'ok' as const,
        version: '0.5.12',
        uptime: 12345.6,
        timestamp: '2026-06-29T12:00:00.000Z',
      }
      apiFetchMock.mockResolvedValueOnce(fakeResponse)

      const result = await getHealth()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/health')
      expect(result).toEqual(fakeResponse)
    })

    it('returns the status field as a string', async () => {
      apiFetchMock.mockResolvedValueOnce({
        status: 'ok',
        version: '0.5.12',
        uptime: 1,
        timestamp: '2026-06-29T00:00:00.000Z',
      })
      const result = await getHealth()
      expect(result.status).toBe('ok')
    })

    it('returns the version as a string the dashboard can render', async () => {
      apiFetchMock.mockResolvedValueOnce({
        status: 'ok',
        version: '1.2.3-rc.4',
        uptime: 0,
        timestamp: '2026-06-29T00:00:00.000Z',
      })
      const result = await getHealth()
      expect(result.version).toBe('1.2.3-rc.4')
    })

    it('returns a numeric uptime in seconds', async () => {
      apiFetchMock.mockResolvedValueOnce({
        status: 'ok',
        version: '0.5.12',
        uptime: 98765.4,
        timestamp: '2026-06-29T00:00:00.000Z',
      })
      const result = await getHealth()
      expect(typeof result.uptime).toBe('number')
      expect(result.uptime).toBe(98765.4)
    })
  })

  describe('getFreshness()', () => {
    it('calls GET /api/v1/freshness and returns the parsed payload', async () => {
      const fakeResponse = {
        items: [
          { domain: 'socios', row_count: 16383, last_update: '2026-06-29T08:00:00.000Z' },
          { domain: 'ctacte', row_count: 200945, last_update: '2026-06-29T09:00:00.000Z' },
        ],
      }
      apiFetchMock.mockResolvedValueOnce(fakeResponse)

      const result = await getFreshness()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/freshness')
      expect(result).toEqual(fakeResponse)
    })

    it('returns each freshness item with a domain and row_count', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [
          { domain: 'socios', row_count: 16383, last_update: '2026-06-29T08:00:00.000Z' },
          { domain: 'escuela', row_count: 61, last_update: '2026-06-29T08:00:00.000Z' },
        ],
      })
      const result = await getFreshness()
      expect(result.items).toHaveLength(2)
      expect(result.items[0]?.domain).toBe('socios')
      expect(result.items[0]?.row_count).toBe(16383)
      expect(result.items[1]?.domain).toBe('escuela')
      expect(result.items[1]?.row_count).toBe(61)
    })

    it('returns an empty list when no freshness data is available', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })
      const result = await getFreshness()
      expect(result.items).toEqual([])
    })
  })
})
