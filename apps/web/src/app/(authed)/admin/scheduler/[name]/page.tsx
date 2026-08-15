'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSchedulerJob } from '@/lib/api/scheduler'
import { useAuth } from '@/lib/use-auth'
import { RunList } from '@/components/scheduler/RunList'
import { TriggerButton } from '@/components/scheduler/TriggerButton'
import { EnableToggle } from '@/components/scheduler/EnableToggle'
import { StatusBadge, type StatusBadgeKind } from '@/components/cards/StatusBadge'

/**
 * Scheduler detail page — `/admin/scheduler/[name]` (TASK-034, PR 8c.1).
 *
 * Shows one scheduler job's full detail. Per the spec:
 *   - Job name + cron + timezone + cadence metadata strip
 *   - Last 5 runs (RunList) with status, duration, attempt, error
 *   - "Disparar ahora" button (TriggerButton) with confirm dialog
 *   - Enable/disable toggle (EnableToggle)
 *   - ADMIN-only: non-ADMIN operators see "Sin permisos" + no fetch
 *   - 404 for unknown job name → "Trabajo no encontrado" + back link
 *   - Refetches after a successful trigger or toggle
 *   - Loading skeleton + error state on initial load
 *
 * State management:
 *   - `useQuery(['scheduler', 'job', name])` is the source of truth
 *   - TriggerButton / EnableToggle call the mutation and on success
 *     call `queryClient.invalidateQueries(...)` so the page refetches
 *     and the new state (enabled flag, fresh lastRuns) renders
 */

export default function SchedulerDetailPage() {
  const params = useParams<{ name: string }>()
  const name = params?.name ?? ''
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const jobQuery = useQuery({
    queryKey: ['scheduler', 'job', name],
    queryFn: () => getSchedulerJob(name),
    enabled: isAdmin && name.length > 0,
    refetchInterval: 30_000,
    retry: 0,
  })

  // Role gate first (no fetch fires if not ADMIN).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">Scheduler</h1>
          <p className="mt-1 text-sm text-ink-500">Estado y control de un trabajo programado.</p>
        </header>
        <div
          role="alert"
          data-testid="scheduler-detail-no-permission"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-1 text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block font-body text-sm text-accent hover:text-accent-hover"
          >
            Volver al dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (jobQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid="scheduler-detail-loading"
        className="space-y-4"
      >
        <div aria-hidden="true" className="h-8 w-64 animate-pulse rounded bg-surface-sunken" />
        <div aria-hidden="true" className="h-24 animate-pulse rounded bg-surface-sunken" />
        <div aria-hidden="true" className="h-48 animate-pulse rounded bg-surface-sunken" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (jobQuery.isError) {
    // Duck-typed status check (works for both real ApiError and
    // the test's Object.assign mocks). 404 → "Trabajo no encontrado",
    // any other failure → generic error copy.
    const status = (jobQuery.error as { status?: number } | null)?.status
    const isNotFound = status === 404
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {isNotFound ? 'Trabajo no encontrado' : 'Error'}
          </h1>
          <p className="mt-1 text-sm text-ink-500">Estado y control de un trabajo programado.</p>
        </header>
        <div
          role="alert"
          data-testid={isNotFound ? 'scheduler-detail-not-found' : 'scheduler-detail-error'}
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">
            {isNotFound ? 'Trabajo no encontrado' : 'No se pudo cargar el trabajo'}
          </p>
          <p className="mt-1 text-ink-500">
            {isNotFound
              ? `No existe un trabajo registrado con el nombre "${name}".`
              : 'Verifique la conectividad con el API o intente nuevamente más tarde.'}
          </p>
          <Link
            href="/admin/scheduler"
            data-testid="scheduler-detail-back-link"
            className="mt-4 inline-block font-body text-sm text-accent hover:text-accent-hover"
          >
            Volver al listado
          </Link>
        </div>
      </div>
    )
  }

  const job = jobQuery.data!
  const lastRuns = job.lastRuns ?? []

  // Status badge: same kind logic as JobCard (so a disabled job
  // surfaces the "Deshabilitado" pill per the spec scenario).
  const statusKind: StatusBadgeKind = !job.enabled
    ? 'disabled'
    : job.healthy
      ? 'healthy'
      : 'degraded'

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/scheduler"
          className="font-body text-sm text-accent hover:text-accent-hover"
        >
          ← Volver al listado
        </Link>
        <p className="mt-2 font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink-900">{job.name}</h1>
          <StatusBadge status={statusKind} />
        </div>
        <p className="mt-1 text-sm text-ink-500">
          <span className="font-mono text-xs text-ink-500">
            {job.cronExpr}
            {job.timezone ? ` · ${job.timezone}` : null} · {job.cadenceMinutes} min
          </span>
        </p>
      </header>

      <div
        className="flex flex-wrap items-center justify-between gap-3"
        data-testid="scheduler-detail-actions"
      >
        <EnableToggle
          jobName={job.name}
          enabled={job.enabled}
          onToggled={() => {
            void queryClient.invalidateQueries({ queryKey: ['scheduler', 'job', name] })
          }}
          onError={(message) => {
            console.error('[scheduler] toggle failed:', message)
          }}
        />
        <TriggerButton
          jobName={job.name}
          onTriggered={() => {
            void queryClient.invalidateQueries({ queryKey: ['scheduler', 'job', name] })
          }}
        />
      </div>

      <RunList runs={lastRuns} />
    </div>
  )
}
