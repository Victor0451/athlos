'use client'

import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useRouter } from 'next/navigation'
import { DataTable, type ColumnDef } from '@/components/tables/DataTable'
import { ApiError } from '@/lib/api'
import {
  getMembershipTypes,
  type MembershipTypeCatalogItem,
  type MembershipTypeCatalogResponse,
} from '@/lib/api/membership-types'
import { useAuth } from '@/lib/use-auth'

const PAGE_LIMIT = 20
const urlStateSchema = {
  q: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
}

const columns: ColumnDef<MembershipTypeCatalogItem>[] = [
  { key: 'code', header: 'Código', className: 'font-mono text-xs text-ink-500' },
  { key: 'name', header: 'Nombre' },
  { key: 'letter', header: 'Letra', className: 'font-mono text-xs text-ink-500' },
  { key: 'catalog_state', header: 'Procedencia', accessor: () => 'Aplicado' },
  { key: 'validated_count', header: 'Validados', className: 'font-mono text-xs text-ink-500' },
  {
    key: 'applied_resolution_count',
    header: 'Correcciones aplicadas',
    className: 'font-mono text-xs text-ink-500',
  },
  { key: 'member_count', header: 'Socios distintos', className: 'font-mono text-xs text-ink-500' },
]

function noPermission() {
  return (
    <div role="alert" className="rounded-lg border border-danger bg-surface p-3 text-sm">
      <p className="font-display font-semibold text-ink-900">Sin permisos</p>
      <p className="mt-1 text-ink-500">Esta sección requiere administración o gestión de datos.</p>
    </div>
  )
}

export default function MembershipTypesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [{ q, page }, setUrlState] = useQueryStates(urlStateSchema)
  const [searchDraft, setSearchDraft] = useState(q)
  const permitted = user?.role === 'ADMIN' || user?.permissions.data_steward === true
  const query = useQuery({
    queryKey: ['membership-types', { page, q }],
    queryFn: () => getMembershipTypes({ page, limit: PAGE_LIMIT, ...(q ? { q } : {}) }),
    enabled: permitted,
  })
  const result: MembershipTypeCatalogResponse | undefined = query.data
  const noReadyCatalog = result?.snapshot.catalog_state === 'unavailable'
  const noPermissionError = query.error instanceof ApiError && query.error.status === 403

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUrlState({ q: searchDraft.trim(), page: 1 })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Socios</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            Socios · Tipos de afiliación
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Catálogo actual y recuentos consolidados de asociaciones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={!permitted || query.isFetching}
          className="min-h-11 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {query.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      {!permitted || noPermissionError ? (
        noPermission()
      ) : (
        <>
          <form
            aria-label="Buscar tipos de afiliación"
            onSubmit={submitSearch}
            className="flex gap-2 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
          >
            <input
              aria-label="Buscar por código, nombre o letra"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Código, nombre o letra"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="submit"
              className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Buscar
            </button>
          </form>

          {query.isPending ? (
            <DataTable columns={columns} data={[]} loading rowKey={(item) => item.source_row_id} />
          ) : query.isError ? (
            <div role="alert" className="rounded-lg border border-danger bg-surface p-3 text-sm">
              <p className="font-display font-semibold text-ink-900">
                No se pudo cargar el catálogo
              </p>
              <p className="mt-1 text-ink-500">Intente actualizar nuevamente.</p>
            </div>
          ) : noReadyCatalog ? (
            <div
              role="status"
              className="rounded-lg border border-ink-100 bg-surface p-4 text-sm text-ink-500 shadow-sm"
            >
              Catálogo aún no disponible. No hay un catálogo actual listo para consultar.
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                data={result?.items ?? []}
                rowKey={(item) => item.source_row_id}
                testId="membership-types-table"
                pagination={{
                  page,
                  limit: PAGE_LIMIT,
                  total: result?.total ?? 0,
                  onPageChange: (nextPage) => setUrlState({ page: nextPage }),
                }}
                onRowClick={(item) => router.push(`/admin/membership-types/${item.source_row_id}`)}
              />
              {result?.snapshot.snapshot_batch_id ? (
                <p className="font-mono text-xs text-ink-500">
                  Referencia de lote: {result.snapshot.snapshot_batch_id}
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  )
}
