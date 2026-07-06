'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  CreditCard,
  Hash,
  IdCard,
  Mail,
  MapPin,
  Pencil,
  PhoneCall,
  Tag,
  Trash2,
  UserRound,
} from 'lucide-react'
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
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

/**
 * Socio detail page — `/socios/[id]` (TASK-021 + PR 8b.2; PR 8b.3
 * visual refresh).
 *
 * Read-only view at PR 8b.1. PR 8b.2 layered the ADMIN-gated create /
 * update / delete surface on top. PR 8b.3 is the visual refresh per
 * `obsidian/Projectos/Athlos/Example/UI_Refresh_Codex_Especificacion.md`:
 *
 *   - Header name bumped to 32-36px semibold (was 24px).
 *   - Big circular back-button on the LEFT (`router.back()`), so the
 *     user has an obvious "exit this view" affordance regardless of
 *     scroll position.
 *   - DNI + estado badge live on a single line below the title.
 *   - All action buttons carry a Lucide icon and use the spec's 10px
 *     radius.
 *   - Tabs: icons inside the tab, 3px active underline (was 2px), more
 *     vertical padding.
 *   - Card principal: rounded-xl (12px), shadow-sm (very subtle),
 *     p-8 (32px), title row with icon tile + subtitle.
 *   - Field grid: 3 columns, each field has its own Lucide icon tile,
 *     uppercase label, larger value, soft vertical/horizontal
 *     separators (dotted, ink-150).
 *
 * The refresh is incremental — no architectural change, no API
 * change, no new components. The `Tabs` and `Badge` primitives stay
 * untouched; this file just composes them with the new layout.
 */

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

/**
 * Iconic decoration for each field row. The icon sits inside a soft
 * tinted tile on the LEFT of the label, matching the mockup. Keys
 * not in this map render without an icon tile (graceful fallback).
 */
