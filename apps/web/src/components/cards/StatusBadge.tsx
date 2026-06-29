/**
 * StatusBadge — pill-shaped status indicator for the dashboard and
 * scheduler cards (PR 8a.3).
 *
 * Maps the API's `healthy` / `enabled` boolean pairs onto a 5-state
 * visual that the operator can scan in <1s:
 *
 * | status    | label         | use case                              |
 * |-----------|---------------|---------------------------------------|
 * | healthy   | Operativo     | API up, scheduler job last run green  |
 * | degraded  | Degradado     | Scheduler job running but slow        |
 * | down      | Caído         | API down or last run failed           |
 * | disabled  | Deshabilitado | Job toggled off via PATCH             |
 * | unknown   | Desconocido   | First run pending, no signal yet      |
 *
 * Uses Gorriti Premium status tokens (`bg-success`, `bg-warning`,
 * `bg-danger`, `text-ink-500`, `bg-info`) — never raw hex.
 */

export type StatusBadgeKind = 'healthy' | 'degraded' | 'down' | 'disabled' | 'unknown'

interface StatusBadgeProps {
  status: StatusBadgeKind
}

interface VariantStyle {
  label: string
  /** Tailwind utility classes — kept inline so the bundle ships
   *  only the active variant. Status badge variants don't share a
   *  base class because the surface tint is the whole point. */
  classes: string
}

const VARIANTS: Record<StatusBadgeKind, VariantStyle> = {
  healthy: { label: 'Operativo', classes: 'bg-success text-white' },
  degraded: { label: 'Degradado', classes: 'bg-warning text-ink-900' },
  down: { label: 'Caído', classes: 'bg-danger text-white' },
  disabled: { label: 'Deshabilitado', classes: 'bg-surface-sunken text-ink-500' },
  unknown: { label: 'Desconocido', classes: 'bg-info text-white' },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variant = VARIANTS[status]
  return (
    <span
      role="status"
      aria-label={variant.label}
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-widest ${variant.classes}`}
    >
      {variant.label}
    </span>
  )
}
