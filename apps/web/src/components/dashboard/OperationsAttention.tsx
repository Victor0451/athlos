'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getOperationalSnapshot } from '@/lib/api/operations'

const REFETCH_INTERVAL_MS = 30_000
const MAX_ATTENTION_LINKS = 10

export function OperationsAttention({ isAdmin }: { isAdmin: boolean }) {
  const snapshotQuery = useQuery({
    queryKey: ['operational-snapshot'],
    queryFn: getOperationalSnapshot,
    enabled: isAdmin,
    refetchInterval: isAdmin ? REFETCH_INTERVAL_MS : false,
  })

  if (!isAdmin) return null

  if (snapshotQuery.isPending) {
    return <p aria-label="Atención de operaciones">Cargando atención de operaciones…</p>
  }

  if (snapshotQuery.isError) {
    return (
      <p aria-label="Atención de operaciones" role="alert">
        No se pudo actualizar la atención de operaciones.
      </p>
    )
  }

  const attention = snapshotQuery.data.attention
  const items = attention.available ? attention.items.slice(0, MAX_ATTENTION_LINKS) : []

  return (
    <section aria-label="Atención de operaciones">
      <h2 className="font-display text-lg font-semibold text-ink-900">Atención de operaciones</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No hay señales que requieran atención.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                className="text-sm font-medium text-club-700 underline"
                href={`/admin/scheduler/${encodeURIComponent(item.jobName)}`}
              >
                {item.jobName}
              </Link>
              <p className="text-sm text-ink-500">Esta ejecución requiere atención.</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
