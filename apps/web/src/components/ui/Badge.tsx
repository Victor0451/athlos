/**
 * Badge — Gorriti Premium visual primitive (2026-07-02).
 *
 * Rounded 4px (per `4-UI-Style-Gorriti-Premium.md` §"Badge"), 12px Inter
 * weight 500, padding 2px 8px. Variants mirror the document:
 *
 *   | variant  | bg          | text       | use case                  |
 *   |----------|-------------|------------|---------------------------|
 *   | default  | surface-sunken | ink-700    | neutral tag               |
 *   | success  | accent-soft | accent     | active / ok               |
 *   | warning  | #fef7e6     | #92670f     | suspended / soft warning  |
 *   | danger   | #fdf2f2     | accent     | soft-deleted / error      |
 *   | info     | #eef2fb     | #1a4a7a     | informational             |
 *
 * The intent of the design system is to keep the badge a *tag*,
 * not a button — no shadow, no border (the bg is the border), small
 * radius, tight padding. Use sparingly; the page's typography should
 * carry meaning first.
 *
 * Why an opt-in `ariaLabel`? For status words that read the same
 * visually (e.g. "Baja" for `soft-deleted` and "Baja" for
 * `pending-payment`) the test-id plus the visible text disambiguate
 * for screen-reader users. Pass an explicit `ariaLabel` when the
 * visible text understates the meaning.
 */
import type { ReactNode } from 'react'

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-surface-sunken text-ink-700',
  success: 'bg-accent-soft text-accent',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-accent',
  info: 'bg-info-soft text-info',
}

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  /** Optional override for the accessible name (screen readers). */
  ariaLabel?: string
  /** Optional test-id for end-to-end test selectors. */
  dataTestid?: string
  /** Extra classes to merge — e.g. `ml-2` for inline placement. */
  className?: string
}

export function Badge({
  variant = 'default',
  children,
  ariaLabel,
  dataTestid,
  className = '',
}: BadgeProps) {
  return (
    <span
      data-testid={dataTestid}
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded px-2 py-0.5 font-body text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
