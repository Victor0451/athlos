'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/use-auth'
import { getOperationalSnapshot } from '@/lib/api/operations'
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

  const snapshotQuery = useQuery({
    queryKey: ['dashboard', 'operational-snapshot'],
    queryFn: getOperationalSnapshot,
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

      <section
        aria-label="Readiness"
        className="rounded-lg bg-surface-elevated p-4 shadow-sm"
        data-testid="dashboard-health-card"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Readiness
          </h2>
          {snapshotQuery.isPending ? (
            <StatusBadge status="unknown" />
          ) : snapshotQuery.data ? (
            <StatusBadge
              status={snapshotQuery.data.readiness.overall === 'ready' ? 'healthy' : 'down'}
            />
          ) : (
            <StatusBadge status="unknown" />
          )}
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <MetricCard
            label="DB"
            value={snapshotQuery.data?.readiness.db === 'ready' ? 'Operativa' : 'No disponible'}
            loading={snapshotQuery.isPending}
          />
          <MetricCard
            label="Schema"
            value={snapshotQuery.data?.readiness.schema === 'ready' ? 'Operativo' : 'No disponible'}
            loading={snapshotQuery.isPending}
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
            {snapshotQuery.data ? `${snapshotQuery.data.freshness.items.length} dominios` : '—'}
          </span>
        </header>
        {!snapshotQuery.data?.freshness.available && !snapshotQuery.isPending ? (
          <p className="mt-3 text-sm text-ink-500">
            Sin datos de frescura. Reintentando automáticamente…
          </p>
        ) : null}
        <dl
          className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="master-counts-grid"
        >
          {snapshotQuery.isPending
            ? Array.from({ length: 8 }).map((_, i) => (
                <MetricCard key={i} label="…" value="…" loading />
              ))
            : (snapshotQuery.data?.freshness.items ?? []).map((item) => (
                <MetricCard
                  key={item.domain}
                  label={item.domain}
                  value={formatNumber(item.recordCount)}
                  sublabel={`${item.status} · ${item.ageDisplay} · ${formatTimestamp(item.lastImportAt)}`}
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
                {snapshotQuery.data ? `${snapshotQuery.data.jobs.items.length} trabajos` : '—'}
              </span>
            </header>
            {snapshotQuery.isPending ? (
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
            ) : !snapshotQuery.data?.jobs.available ? (
              <p className="mt-3 text-sm text-ink-500">Sin datos de trabajos.</p>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="scheduler-jobs-list">
                {(snapshotQuery.data?.jobs.items ?? []).map((job) => (
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
                {snapshotQuery.data
                  ? `${Math.min(snapshotQuery.data.attention.items.length, 10)} corridas`
                  : '—'}
              </span>
            </header>
            {snapshotQuery.isPending ? (
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
            ) : !snapshotQuery.data?.attention.available ? (
              <p className="mt-3 text-sm text-ink-500">Sin datos de atención.</p>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="recent-runs-list">
                {(snapshotQuery.data?.attention.items ?? []).slice(0, 10).map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2"
                    data-testid={`attention-run-${run.id}`}
                  >
                    <div>
                      <p className="font-display text-sm font-semibold text-ink-900">
                        {run.jobName}
                      </p>
                      <p className="font-mono text-[11px] text-ink-500">
                        {formatTimestamp(run.startedAt)} ·{' '}
                        {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                      </p>
                      {run.reason ? (
                        <p className="font-mono text-[11px] text-ink-500">{run.reason.message}</p>
                      ) : null}
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
