'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getPadrones, type PadronRow as PadronRowData } from '@/lib/api/padrones'
import { PadronRow } from '@/components/padrones/PadronRow'
import { toCSV, downloadCSV } from '@/lib/csv-export'

/**
 * Padron detail page — `/padrones/[id]` (TASK-029, PR 8b.3).
 *
 * Deep-link view of ONE padron. The `[id]` segment is a slug of
 * the form `<DISCIPLINA>-<EJERCICIO>` (e.g. `NATACION-2026`) —
 * the page splits on the LAST `-` to recover the filter pair
 * (the disciplina portion may itself contain dashes, e.g.
 * `FUTBOL-7-2026` → `FUTBOL-7` + `2026`).
 *
 * Why a slug instead of a dedicated detail endpoint? The backend
 * only exposes the list endpoint
 * (`apps/api/src/routes/padrones.ts`), and the orchestrator brief
 * flagged this explicitly. The "detail" is the same roster, just
 * driven by URL params instead of a filter form. The slug makes
 * the URL shareable — an operator can paste a `/padrones/...`
 * link into Slack and the recipient lands on the same view.
 *
 * Read-only per the orchestrator brief — no create / update /
 * delete UI surfaces here.
 */

const PAGE_LIMIT = 20

/**
 * Split a `<DISCIPLINA>-<EJERCICIO>` slug into its parts. The
 * last `-` separates disciplina from ejercicio so multi-segment
 * disciplina codes like `FUTBOL-7` survive the round-trip.
 *
 * Returns `null` for malformed slugs — the caller renders the
 * "Padrón no encontrado" state.
 */
function decodeSlug(slug: string): { disciplina: string; ejercicio: number } | null {
  const lastDash = slug.lastIndexOf('-')
  if (lastDash < 1 || lastDash === slug.length - 1) return null
  const disciplina = slug.slice(0, lastDash)
  const ejercicioStr = slug.slice(lastDash + 1)
  const ejercicio = Number(ejercicioStr)
  if (!Number.isInteger(ejercicio) || ejercicio < 1900 || ejercicio > 2200) {
    return null
  }
  if (disciplina.length === 0) return null
  return { disciplina, ejercicio }
}

export default function PadronDetailPage() {
  const params = useParams<{ id: string }>()
  const slug = params?.id ?? ''
  const decoded = useMemo(() => decodeSlug(slug), [slug])

  // Page state kept local — the detail view doesn't drive the URL
  // (the URL is the canonical identifier of the padron itself), so
  // a pagination tweak shouldn't replace the slug.
  const [page, setPage] = useState(1)

  const padronQuery = useQuery({
    queryKey: ['padrones-detail', decoded?.disciplina, decoded?.ejercicio, page],
    queryFn: () =>
      getPadrones({
        disciplina: decoded!.disciplina,
        ejercicio: decoded!.ejercicio,
        page,
        limit: PAGE_LIMIT,
      }),
    enabled: decoded !== null,
    retry: false,
  })

  const items: PadronRowData[] = padronQuery.data?.items ?? []
  const total = padronQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  /** Build a CSV from the current page's rows + trigger a download. */
  const onExportCSV = useCallback(() => {
    if (!decoded) return
    const csv = toCSV(items, [
      { key: 'apellido', label: 'Apellido' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'numeroSocio', label: 'N° Socio' },
      { key: 'dni', label: 'DNI' },
      { key: 'estado', label: 'Estado' },
      { key: 'fechaAlta', label: 'Fecha Alta' },
    ])
    const filename = `padron-${decoded.disciplina}-${decoded.ejercicio}.csv`
    downloadCSV(filename, csv)
  }, [items, decoded])

  // Malformed slug — render the same "not found" affordance as a
  // backend 404 so the user has a single recovery path (back to
  // the list page).
  if (!decoded) {
    return (
      <div
        role="alert"
        data-testid="padron-detail-malformed"
        className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
      >
        <p className="font-display text-lg font-semibold text-ink-900">Padrón no encontrado</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          El identificador del padrón no es válido.
        </p>
        <Link
          href="/padrones"
          className="mt-4 inline-block rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Volver al listado
        </Link>
      </div>
    )
  }

  if (padronQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid="padron-detail-loading"
        className="space-y-6"
      >
        <div className="h-7 w-64 animate-pulse rounded bg-surface-sunken" />
        <div className="h-24 animate-pulse rounded bg-surface-sunken" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (padronQuery.isError) {
    return (
      <div
        role="alert"
        data-testid="padron-detail-not-found"
        className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
      >
        <p className="font-display text-lg font-semibold text-ink-900">Padrón no encontrado</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          No pudimos cargar el padrón. Es posible que la disciplina o el ejercicio no existan.
        </p>
        <Link
          href={
            '/padrones?disciplina=' +
            encodeURIComponent(decoded.disciplina) +
            '&ejercicio=' +
            decoded.ejercicio
          }
          className="mt-4 inline-block rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Volver al Padrón
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900" data-testid="padron-title">
            Padrón {decoded.disciplina} {decoded.ejercicio}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-500" data-testid="padron-total">
            {total} {total === 1 ? 'inscripto' : 'inscriptos'}
          </p>
        </div>
        <Link
          href={
            '/padrones?disciplina=' +
            encodeURIComponent(decoded.disciplina) +
            '&ejercicio=' +
            decoded.ejercicio
          }
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
          data-testid="padron-back-link"
        >
          Volver al Padrón
        </Link>
      </header>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onExportCSV}
          disabled={items.length === 0}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="padron-detail-export-csv"
        >
          Exportar CSV
        </button>
      </div>

      {items.length === 0 ? (
        <div
          role="status"
          aria-label="Sin resultados"
          data-testid="padron-detail-empty"
          className="rounded-lg border border-ink-100 bg-surface px-6 py-12 text-center"
        >
          <p className="font-body text-sm text-ink-500">
            Sin inscriptos para esta combinación de disciplina y ejercicio.
          </p>
        </div>
      ) : (
        <>
          <ul
            className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
            data-testid="padron-detail-results"
          >
            {items.map((row) => (
              <PadronRow key={row.inscripcionId} row={row} />
            ))}
          </ul>
          {totalPages > 1 ? (
            <nav
              aria-label="Paginación del padrón"
              className="flex items-center justify-between"
              data-testid="padron-detail-pagination"
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
          ) : null}
        </>
      )}

      <section
        aria-label="Próximamente"
        data-testid="padron-detail-proximamente"
        className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center"
      >
        <p className="font-body text-sm text-ink-500">
          Próximamente — crear, editar y dar de baja inscripciones disponibles en una próxima
          versión.
        </p>
      </section>
    </div>
  )
}
