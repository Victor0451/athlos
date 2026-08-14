'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getOperationalSnapshot } from '@/lib/api/operations'

const REFETCH_INTERVAL_MS = 30_000
const MAX_ATTENTION_GROUPS = 10

type AttentionItem = Awaited<
  ReturnType<typeof getOperationalSnapshot>
>['attention']['items'][number]

interface AttentionGroup {
  jobName: string
  count: number
  latestStartedAt: string | null
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function groupAttentionItems(items: AttentionItem[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup>()

  for (const item of items) {
    const current = groups.get(item.jobName)
    if (!current) {
      groups.set(item.jobName, {
        jobName: item.jobName,
        count: 1,
        latestStartedAt: item.startedAt,
      })
      continue
    }

    current.count += 1
    if (timestamp(item.startedAt) > timestamp(current.latestStartedAt)) {
      current.latestStartedAt = item.startedAt
    }
  }

  return [...groups.values()]
    .sort((left, right) => {
      const leftTimestamp = timestamp(left.latestStartedAt)
      const rightTimestamp = timestamp(right.latestStartedAt)
      if (leftTimestamp !== rightTimestamp) {
        if (rightTimestamp === Number.NEGATIVE_INFINITY) return -1
        if (leftTimestamp === Number.NEGATIVE_INFINITY) return 1
        return rightTimestamp - leftTimestamp
      }
      return left.jobName < right.jobName ? -1 : left.jobName > right.jobName ? 1 : 0
    })
    .slice(0, MAX_ATTENTION_GROUPS)
}

function formatStartedAt(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'Fecha no disponible'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function OperationsAttention({ isAdmin }: { isAdmin: boolean }) {
  const snapshotQuery = useQuery({
    queryKey: ['operational-snapshot'],
    queryFn: getOperationalSnapshot,
    enabled: isAdmin,
    refetchInterval: isAdmin ? REFETCH_INTERVAL_MS : false,
  })

  if (!isAdmin) return null

  if (snapshotQuery.isPending) {
    return (
      <section aria-label="Atención de operaciones" className="space-y-4">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
          <h2 className="font-display text-2xl font-bold text-ink-900">Atención de operaciones</h2>
        </header>
        <div role="status" aria-label="Cargando atención de operaciones" className="space-y-2">
          <span className="sr-only">Cargando atención de operaciones…</span>
          <div aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
          <div aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
        </div>
      </section>
    )
  }

  if (snapshotQuery.isError) {
    return (
      <p aria-label="Atención de operaciones" role="alert">
        No se pudo actualizar la atención de operaciones.
      </p>
    )
  }

  const attention = snapshotQuery.data.attention
  const groups = attention.available ? groupAttentionItems(attention.items) : []

  return (
    <section aria-label="Atención de operaciones" className="space-y-4">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Operaciones</p>
        <h2 className="font-display text-2xl font-bold text-ink-900">Atención de operaciones</h2>
      </header>
      {groups.length === 0 ? (
        <p className="text-sm text-ink-500">Sin ejecuciones que requieran atención.</p>
      ) : (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-100 bg-surface">
          {groups.map((group) => (
            <li key={group.jobName} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-ink-900">
                  {group.jobName}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="rounded border border-danger bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                    {group.count} {group.count === 1 ? 'ejecución' : 'ejecuciones'}
                  </span>
                  <time dateTime={group.latestStartedAt ?? undefined}>
                    {formatStartedAt(group.latestStartedAt)}
                  </time>
                </div>
              </div>
              <Link
                className="shrink-0 text-sm font-medium text-accent underline"
                href={`/admin/scheduler/${encodeURIComponent(group.jobName)}`}
              >
                Revisar {group.jobName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
