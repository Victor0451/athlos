'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getCtacte, getMovimientos, type Movimiento } from '@/lib/api/ctacte'
import { getSocio } from '@/lib/api/socios'
import { MovementList } from '@/components/ledger/MovementList'

/**
 * Ctacte detail page — `/ctacte/[cuenta]` (TASK-025, PR 8b.2).
 *
 * Per the orchestrator brief, this PR is **read-only**:
 *   - The page fetches `getCtacte(id)` for the summary (saldo +
 *     first page of movimientos) and `getSocio(id)` for the
 *     header card
 *   - For page 2+, `getMovimientos(id, { page })` is queried so
 *     we don't re-fetch the saldo (which is stable across pages)
 *   - No create / update / delete UI — write affordances land
 *     in a later slice once the backend surfaces the endpoints
 *   - Money formatted via the `MovementList` component (es-AR ARS)
 *
 * The summary strip computes `Total Debe` + `Total Haber` from the
 * visible movimientos (the API's `getCuentaCorriente` does not
 * expose these aggregates; they're cheap to derive client-side).
 *
 * Uses `useParams()` instead of `use(params)` so the test page
 * can render without a Suspense wrapper (same precedent as
 * `/socios/[id]` from PR 8b.1).
 */

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

const PAGE_LIMIT = 20

export default function CtacteDetailPage() {
  const params = useParams<{ cuenta: string }>()
  const cuenta = params.cuenta
  const [page, setPage] = useState(1)

  // Fetch the socio card + the canonical saldo + first-page movimientos
  // in parallel. The socio card is independent of pagination.
  const socioQuery = useQuery({
    queryKey: ['socio', cuenta],
    queryFn: () => getSocio(cuenta),
  })

  // First page uses the canonical endpoint (saldo + movimientos in
  // one round-trip). Server defaults to page=1, limit=20 — matches
  // PAGE_LIMIT so we don't need to pass params.
  const ctacteQuery = useQuery({
    queryKey: ['ctacte', cuenta, { page: 1, limit: PAGE_LIMIT }],
    queryFn: () => getCtacte(cuenta),
    enabled: page === 1,
  })

  // Movements for pages > 1 don't need the saldo — the dedicated
  // /movimientos endpoint is lighter (no saldo recompute).
  const movimientosQuery = useQuery({
    queryKey: ['ctacte-movimientos', cuenta, { page, limit: PAGE_LIMIT }],
    queryFn: () => getMovimientos(cuenta, { page, limit: PAGE_LIMIT }),
    enabled: page > 1,
  })

  // Loading state — wait on the first-page ctacte query + the socio
  // card so the header is ready in lock-step with the data.
  if (ctacteQuery.isPending || (page === 1 && socioQuery.isPending)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-6"
        data-testid="ctacte-detail-loading"
      >
        <div className="h-7 w-64 animate-pulse rounded bg-surface-sunken" />
        <div className="h-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded bg-surface-sunken" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (ctacteQuery.isError || !ctacteQuery.data) {
    return (
      <div
        role="alert"
        data-testid="ctacte-detail-not-found"
        className="rounded-lg border border-ink-100 bg-surface-elevated p-6 text-center"
      >
        <p className="font-display text-lg font-semibold text-ink-900">Cuenta no encontrada</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          No pudimos cargar la cuenta corriente. Es posible que el socio no exista o que haya sido
          eliminado.
        </p>
        <Link
          href="/ctacte"
          className="mt-4 inline-block rounded-md bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
        >
          Volver al selector
        </Link>
      </div>
    )
  }

  const ctacte = ctacteQuery.data
  // First-page movimientos come from the canonical ctacte response;
  // page > 1 comes from the movimientos query.
  const movimientos: Movimiento[] =
    page === 1 ? ctacte.movimientos : (movimientosQuery.data?.items ?? [])
  const total = page === 1 ? ctacte.total : (movimientosQuery.data?.total ?? ctacte.total)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  // Aggregate the visible movimientos into debe / haber totals for
  // the summary strip. Anuladas are excluded from the per-row total
  // but the saldo column already filters them server-side.
  const totalDebe = movimientos.reduce((sum, m) => (m.anulado ? sum : sum + Number(m.debe)), 0)
  const totalHaber = movimientos.reduce((sum, m) => (m.anulado ? sum : sum + Number(m.haber)), 0)

  const socio = socioQuery.data
  const headerName = socio ? `${socio.apellido}, ${socio.nombre}` : 'Cuenta corriente'

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{headerName}</h1>
          {socio ? (
            <p className="mt-1 font-mono text-xs text-ink-500">
              DNI {socio.dni} · N° {socio.numero_socio}
            </p>
          ) : null}
        </div>
        <Link
          href="/ctacte"
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
        >
          Volver al selector
        </Link>
      </header>

      <section
        aria-label="Resumen de cuenta"
        data-testid="ctacte-summary"
        className="grid grid-cols-1 gap-4 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm sm:grid-cols-3"
      >
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Total Debe
          </p>
          <p
            className="mt-1 font-display text-lg font-semibold text-ink-900 tabular-nums"
            data-testid="ctacte-summary-debe"
          >
            {ARS.format(totalDebe)}
          </p>
        </div>
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Total Haber
          </p>
          <p
            className="mt-1 font-display text-lg font-semibold text-ink-900 tabular-nums"
            data-testid="ctacte-summary-haber"
          >
            {ARS.format(totalHaber)}
          </p>
        </div>
        <div>
          <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Saldo
          </p>
          <p
            className="mt-1 font-display text-lg font-semibold text-ink-900 tabular-nums"
            data-testid="ctacte-summary-saldo"
          >
            {ARS.format(Number(ctacte.saldo))}
          </p>
        </div>
      </section>

      <MovementList
        socioId={cuenta}
        saldo={ctacte.saldo}
        movimientos={movimientos}
        loading={page > 1 && movimientosQuery.isPending}
      />

      <nav
        aria-label="Paginación de movimientos"
        className="flex items-center justify-between"
        data-testid="ctacte-pagination"
      >
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
        >
          Anterior
        </button>
        <span className="font-mono text-xs text-ink-500" data-testid="ctacte-page-indicator">
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

      <section
        aria-label="Próximamente"
        data-testid="ctacte-detail-proximamente"
        className="rounded-lg border border-dashed border-ink-200 bg-surface-sunken p-4 text-center"
      >
        <p className="font-body text-sm text-ink-500">
          Próximamente — crear, editar y anular movimientos disponibles en una próxima versión.
        </p>
      </section>
    </div>
  )
}
