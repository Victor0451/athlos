import { MessageSquare } from 'lucide-react'
import type { Movimiento } from '@/lib/api/ctacte'
import { downloadCSV, toCSV } from '@/lib/csv-export'

/**
 * MovementList — read-only cuenta-corriente ledger (TASK-026, PR 8b.2).
 *
 * Used by `/ctacte/[cuenta]` to render a socio's movements. Pure
 * presentation: receives the movimientos + saldo + socioId as
 * props (parent handles data fetching) and renders:
 *
 *   - Header strip: "Cuenta: <socioId>" + saldo (es-AR currency) +
 *     "Exportar CSV" button
 *   - Movements table: Fecha | Descripción | Debe | Haber | Saldo
 *   - Empty state copy: "Sin movimientos para los filtros seleccionados"
 *   - Loading state: 5 skeleton rows + SR-only "Cargando…"
 *
 * Money values use `Intl.NumberFormat('es-AR', { style: 'currency',
 * currency: 'ARS' })` per design §5 / `web-frontend/spec.md`.
 *
 * The "Exportar CSV" button writes the visible movimientos using
 * the shared `downloadCSV` helper (TASK-027) so the same export
 * pipeline is reused by the ctacte list page (8b.2) and will be
 * reused by the padron list (8b.3).
 *
 * The list is **read-only** (per orchestrator brief): no create /
 * update / delete actions. Anuladas are surfaced visually so
 * operators can see when a row was reversed.
 */

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

/** YYYY-MM-DD → DD/MM/YYYY (es-AR). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

/** Canonical column set for the CSV export. */
const CSV_COLUMNS = [
  { key: 'fecha' as const, label: 'Fecha' },
  { key: 'concepto' as const, label: 'Concepto' },
  { key: 'tipo' as const, label: 'Tipo' },
  { key: 'debe' as const, label: 'Debe' },
  { key: 'haber' as const, label: 'Haber' },
]

export interface MovementListProps {
  /** The socioId — used in the header and the export filename. */
  socioId: string
  /** NUMERIC(14,2) string (e.g., "1500.00" or "-250.50"). */
  saldo: string
  movimientos: Movimiento[]
  loading?: boolean
  /** Optional callback to open the Nota modal for a given movement. */
  onNotaClick?: (movementId: string) => void
}

export function MovementList({
  socioId,
  saldo,
  movimientos,
  loading = false,
  onNotaClick,
}: MovementListProps) {
  function handleExport(): void {
    const csv = toCSV(movimientos, CSV_COLUMNS)
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    downloadCSV(`ctacte-${socioId}-${today}.csv`, csv)
  }

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid="movement-list-loading"
        className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
      >
        <table className="w-full">
          <thead className="bg-surface-sunken">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Fecha
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Descripción
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Debe
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Haber
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} aria-hidden="true">
                <td className="border-t border-ink-100 px-4 py-3">
                  <span className="block h-3 w-20 animate-pulse rounded bg-surface-sunken" />
                </td>
                <td className="border-t border-ink-100 px-4 py-3">
                  <span className="block h-3 w-40 animate-pulse rounded bg-surface-sunken" />
                </td>
                <td className="border-t border-ink-100 px-4 py-3">
                  <span className="ml-auto block h-3 w-24 animate-pulse rounded bg-surface-sunken" />
                </td>
                <td className="border-t border-ink-100 px-4 py-3">
                  <span className="ml-auto block h-3 w-24 animate-pulse rounded bg-surface-sunken" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  return (
    <section
      aria-label="Movimientos de cuenta corriente"
      data-testid="movement-list"
      className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
    >
      <header className="flex flex-col gap-3 border-b border-ink-100 bg-surface-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Cuenta
          </span>
          <span className="font-mono text-xs text-ink-700" data-testid="movement-list-cuenta">
            {socioId}
          </span>
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Saldo
          </span>
          <span
            className="font-display text-base font-semibold text-ink-900"
            data-testid="movement-list-saldo"
          >
            {ARS.format(Number(saldo))}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={movimientos.length === 0}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-display text-xs font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="movement-list-export"
        >
          Exportar CSV
        </button>
      </header>

      {movimientos.length === 0 ? (
        <p
          className="px-6 py-12 text-center font-body text-sm text-ink-500"
          data-testid="movement-list-empty"
        >
          Sin movimientos para los filtros seleccionados.
        </p>
      ) : (
        <table className="w-full">
          <thead className="bg-surface-sunken">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Fecha
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Descripción
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Debe
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                Haber
              </th>
              {onNotaClick ? (
                <th scope="col" className="w-10">
                  <span className="sr-only">Acciones</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr
                key={m.id}
                data-testid={`movement-row-${m.id}`}
                className={
                  m.anulado
                    ? 'border-t border-ink-100 bg-surface-sunken text-ink-500 line-through'
                    : 'border-t border-ink-100'
                }
              >
                <td className="px-4 py-3 font-body text-sm tabular-nums text-ink-700">
                  {formatDate(m.fecha)}
                </td>
                <td className="px-4 py-3 font-body text-sm text-ink-700">
                  <span>{m.concepto}</span>
                  {m.anulado ? (
                    <span
                      className="ml-2 font-display text-[10px] font-semibold uppercase tracking-widest text-danger"
                      data-testid={`movement-row-${m.id}-anulado`}
                    >
                      Anulado
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-body text-sm tabular-nums text-ink-700">
                  {Number(m.debe) > 0 ? ARS.format(Number(m.debe)) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-body text-sm tabular-nums text-ink-700">
                  {Number(m.haber) > 0 ? ARS.format(Number(m.haber)) : '—'}
                </td>
                {onNotaClick ? (
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label={`Agregar nota al movimiento ${m.id}`}
                      data-testid={`movement-row-${m.id}-nota`}
                      onClick={() => onNotaClick(m.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-600"
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
