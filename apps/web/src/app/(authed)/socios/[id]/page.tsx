'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getSocio } from '@/lib/api/socios'

/**
 * Socio detail page — `/socios/[id]` (TASK-021, PR 8b.1).
 *
 * Per the orchestrator brief, PR 8b.1 is **read-only**: this page
 * renders a socio's profile and a "Volver al listado" link. No
 * create / update / delete actions yet — those land in PR 8b.1b
 * (or 8b.2) behind ADMIN role gating.
 *
 * Field grid mirrors the backend `Socio` DTO (`apps/api/src/routes/socios.ts`)
 * snake_case → camelCase unchanged for the web client (the wire
 * shape is snake_case). Null / empty fields render as "—" (em dash)
 * so the layout doesn't shift when a socio has no email.
 *
 * We use `useParams()` from `next/navigation` rather than the
 * `use(params)` React 19 pattern because (a) `useParams()` works in
 * tests without a Suspense wrapper — it's plain read from Next's
 * router context, not a thenable — and (b) it survives future Next
 * versions without refactoring. Both patterns are documented as
 * supported in the Next.js 16 App Router.
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
    // YYYY-MM-DD → DD/MM/YYYY (es-AR)
    const [y, m, d] = value.split('-')
    if (y && m && d) return `${d}/${m}/${y}`
  }
  return value
}

export default function SocioDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const socioQuery = useQuery({
    queryKey: ['socio', id],
    queryFn: () => getSocio(id),
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

  const socio = socioQuery.data
  const fields: Array<{ key: keyof typeof socio; value: string | null }> = [
    { key: 'numero_socio', value: socio.numero_socio },
    { key: 'nombre', value: socio.nombre },
    { key: 'apellido', value: socio.apellido },
    { key: 'dni', value: socio.dni },
    { key: 'fecha_alta', value: socio.fecha_alta },
    { key: 'estado', value: socio.estado },
    { key: 'categoria', value: socio.categoria },
    { key: 'direccion', value: socio.direccion },
    { key: 'telefono', value: socio.telefono },
    { key: 'email', value: socio.email },
  ]

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {socio.apellido}, {socio.nombre}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-500">DNI {socio.dni}</p>
        </div>
        <Link
          href="/socios"
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
        >
          Volver al listado
        </Link>
      </header>

      <section
        aria-label="Datos del socio"
        className="rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
        data-testid="socio-detail-fields"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(({ key, value }) => (
            <div key={key} data-testid={`socio-field-${key}`}>
              <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                {FIELD_LABEL[key] ?? key}
              </dt>
              <dd className="mt-1 font-body text-sm text-ink-700">{formatValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-label="Próximamente"
        className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center"
        data-testid="socio-detail-proximamente"
      >
        <p className="font-body text-sm text-ink-500">
          Próximamente — pestañas de Ctacte, Deportes y Cuotas disponibles en una próxima versión.
        </p>
      </section>
    </div>
  )
}
