/**
 * MetricCard — presentational card for the dashboard (PR 8a.3).
 *
 * Used by the "Master Table Counts", "Scheduler Status", and "Recent
 * Runs" cards. Pure presentation — no fetch, no state. The parent
 * passes the resolved value (already formatted as a string) plus an
 * optional loading flag.
 *
 * Visual contract (from `web-frontend/spec.md` / design §5):
 *   - `bg-surface-elevated` token (matches the rest of the chrome)
 *   - `rounded-lg p-4 shadow-sm` — same density as the existing
 *     AppShell cards in the design system
 *   - Label = small uppercase ink-500 caption
 *   - Value = display-sized ink-900 number/string
 *   - Sublabel = secondary metadata (count, last-update timestamp)
 *
 * The loading state hides the value (no fake content!) and shows a
 * pulse skeleton with a "Cargando…" label for screen readers.
 */

interface MetricCardProps {
  /** Small caption above the value — usually the card's title. */
  label: string
  /** Primary value (already formatted as a string). */
  value: string
  /** Optional secondary line — count, timestamp, helper text. */
  sublabel?: string
  /** When true, hides the value and renders a skeleton placeholder. */
  loading?: boolean
}

export function MetricCard({ label, value, sublabel, loading = false }: MetricCardProps) {
  return (
    <div
      data-testid={`metric-card-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className="rounded-lg bg-surface-elevated p-4 shadow-sm"
    >
      <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
        {label}
      </p>

      {loading ? (
        <div role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-ink-300">
          <span className="block h-6 w-24 animate-pulse rounded bg-surface-sunken" />
          <span className="sr-only">Cargando…</span>
          <span aria-hidden="true" className="font-mono text-xs">
            Cargando…
          </span>
        </div>
      ) : (
        <p
          data-testid={`metric-card-value-${label.toLowerCase().replace(/\s+/g, '-')}`}
          className="mt-1 font-display text-2xl font-bold text-ink-900 tabular-nums"
        >
          {value}
        </p>
      )}

      {sublabel ? <p className="mt-1 font-body text-xs text-ink-500">{sublabel}</p> : null}
    </div>
  )
}
