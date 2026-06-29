'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getSocios, type Socio } from '@/lib/api/socios'

/**
 * Ctacte list page — `/ctacte` (TASK-024, PR 8b.2).
 *
 * The backend does NOT expose a "list of cuentas" endpoint — the
 * canonical ledger endpoint is nested under
 * `/api/v1/socios/:id/cuenta-corriente` (per `apps/api/src/routes/ctacte.ts`).
 * So this page is a **socio selector**: the operator types a DNI or
 * nombre, picks a match, and is navigated to `/ctacte/<id>` to see
 * the cuenta-corriente of that specific socio.
 *
 * Per `web-frontend/spec.md` (Cuentas Corrientes section):
 *   - Read-only access for any authenticated operator (no role
 *     gate beyond `requireAuth()` server-side)
 *   - Money values formatted as ARS (`Intl.NumberFormat('es-AR')`)
 *   - Movements list is paginated, default 20/page
 *
 * The orchestrator scope for PR 8b.2 is **read-only** — no create
 * / update / delete UI surfaces here. The "Próximamente"
 * placeholder documents the deferred write affordances.
 *
 * Deep-link from approvals / scheduler: the URL `?cuenta=<id>`
 * redirects immediately to `/ctacte/<id>` so a click on a
 * "ver cuenta corriente" link in the approvals list lands
 * the operator on the right page without an extra click.
 */

const PAGE_LIMIT = 20

export default function CtacteListPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchDraft, setSearchDraft] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')

  // Deep-link redirect: ?cuenta=<id> → /ctacte/<id>
  const cuentaParam = searchParams.get('cuenta')
  useEffect(() => {
    if (cuentaParam) {
      router.push('/ctacte/' + cuentaParam)
    }
  }, [cuentaParam, router])

  const searchQuery = useQuery({
    queryKey: ['ctacte-socios-search', submittedSearch],
    queryFn: () =>
      getSocios({
        search: submittedSearch,
        page: 1,
        limit: PAGE_LIMIT,
      }),
    enabled: submittedSearch.length > 0,
  })

  const items: Socio[] = searchQuery.data?.items ?? []

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmittedSearch(searchDraft.trim())
  }

  function onRowClick(row: Socio) {
    router.push('/ctacte/' + row.id)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink-900">Cuentas corrientes</h1>
        <p className="mt-1 text-sm text-ink-500">
          Buscá un socio por DNI, nombre o apellido para ver su cuenta corriente.
        </p>
      </header>

      <form
        role="search"
        onSubmit={onSearchSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        data-testid="ctacte-search-form"
      >
        <div className="flex-1">
          <label
            htmlFor="ctacte-search"
            className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Buscar socio
          </label>
          <input
            id="ctacte-search"
            name="search"
            type="search"
            placeholder="DNI, nombre o apellido"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Buscar
        </button>
      </form>

      {submittedSearch.length === 0 ? (
        <p className="font-body text-sm text-ink-500" data-testid="ctacte-empty-initial">
          Ingresá un DNI, nombre o apellido y presioná Buscar.
        </p>
      ) : searchQuery.isPending ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Cargando"
          data-testid="ctacte-results-loading"
          className="space-y-2"
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
      ) : items.length === 0 ? (
        <div
          role="status"
          aria-label="Sin resultados"
          data-testid="ctacte-results-empty"
          className="rounded-lg border border-ink-100 bg-surface px-6 py-12 text-center"
        >
          <p className="font-body text-sm text-ink-500">
            Sin resultados para los filtros seleccionados.
          </p>
        </div>
      ) : (
        <ul
          className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
          data-testid="ctacte-results"
        >
          {items.map((row) => (
            <li key={row.id} className="border-t border-ink-100 first:border-t-0">
              <button
                type="button"
                onClick={() => onRowClick(row)}
                data-testid={`ctacte-result-${row.id}`}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-display text-sm font-semibold text-ink-900">
                    {row.apellido}, {row.nombre}
                  </span>
                  <span className="font-mono text-xs text-ink-500">DNI {row.dni}</span>
                </span>
                <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                  N° {row.numero_socio}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section
        aria-label="Próximamente"
        data-testid="ctacte-proximamente"
        className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center"
      >
        <p className="font-body text-sm text-ink-500">
          Próximamente — creación, edición y anulación de movimientos disponibles en una próxima
          versión.
        </p>
      </section>
    </div>
  )
}
