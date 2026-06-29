'use client'

import type { SchedulerJobRun } from '@/lib/api/scheduler'
import { StatusBadge, type StatusBadgeKind } from '@/components/cards/StatusBadge'

/**
 * JobCard — one clickable row in the scheduler job grid (TASK-031, PR 8c.1).
 *
 * Renders a single registered scheduler job (drift-detection,
 * freshness-refresh, etc.) as a stacked-list card. Used by the
 * `/admin/scheduler` list page. The page is responsible for
 * aggregating the most-recent run per jobName from
 * `getSchedulerJobs()` and passing the most-recent run to the
 * card (or `null` for never-run jobs).
 *
 * Visual contract (Gorriti Premium tokens):
 *   - Job name: font-display, semibold, ink-900
 *   - Cron expression: font-mono, xs, ink-500
 *   - Last run: font-mono, xs, ink-500 (es-AR short timestamp)
 *   - Status badge: right-aligned (Operativo / Deshabilitado / Caído)
 *   - Whole card is a `<button>` for keyboard accessibility
 *
 * Status badge logic mirrors the dashboard's
 * `jobHealthToBadge()` helper: not enabled → Deshabilitado,
 * enabled + lastRun failed/dead_letter → Caído, otherwise
 * Operativo. The "Sin corridas" copy renders when the job has
 * never run (lastRun is null) — common for fresh installations
 * or after a manual `job_runs` truncate.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return DATETIME_FMT.format(d)
}

function resolveStatusKind(enabled: boolean, lastRun: SchedulerJobRun | null): StatusBadgeKind {
  if (!enabled) return 'disabled'
  if (lastRun && (lastRun.status === 'failed' || lastRun.status === 'dead_letter')) {
    return 'down'
  }
  return 'healthy'
}

export interface JobCardProps {
  jobName: string
  cronExpr: string
  enabled: boolean
  lastRun: SchedulerJobRun | null
  onSelect: (jobName: string) => void
}

export function JobCard({ jobName, cronExpr, enabled, lastRun, onSelect }: JobCardProps) {
  const badgeKind = resolveStatusKind(enabled, lastRun)
  const lastRunLabel = lastRun
    ? `Última corrida: ${formatTimestamp(lastRun.startedAt ?? lastRun.scheduledAt)}`
    : 'Sin corridas'

  return (
    <li className="border-t border-ink-100 first:border-t-0" data-testid={`job-card-${jobName}`}>
      <button
        type="button"
        onClick={() => onSelect(jobName)}
        aria-label={`Ver detalle de ${jobName}`}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-sm font-semibold text-ink-900">{jobName}</span>
          <span className="font-mono text-xs text-ink-500" data-testid={`job-card-${jobName}-meta`}>
            <span data-testid={`job-card-${jobName}-cron`}>{cronExpr}</span>
            <span aria-hidden="true"> · </span>
            <span data-testid={`job-card-${jobName}-last-run`}>{lastRunLabel}</span>
          </span>
        </span>
        <StatusBadge status={badgeKind} />
      </button>
    </li>
  )
}
