'use client'

import { useQuery } from '@tanstack/react-query'
import { getSociosAggregate } from '@/lib/api/socios'

export function SociosSummary() {
  const summary = useQuery({ queryKey: ['socios', 'aggregate'], queryFn: getSociosAggregate })

  return (
    <section
      aria-label="Resumen de socios"
      className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
    >
      <p className="font-mono text-xs uppercase tracking-widest text-accent">Membresía</p>
      <h2 className="mt-1 font-display text-lg font-bold text-ink-900">Socios</h2>
      {summary.isPending ? (
        <span
          role="status"
          aria-live="polite"
          className="mt-3 block h-8 animate-pulse rounded bg-surface-sunken"
        >
          <span className="sr-only">Cargando resumen de socios…</span>
        </span>
      ) : null}
      {summary.isError ? (
        <p role="alert" aria-label="Resumen de socios" className="mt-2 text-sm text-ink-500">
          No se pudo cargar el resumen de socios. Intentá nuevamente.
        </p>
      ) : null}
      {summary.data ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded border border-ink-200 bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            {summary.data.total} socios
          </span>
          <span className="rounded border border-success bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
            {summary.data.activos} activos
          </span>
          <span className="rounded border border-warning bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
            {summary.data.suspendidos} suspendidos
          </span>
          <span className="rounded border border-danger bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
            {summary.data.baja} bajas
          </span>
        </div>
      ) : null}
    </section>
  )
}
