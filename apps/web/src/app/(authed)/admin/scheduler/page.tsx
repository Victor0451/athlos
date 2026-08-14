'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getSchedulerHealth } from '@/lib/api/scheduler'
import { useAuth } from '@/lib/use-auth'
import { JobCard } from '@/components/scheduler/JobCard'

/**
 * Scheduler list page — `/admin/scheduler` (TASK-033, PR 8c.1).
 *
 * Landing page for registered scheduler jobs. ADMIN-only.
 * Per the spec:
 *   - One row per job with name + last-run timestamp + status badge
 *   - The whole card is clickable → /admin/scheduler/<name>
 *   - Loading skeleton + error state for the initial load
 *   - "Sin permisos" copy for non-ADMIN operators
 *   - "Próximamente" placeholder for the deferred advanced filters
 *     (date range, status filter, etc. — out of scope for v0.5.17)
 *
 * The page reads one dynamic registry-backed health payload, so newly
 * registered jobs appear without a client release.
 *
 * Auto-refresh: `refetchInterval: 30_000` per the dashboard
 * pattern. The page is the only place that shows the per-job
 * detail at a glance, so keeping it fresh is high-value.
 */

const REFETCH_INTERVAL_MS = 30_000

export default function SchedulerListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const jobsQuery = useQuery({
    queryKey: ['scheduler', 'health'],
    queryFn: getSchedulerHealth,
    enabled: isAdmin,
    refetchInterval: REFETCH_INTERVAL_MS,
    retry: 0,
  })

  // For the role gate, check first (no queries fired if not ADMIN).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">Scheduler</h1>
          <p className="mt-1 text-sm text-ink-500">Estado de los trabajos programados.</p>
        </header>
        <div
          role="alert"
          data-testid="scheduler-no-permission"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-1 text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const isLoading = jobsQuery.isPending
  const isError = jobsQuery.isError
  const jobs = jobsQuery.data?.items ?? []

  function onSelect(jobName: string) {
    router.push(`/admin/scheduler/${jobName}`)
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Scheduler</h1>
        <p className="mt-1 text-sm text-ink-500">
          Estado de los trabajos programados. Seleccione un trabajo para ver el detalle y ejecutar
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
          {Array.from({ length: 3 }).map((_, i) => (
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
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">
            No se pudo cargar el estado del scheduler
          </p>
          <p className="mt-1 text-ink-500">
            Verifique la conectividad con el API o intente nuevamente más tarde.
          </p>
        </div>
      ) : (
        <ul
          className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-100 bg-surface shadow-sm"
          data-testid="scheduler-jobs-list"
        >
          {jobs.length === 0 ? (
            <li className="p-4 text-sm text-ink-500">No hay trabajos programados registrados.</li>
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.name}
                jobName={job.name}
                cronExpr={job.cronExpr}
                enabled={job.enabled}
                lastRun={job.lastRun}
                onSelect={onSelect}
              />
            ))
          )}
        </ul>
      )}

      <section
        aria-label="Próximamente"
        data-testid="scheduler-proximamente"
        className="rounded-lg border border-ink-100 bg-surface p-4 text-sm text-ink-500 shadow-sm"
      >
        Próximamente: filtros por estado, ventana temporal y búsqueda por nombre de trabajo.
      </section>
    </div>
  )
}