function FieldIcon({ k }: { k: keyof Socio }) {
  const className = 'h-4 w-4 text-accent'
  switch (k) {
    case 'numero_socio':
      return <Hash className={className} aria-hidden="true" />
    case 'dni':
      return <IdCard className={className} aria-hidden="true" />
    case 'apellido':
    case 'nombre':
      return <UserRound className={className} aria-hidden="true" />
    case 'fecha_alta':
      return <CalendarDays className={className} aria-hidden="true" />
    case 'estado':
      return <BadgeCheck className={className} aria-hidden="true" />
    case 'categoria':
      return <Tag className={className} aria-hidden="true" />
    case 'direccion':
      return <MapPin className={className} aria-hidden="true" />
    case 'telefono':
      return <PhoneCall className={className} aria-hidden="true" />
    case 'email':
      return <Mail className={className} aria-hidden="true" />
    default:
      return null
  }
}

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
  // Tabbed sections: Datos / Contacto / Cuenta. Each panel renders
  // independently under the same tab strip — switching is O(1) and
  // preserves scroll position inside each panel.
  const [activeTab, setActiveTab] = useState<'datos' | 'contacto' | 'cuenta'>('datos')

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
        <div className="h-9 w-64 animate-pulse rounded bg-surface-sunken" />
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
        className="rounded-xl border border-ink-150 bg-surface p-8 text-center shadow-sm"
      >
        <p className="font-display text-lg font-semibold text-ink-900">Socio no encontrado</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          No pudimos cargar los datos del socio. Es posible que el ID sea inválido o que haya sido
          eliminado.
        </p>
        <Link
          href="/socios"
          className="mt-4 inline-block rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Volver al listado
        </Link>
      </div>
    )
  }

  const socio = socioQuery.data as Socio

  /**
   * Renders the 3-column field grid with icon tiles + dotted
   * separators. Each row is a 3-cell grid; cells share the same
   * vertical/horizontal lines via the `border-r border-b` chain. The
   * last cell of each row drops the right border; the last row drops
   * the bottom border. We use `divide-x` + `divide-y` for less code
   * with the same visual result.
   */
  function renderFieldRows(fields: FieldRow[]) {
    return (
      <div className="grid grid-cols-1 divide-y divide-dashed divide-ink-150 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-3">
        {fields.map((row) => (
          <div
            key={row.key}
            data-testid={`socio-field-${row.key}`}
            className="flex items-start gap-3 px-2 py-5"
          >
            <div className="shrink-0 rounded-lg bg-accent-soft p-2">
              <FieldIcon k={row.key} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500">
                {FIELD_LABEL[row.key] ?? row.key}
              </div>
              <div className="mt-1 font-body text-lg text-ink-900 break-words">
                {formatValue(row.key, socio[row.key])}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  const datosPersonales: FieldRow[] = DATOS_PERSONALES_FIELDS.map((f) => ({
    key: f.key,
    value: socio[f.key],
  }))
  const contacto: FieldRow[] = CONTACTO_FIELDS.map((f) => ({ key: f.key, value: socio[f.key] }))

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          data-testid="socio-detail-back"
          className="shrink-0 rounded-xl border border-ink-150 bg-surface p-3 shadow-sm transition-colors duration-fast hover:bg-surface-sunken"
        >
          <ChevronLeft className="h-5 w-5 text-ink-700" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h1
            className="font-display text-3xl font-bold uppercase tracking-tight text-ink-900"
            data-testid="socio-detail-h1"
          >
            {socio.apellido}, {socio.nombre}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-ink-500">DNI {socio.dni}</span>
            <Badge
              variant={
                socio.estado === 'activo'
                  ? 'success'
                  : socio.estado === 'baja'
                    ? 'danger'
                    : 'warning'
              }
              ariaLabel={`Estado: ${socio.estado}`}
              dataTestid="socio-detail-estado"
            >
              {socio.estado}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
                data-testid="socio-detail-edit"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Editar
              </button>
              {socio.estado === 'baja' ? (
                <button
                  type="button"
                  onClick={() => setConfirmReactivateOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-success bg-surface px-3 py-1.5 font-body text-sm text-success transition-colors duration-fast hover:bg-success hover:text-white"
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
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-danger bg-surface px-3 py-1.5 font-body text-sm text-danger transition-colors duration-fast hover:bg-danger hover:text-white"
                  data-testid="socio-detail-delete"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Dar baja
                </button>
              )}
            </>
          ) : null}
        </div>
      </header>

      {/* ── Tabs (with icons) ─────────────────────────────────── */}
      <Tabs<'datos' | 'contacto' | 'cuenta'>
        items={[
          {
            key: 'datos',
            label: (
              <span className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4" aria-hidden="true" />
                Datos personales
              </span>
            ),
            panelId: 'panel-datos',
          },
          {
            key: 'contacto',
            label: (
              <span className="inline-flex items-center gap-2">
                <PhoneCall className="h-4 w-4" aria-hidden="true" />
                Contacto
              </span>
            ),
            panelId: 'panel-contacto',
          },
          {
            key: 'cuenta',
            label: (
              <span className="inline-flex items-center gap-2">
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Cuenta corriente
              </span>
            ),
            panelId: 'panel-cuenta',
          },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
        dataTestid="socio-detail-tabs"
      />

      {/* ── Tab panels (lazy-mounted) ─────────────────────────── */}
      {activeTab === 'datos' ? (
        <section
          id="panel-datos"
          role="tabpanel"
          aria-labelledby="tab-datos"
          aria-label="Datos personales"
          className="rounded-xl border border-ink-150 bg-surface p-8 shadow-sm"
          data-testid="socio-section-datos-personales"
        >
          <header className="mb-6 flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-accent-soft p-2.5">
              <UserRound className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink-900">Datos personales</h2>
              <p className="font-body text-sm text-ink-500">
                Información básica registrada en el sistema.
              </p>
            </div>
          </header>
          {renderFieldRows(datosPersonales)}
        </section>
      ) : null}

      {activeTab === 'contacto' ? (
        <section
          id="panel-contacto"
          role="tabpanel"
          aria-labelledby="tab-contacto"
          aria-label="Contacto"
          className="rounded-xl border border-ink-150 bg-surface p-8 shadow-sm"
          data-testid="socio-section-contacto"
        >
          <header className="mb-6 flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-accent-soft p-2.5">
              <PhoneCall className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink-900">Contacto</h2>
              <p className="font-body text-sm text-ink-500">
                Medios de comunicación registrados para este socio.
              </p>
            </div>
          </header>
          {renderFieldRows(contacto)}
        </section>
      ) : null}

      {activeTab === 'cuenta' ? (
        <section
          id="panel-cuenta"
          role="tabpanel"
          aria-labelledby="tab-cuenta"
          aria-label="Cuenta corriente"
          className="rounded-xl border border-ink-150 bg-surface p-8 shadow-sm"
          data-testid="socio-section-cuenta"
        >
          <CtacteTab socioId={id} />
        </section>
      ) : null}

      {/* Edit modal — ADMIN only. Body holds the SocioForm (with
          hideActions), footer holds the action buttons. The submit
          button uses `form="socio-form-edit"` to associate with the
          inner form so the action stays in the sticky footer. */}
      <Modal
        open={isAdmin && editOpen}
        title="Editar socio"
        size="xl"
        dataTestid="socio-edit-modal"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                if (!updateMutation.isPending) setEditOpen(false)
              }}
              disabled={updateMutation.isPending}
              className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-edit-cancel"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="socio-form-edit"
              disabled={updateMutation.isPending}
              className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-edit-submit"
            >
              {updateMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </>
        }
      >
        <SocioForm
          mode="edit"
          initialValue={socio}
          isSubmitting={updateMutation.isPending}
          errorMessage={updateMutation.error?.message}
          onSubmit={(input) => updateMutation.mutate(input)}
          onCancel={() => {
            if (!updateMutation.isPending) setEditOpen(false)
          }}
          hideActions
        />
      </Modal>

      {/* Delete confirmation modal — ADMIN only. alertdialog + description
          so screen readers announce the destructive intent. */}
      <Modal
        open={isAdmin && confirmDeleteOpen}
        title="Dar baja al socio"
        role="alertdialog"
        descriptionId="socio-delete-modal-desc"
        size="md"
        dataTestid="socio-delete-modal"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                if (!deleteMutation.isPending) {
                  setConfirmDeleteOpen(false)
                  setDeleteError(null)
                }
              }}
              disabled={deleteMutation.isPending}
              className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-delete-cancel"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-[10px] bg-danger px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-delete-confirm"
            >
              {deleteMutation.isPending ? 'Dando de baja…' : 'Confirmar baja'}
            </button>
          </>
        }
      >
        <p id="socio-delete-modal-desc" className="font-body text-sm text-ink-500">
          ¿Dar de baja a{' '}
          <strong>
            {socio.apellido}, {socio.nombre}
          </strong>{' '}
          (DNI {socio.dni})? El row se marca como &quot;baja&quot; pero NO se borra de la base de
          datos — se preserva para el audit trail. El socio no aparece en el listado por defecto.
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
      </Modal>

      {/* Reactivate confirmation modal — ADMIN only, shown only when
          estado='baja' (the Reactivar button in the header sets this). */}
      <Modal
        open={isAdmin && confirmReactivateOpen}
        title="Reactivar socio"
        role="alertdialog"
        descriptionId="socio-reactivate-modal-desc"
        size="md"
        dataTestid="socio-reactivate-modal"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                if (!reactivateMutation.isPending) setConfirmReactivateOpen(false)
              }}
              disabled={reactivateMutation.isPending}
              className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-reactivate-cancel"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
              className="rounded-[10px] bg-success px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-success/80 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="socio-reactivate-confirm"
            >
              {reactivateMutation.isPending ? 'Reactivando…' : 'Confirmar reactivación'}
            </button>
          </>
        }
      >
        <p id="socio-reactivate-modal-desc" className="font-body text-sm text-ink-500">
          ¿Reactivar a{' '}
          <strong>
            {socio.apellido}, {socio.nombre}
          </strong>{' '}
          (DNI {socio.dni})? El socio volverá a estar activo y aparecerá en el listado por defecto.
        </p>
      </Modal>
    </div>
  )
}
