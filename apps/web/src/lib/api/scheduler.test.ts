import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Scheduler API tests (TASK-030, PR 8c.1).
 *
 * Covers the ADMIN-only scheduler admin contract from
 * `apps/api/src/routes/admin/scheduler.ts`:
 *
 *   - `getSchedulerJobs()`
 *       → `GET /api/v1/scheduler/jobs`
 *       → `{ items: JobRunDTO[] }` (last 20 runs)
 *
 *   - `getSchedulerJob(name)`
 *       → `GET /api/v1/scheduler/jobs/<name>`
 *       → `{ name, cronExpr, timezone, cadenceMinutes, enabled,
 *             healthy, reason, lastRuns: JobRunDTO[] }`
 *
 *   - `triggerSchedulerJob(name)`
 *       → `POST /api/v1/scheduler/jobs/<name>/run-now`
 *       → `{ jobRunId, status: 'pending' }`
 *
 *   - `setSchedulerJobEnabled(name, enabled)`
 *       → `PATCH /api/v1/scheduler/jobs/<name>` with `{ enabled }`
 *       → `{ name, cronExpr, timezone, cadenceMinutes, enabled }`
 *
 * All four endpoints are gated by `requireRole('ADMIN')` server-side.
 * A non-ADMIN token is rejected with 403; the web client does NOT
 * attempt to filter by role in the wrapper — the page's role gate
 * is the only line of defense, mirroring the dashboard pattern.
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + body + return shape). The auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 *
 * The wire shape mirrors the route at
 * `apps/api/src/routes/admin/scheduler.ts:80-230`:
 *   - GET /jobs returns last 20 runs (no job def, no pagination)
 *   - GET /jobs/:name returns job def + last 5 runs
 *   - The `error: 'JOB_NOT_FOUND'` body maps to ApiError(404)
 *   - Rate-limited POST returns 429 — the wrapper does NOT retry,
 *     it surfaces the ApiError so the page can render the 429 toast
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getSchedulerJobs, getSchedulerJob, triggerSchedulerJob, setSchedulerJobEnabled } =
  await import('./scheduler')

const SAMPLE_RUN = {
  id: 'run-1',
  jobName: 'drift-detection',
  status: 'succeeded' as const,
  attempt: 1,
  scheduledAt: '2026-06-27T10:00:00.000Z',
  startedAt: '2026-06-27T10:00:01.000Z',
  finishedAt: '2026-06-27T10:00:05.000Z',
  triggeredBy: 'scheduler' as const,
  errorMessage: null,
  durationMs: 4000,
}

const SAMPLE_JOB_DETAIL = {
  name: 'drift-detection',
  cronExpr: '*/15 * * * *',
  timezone: 'America/Argentina/Buenos_Aires',
  cadenceMinutes: 15,
  enabled: true,
  healthy: true,
  reason: '',
  lastRuns: [SAMPLE_RUN],
}

describe('scheduler admin API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getSchedulerJobs()', () => {
    it('calls GET /api/v1/scheduler/jobs (no params) and returns the items envelope', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [SAMPLE_RUN] })

      const result = await getSchedulerJobs()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/scheduler/jobs')
      expect(result).toEqual({ items: [SAMPLE_RUN] })
    })

    it('returns an empty items array when no runs exist', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })

      const result = await getSchedulerJobs()

      expect(result.items).toEqual([])
    })
  })

  describe('getSchedulerJob(name)', () => {
    it('calls GET /api/v1/scheduler/jobs/<name> and returns the job def + lastRuns', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_JOB_DETAIL)

      const result = await getSchedulerJob('drift-detection')

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/scheduler/jobs/drift-detection')
      expect(result).toEqual(SAMPLE_JOB_DETAIL)
    })

    it('preserves the wire shape: enabled, healthy, lastRuns[] verbatim', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_JOB_DETAIL)

      const result = await getSchedulerJob('scheduled-import')

      expect(result.name).toBe('drift-detection')
      expect(result.cronExpr).toBe('*/15 * * * *')
      expect(result.timezone).toBe('America/Argentina/Buenos_Aires')
      expect(result.cadenceMinutes).toBe(15)
      expect(result.enabled).toBe(true)
      expect(result.healthy).toBe(true)
      expect(Array.isArray(result.lastRuns)).toBe(true)
      expect(result.lastRuns).toHaveLength(1)
    })

    it('propagates ApiError(404) for an unknown job name (JOB_NOT_FOUND)', async () => {
      const notFound = Object.assign(new Error('JOB_NOT_FOUND: Unknown job'), {
        status: 404,
        code: 'JOB_NOT_FOUND',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(notFound)

      await expect(getSchedulerJob('unknown-job')).rejects.toMatchObject({
        status: 404,
        code: 'JOB_NOT_FOUND',
      })
    })
  })

  describe('triggerSchedulerJob(name)', () => {
    it('POSTs to /api/v1/scheduler/jobs/<name>/run-now (no body) and returns jobRunId + status', async () => {
      apiFetchMock.mockResolvedValueOnce({ jobRunId: 'run-new-1', status: 'pending' })

      const result = await triggerSchedulerJob('scheduled-promotion')

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
        {
          method: 'POST',
        },
      )
      expect(result).toEqual({ jobRunId: 'run-new-1', status: 'pending' })
    })

    it('propagates ApiError(429) when rate-limited (does NOT auto-retry)', async () => {
      const rateLimited = Object.assign(new Error('TOO_MANY_REQUESTS: rate limit exceeded'), {
        status: 429,
        code: 'TOO_MANY_REQUESTS',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(rateLimited)

      await expect(triggerSchedulerJob('scheduled-import')).rejects.toMatchObject({
        status: 429,
        code: 'TOO_MANY_REQUESTS',
      })
      expect(apiFetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('setSchedulerJobEnabled(name, enabled)', () => {
    it('PATCHes /api/v1/scheduler/jobs/<name> with { enabled: true }', async () => {
      apiFetchMock.mockResolvedValueOnce({
        name: 'drift-detection',
        cronExpr: '*/15 * * * *',
        timezone: 'America/Argentina/Buenos_Aires',
        cadenceMinutes: 15,
        enabled: true,
      })

      const result = await setSchedulerJobEnabled('drift-detection', true)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/scheduler/jobs/drift-detection', {
        method: 'PATCH',
        body: { enabled: true },
      })
      expect(result.enabled).toBe(true)
      expect(result.name).toBe('drift-detection')
    })

    it('PATCHes with { enabled: false } when disabling a job', async () => {
      apiFetchMock.mockResolvedValueOnce({
        name: 'drift-detection',
        cronExpr: '*/15 * * * *',
        timezone: null,
        cadenceMinutes: 15,
        enabled: false,
      })

      await setSchedulerJobEnabled('drift-detection', false)

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/scheduler/jobs/drift-detection', {
        method: 'PATCH',
        body: { enabled: false },
      })
    })

    it('propagates ApiError(400) when the body is malformed server-side', async () => {
      const badRequest = Object.assign(new Error('VALIDATION_ERROR: enabled is required'), {
        status: 400,
        code: 'VALIDATION_ERROR',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(badRequest)

      await expect(setSchedulerJobEnabled('drift-detection', true)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      })
    })
  })
})
