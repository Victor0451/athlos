import type { SchedulerJobRun } from '@/lib/api/scheduler'
import { StatusBadge, type StatusBadgeKind } from '@/components/cards/StatusBadge'

/**
 * RunList — recent runs for a single scheduler job (TASK-032, PR 8c.1).
 *
 * Renders the `lastRuns[]` payload from
 * `GET /api/v1/scheduler/jobs/<name>` (the API returns the last
 * 5 runs). Used by the `/admin/scheduler/<name>` detail page.
 *
 * Visual contract:
 *   - Header strip: run count + "corridas" copy
 *   - One row per run: status badge, started timestamp, duration
 *     in seconds, attempt number, triggeredBy label
 *   - Failed runs surface the `errorMessage` inline (muted text
 *     so the operator can scan for failures quickly)
 *   - Loading state: 5 skeleton rows + SR-only "Cargando…"
 *   - Empty state: "Sin corridas registradas"
 *
 * Status mapping mirrors the dashboard's `runStatusToBadge()`:
 * succeeded → Operativo, failed / dead_letter → Caído, running
 * or pending → Degradado, anything else → Desconocido.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

/** ms → "N.Ns" string (one decimal place, es-AR locale). */
function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return DATETIME_FMT.format(d)
}

function runStatusToBadge(status: string): StatusBadgeKind {
  switch (status) {
    case 'succeeded':
      return 'healthy'
    case 'failed':
    case 'dead_letter':
      return 'down'
    case 'running':
    case 'pending':
      return 'degraded'
    default:
      return 'unknown'
  }
}

const TRIGGERED_BY_LABEL: Record<string, string> = {
  scheduler: 'Automática',
  manual: 'Manual',
  'post-import': 'Post-import',
}

function triggeredByLabel(t: string): string {
  return TRIGGERED_BY_LABEL[t] ?? t
}

export interface RunListProps {
  runs: SchedulerJobRun[]
  loading?: boolean
}

export function RunList({ runs, loading = false }: RunListProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid="run-list-loading"
        className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
      >
        <ul className="divide-y divide-ink-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} aria-hidden="true" className="flex items-center justify-between px-4 py-3">
              <span className="block h-3 w-40 animate-pulse rounded bg-surface-sunken" />
              <span className="block h-3 w-16 animate-pulse rounded bg-surface-sunken" />
            </li>
          ))}
        </ul>
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  return (
    <section
      aria-label="Corridas recientes"
      data-testid="run-list"
      className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
    >
      <header className="flex items-baseline justify-between border-b border-ink-100 bg-surface-sunken px-4 py-2">
        <h3 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
          Corridas recientes
        </h3>
        <span className="font-mono text-xs text-ink-500" data-testid="run-list-count">
          {runs.length} {runs.length === 1 ? 'corrida' : 'corridas'}
        </span>
      </header>

      {runs.length === 0 ? (
        <p
          className="px-6 py-12 text-center font-body text-sm text-ink-500"
          data-testid="run-list-empty"
        >
          Sin corridas registradas.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {runs.map((run) => {
            const isFailed = run.status === 'failed' || run.status === 'dead_letter'
            return (
              <li
                key={run.id}
                data-testid={`run-row-${run.id}`}
                className={isFailed ? 'px-4 py-3 text-ink-500' : 'px-4 py-3'}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={
                        isFailed
                          ? 'font-mono text-xs text-ink-500'
                          : 'font-mono text-xs text-ink-700'
                      }
                    >
                      {formatTimestamp(run.startedAt)} · Intento {run.attempt} ·{' '}
                      {triggeredByLabel(run.triggeredBy)}
                    </span>
                    {isFailed && run.errorMessage ? (
                      <span
                        className="font-body text-xs text-danger"
                        data-testid={`run-row-${run.id}-error`}
                      >
                        {run.errorMessage}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-ink-500">
                      {formatDuration(run.durationMs)}
                    </span>
                    <StatusBadge status={runStatusToBadge(run.status)} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
