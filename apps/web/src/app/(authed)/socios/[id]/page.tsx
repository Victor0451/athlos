'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/use-auth'
import {
  deleteSocio,
  getSocio,
  updateSocio,
  type UpdateSocioInput,
  type Socio,
} from '@/lib/api/socios'
import SocioForm from '@/components/socios/SocioForm'
import { CtacteTab } from '@/components/socios/CtacteTab'

/**
 * Socio detail page — `/socios/[id]` (TASK-021 + PR 8b.2; second
 * slice: sectioned layout + CtacteTab, PR 8b.2 second slice).
 *
 * Read-only view at PR 8b.1. PR 8b.2 layered the ADMIN-gated create /
 * update / delete surface on top:
 *   - "Editar" button (ADMIN only) opens a modal with
 *     <SocioForm mode="edit" /> pre-filled from the current socio.
 *   - "Dar baja" button (ADMIN only) opens a confirmation modal. The
 *     server soft-deletes (`estado='baja'` + `deletedAt`); the row
 *     stays in the table for the audit trail.
 *   - "Reactivar" button (ADMIN only, visible only when `estado='baja'`)
 *     PATCHes the row with `estado='activo'`. Single-click with
 *     confirmation modal.
 *     On confirm, the server soft-deletes (sets `estado='baja'`) and
 *     we navigate back to the list.
 *   - Both mutations invalidate `['socio', id]` and `['socios']`
 *     query keys so the list and detail refetch with fresh data.
 *
 * PR 8b.2 second slice — visual + functional polish:
 *   - Fields are grouped into "Datos personales" / "Contacto"
 *     sections (each its own `<section>` + h2), per the
 *     design-system "sectioned detail view" pattern.
 *   - The "Próximamente" placeholder is replaced with the live
 *     <CtacteTab socioId={id} /> component so the saldo + the
 *     first page of movimientos render in place.
 *
 * Future tabs (Deportes / Cuotas) follow the same section pattern
 * once they ship — the orchestrator scope caps this slice to the
 * Ctacte only.
 */

const SECTION_HEADING = 'text-base font-semibold uppercase tracking-wide text-ink-700'

const FIELD_LABEL: Record<string, string> = {
  numero_socio: 'N° Socio',
  nombre: 'Nombre',
  apellido: 'Apellido',
  dni: 'DNI',
  fecha_alta: 'Fecha de alta',
  estado: 'Estado',
  categoria: 'Categoría',
  direccion: 'Dirección',
  telefono: 'Teléfono',
  email: 'Email',
}

function formatValue(key: string, value: string | null): string {
  if (value === null || value === '') return '—'
  if (key === 'fecha_alta') {
    const [y, m, d] = value.split('-')
    if (y && m && d) return `${d}/${m}/${y}`
  }
  return value
}

interface FieldRow {
  key: keyof Socio
  value: string | null
}

const DATOS_PERSONALES_FIELDS: FieldRow[] = [
  { key: 'numero_socio', value: null },
  { key: 'apellido', value: null },
  { key: 'nombre', value: null },
  { key: 'dni', value: null },
  { key: 'fecha_alta', value: null },
  { key: 'estado', value: null },
  { key: 'categoria', value: null },
]

const CONTACTO_FIELDS: FieldRow[] = [
  { key: 'direccion', value: null },
  { key: 'telefono', value: null },
  { key: 'email', value: null },
]

