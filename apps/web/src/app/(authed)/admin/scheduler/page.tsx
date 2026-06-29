'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getSchedulerJob } from '@/lib/api/scheduler'
import { useAuth } from '@/lib/use-auth'
import { JobCard } from '@/components/scheduler/JobCard'

/**
 * Scheduler list page — `/admin/scheduler` (TASK-033, PR 8c.1).
 *
 * Landing page for the 6 registered scheduler jobs. ADMIN-only.
 * Per the spec:
 *   - One row per job with name + last-run timestamp + status badge
 *   - The whole card is clickable → /admin/scheduler/<name>
 *   - Loading skeleton + error state for the initial load
 *   - "Sin permisos" copy for non-ADMIN operators
 *   - "Próximamente" placeholder for the deferred advanced filters
 *     (date range, status filter, etc. — out of scope for v0.5.17)
 *
 * The page makes 6 parallel `getSchedulerJob(name)` calls — one
 * per known job — to pull the live def + lastRuns. The list is
 * hardcoded because the API has no "list all jobs" endpoint (the
 * scheduler module exposes per-job defs only). The 6 names are
 * stable in v0.5.x per `apps/api/src/jobs/register.ts`.
 *
 * Auto-refresh: `refetchInterval: 30_000` per the dashboard
 * pattern. The page is the only place that shows the per-job
 * detail at a glance, so keeping it fresh is high-value.
 */

const REFETCH_INTERVAL_MS = 30_000

/** The 6 known scheduler jobs. Stable in v0.5.x — sourced from
 *  `apps/api/src/jobs/register.ts:96-145`. */
const KNOWN_JOBS: ReadonlyArray<{ name: string; defaultCron: string }> = [
  { name: 'drift-detection', defaultCron: '*/15 * * * *' },
  { name: 'freshness-refresh', defaultCron: '*/5 * * * *' },
  { name: 'token-cleanup', defaultCron: '0 3 * * *' },
  { name: 'scheduled-import', defaultCron: '0 2 * * *' },
  { name: 'scheduled-promotion', defaultCron: '0 */6 * * *' },
  { name: 'reconciliation', defaultCron: '0 * * * *' },
]

export default function SchedulerListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  // 6 parallel queries — each `getSchedulerJob` is independent and
  // small. The page re-renders once each promise resolves; the
  // loading skeleton is shown while any are still pending.
  const jobQueries = KNOWN_JOBS.map((job) => ({
    job,
    useQueryResult: useQuery({
      queryKey: ['scheduler', 'job', job.name],
      queryFn: () => getSchedulerJob(job.name),
      enabled: isAdmin,
      refetchInterval: REFETCH_INTERVAL_MS,
      retry: 0,
    }),
  }))

  // For the role gate, check first (no queries fired if not ADMIN).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold text-ink-900">Scheduler</h1>
        </header>
        <div
          role="alert"
          data-testid="scheduler-no-permission"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const isLoading = jobQueries.some((q) => q.useQueryResult.isPending)
  const isError = jobQueries.every((q) => q.useQueryResult.isError)

  function onSelect(jobName: string) {
    router.push(`/admin/scheduler/${jobName}`)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Scheduler</h1>
        <p className="mt-1 text-sm text-ink-500">
          Estado de los 6 trabajos programados. Click en un trabajo para ver el detalle y disparar
          corridas manuales.
        </p>
      </header>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Cargando"
          data-testid="scheduler-list-loading"
          className="space-y-2"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-12 animate-pulse rounded bg-surface-sunken"
            />
          ))}
          <span className="sr-only">Cargando…</span>
        </div>
      ) : isError ? (
        <div
          role="alert"
          data-testid="scheduler-list-error"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">
            No se pudo cargar el estado del scheduler
          </p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Verificá la conectividad con el API o intentá nuevamente más tarde.
          </p>
        </div>
      ) : (
        <ul
          className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
          data-testid="scheduler-jobs-list"
        >
          {jobQueries.map(({ job, useQueryResult }) => {
            const data = useQueryResult.data
            const lastRun = data?.lastRuns?.[0] ?? null
            return (
              <JobCard
                key={job.name}
                jobName={job.name}
                cronExpr={data?.cronExpr ?? job.defaultCron}
                enabled={data?.enabled ?? true}
                lastRun={lastRun}
                onSelect={onSelect}
              />
            )
          })}
        </ul>
      )}

      <section
        aria-label="Próximamente"
        data-testid="scheduler-proximamente"
        className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center"
      >
        <p className="font-body text-sm text-ink-500">
          Próximamente — filtros por estado, ventana temporal y búsqueda por nombre de trabajo.
        </p>
      </section>
    </div>
  )
}
