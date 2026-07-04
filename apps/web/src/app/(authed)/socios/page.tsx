'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useQueries } from '@tanstack/react-query'
import {
  getSocios,
  getSociosAggregate,
  type Socio,
  type SocioAggregate,
  type SocioListParams,
} from '@/lib/api/socios'
import { DataTable, type ColumnDef } from '@/components/tables/DataTable'
import { Monogram } from '@/components/ui/Monogram'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/lib/use-auth'

/**
 * Socios list page — `/socios` (TASK-020 + TASK-022, PR 8b.1; second
 * slice: cards + monogram + sort, PR 8b.2 second slice).
 *
 * Per `web-frontend/spec.md` + orchestrator brief:
 *   - 20-per-page paginated table against `GET /api/v1/socios`
 *   - Search input filters by `nombre + apellido + dni` server-side
 *     (case-insensitive, per `apps/api/src/modules/socios/service.ts`)
 *   - Estado filter dropdown (Todos / Activo / Suspendido / Baja)
 *   - Summary cards (Activos / Suspendidos / Baja / Total) on top,
 *     populated by `GET /api/v1/socios?aggregate=1`
 *   - Monogram avatar in the first column of each row
 *   - Click-to-sort on key columns via the DataTable primitive
 *   - Each row is clickable → navigates to `/socios/<id>` (detail)
 *   - ADMIN sees a "+ Nuevo" button linking to `/socios/new`
 *   - URL state via nuqs (`?search=…&estado=…&page=…&sortBy=…&sortDir=…`)
 *
 * URL-state strategy (TASK-022):
 *   - `useQueryStates` from `nuqs` powers all five URL params
 *   - The search input is a controlled field; submitting the form
 *     pushes `{ search, page: 1 }` so the new search resets to page 1
 *   - The estado `<select>` updates on `change` (same page reset)
 *   - The sort headers update `sortBy` / `sortDir` (no page reset —
 *     sort applies to the current page set; offset pagination on a
 *     stable backend ORDER BY makes the change visibly meaningful
 *     across page boundaries).
 *   - The pagination buttons call `setPage(...)` directly
 *   - The summary cards fetch in parallel via `useQueries` so the
 *     table never blocks on the aggregate query
 */

const PAGE_LIMIT = 20

const urlStateSchema = {
  search: parseAsString.withDefault(''),
  estado: parseAsString.withDefault(''),
  categoria: parseAsString.withDefault(''),
  fechaDesde: parseAsString.withDefault(''),
  fechaHasta: parseAsString.withDefault(''),
  hasEmail: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  sortBy: parseAsString.withDefault(''),
  sortDir: parseAsString.withDefault(''),
}

interface UrlState {
  search: string
  estado: string
  categoria: string
  fechaDesde: string
  fechaHasta: string
  hasEmail: string
  page: number
  sortBy: string
  sortDir: string
}

function formatCount(n: number): string {
  return n.toLocaleString('es-AR')
}

type SortDirValue = 'asc' | 'desc'

/** Sort keys accepted by the backend enum — narrow type. */
type ListSortBy = NonNullable<SocioListParams['sortBy']>

function isSortDirValue(s: string): s is SortDirValue {
  return s === 'asc' || s === 'desc'
}

const SORTABLE_KEYS = [
  'apellido',
  'nombre',
  'numero_socio',
  'dni',
  'fecha_alta',
  'estado',
] as const satisfies readonly ListSortBy[]

function isListSortBy(s: string): s is ListSortBy {
  return (SORTABLE_KEYS as readonly string[]).includes(s)
}

const AGGREGATE_EMPTY: SocioAggregate = { activos: 0, suspendidos: 0, baja: 0, total: 0 }

