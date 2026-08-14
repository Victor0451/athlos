'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, WalletCards } from 'lucide-react'
import { getCtacte, getMovimientos, type Movimiento } from '@/lib/api/ctacte'
import { getSocio } from '@/lib/api/socios'
import { getCtacteGastosLinks, type GastoLinkForCuenta } from '@/lib/api/gastos-ctacte'
import { getCtacteNotes } from '@/lib/api/ctacte-mutations'
import { MovementList } from '@/components/ledger/MovementList'
import { CtactePaymentForm } from '@/components/ctacte/CtactePaymentForm'
import { CtacteDebitForm } from '@/components/ctacte/CtacteDebitForm'
import { CtacteComprobanteButton } from '@/components/ctacte/CtacteComprobanteButton'
import { CtacteNotesSection } from '@/components/ctacte/CtacteNotesSection'
import { Badge } from '@/components/ui/Badge'

/**
 * Ctacte detail page — `/ctacte/[cuenta]` (TASK-025 + TASK-013).
 *
 * Per the orchestrator brief, this PR is **read-only**:
 *   - The page fetches `getCtacte(id)` for the summary (saldo +
 *     first page of movimientos) and `getSocio(id)` for the
 *     header card
 *   - For page 2+, `getMovimientos(id, { page })` is queried so
 *     we don't re-fetch the saldo (which is stable across pages)
 *   - TASK-013 (PR n16b-web): the page now renders a "Gastos
 *     vinculados" panel below MovementList that lists the active
 *     `gastos_ctacte_mapping` rows for this cuenta. The previous
 *     "Próximamente" placeholder is removed.
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
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showDebit, setShowDebit] = useState(false)
  const queryClient = useQueryClient()

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

  // TASK-013: linked gastos from the gastos_ctacte_mapping table.
  // Admin-only data, but rendered for every authed role (per spec —
  // no role gate at the panel level). Zero-state renders nothing.
  const gastosVinculadosQuery = useQuery({
    queryKey: ['ctacte-gastos-links', cuenta],
    queryFn: () => getCtacteGastosLinks(cuenta),
  })

  // Notes for the selected movement
  const notesQuery = useQuery({
    queryKey: ['ctacte-notes', cuenta, selectedMovementId],
    queryFn: () => getCtacteNotes(cuenta, selectedMovementId!),
    enabled: selectedMovementId !== null,
  })

  const handleNoteAdded = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ctacte-notes', cuenta, selectedMovementId] })
  }, [queryClient, cuenta, selectedMovementId])

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
        <div className="h-7 w-64 animate-pulse rounded bg-surface-sunken" aria-hidden="true" />
        <div className="h-24 animate-pulse rounded bg-surface-sunken" aria-hidden="true" />
        <div className="h-64 animate-pulse rounded bg-surface-sunken" aria-hidden="true" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (ctacteQuery.isError || !ctacteQuery.data) {
    return (
      <div
        role="alert"
        data-testid="ctacte-detail-not-found"
        className="rounded-lg border border-danger bg-surface p-3 text-sm"
      >
        <p className="font-display font-semibold text-ink-900">Cuenta no encontrada</p>
        <p className="mt-1 text-ink-500">
          No pudimos cargar la cuenta corriente. Es posible que el socio no exista o que haya sido
          eliminado.
        </p>
        <Link
          href="/ctacte"
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover"
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
      <header
        data-testid="ctacte-premium-header"
        className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <Link
              href="/ctacte"
              aria-label="Volver al selector"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-surface px-3 py-2 text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div
              data-testid="ctacte-header-icon"
              className="shrink-0 rounded-lg bg-accent-soft p-3 text-accent"
            >
              <WalletCards className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-widest text-accent">
                Cuenta corriente
              </p>
              <h1 className="font-display text-2xl font-bold text-ink-900">{headerName}</h1>
              <p className="mt-1 text-sm text-ink-500">
                Consulta de movimientos y saldo de la cuenta corriente.
              </p>
              {socio ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span
                    data-testid="ctacte-header-member-number"
                    className="font-mono text-xs tabular-nums text-ink-500"
                  >
                    N° socio {socio.numero_socio}
                  </span>
                  <span
                    data-testid="ctacte-header-dni"
                    className="font-mono text-xs tabular-nums text-ink-500"
                  >
                    DNI {socio.dni}
                  </span>
                  <Badge
                    variant={
                      socio.estado === 'activo'
                        ? 'success'
                        : socio.estado === 'baja'
                          ? 'danger'
                          : 'warning'
                    }
                    ariaLabel={`Estado: ${socio.estado}`}
                    dataTestid="ctacte-header-status"
                    className="uppercase tracking-wide"
                  >
                    {socio.estado}
                  </Badge>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:max-w-xl lg:justify-end">
            <button
              type="button"
              onClick={() => setShowPayment(true)}
              data-testid="ctacte-action-payment"
              className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Registrar pago
            </button>
            <button
              type="button"
              onClick={() => setShowDebit(true)}
              data-testid="ctacte-action-debit"
              className="min-h-11 rounded-md border border-ink-200 bg-surface px-4 py-2 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Registrar débito
            </button>
            <CtacteComprobanteButton socioId={cuenta} cuenta={cuenta} />
          </div>
        </div>
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
            className="mt-1 font-mono text-lg font-semibold text-ink-900 tabular-nums"
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
            className="mt-1 font-mono text-lg font-semibold text-ink-900 tabular-nums"
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
            className="mt-1 font-mono text-lg font-semibold text-ink-900 tabular-nums"
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
        onNotaClick={setSelectedMovementId}
      />

      {selectedMovementId && (
        <CtacteNotesSection
          socioId={cuenta}
          movementId={selectedMovementId}
          key={selectedMovementId}
          notes={notesQuery.data ?? []}
          isLoading={notesQuery.isPending}
          error={notesQuery.isError ? 'No pudimos cargar las notas del movimiento.' : null}
          onNoteAdded={handleNoteAdded}
        />
      )}

      <nav
        aria-label="Paginación de movimientos"
        className="flex items-center justify-between rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
        data-testid="ctacte-pagination"
      >
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="min-h-11 rounded-md border border-ink-200 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
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
          className="min-h-11 rounded-md border border-ink-200 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
        >
          Siguiente
        </button>
      </nav>

      <section
        aria-label="Gastos vinculados"
        data-testid="gastos-vinculados"
        className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
      >
        <h2 className="font-display text-lg font-semibold text-ink-900">Gastos vinculados</h2>
        {gastosVinculadosQuery.isPending ? (
          <div role="status" aria-live="polite" className="mt-3">
            <div className="h-12 animate-pulse rounded bg-surface-sunken" aria-hidden="true" />
            <span className="sr-only">Cargando…</span>
          </div>
        ) : (gastosVinculadosQuery.data?.items ?? []).length === 0 ? null : (
          <div className="mt-3 overflow-x-auto rounded-md border border-ink-100">
            <table className="w-full">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Cuenta
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Concepto
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Importe
                  </th>
                  <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {(gastosVinculadosQuery.data?.items ?? []).map((g: GastoLinkForCuenta) => (
                  <tr key={g.linkId} data-testid={`gastos-vinculado-row-${g.linkId}`}>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums text-ink-900">
                      {g.gastoCuentaPrincipal}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-ink-700">
                      {g.gastoConcepto ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm tabular-nums text-ink-700">
                      {g.gastoFecha}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-900">
                      {g.gastoImporte}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-ink-700">{g.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CtactePaymentForm
        open={showPayment}
        socioId={cuenta}
        onClose={() => setShowPayment(false)}
        onSuccess={() => {
          setShowPayment(false)
          queryClient.invalidateQueries({ queryKey: ['ctacte', cuenta] })
          queryClient.invalidateQueries({ queryKey: ['ctacte-movimientos', cuenta] })
        }}
      />

      <CtacteDebitForm
        open={showDebit}
        socioId={cuenta}
        onClose={() => setShowDebit(false)}
        onSuccess={() => {
          setShowDebit(false)
          queryClient.invalidateQueries({ queryKey: ['ctacte', cuenta] })
          queryClient.invalidateQueries({ queryKey: ['ctacte-movimientos', cuenta] })
        }}
      />
    </div>
  )
}
