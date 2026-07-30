'use client'

import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
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
  { key: 'code', header: 'Código' },
  { key: 'name', header: 'Nombre' },
  { key: 'letter', header: 'Letra' },
  { key: 'catalog_state', header: 'Procedencia', accessor: () => 'Aplicado' },
  { key: 'validated_count', header: 'Validados' },
  { key: 'applied_resolution_count', header: 'Correcciones aplicadas' },
  { key: 'member_count', header: 'Socios distintos' },
]

function noPermission() {
  return (
    <div
      role="alert"
      className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
    >
      <p className="font-display text-lg font-semibold text-ink-900">Sin permisos</p>
      <p className="mt-2 text-sm text-ink-500">
        Esta sección requiere administración o gestión de datos.
      </p>
    </div>
  )
}

export default function MembershipTypesPage() {
  const { user } = useAuth()
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
          className="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 disabled:opacity-50"
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
            className="flex gap-2 rounded-lg border border-ink-100 bg-surface p-4"
          >
            <input
              aria-label="Buscar por código, nombre o letra"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Código, nombre o letra"
              className="min-w-0 flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-ink-900 px-3 py-2 text-sm text-surface">
              Buscar
            </button>
          </form>

          {query.isPending ? (
            <DataTable columns={columns} data={[]} loading rowKey={(item) => item.source_row_id} />
          ) : query.isError ? (
            <div
              role="alert"
              className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
            >
              <p className="font-display text-lg font-semibold text-ink-900">
                No se pudo cargar el catálogo
              </p>
              <p className="mt-2 text-sm text-ink-500">Intentá actualizar nuevamente.</p>
            </div>
          ) : noReadyCatalog ? (
            <div
              role="status"
              className="rounded-lg border border-ink-100 bg-surface p-6 text-center"
            >
              <p className="font-display text-lg font-semibold text-ink-900">
                Catálogo aún no disponible
              </p>
              <p className="mt-2 text-sm text-ink-500">
                No hay un catálogo actual listo para consultar.
              </p>
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
              />
              {result?.snapshot.snapshot_batch_id ? (
                <p className="text-xs text-ink-500">
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
