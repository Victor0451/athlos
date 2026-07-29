'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import {
  getSociosEvidenceExceptions,
  type EvidenceExceptionKind,
  type EvidenceExceptionStatus,
} from '@/lib/api/socios-evidence-exceptions'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'

const PAGE_LIMIT = 20

const KIND: Record<EvidenceExceptionKind, string> = {
  unknown_type: 'Tipo de afiliación sin identificar',
  ambiguous_identity: 'Identidad de socio ambigua',
}

function statusVariant(status: EvidenceExceptionStatus): BadgeVariant {
  return status === 'unresolved' ? 'warning' : 'success'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value))
}

export default function SociosEvidenceExceptionsPage() {
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<EvidenceExceptionKind | 'all'>('all')
  const [status, setStatus] = useState<EvidenceExceptionStatus>('unresolved')
  const query = useQuery({
    queryKey: ['socios-evidence-exceptions', { page, kind, status }],
    queryFn: () =>
      getSociosEvidenceExceptions({
        page,
        limit: PAGE_LIMIT,
        ...(kind !== 'all' ? { kind } : {}),
        status,
      }),
  })

  const noPermission = query.error instanceof ApiError && query.error.status === 403
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  function changeFilters(
    nextKind: EvidenceExceptionKind | 'all',
    nextStatus: EvidenceExceptionStatus,
  ) {
    setPage(1)
    setKind(nextKind)
    setStatus(nextStatus)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            Socios · Excepciones de evidencia
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Casos de padrón que requieren revisión administrativa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 disabled:opacity-50"
        >
          {query.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <section
        aria-label="Filtros"
        className="grid grid-cols-1 gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-2"
      >
        <label className="block text-sm text-ink-700">
          Tipo
          <select
            value={kind}
            onChange={(event) =>
              changeFilters(event.target.value as EvidenceExceptionKind | 'all', status)
            }
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2"
          >
            <option value="all">Todos los tipos</option>
            <option value="unknown_type">Tipo sin identificar</option>
            <option value="ambiguous_identity">Identidad ambigua</option>
          </select>
        </label>
        <label className="block text-sm text-ink-700">
          Estado
          <select
            value={status}
            onChange={(event) => changeFilters(kind, event.target.value as EvidenceExceptionStatus)}
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2"
          >
            <option value="unresolved">Sin resolver</option>
            <option value="resolved">Resueltos</option>
          </select>
        </label>
      </section>

      {query.isPending ? (
        <div
          role="status"
          className="rounded-lg border border-ink-100 bg-surface p-6 text-center text-sm text-ink-500"
        >
          Cargando excepciones…
        </div>
      ) : noPermission ? (
        <div
          role="alert"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-2 text-sm text-ink-500">
            Esta sección requiere permisos de administración o gestión de datos.
          </p>
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">
            No se pudo cargar el listado
          </p>
          <p className="mt-2 text-sm text-ink-500">
            Verificá la conectividad con el API e intentá nuevamente.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          role="status"
          className="rounded-lg border border-ink-100 bg-surface p-6 text-center text-sm text-ink-500"
        >
          No hay excepciones para los filtros seleccionados.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-ink-100 bg-surface">
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  {['Excepción', 'Evidencia', 'Registrada', 'Estado', ''].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-ink-100">
                    <td className="px-4 py-3 text-sm text-ink-900">{KIND[item.kind]}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-500">
                      Evidencia {item.fingerprint.slice(0, 12)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-700">
                      {formatDate(item.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(item.status)}>
                        {item.status === 'unresolved' ? 'Sin resolver' : 'Resuelta'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled
                        title="Detalle disponible próximamente"
                        className="text-sm text-ink-500 disabled:cursor-not-allowed"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Paginación de excepciones" className="flex items-center justify-between">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="rounded-md border border-ink-200 bg-surface px-3 py-1 text-sm disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="font-mono text-xs text-ink-500">
              Página {page} de {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              className="rounded-md border border-ink-200 bg-surface px-3 py-1 text-sm disabled:opacity-50"
            >
              Siguiente
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