export default function SociosListPage() {
  const router = useRouter()
  const [
    { search, estado, categoria, fechaDesde, fechaHasta, hasEmail, page, sortBy, sortDir },
    setUrlState,
  ] = useQueryStates(urlStateSchema)
  const [searchDraft, setSearchDraft] = useState(search)
  // Collapsible advanced filters — open by default when any advanced
  // filter is already set (e.g. the user opens a deep link with
  // ?categoria=...); collapsed otherwise to keep the search form
  // visually quiet (per the design system: 95% white/black, rojo only
  // for accent / action moments).
  const [showAdvanced, setShowAdvanced] = useState<boolean>(
    Boolean(categoria || fechaDesde || fechaHasta || hasEmail),
  )
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  // Server-side filter values passed to `getSocios()`. Empty/unset
  // values are stripped so the URL stays minimal (omit `search=` if
  // the field is blank, per nuqs defaults).
  const listParams: {
    search?: string
    estado?: 'activo' | 'suspendido' | 'baja'
    categoria?: string
    fechaDesde?: string
    fechaHasta?: string
    hasEmail?: 'true' | 'false'
    page: number
    sortBy?: ListSortBy
    sortDir?: SortDirValue
  } = {
    page,
  }
  if (search) listParams.search = search
  if (estado === 'activo' || estado === 'suspendido' || estado === 'baja') {
    listParams.estado = estado
  }
  if (categoria) listParams.categoria = categoria
  if (fechaDesde) listParams.fechaDesde = fechaDesde
  if (fechaHasta) listParams.fechaHasta = fechaHasta
  if (hasEmail === 'true' || hasEmail === 'false') listParams.hasEmail = hasEmail
  if (isListSortBy(sortBy)) listParams.sortBy = sortBy
  if (isSortDirValue(sortDir)) listParams.sortDir = sortDir

  // Fire the list + aggregate queries in parallel. The aggregate is
  // independent of the list filters — we always want the global
  // counts, not the filtered counts — so it shares no `query` keys
  // with the list query.
  const [sociosResult, aggregateResult] = useQueries({
    queries: [
      {
        queryKey: ['socios', listParams],
        queryFn: () => getSocios(listParams),
      },
      {
        queryKey: ['socios', 'aggregate'],
        queryFn: () => getSociosAggregate(),
      },
    ],
  })

  const items: Socio[] = (sociosResult.data as { items: Socio[] } | undefined)?.items ?? []
  const total = (sociosResult.data as { total: number } | undefined)?.total ?? 0
  const loading = sociosResult.isPending
  const counts: SocioAggregate =
    (aggregateResult.data as SocioAggregate | undefined) ?? AGGREGATE_EMPTY

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next: Partial<UrlState> = { search: searchDraft, page: 1 }
    setUrlState(next)
  }

  function onEstadoChange(value: string) {
    setUrlState({ estado: value, page: 1 })
  }

  function onPageChange(next: number) {
    setUrlState({ page: next })
  }

  function onSortChange(key: string) {
    // Toggle direction on the same key, reset to asc on a new key.
    // The DataTable emits a click only on sortable headers; the
    // mapping key→column is set in `columns` below.
    const isSame = sortBy === key
    const nextDir: SortDirValue =
      isSame && isSortDirValue(sortDir) && sortDir === 'asc' ? 'desc' : 'asc'
    setUrlState({ sortBy: key, sortDir: nextDir })
  }

  function onRowClick(row: Socio) {
    router.push('/socios/' + row.id)
  }

  const columns: ColumnDef<Socio>[] = [
    {
      key: 'numero_socio',
      header: 'N° Socio',
      sortable: true,
      className: 'font-mono',
    },
    {
      key: 'nombre',
      header: 'Nombre',
      sortable: true,
      className: 'min-w-[14rem]',
      accessor: (row) => (
        <div className="flex items-center gap-3" data-testid={`socios-row-${row.id}-name`}>
          <Monogram nombre={row.nombre} apellido={row.apellido} id={row.id} size="h-8 w-8" />
          <span>
            {row.apellido}, {row.nombre}
          </span>
        </div>
      ),
    },
    {
      key: 'dni',
      header: 'DNI',
      className: 'font-mono',
    },
    {
      key: 'fecha_alta',
      header: 'Fecha de alta',
      sortable: true,
      className: 'font-mono',
      accessor: (row) => {
        const [y, m, d] = row.fecha_alta.split('-')
        if (!y || !m || !d) return row.fecha_alta
        return `${d}/${m}/${y}`
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      accessor: (row) => {
        const variant =
          row.estado === 'activo' ? 'success' : row.estado === 'baja' ? 'danger' : 'warning'
        return <Badge variant={variant}>{row.estado}</Badge>
      },
    },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Socios</h1>
          <p className="mt-1 text-sm text-ink-500">
            Browse the 16k+ master socio table. Search filters by nombre, apellido, o DNI.
          </p>
        </div>
        {isAdmin ? (
          <Link
            href="/socios/new"
            data-testid="socios-new-button"
            className="rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
          >
            + Nuevo
          </Link>
        ) : null}
      </header>

      <section
        aria-label="Resumen de socios"
        data-testid="socios-aggregate"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <AggregateCard
          label="Activos"
          value={counts.activos}
          accentClass="text-success"
          loading={aggregateResult.isPending}
          testId="socios-aggregate-activo"
        />
        <AggregateCard
          label="Suspendidos"
          value={counts.suspendidos}
          accentClass="text-warning"
          loading={aggregateResult.isPending}
          testId="socios-aggregate-suspendido"
        />
        <AggregateCard
          label="Baja"
          value={counts.baja}
          accentClass="text-danger"
          loading={aggregateResult.isPending}
          testId="socios-aggregate-baja"
        />
        <AggregateCard
          label="Total"
          value={counts.total}
          accentClass="text-ink-500"
          loading={aggregateResult.isPending}
          testId="socios-aggregate-total"
        />
      </section>

      <nav
        aria-label="Filtro por estado"
        data-testid="socios-estado-tabs"
        className="flex flex-wrap gap-2 border-b border-ink-100"
      >
        {(
          [
            { value: '', label: 'Todos' },
            { value: 'activo', label: 'Activos' },
            { value: 'suspendido', label: 'Suspendidos' },
            { value: 'baja', label: 'Dados de baja' },
          ] as const
        ).map((tab) => {
          const active = estado === tab.value
          return (
            <button
              key={tab.value || 'all'}
              type="button"
              onClick={() => onEstadoChange(tab.value)}
              aria-current={active ? 'page' : undefined}
              data-testid={`socios-estado-tab-${tab.value || 'all'}`}
              className={
                active
                  ? 'border-b-2 border-accent px-3 py-2 font-display text-sm font-semibold text-ink-900'
                  : 'border-b-2 border-transparent px-3 py-2 font-display text-sm font-medium text-ink-500 transition-colors duration-fast hover:text-ink-700'
              }
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <form
        role="search"
        onSubmit={onSearchSubmit}
        className="space-y-3"
        data-testid="socios-search-form"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label
              htmlFor="socios-search"
              className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
            >
              Buscar
            </label>
            <input
              id="socios-search"
              name="search"
              type="search"
              placeholder="Nombre, apellido o DNI"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              aria-controls="socios-advanced-filters"
              data-testid="socios-advanced-toggle"
              className="rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
            >
              {showAdvanced ? 'Ocultar filtros' : 'Más filtros'}
            </button>
            <button
              type="submit"
              className="rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
            >
              Buscar
            </button>
          </div>
        </div>

        {showAdvanced ? (
          <div
            id="socios-advanced-filters"
            data-testid="socios-advanced-filters"
            className="grid grid-cols-1 gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4 sm:items-end"
          >
            <div>
              <label
                htmlFor="socios-filter-categoria"
                className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Categoría
              </label>
              <input
                id="socios-filter-categoria"
                name="categoria"
                type="text"
                placeholder="Ej: TITULAR"
                value={categoria}
                onChange={(e) => setUrlState({ categoria: e.target.value, page: 1 })}
                className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label
                htmlFor="socios-filter-fecha-desde"
                className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Fecha alta desde
              </label>
              <input
                id="socios-filter-fecha-desde"
                name="fechaDesde"
                type="date"
                value={fechaDesde}
                onChange={(e) => setUrlState({ fechaDesde: e.target.value, page: 1 })}
                className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label
                htmlFor="socios-filter-fecha-hasta"
                className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Fecha alta hasta
              </label>
              <input
                id="socios-filter-fecha-hasta"
                name="fechaHasta"
                type="date"
                value={fechaHasta}
                onChange={(e) => setUrlState({ fechaHasta: e.target.value, page: 1 })}
                className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-end pb-0.5">
              <label
                htmlFor="socios-filter-has-email"
                className="inline-flex items-center gap-2 font-body text-sm text-ink-700"
              >
                <input
                  id="socios-filter-has-email"
                  name="hasEmail"
                  type="checkbox"
                  checked={hasEmail === 'true'}
                  onChange={(e) =>
                    setUrlState({
                      hasEmail: e.target.checked ? 'true' : '',
                      page: 1,
                    })
                  }
                  className="h-4 w-4 rounded border-ink-200 text-accent focus:ring-accent"
                />
                Solo con email
              </label>
            </div>
          </div>
        ) : null}

        {/* Filter chips — pill for each active filter, with × to clear.
            Per the design system, active filters are pills with a
            border and accent-soft text-accent (the same as Badge
            success), reinforcing "you've narrowed the list" without
            shouting. The clear button stays text-only (no shadow). */}
        {(categoria || fechaDesde || fechaHasta || hasEmail) && (
          <ul data-testid="socios-filter-chips" className="flex flex-wrap items-center gap-2">
            {categoria && (
              <li>
                <span className="inline-flex items-center gap-1 rounded border border-ink-200 bg-accent-soft px-2 py-0.5 font-body text-xs font-medium text-accent">
                  Categoría: {categoria}
                  <button
                    type="button"
                    onClick={() => setUrlState({ categoria: '', page: 1 })}
                    aria-label={`Quitar filtro categoría ${categoria}`}
                    className="ml-0.5 font-bold text-accent hover:text-accent-hover"
                  >
                    ×
                  </button>
                </span>
              </li>
            )}
            {fechaDesde && (
              <li>
                <span className="inline-flex items-center gap-1 rounded border border-ink-200 bg-accent-soft px-2 py-0.5 font-body text-xs font-medium text-accent">
                  Desde: {fechaDesde}
                  <button
                    type="button"
                    onClick={() => setUrlState({ fechaDesde: '', page: 1 })}
                    aria-label="Quitar filtro fecha desde"
                    className="ml-0.5 font-bold text-accent hover:text-accent-hover"
                  >
                    ×
                  </button>
                </span>
              </li>
            )}
            {fechaHasta && (
              <li>
                <span className="inline-flex items-center gap-1 rounded border border-ink-200 bg-accent-soft px-2 py-0.5 font-body text-xs font-medium text-accent">
                  Hasta: {fechaHasta}
                  <button
                    type="button"
                    onClick={() => setUrlState({ fechaHasta: '', page: 1 })}
                    aria-label="Quitar filtro fecha hasta"
                    className="ml-0.5 font-bold text-accent hover:text-accent-hover"
                  >
                    ×
                  </button>
                </span>
              </li>
            )}
            {hasEmail && (
              <li>
                <span className="inline-flex items-center gap-1 rounded border border-ink-200 bg-accent-soft px-2 py-0.5 font-body text-xs font-medium text-accent">
                  Con email
                  <button
                    type="button"
                    onClick={() => setUrlState({ hasEmail: '', page: 1 })}
                    aria-label="Quitar filtro con email"
                    className="ml-0.5 font-bold text-accent hover:text-accent-hover"
                  >
                    ×
                  </button>
                </span>
              </li>
            )}
          </ul>
        )}
      </form>
      <DataTable<Socio>
        testId="socios-table"
        columns={columns}
        data={items}
        loading={loading}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
        {...(sortBy ? { sortBy } : {})}
        {...(isSortDirValue(sortDir) ? { sortDir } : {})}
        onSortChange={onSortChange}
        {...(total > 0
          ? {
              pagination: {
                page,
                limit: PAGE_LIMIT,
                total,
                onPageChange,
              },
            }
          : {})}
      />

      {!loading && items.length > 0 ? (
        <p className="font-mono text-xs text-ink-500" data-testid="socios-result-count">
          {total.toLocaleString('es-AR')} resultados
        </p>
      ) : null}
    </div>
  )
}

/**
 * Inline aggregate card (column count + label). Mirrors the
 * MetricCard chrome but keeps a per-card `data-testid` stable for the
 * orchestrator's spec ("socios-aggregate-{activo|suspendido|baja|total}").
 */
function AggregateCard({
  label,
  value,
  loading,
  accentClass,
  testId,
}: {
  label: string
  value: number
  loading: boolean
  accentClass: string
  testId: string
}) {
  return (
    <div data-testid={testId} className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm">
      <p
        className={`font-display text-[10px] font-semibold uppercase tracking-widest ${accentClass}`}
      >
        {label}
      </p>
      {loading ? (
        <div role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-ink-300">
          <span className="block h-6 w-24 animate-pulse rounded bg-surface-sunken" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : (
        <p
          data-testid={`${testId}-value`}
          className="mt-1 font-display text-2xl font-bold text-ink-900 tabular-nums"
        >
          {formatCount(value)}
        </p>
      )}
    </div>
  )
}
