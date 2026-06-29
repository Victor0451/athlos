'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useQuery } from '@tanstack/react-query'
import { getSocios, type Socio } from '@/lib/api/socios'
import { DataTable, type ColumnDef } from '@/components/tables/DataTable'

/**
 * Socios list page — `/socios` (TASK-020 + TASK-022, PR 8b.1).
 *
 * Per `web-frontend/spec.md` + orchestrator brief:
 *   - 20-per-page paginated table against `GET /api/v1/socios`
 *   - Search input filters by `nombre + apellido + dni` server-side
 *     (case-insensitive, per `apps/api/src/modules/socios/service.ts`)
 *   - Estado filter dropdown (Todos / Activo / Suspendido / Baja)
 *   - Each row is clickable → navigates to `/socios/<id>` (detail)
 *   - URL state via nuqs: `?search=…&estado=…&page=…` deep-linkable,
 *     shareable, and survives a full page reload
 *
 * URL-state strategy (TASK-022):
 *   - `useQueryStates` from `nuqs` powers all three URL params
 *   - The search input is a controlled field; submitting the form
 *     pushes `{ search, page: 1 }` so the new search resets to page 1
 *   - The estado `<select>` updates on `change` (same page reset)
 *   - The pagination buttons call `setPage(...)` directly
 *   - Loading the page at `/socios?search=garcia` is the deep-link
 *     behaviour: nuqs reads the URL on mount and feeds the query
 *
 * The query function only sends the params nuqs reports as
 * non-default — `useQuery` is keyed on the URL state so a fresh
 * search invalidates the cached page.
 */

const PAGE_LIMIT = 20

const urlStateSchema = {
  search: parseAsString.withDefault(''),
  estado: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
}

interface UrlState {
  search: string
  estado: string
  page: number
}

export default function SociosListPage() {
  const router = useRouter()
  const [{ search, estado, page }, setUrlState] = useQueryStates(urlStateSchema)
  const [searchDraft, setSearchDraft] = useState(search)

  // Server-side filter values passed to `getSocios()`. Empty/unset
  // values are stripped so the URL stays minimal (omit `search=` if
  // the field is blank, per nuqs defaults).
  const queryParams: { search?: string; estado?: 'activo' | 'suspendido' | 'baja'; page: number } =
    {
      page,
    }
  if (search) queryParams.search = search
  if (estado === 'activo' || estado === 'suspendido' || estado === 'baja') {
    queryParams.estado = estado
  }

  const sociosQuery = useQuery({
    queryKey: ['socios', queryParams],
    queryFn: () => getSocios(queryParams),
  })

  const items: Socio[] = sociosQuery.data?.items ?? []
  const total = sociosQuery.data?.total ?? 0

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

  function onRowClick(row: Socio) {
    router.push('/socios/' + row.id)
  }

  const columns: ColumnDef<Socio>[] = [
    { key: 'numero_socio', header: 'N° Socio' },
    {
      key: 'nombre',
      header: 'Nombre',
      accessor: (row) => `${row.apellido}, ${row.nombre}`,
    },
    { key: 'dni', header: 'DNI' },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (row) => (
        <span
          className={
            row.estado === 'activo'
              ? 'font-display text-[10px] font-semibold uppercase tracking-widest text-success'
              : row.estado === 'baja'
                ? 'font-display text-[10px] font-semibold uppercase tracking-widest text-danger'
                : 'font-display text-[10px] font-semibold uppercase tracking-widest text-warning'
          }
        >
          {row.estado}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Socios</h1>
        <p className="mt-1 text-sm text-ink-500">
          Browse the 16k+ master socio table. Search filters by nombre, apellido, or DNI.
        </p>
      </header>

      <form
        role="search"
        onSubmit={onSearchSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        data-testid="socios-search-form"
      >
        <div className="flex-1">
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
        <div>
          <label
            htmlFor="estado-filter"
            className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Estado
          </label>
          <select
            id="estado-filter"
            name="estado"
            value={estado}
            onChange={(e) => onEstadoChange(e.target.value)}
            className="mt-1 block rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Todos</option>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="baja">Baja</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Buscar
        </button>
      </form>

      <DataTable<Socio>
        testId="socios-table"
        columns={columns}
        data={items}
        loading={sociosQuery.isPending}
        rowKey={(row) => row.id}
        onRowClick={onRowClick}
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

      {!sociosQuery.isPending && items.length > 0 ? (
        <p className="font-mono text-xs text-ink-500" data-testid="socios-result-count">
          {total.toLocaleString('es-AR')} resultados
        </p>
      ) : null}
    </div>
  )
}
