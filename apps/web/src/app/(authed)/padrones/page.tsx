'use client'

import { useCallback, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { getPadrones, type PadronRow as PadronRowData } from '@/lib/api/padrones'
import { PadronRow } from '@/components/padrones/PadronRow'
import { toCSV, downloadCSV } from '@/lib/csv-export'

/**
 * Padrones list page — `/padrones` (TASK-028, PR 8b.3).
 *
 * Filter-driven padron browser:
 *   - Disciplina selector (dropdown) + ejercicio input (year)
 *   - "Ver Padrón" submit button → triggers the query + URL state
 *   - Results rendered as `<PadronRow>` stacked-list cards
 *   - Pagination (Anterior / Siguiente) — 20 rows per page
 *   - "Exportar CSV" of the current page's results
 *   - URL state via nuqs (?disciplina=&ejercicio=&page=) so the
 *     view is deep-linkable and survives reloads
 *   - "Próximamente" placeholder for the deferred write actions
 *
 * Read-only per the orchestrator brief — no create / update /
 * delete UI. The deportes write endpoints aren't in the v0.5.x
 * backend yet (PR 5 ships the read view only; writes land in a
 * later slice). The "Próximamente" badge below the form is the
 * explicit signal that the write affordances are queued.
 *
 * Disciplina options: the backend does NOT expose a
 * `GET /api/v1/disciplinas` endpoint yet (exploration §4.6), so
 * the dropdown lists the common codigos hard-coded. Operators
 * can still type any codigo via the backend if needed — the
 * wire validator accepts any non-empty string up to 40 chars.
 * Adding the dedicated endpoint (and replacing this list with
 * a fetch) lands alongside the deportes write endpoints in a
 * follow-up slice.
 */

const PAGE_LIMIT = 20

/** Disciplina codigos used as quick-select options. */
const DISCIPLINA_OPTIONS = [
  { value: '', label: 'Seleccionar…' },
  { value: 'NATACION', label: 'Natación' },
  { value: 'FUTBOL', label: 'Fútbol' },
  { value: 'HOCKEY', label: 'Hockey' },
  { value: 'TENIS', label: 'Tenis' },
  { value: 'GIMNASIA', label: 'Gimnasia' },
  { value: 'BASQUET', label: 'Básquet' },
  { value: 'VOLEY', label: 'Vóley' },
  { value: 'PATIN', label: 'Patín' },
] as const

/** Current year — used as the default value in the ejercicio input. */
const CURRENT_YEAR = new Date().getFullYear()

/** URL-state schema — drives both nuqs + the test mock. */
const urlStateSchema = {
  disciplina: parseAsString.withDefault(''),
  ejercicio: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
}

export default function PadronesListPage() {
  // URL state via nuqs — disciplina + ejercicio + page.
  // The form's "Ver Padrón" submit is what commits disciplina + ejercicio
  // to the URL; `page` is bumped by the Anterior / Siguiente controls.
  const [urlState, setUrlState] = useQueryStates(urlStateSchema)
  const { disciplina: disciplinaUrl, ejercicio: ejercicioUrl, page } = urlState

  // Form drafts — uncontrolled-ish: we keep them as local state so the
  // operator can change disciplina without firing a query on every
  // keystroke. The submit button commits the drafts to the URL.
  const [disciplinaDraft, setDisciplinaDraft] = useState(disciplinaUrl)
  const [ejercicioDraft, setEjercicioDraft] = useState(ejercicioUrl)

  // Query is enabled only when BOTH filters are committed to the URL.
  // This guards against firing a query with an empty string (which the
  // backend would 400 on).
  const filtersReady = disciplinaUrl.length > 0 && ejercicioUrl.length > 0
  const ejercicioNumber = filtersReady ? Number(ejercicioUrl) : NaN

  const padronQuery = useQuery({
    queryKey: ['padrones', disciplinaUrl, ejercicioUrl, page],
    queryFn: () =>
      getPadrones({
        disciplina: disciplinaUrl,
        ejercicio: ejercicioNumber,
        page,
        limit: PAGE_LIMIT,
      }),
    enabled: filtersReady && !Number.isNaN(ejercicioNumber),
  })

  const items: PadronRowData[] = padronQuery.data?.items ?? []
  const total = padronQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  /** Commit the form drafts to the URL — triggers the query. */
  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const trimmedDisc = disciplinaDraft.trim()
      const trimmedEj = ejercicioDraft.trim()
      if (trimmedDisc.length === 0 || trimmedEj.length === 0) return
      // Reset to page 1 when the filter changes; clamp on plain pagination.
      void setUrlState({
        disciplina: trimmedDisc,
        ejercicio: trimmedEj,
        page: 1,
      })
    },
    [disciplinaDraft, ejercicioDraft, setUrlState],
  )

  /** Build a CSV from the current page's rows + trigger a browser download. */
  const onExportCSV = useCallback(() => {
    const csv = toCSV(items, [
      { key: 'apellido', label: 'Apellido' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'numeroSocio', label: 'N° Socio' },
      { key: 'dni', label: 'DNI' },
      { key: 'estado', label: 'Estado' },
      { key: 'fechaAlta', label: 'Fecha Alta' },
    ])
    const filename = `padron-${disciplinaUrl}-${ejercicioUrl}-pagina-${page}.csv`
    downloadCSV(filename, csv)
  }, [items, disciplinaUrl, ejercicioUrl, page])

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Padrones</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Padrones</h1>
        <p className="mt-1 text-sm text-ink-500">
          Seleccioná una disciplina y un ejercicio para ver el padrón de socios inscritos.
        </p>
      </header>

      <form
        role="search"
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        data-testid="padrones-search-form"
      >
        <div className="flex-1">
          <label
            htmlFor="padrones-disciplina"
            className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Disciplina
          </label>
          <select
            id="padrones-disciplina"
            name="disciplina"
            value={disciplinaDraft}
            onChange={(e) => setDisciplinaDraft(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {DISCIPLINA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label
            htmlFor="padrones-ejercicio"
            className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Ejercicio
          </label>
          <input
            id="padrones-ejercicio"
            name="ejercicio"
            type="number"
            min="1900"
            max="2200"
            placeholder={String(CURRENT_YEAR)}
            value={ejercicioDraft}
            onChange={(e) => setEjercicioDraft(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver Padrón
        </button>
      </form>

      {!filtersReady ? (
        <p className="font-body text-sm text-ink-500" data-testid="padrones-empty-initial">
          Seleccioná una disciplina y un ejercicio, y presioná Ver Padrón.
        </p>
      ) : padronQuery.isPending ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Cargando"
          data-testid="padrones-results-loading"
          className="space-y-2 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-12 animate-pulse rounded bg-surface-sunken"
            />
          ))}
          <span className="sr-only">Cargando…</span>
        </div>
      ) : padronQuery.isError ? (
        <div
          role="alert"
          data-testid="padrones-results-error"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-semibold text-danger">No se pudo cargar el padrón</p>
          <p className="mt-1 text-ink-500">
            Verificá que la disciplina y el ejercicio sean correctos, o intentá nuevamente más
            tarde.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          role="status"
          aria-label="Sin resultados"
          data-testid="padrones-results-empty"
          className="rounded-lg border border-ink-100 bg-surface p-4 text-sm text-ink-500 shadow-sm"
        >
          Sin resultados para los filtros seleccionados.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-ink-500" data-testid="padrones-total">
              {total} {total === 1 ? 'inscripto' : 'inscriptos'} · {disciplinaUrl} {ejercicioUrl}
            </p>
            <button
              type="button"
              onClick={onExportCSV}
              className="min-h-11 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="padrones-export-csv"
            >
              Exportar CSV
            </button>
          </div>
          <ul
            className="divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-100 bg-surface shadow-sm"
            data-testid="padrones-results"
          >
            {items.map((row) => (
              <PadronRow key={row.inscripcionId} row={row} />
            ))}
          </ul>
          {totalPages > 1 ? (
            <nav
              aria-label="Paginación de padrones"
              className="flex items-center justify-between"
              data-testid="padrones-pagination"
            >
              <button
                type="button"
                onClick={() => void setUrlState({ page: Math.max(1, page - 1) })}
                disabled={page <= 1}
                className="min-h-11 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="font-mono text-xs text-ink-500">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => void setUrlState({ page: page + 1 })}
                disabled={page >= totalPages}
                className="min-h-11 rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </nav>
          ) : null}
        </>
      )}

      <section
        aria-label="Próximamente"
        data-testid="padrones-proximamente"
        className="rounded-lg border border-warning bg-warning-soft p-4 text-sm text-warning"
      >
        Próximamente — crear, editar y dar de baja inscripciones disponibles en una próxima versión.
      </section>
    </div>
  )
}
