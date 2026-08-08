'use client'

import { useQuery } from '@tanstack/react-query'
import { getSociosAggregate } from '@/lib/api/socios'

export function SociosSummary() {
  const summary = useQuery({ queryKey: ['socios', 'aggregate'], queryFn: getSociosAggregate })

  return (
    <section
      aria-label="Resumen de socios"
      className="rounded-lg bg-surface-elevated p-4 shadow-sm"
    >
      <h2 className="font-display text-sm font-semibold text-ink-900">Socios</h2>
      {summary.isPending ? (
        <p className="mt-2 text-sm text-ink-500">Cargando resumen de socios…</p>
      ) : null}
      {summary.isError ? (
        <p role="alert" aria-label="Resumen de socios" className="mt-2 text-sm text-ink-500">
          No se pudo cargar el resumen de socios. Intentá nuevamente.
        </p>
      ) : null}
      {summary.data ? (
        <p className="mt-2 text-sm text-ink-700">
          {summary.data.total} socios · {summary.data.activos} activos · {summary.data.suspendidos}{' '}
          suspendidos · {summary.data.baja} bajas
        </p>
      ) : null}
    </section>
  )
}
