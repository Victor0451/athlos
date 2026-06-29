import { apiFetch } from '@/lib/api'

/**
 * Scheduler API wrappers (PR 8a.3 — Dashboard cards).
 *
 * Two endpoints feed the dashboard's ADMIN-only cards:
 *
 *   GET /api/v1/admin/jobs/health
 *     Returns one row per registered job with liveness + last-run
 *     summary. Drives the "Scheduler Status" card on the dashboard.
 *     The full scheduler admin surface (manual trigger, toggle,
 *     detail) lands in PR 8c.1 — for now the dashboard just shows
 *     the snapshot.
 *
 *   GET /api/v1/admin/jobs/runs?limit=N
 *     Returns the N most-recent runs across ALL jobs (default 50,
 *     hard cap 200). Drives the "Recent Runs" card on the dashboard.
 *
 * Both endpoints are gated by `requireRole('ADMIN')` server-side.
 * The web client sends the bearer token via the shared `apiFetch`
 * wrapper; if a non-ADMIN operator's token reaches the endpoint the
 * API returns 403 and `apiFetch` surfaces the `ApiError` (the
 * dashboard uses TanStack Query's error state to render a fallback
 * rather than a hard redirect — UI role-gating already prevents the
 * page from sending the query).
 *
 * DTO shapes mirror `apps/api/src/routes/admin/jobs.ts` exactly so
 * the types stay in lock-step with the server response.
 */

/* ── /api/v1/admin/jobs/health ──────────────────────────────────── */

export type JobRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter'

export interface JobHealthLastRun {
  id: string
  status: JobRunStatus
  startedAt: string | null
  finishedAt: string | null
  attempt: number
  durationMs: number | null
  errorMessage: string | null
}

export interface JobHealth {
  name: string
  enabled: boolean
  cronExpr: string
  cadenceMinutes: number
  scheduled: boolean
  inFlight: boolean
  healthy: boolean
  reason: string | null
  lastRun: JobHealthLastRun | null
}

export interface SchedulerHealthResponse {
  items: JobHealth[]
}

/* ── /api/v1/admin/jobs/runs ─────────────────────────────────────── */

export interface JobRunDTO {
  id: string
  jobName: string
  status: JobRunStatus
  attempt: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  triggeredBy: 'scheduler' | 'manual' | 'post-import'
  errorMessage: string | null
  durationMs: number | null
}

export interface JobRunsResponse {
  items: JobRunDTO[]
}

/**
 * Fetch the per-job health snapshot. Used by the dashboard's
 * "Scheduler Status" card. ADMIN-only — the UI gates this query
 * with `useAuth().user?.role === 'ADMIN'` so non-ADMIN operators
 * never trigger it.
 */
export function getSchedulerHealth(): Promise<SchedulerHealthResponse> {
  return apiFetch<SchedulerHealthResponse>('/api/v1/admin/jobs/health')
}

/**
 * Fetch the most-recent N job runs across ALL jobs (sorted by
 * `startedAt DESC`). Used by the dashboard's "Recent Runs" card.
 * ADMIN-only.
 */
export function getRecentRuns(limit = 5): Promise<JobRunsResponse> {
  return apiFetch<JobRunsResponse>('/api/v1/admin/jobs/runs', {
    query: { limit },
  })
}

/* ── /api/v1/scheduler/jobs/* (PR 8c.1 — Admin Scheduler page) ──── */

/**
 * Wire shape for a single job_run row. Mirrors
 * `apps/api/src/routes/admin/scheduler.ts:38-49` verbatim (the
 * route does not snake_case the output). The dashboard's
 * `JobRunDTO` above happens to use the same field names — kept
 * a distinct export here so the admin surface can grow new
 * fields (e.g. operatorId on manual runs) without disturbing
 * the dashboard card.
 */
export interface SchedulerJobRun {
  id: string
  jobName: string
  status: string
  attempt: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  triggeredBy: string
  errorMessage: string | null
  durationMs: number | null
}

/** Wire shape of `GET /api/v1/scheduler/jobs` — last 20 runs. */
export interface SchedulerJobsListResponse {
  items: SchedulerJobRun[]
}

/** Wire shape of `GET /api/v1/scheduler/jobs/:name` — def + last runs. */
export interface SchedulerJobDetail {
  name: string
  cronExpr: string
  timezone: string | null
  cadenceMinutes: number
  enabled: boolean
  healthy: boolean
  reason: string | null
  lastRuns: SchedulerJobRun[]
}

/** Wire shape of `POST /api/v1/scheduler/jobs/:name/run-now`. */
export interface SchedulerJobRunResponse {
  jobRunId: string
  status: string
}

/** Wire shape of `PATCH /api/v1/scheduler/jobs/:name`. */
export interface SchedulerJobEnabledResponse {
  name: string
  cronExpr: string
  timezone: string | null
  cadenceMinutes: number
  enabled: boolean
}

/**
 * `getSchedulerJobs()` — last 20 job runs across all registered
 * jobs, ordered by `startedAt DESC`. Powers the
 * `/admin/scheduler` list page (PR 8c.1). ADMIN-only — the
 * server returns 403 for non-ADMIN tokens, surfaced as
 * `ApiError(403)` by `apiFetch` and rendered as an error state
 * by the page (the sidebar role gate already prevents non-ADMIN
 * operators from reaching this URL).
 */
export function getSchedulerJobs(): Promise<SchedulerJobsListResponse> {
  return apiFetch<SchedulerJobsListResponse>('/api/v1/scheduler/jobs')
}

/**
 * `getSchedulerJob(name)` — single job definition + its last 5
 * runs. Powers the `/admin/scheduler/[name]` detail page. The
 * route returns 404 `{ error: 'JOB_NOT_FOUND' }` for unknown
 * names — surfaced as `ApiError(404)` and rendered as the
 * "Trabajo no encontrado" state.
 */
export function getSchedulerJob(name: string): Promise<SchedulerJobDetail> {
  return apiFetch<SchedulerJobDetail>(`/api/v1/scheduler/jobs/${encodeURIComponent(name)}`)
}

/**
 * `triggerSchedulerJob(name)` — fire an immediate one-shot run
 * of the named job. Returns the new `jobRunId` + the
 * server-confirmed `status: 'pending'` envelope. The server
 * rate-limits this endpoint to 1 request per 60 seconds per
 * operator; a 429 surfaces as `ApiError(429)` and the detail
 * page renders a "Espera N segundos antes de volver a disparar"
 * toast (the wrapper does NOT auto-retry — explicit user
 * intent is the contract per the spec).
 */
export function triggerSchedulerJob(name: string): Promise<SchedulerJobRunResponse> {
  return apiFetch<SchedulerJobRunResponse>(
    `/api/v1/scheduler/jobs/${encodeURIComponent(name)}/run-now`,
    { method: 'POST' },
  )
}

/**
 * `setSchedulerJobEnabled(name, enabled)` — toggle the cron
 * schedule ON/OFF. The body is `{ enabled: boolean }`; the
 * server validates with zod and returns 400 on a malformed
 * body (rare — both the detail page and the unit test send a
 * proper boolean). The new `enabled` state is reflected in
 * the response envelope, so the page can update the badge
 * from the response (no second GET round-trip needed).
 */
export function setSchedulerJobEnabled(
  name: string,
  enabled: boolean,
): Promise<SchedulerJobEnabledResponse> {
  return apiFetch<SchedulerJobEnabledResponse>(
    `/api/v1/scheduler/jobs/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: { enabled } },
  )
}
