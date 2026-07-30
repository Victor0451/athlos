'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { DataTable, type ColumnDef } from '@/components/tables/DataTable'
import { ApiError } from '@/lib/api'
import {
  getMembershipTypeMembers,
  type MembershipTypeAssociatedMember,
  type MembershipTypeMembersResponse,
} from '@/lib/api/membership-types'
import { useAuth } from '@/lib/use-auth'

const PAGE_LIMIT = 20
const urlStateSchema = { q: parseAsString.withDefault(''), page: parseAsInteger.withDefault(1) }
const lifecycleLabels = {
  imported: 'Importado',
  validated: 'Validado',
  review_required: 'Requiere revisión',
}
const sourceLabels = { validated: 'Evidencia validada', resolved: 'Corrección aplicada' }
const columns: ColumnDef<MembershipTypeAssociatedMember>[] = [
  { key: 'member_number', header: 'Número de socio' },
  {
    key: 'credential_ref',
    header: 'Referencia de credencial',
    accessor: (row) => row.credential_ref ?? 'Sin referencia',
  },
  {
    key: 'lifecycle_state',
    header: 'Estado',
    accessor: (row) => lifecycleLabels[row.lifecycle_state],
  },
  {
    key: 'association_sources',
    header: 'Origen de asociación',
    accessor: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.association_sources.map((source) => (
          <span key={source} className="rounded bg-surface-sunken px-2 py-1 text-xs text-ink-700">
            {sourceLabels[source]}
          </span>
        ))}
      </span>
    ),
  },
]

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
    >
      <p className="font-display text-lg font-semibold text-ink-900">{title}</p>
      <p className="mt-2 text-sm text-ink-500">{children}</p>
    </div>
  )
}

export default function MembershipTypeDetailPage() {
  const { user } = useAuth()
  const { sourceRowId } = useParams<{ sourceRowId: string }>()
  const [{ q, page }, setUrlState] = useQueryStates(urlStateSchema)
  const [searchDraft, setSearchDraft] = useState(q)
  const permitted = user?.role === 'ADMIN' || user?.permissions.data_steward === true
  const query = useQuery({
    queryKey: ['membership-type-members', { sourceRowId, page, q }],
    queryFn: () =>
      getMembershipTypeMembers(sourceRowId, { page, limit: PAGE_LIMIT, ...(q ? { q } : {}) }),
    enabled: permitted && Boolean(sourceRowId),
  })
  const result: MembershipTypeMembersResponse | undefined = query.data
  const error = query.error instanceof ApiError ? query.error : undefined
  const historical =
    error?.status === 404 ||
    error?.status === 409 ||
    result?.snapshot.catalog_state === 'unavailable'

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUrlState({ q: searchDraft.trim(), page: 1 })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/membership-types" className="text-sm text-ink-500 hover:text-ink-900">
            Volver a tipos de afiliación
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink-900">
            {result?.membership_type
              ? `${result.membership_type.code} · ${result.membership_type.name}`
              : 'Tipo de afiliación'}
          </h1>
          {result?.membership_type ? (
            <p className="mt-1 text-sm text-ink-500">
              Letra {result.membership_type.letter} · Procedencia: Aplicado · Referencia de lote:{' '}
              {result.membership_type.snapshot_batch_id}
            </p>
          ) : null}
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

      {!permitted || error?.status === 403 ? (
        <Notice title="Sin permisos">
          Esta sección requiere administración o gestión de datos.
        </Notice>
      ) : historical ? (
        <Notice title="Tipo no disponible en el catálogo actual">
          La referencia consultada es histórica o ya no está vigente. Volvé al catálogo y actualizá
          la consulta.
        </Notice>
      ) : (
        <>
          <p className="text-sm text-ink-500">
            Los recuentos corresponden a asociaciones actuales. Esta vista es solo de consulta.
          </p>
          <form
            aria-label="Buscar socios asociados"
            onSubmit={submitSearch}
            className="flex gap-2 rounded-lg border border-ink-100 bg-surface p-4"
          >
            <input
              aria-label="Buscar por número o referencia de credencial"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Número o referencia de credencial"
              className="min-w-0 flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-ink-900 px-3 py-2 text-sm text-surface">
              Buscar
            </button>
          </form>
          {query.isPending ? (
            <DataTable columns={columns} data={[]} loading rowKey={(item) => item.member_id} />
          ) : query.isError ? (
            <Notice title="No se pudieron cargar los socios asociados">
              Intentá actualizar nuevamente.
            </Notice>
          ) : (
            <DataTable
              columns={columns}
              data={result?.items ?? []}
              rowKey={(item) => item.member_id}
              testId="membership-type-members-table"
              pagination={{
                page,
                limit: PAGE_LIMIT,
                total: result?.total ?? 0,
                onPageChange: (nextPage) => setUrlState({ page: nextPage }),
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
