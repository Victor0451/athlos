'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGastos, type Gasto } from '@/lib/api/gastos'
import { useAuth } from '@/lib/use-auth'

/**
 * Admin gastos list page — `/admin/gastos` (TASK-011, PR n16b-web).
 *
 * N16 ships gastos CRUD for the 2,114-row expense ledger. Per spec:
 *   - Filters: `cuenta_principal` text, date-range (fecha_desde/hasta),
 *     `anulado` toggle (true/false)
 *   - Table columns: cuenta_principal, fecha, concepto, importe, link_count,
 *     anulado badge
 *   - Per-row click → `/admin/gastos/<id>`
 *   - ADMIN-only (`requireRole('ADMIN')` server-side; this page gates
 *     the `useQuery` so non-ADMIN operators never fire the request)
 *   - Loading skeleton + error state on initial load
 */

const PAGE_LIMIT = 50

export default function GastosListPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [cuentaPrincipal, setCuentaPrincipal] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [showAnulado, setShowAnulado] = useState<'all' | 'true' | 'false'>('all')

  const query = useQuery({
    queryKey: ['gastos', { page, cuentaPrincipal, fechaDesde, fechaHasta, showAnulado }],
    queryFn: () => {
      const params: {
        page: number
        limit: number
        cuentaPrincipal?: string
        fechaDesde?: string
        fechaHasta?: string
        anulado?: boolean
      } = { page, limit: PAGE_LIMIT }
      if (cuentaPrincipal) params.cuentaPrincipal = cuentaPrincipal
      if (fechaDesde) params.fechaDesde = fechaDesde
      if (fechaHasta) params.fechaHasta = fechaHasta
      if (showAnulado !== 'all') params.anulado = showAnulado === 'true'
      return getGastos(params)
    },
    enabled: isAdmin,
  })

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold text-ink-900">Tesorería · Gastos</h1>
        </header>
        <div
          role="alert"
          data-testid="gastos-no-permission"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Tesorería · Gastos</h1>
        <p className="mt-1 text-sm text-ink-500">
          Listado paginado del libro mayor de gastos. Click en una fila para ver el detalle y los
          movimientos de cuenta corriente vinculados.
        </p>
      </header>

      <section
        aria-label="Filtros"
        data-testid="gastos-filters"
        className="grid grid-cols-1 gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-4"
      >
        <label className="block">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Cuenta principal
          </span>
          <input
            type="text"
            value={cuentaPrincipal}
            onChange={(e) => setCuentaPrincipal(e.target.value)}
            placeholder="6003009"
            data-testid="gastos-filter-cuenta"
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-mono text-sm text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="block">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Desde
          </span>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            data-testid="gastos-filter-desde"
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="block">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Hasta
          </span>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            data-testid="gastos-filter-hasta"
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="block">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Anulado
          </span>
          <select
            value={showAnulado}
            onChange={(e) => setShowAnulado(e.target.value as 'all' | 'true' | 'false')}
            data-testid="gastos-filter-anulado"
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">Todos</option>
            <option value="false">Activos</option>
            <option value="true">Anulados</option>
          </select>
        </label>
      </section>

      {query.isPending ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Cargando"
          data-testid="gastos-list-loading"
          className="space-y-2"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-10 animate-pulse rounded bg-surface-sunken"
            />
          ))}
          <span className="sr-only">Cargando…</span>
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          data-testid="gastos-list-error"
          className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
        >
          <p className="font-display text-lg font-semibold text-ink-900">
            No se pudo cargar el listado de gastos
          </p>
          <p className="mt-2 font-body text-sm text-ink-500">
            Verificá la conectividad con el API o intentá nuevamente más tarde.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          role="status"
          data-testid="gastos-list-empty"
          className="rounded-lg border border-ink-100 bg-surface p-6 text-center"
        >
          <p className="font-body text-sm text-ink-500">
            Sin resultados para los filtros seleccionados.
          </p>
        </div>
      ) : (
        <>
          <div
            className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
            data-testid="gastos-list"
          >
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Cuenta
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Concepto
                  </th>
                  <th className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Importe
                  </th>
                  <th className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Vínculos
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((g: Gasto & { linkCount: number }) => (
                  <tr
                    key={g.id}
                    data-testid={`gastos-row-${g.id}`}
                    onClick={() => router.push(`/admin/gastos/${g.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        router.push(`/admin/gastos/${g.id}`)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    className="cursor-pointer border-t border-ink-100 transition-colors duration-fast hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <td className="px-4 py-3 font-mono text-sm text-ink-900">
                      {g.cuentaPrincipal}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-ink-700">{g.fecha}</td>
                    <td className="px-4 py-3 font-body text-sm text-ink-700">
                      {g.concepto ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm tabular-nums text-ink-900">
                      {g.importe}
                    </td>
                    <td className="px-4 py-3 text-right font-body text-sm tabular-nums text-ink-700">
                      {g.linkCount}
                    </td>
                    <td className="px-4 py-3 font-body text-sm">
                      {g.anulado ? (
                        <span
                          data-testid={`gastos-anulado-${g.id}`}
                          className="inline-block rounded-full bg-danger/10 px-2 py-1 font-display text-xs font-semibold text-danger"
                        >
                          Anulado
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-success/10 px-2 py-1 font-display text-xs font-semibold text-success">
                          Activo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav
            aria-label="Paginación de gastos"
            className="flex items-center justify-between"
            data-testid="gastos-pagination"
          >
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="font-mono text-xs text-ink-500">
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              Siguiente
            </button>
          </nav>
        </>
      )}

      <p className="text-center font-body text-xs text-ink-500">
        <Link href="/admin" className="text-accent hover:text-accent-hover">
          Volver al panel de admin
        </Link>
      </p>
    </div>
  )
}
