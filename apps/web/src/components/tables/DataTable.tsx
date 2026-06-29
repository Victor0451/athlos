import type { ReactNode } from 'react'
import { useMemo } from 'react'

/**
 * DataTable — generic table primitive (TASK-019, PR 8b.1).
 *
 * Drives the Socios list (8b.1) and will be reused by Ctacte (8b.2)
 * + Padrones (8b.3). Pure presentation — pagination, sort, and
 * row navigation are parent concerns (URL search/filter state,
 * click handlers); this component just renders and emits callbacks.
 *
 * Visual contract (Gorriti Premium tokens):
 *   - Sticky <thead> with `bg-surface-sunken`
 *   - Rows on `bg-surface`, no zebra stripes, `tabular-nums`
 *   - Empty state copy "Sin resultados para los filtros seleccionados"
 *   - Loading skeleton: 5 pulse rows
 *   - Pagination footer: "Anterior / Página N de M / Siguiente"
 */

export interface ColumnDef<T> {
  /** Stable column key — used as React `key` and the cell fallback. */
  key: string
  /** Header text. */
  header: string
  /**
   * Custom cell renderer. When omitted, the cell renders
   * `String(row[key])`. Use this for status badges, links, formatted
   * numbers/dates, etc.
   */
  accessor?: (row: T) => ReactNode
  /** Optional Tailwind classes applied to the `<td>`. Escape hatch. */
  className?: string
}

export interface PaginationProps {
  page: number
  limit: number
  total: number
  onPageChange: (page: number) => void
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  loading?: boolean
  /** When provided, renders the pagination footer. */
  pagination?: PaginationProps
  /**
   * Optional row click handler. When provided, rows become
   * clickable (cursor-pointer + keyboard). For navigation, the
   * parent typically calls `router.push(...)` inside the handler.
   */
  onRowClick?: (row: T) => void
  /** Per-row React `key` extractor. Required when data is non-empty. */
  rowKey: (row: T) => string
  /** test-id root. Pass `testId="socios-table"` to scope queries. */
  testId?: string
}

/** Empty-state copy (Spanish — design system default for empty lists). */
const EMPTY_MESSAGE = 'Sin resultados para los filtros seleccionados'

export function DataTable<T>({
  columns,
  data,
  loading = false,
  pagination,
  onRowClick,
  rowKey,
  testId,
}: DataTableProps<T>) {
  const totalPages = useMemo(() => {
    if (!pagination) return 0
    return Math.max(1, Math.ceil(pagination.total / pagination.limit))
  }, [pagination])

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid={testId ? `${testId}-loading` : undefined}
        className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
      >
        <table className="w-full">
          <thead className="bg-surface-sunken">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} aria-hidden="true">
                {columns.map((c) => (
                  <td key={c.key} className="border-t border-ink-100 px-4 py-3">
                    <span className="block h-3 w-24 animate-pulse rounded bg-surface-sunken" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div
        role="status"
        aria-label={EMPTY_MESSAGE}
        data-testid={testId ? `${testId}-empty` : undefined}
        className="overflow-hidden rounded-lg border border-ink-100 bg-surface px-6 py-12 text-center"
      >
        <p className="font-body text-sm text-ink-500">{EMPTY_MESSAGE}</p>
      </div>
    )
  }

  return (
    <div
      data-testid={testId}
      className="overflow-hidden rounded-lg border border-ink-100 bg-surface"
    >
      <table className="w-full">
        <thead className="bg-surface-sunken">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={testId ? `${testId}-row-${rowKey(row)}` : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
              className={
                onRowClick
                  ? 'cursor-pointer border-t border-ink-100 transition-colors duration-fast hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                  : 'border-t border-ink-100'
              }
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 font-body text-sm text-ink-700 tabular-nums ${c.className ?? ''}`}
                >
                  {c.accessor
                    ? c.accessor(row)
                    : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {pagination ? (
        <nav
          aria-label="Paginación"
          className="flex items-center justify-between border-t border-ink-100 bg-surface-sunken px-4 py-3"
          data-testid={testId ? `${testId}-pagination` : undefined}
        >
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anterior
          </button>
          <span
            className="font-mono text-xs text-ink-500"
            data-testid={testId ? `${testId}-page-indicator` : undefined}
          >
            Página {pagination.page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => pagination.onPageChange(pagination.page + 1)}
            disabled={pagination.page >= totalPages}
            className="rounded-md border border-ink-200 bg-surface px-3 py-1 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente
          </button>
        </nav>
      ) : null}
    </div>
  )
}