export default function SocioDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const socioQuery = useQuery({
    queryKey: ['socio', id],
    queryFn: () => getSocio(id),
  })

  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [confirmReactivateOpen, setConfirmReactivateOpen] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (input: UpdateSocioInput) => updateSocio(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socio', id] })
      queryClient.invalidateQueries({ queryKey: ['socios'] })
      setEditOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSocio(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socio', id] })
      queryClient.invalidateQueries({ queryKey: ['socios'] })
      router.push('/socios')
    },
    onError: (err) => {
      setDeleteError(
        err instanceof Error
          ? `${err.message}. Intentá de nuevo.`
          : 'No se pudo dar de baja al socio. Intentá de nuevo.',
      )
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: () => updateSocio(id, { estado: 'activo' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socio', id] })
      queryClient.invalidateQueries({ queryKey: ['socios'] })
      setConfirmReactivateOpen(false)
    },
  })

  if (socioQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-6"
        data-testid="socio-detail-loading"
      >
        <div className="h-7 w-64 animate-pulse rounded bg-surface-sunken" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-16 animate-pulse rounded bg-surface-sunken" />
              <div className="h-5 w-32 animate-pulse rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (socioQuery.isError || !socioQuery.data) {
    return (
      <div
        role="alert"
        data-testid="socio-detail-not-found"
        className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
      >
        <p className="font-display text-lg font-semibold text-ink-900">Socio no encontrado</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          No pudimos cargar los datos del socio. Es posible que el ID sea inválido o que haya sido
          eliminado.
        </p>
        <Link
          href="/socios"
          className="mt-4 inline-block rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Volver al listado
        </Link>
      </div>
    )
  }

  const socio = socioQuery.data as Socio

  function renderFieldRows(fields: FieldRow[]) {
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((row) => (
          <div key={row.key} data-testid={`socio-field-${row.key}`}>
            <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
              {FIELD_LABEL[row.key] ?? row.key}
            </dt>
            <dd className="mt-1 font-body text-sm text-ink-700">
              {formatValue(row.key, socio[row.key])}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  const datosPersonales: FieldRow[] = DATOS_PERSONALES_FIELDS.map((f) => ({
    key: f.key,
    value: socio[f.key],
  }))
  const contacto: FieldRow[] = CONTACTO_FIELDS.map((f) => ({ key: f.key, value: socio[f.key] }))

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display text-2xl font-bold text-ink-900"
            data-testid="socio-detail-h1"
          >
            {socio.apellido}, {socio.nombre}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-500">DNI {socio.dni}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
                data-testid="socio-detail-edit"
              >
                Editar
              </button>
              {socio.estado === 'baja' ? (
                <button
                  type="button"
                  onClick={() => setConfirmReactivateOpen(true)}
                  className="rounded-md border border-success bg-surface px-3 py-1 font-body text-sm text-success transition-colors duration-fast hover:bg-success hover:text-white"
                  data-testid="socio-detail-reactivate"
                >
                  Reactivar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null)
                    setConfirmDeleteOpen(true)
                  }}
                  className="rounded-md border border-danger bg-surface px-3 py-1 font-body text-sm text-danger transition-colors duration-fast hover:bg-danger hover:text-white"
                  data-testid="socio-detail-delete"
                >
                  Dar baja
                </button>
              )}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
            data-testid="socio-detail-back"
          >
            Volver al listado
          </button>
        </div>
      </header>

      <section
        aria-label="Datos personales"
        className="rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
        data-testid="socio-section-datos-personales"
      >
        <h2 className={`mb-4 font-display ${SECTION_HEADING}`}>Datos personales</h2>
        {renderFieldRows(datosPersonales)}
      </section>

      <section
        aria-label="Contacto"
        className="rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
        data-testid="socio-section-contacto"
      >
        <h2 className={`mb-4 font-display ${SECTION_HEADING}`}>Contacto</h2>
        {renderFieldRows(contacto)}
      </section>

      <CtacteTab socioId={id} />

      {/* Edit modal — ADMIN only */}
      {isAdmin && editOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="socio-edit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
          data-testid="socio-edit-modal"
        >
          <div className="w-full max-w-2xl rounded-lg border border-ink-100 bg-surface-elevated p-6 shadow-2xl">
            <h2
              id="socio-edit-modal-title"
              className="mb-4 font-display text-lg font-semibold text-ink-900"
            >
              Editar socio
            </h2>
            <SocioForm
              mode="edit"
              initialValue={socio}
              isSubmitting={updateMutation.isPending}
              errorMessage={updateMutation.error?.message}
              onSubmit={(input) => updateMutation.mutate(input)}
              onCancel={() => {
                if (!updateMutation.isPending) setEditOpen(false)
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Delete confirmation modal — ADMIN only */}
      {isAdmin && confirmDeleteOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="socio-delete-modal-title"
          aria-describedby="socio-delete-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
          data-testid="socio-delete-modal"
        >
          <div className="w-full max-w-md rounded-lg border border-ink-100 bg-surface-elevated p-6 shadow-2xl">
            <h2
              id="socio-delete-modal-title"
              className="font-display text-lg font-semibold text-ink-900"
            >
              Dar baja al socio
            </h2>
            <p id="socio-delete-modal-desc" className="mt-2 font-body text-sm text-ink-500">
              ¿Dar de baja a{' '}
              <strong>
                {socio.apellido}, {socio.nombre}
              </strong>{' '}
              (DNI {socio.dni})? El row se marca como &quot;baja&quot; pero NO se borra de la base
              de datos — se preserva para el audit trail. El socio no aparece en el listado por
              defecto.
            </p>
            {deleteError ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-sm text-danger"
                data-testid="socio-delete-error"
              >
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!deleteMutation.isPending) {
                    setConfirmDeleteOpen(false)
                    setDeleteError(null)
                  }
                }}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="socio-delete-cancel"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-danger px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="socio-delete-confirm"
              >
                {deleteMutation.isPending ? 'Dando de baja…' : 'Confirmar baja'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reactivate confirmation modal — ADMIN only, shown only when
          estado='baja' (the Reactivar button in the header sets this). */}
      {isAdmin && confirmReactivateOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="socio-reactivate-modal-title"
          aria-describedby="socio-reactivate-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
          data-testid="socio-reactivate-modal"
        >
          <div className="w-full max-w-md rounded-lg border border-ink-100 bg-surface-elevated p-6 shadow-2xl">
            <h2
              id="socio-reactivate-modal-title"
              className="font-display text-lg font-semibold text-ink-900"
            >
              Reactivar socio
            </h2>
            <p id="socio-reactivate-modal-desc" className="mt-2 font-body text-sm text-ink-500">
              ¿Reactivar a{' '}
              <strong>
                {socio.apellido}, {socio.nombre}
              </strong>{' '}
              (DNI {socio.dni})? El socio volverá a estar activo y aparecerá en el listado por
              defecto.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!reactivateMutation.isPending) setConfirmReactivateOpen(false)
                }}
                disabled={reactivateMutation.isPending}
                className="rounded-md border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="socio-reactivate-cancel"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => reactivateMutation.mutate()}
                disabled={reactivateMutation.isPending}
                className="rounded-md bg-success px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-success/80 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="socio-reactivate-confirm"
              >
                {reactivateMutation.isPending ? 'Reactivando…' : 'Confirmar reactivación'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
