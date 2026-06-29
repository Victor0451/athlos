'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/use-auth'
import { getFreshness, getHealth } from '@/lib/api/health'
import { getRecentRuns, getSchedulerHealth } from '@/lib/api/scheduler'
import { MetricCard } from '@/components/cards/MetricCard'
import { StatusBadge, type StatusBadgeKind } from '@/components/cards/StatusBadge'

/**
 * Dashboard landing page (`/dashboard`) — PR 8a.3.
 *
 * Per `web-frontend/spec.md` (Dashboard Cards):
 *   - API Health card — status + version + uptime from `GET /health`
 *   - Master Table Counts card — row counts from `GET /api/v1/freshness`
 *   - Scheduler Status + Recent Runs cards — ADMIN-only
 *   - All cards auto-refresh every 30 seconds via TanStack Query's
 *     `refetchInterval`
 *
 * The four cards are independent `useQuery` instances so one slow
 * fetch never blocks another (e.g. an `uptime` delay does not stall
 * the freshness list). The `staleTime` default (5min) lives in the
 * `QueryProvider`; the `refetchInterval: 30_000` on each query is
 * the spec's 30s auto-refresh.
 *
 * Date formatting: `Intl.DateTimeFormat('es-AR', ...)` for timestamps
 * — the dashboard is the first place we need it. Helper duplicated
 * inline for now; PR 8b.1 extracts a `lib/format.ts` for the
 * Socios/Ctacte surfaces.
 */

const REFETCH_INTERVAL_MS = 30_000

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n)
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d)
  } catch {
    return '—'
  }
}

function jobHealthToBadge(healthy: boolean, enabled: boolean): StatusBadgeKind {
  if (!enabled) return 'disabled'
  if (!healthy) return 'down'
  return 'healthy'
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

export default function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  // Always-on queries.
  const healthQuery = useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: getHealth,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
  const freshnessQuery = useQuery({
    queryKey: ['dashboard', 'freshness'],
    queryFn: getFreshness,
    refetchInterval: REFETCH_INTERVAL_MS,
  })

  // ADMIN-only queries — the role check in `enabled` prevents the
  // query from firing for non-ADMIN operators (matches the spec's
  // "ADMIN only" requirement without bouncing them to /dashboard).
  const schedulerQuery = useQuery({
    queryKey: ['dashboard', 'scheduler-health'],
    queryFn: getSchedulerHealth,
    enabled: isAdmin,
    refetchInterval: REFETCH_INTERVAL_MS,
  })
  const recentRunsQuery = useQuery({
    queryKey: ['dashboard', 'recent-runs'],
    queryFn: () => getRecentRuns(5),
    enabled: isAdmin,
    refetchInterval: REFETCH_INTERVAL_MS,
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Resumen operativo del club. Las tarjetas se actualizan automáticamente cada 30 segundos.
        </p>
      </header>

      {/* API Health */}
      <section
        aria-label="Salud del API"
        className="rounded-lg bg-surface-elevated p-4 shadow-sm"
        data-testid="dashboard-health-card"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            API
          </h2>
          {healthQuery.isPending ? (
            <StatusBadge status="unknown" />
          ) : healthQuery.data ? (
            <StatusBadge status={healthQuery.data.status === 'ok' ? 'healthy' : 'down'} />
          ) : (
            <StatusBadge status="unknown" />
          )}
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <MetricCard
            label="Versión"
            value={healthQuery.data?.version ?? '—'}
            loading={healthQuery.isPending}
          />
          <MetricCard
            label="Uptime"
            value={healthQuery.data ? formatUptime(healthQuery.data.uptime) : '—'}
            loading={healthQuery.isPending}
          />
        </dl>
      </section>

      {/* Master Table Counts */}
      <section
        aria-label="Conteos de tablas maestras"
        className="rounded-lg bg-surface-elevated p-4 shadow-sm"
        data-testid="dashboard-master-counts-card"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Tablas maestras
          </h2>
          <span className="font-mono text-xs text-ink-300">
            {freshnessQuery.data ? `${freshnessQuery.data.items.length} dominios` : '—'}
          </span>
        </header>
        {freshnessQuery.isError ? (
          <p className="mt-3 text-sm text-ink-500">
            No se pudieron cargar los conteos. Reintentando automáticamente…
          </p>
        ) : null}
        <dl
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="master-counts-grid"
        >
          {freshnessQuery.isPending
            ? Array.from({ length: 8 }).map((_, i) => (
                <MetricCard key={i} label="…" value="…" loading />
              ))
            : (freshnessQuery.data?.items ?? []).map((item) => (
                <MetricCard
                  key={item.domain}
                  label={item.domain}
                  value={formatNumber(item.row_count)}
                  sublabel={`Actualizado ${formatTimestamp(item.last_update)}`}
                />
              ))}
        </dl>
      </section>

      {/* Scheduler Status + Recent Runs (ADMIN-only) */}
      {isAdmin ? (
        <section
          aria-label="Estado del scheduler"
          className="grid gap-4 lg:grid-cols-2"
          data-testid="dashboard-admin-section"
        >
          <div
            className="rounded-lg bg-surface-elevated p-4 shadow-sm"
            data-testid="dashboard-scheduler-card"
          >
            <header className="flex items-baseline justify-between">
              <h2 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Scheduler
              </h2>
              <span className="font-mono text-xs text-ink-300">
                {schedulerQuery.data ? `${schedulerQuery.data.items.length} trabajos` : '—'}
              </span>
            </header>
            {schedulerQuery.isPending ? (
              <ul className="mt-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
                  >
                    <span className="block h-3 w-32 animate-pulse rounded bg-surface" />
                    <span className="block h-3 w-16 animate-pulse rounded bg-surface" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="scheduler-jobs-list">
                {(schedulerQuery.data?.items ?? []).map((job) => (
                  <li
                    key={job.name}
                    className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
                    data-testid={`scheduler-job-${job.name}`}
                  >
                    <div>
                      <p className="font-display text-sm font-semibold text-ink-900">{job.name}</p>
                      <p className="font-mono text-[11px] text-ink-500">
                        {job.cronExpr} ·{' '}
                        {job.lastRun
                          ? `última: ${formatTimestamp(job.lastRun.startedAt)}`
                          : 'sin corridas'}
                      </p>
                    </div>
                    <StatusBadge status={jobHealthToBadge(job.healthy, job.enabled)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            className="rounded-lg bg-surface-elevated p-4 shadow-sm"
            data-testid="dashboard-recent-runs-card"
          >
            <header className="flex items-baseline justify-between">
              <h2 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Corridas recientes
              </h2>
              <span className="font-mono text-xs text-ink-300">
                {recentRunsQuery.data ? `${recentRunsQuery.data.items.length} corridas` : '—'}
              </span>
            </header>
            {recentRunsQuery.isPending ? (
              <ul className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
                  >
                    <span className="block h-3 w-40 animate-pulse rounded bg-surface" />
                    <span className="block h-3 w-12 animate-pulse rounded bg-surface" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="recent-runs-list">
                {(recentRunsQuery.data?.items ?? []).map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
                    data-testid={`recent-run-${run.id}`}
                  >
                    <div>
                      <p className="font-display text-sm font-semibold text-ink-900">
                        {run.jobName}
                      </p>
                      <p className="font-mono text-[11px] text-ink-500">
                        {formatTimestamp(run.startedAt)} ·{' '}
                        {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                      </p>
                    </div>
                    <StatusBadge status={runStatusToBadge(run.status)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
