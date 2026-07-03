'use client'

import { useQuery } from '@tanstack/react-query'
import { getCtacte } from '@/lib/api/ctacte'

/**
 * CtacteTab — cuenta-corriente panel for the Socio detail page
 * (PR 8b.2 second slice).
 *
 * Renders the socio's current `saldo` + the first page of
 * movimientos (default 20) inside the tab pane. The tab itself owns
 * the data fetch (single useQuery against `/cuenta-corriente`) so the
 * detail page stays free of fetch logic and mounts the panel as a
 * self-contained island.
 *
 * The Spanish `Intl.NumberFormat('es-AR', { style: 'currency',
 * currency: 'ARS' })` formatter is duplicated inline for this slice
 * — the audit documented the duplication (`lib/format.ts` extraction
 * is scoped to a later slice once we have a second consumer).
 *
 * No "ver más" pagination this slice — the orchestrator brief caps
 * the work to a single page; future slices can plumb a load-more
 * button using the `getMovimientos` paginated endpoint.
 */

interface CtacteTabProps {
  socioId: string
}

/** Format a numeric-string (NUMERIC(14,2) wire shape) as ARS. */
const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

/** YYYY-MM-DD → DD/MM/YYYY (es-AR). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

/** "CUENTA CORRIENTE" — the section heading + a11y label. */
const SECTION_LABEL = 'Cuenta corriente'

export function CtacteTab({ socioId }: CtacteTabProps) {
  const query = useQuery({
    queryKey: ['ctacte', socioId, { limit: 20 }],
    queryFn: () => getCtacte(socioId, { limit: 20 }),
  })

  if (query.isPending) {
    return (
      <section
        role="region"
        aria-label={SECTION_LABEL}
        aria-busy="true"
        data-testid="ctacte-tab-loading"
        className="space-y-3 rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
      >
        <div className="h-4 w-32 animate-pulse rounded bg-surface-sunken" />
        <div className="h-7 w-40 animate-pulse rounded bg-surface-sunken" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
          ))}
        </div>
        <span className="sr-only">Cargando…</span>
      </section>
    )
  }

  if (query.isError) {
    return (
      <section
        role="region"
        aria-label={SECTION_LABEL}
        data-testid="ctacte-tab-error"
        className="rounded-lg border border-danger bg-danger/10 p-6"
      >
        <p role="alert" className="font-display text-sm font-semibold text-danger">
          No pudimos cargar la cuenta corriente.
        </p>
        <p className="mt-1 font-body text-sm text-danger">
          {query.error instanceof Error ? query.error.message : 'Error desconocido'}
        </p>
      </section>
    )
  }

  const data = query.data
  const movimientos = data?.movimientos ?? []
  const saldo = data?.saldo ?? '0.00'

  return (
    <section
      role="region"
      aria-label={SECTION_LABEL}
      data-testid="ctacte-tab"
      className="space-y-3 rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-base font-semibold uppercase tracking-wide text-ink-700">
          Cuenta corriente
        </h2>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Saldo actual
          </span>
          <span
            className="font-display text-lg font-semibold tabular-nums text-ink-900"
            data-testid="ctacte-tab-saldo"
          >
            {ARS.format(Number(saldo))}
          </span>
        </div>
      </header>

      {movimientos.length === 0 ? (
        <p
          data-testid="ctacte-tab-empty"
          className="rounded-md border border-dashed border-ink-200 px-4 py-8 text-center font-body text-sm text-ink-500"
        >
          Sin movimientos para este socio.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-ink-100">
          <table role="table" aria-label="Movimientos de cuenta corriente" className="w-full">
            <thead className="bg-surface-sunken">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  Fecha
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  Tipo
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  Concepto
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  Debe
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  Haber
                </th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr
                  key={m.id}
                  data-testid={`ctacte-tab-row-${m.id}`}
                  className={
                    m.anulado
                      ? 'border-t border-ink-100 bg-surface-sunken text-ink-500 line-through'
                      : 'border-t border-ink-100'
                  }
                >
                  <td className="px-3 py-2 font-body text-sm tabular-nums text-ink-700">
                    {formatDate(m.fecha)}
                  </td>
                  <td className="px-3 py-2 font-body text-sm text-ink-700">{m.tipo}</td>
                  <td className="px-3 py-2 font-body text-sm text-ink-700">
                    {m.concepto}
                    {m.anulado ? (
                      <span
                        className="ml-2 font-display text-[10px] font-semibold uppercase tracking-widest text-danger"
                        data-testid={`ctacte-tab-row-${m.id}-anulado`}
                      >
                        Anulado
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-body text-sm tabular-nums text-ink-700">
                    {Number(m.debe) > 0 ? ARS.format(Number(m.debe)) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-body text-sm tabular-nums text-ink-700">
                    {Number(m.haber) > 0 ? ARS.format(Number(m.haber)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default CtacteTab
