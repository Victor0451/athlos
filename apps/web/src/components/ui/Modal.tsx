import { useId, type ReactNode } from 'react'

/**
 * Modal — Gorriti Premium visual primitive (2026-07-06).
 *
 * The canonical responsive modal for the operator console. Built
 * around three vertical regions that solve the "buttons fall below
 * the fold on small monitors" bug:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ Header (shrink-0, sticky)               │  ← title, always visible
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │ Body (overflow-y-auto)                   │  ← content scrolls
 *   │                                          │
 *   ├──────────────────────────────────────────┤
 *   │ Footer (shrink-0, sticky)                │  ← actions, always visible
 *   └──────────────────────────────────────────┘
 *
 * Why this structure? On a 768px-tall monitor, a modal with
 * `fixed inset-0 flex items-center justify-center` and no `max-h`
 * lets the content overflow the viewport. The cancel/submit
 * buttons get pushed below the fold and the operator has to zoom
 * out the browser to reach them. This component enforces:
 *
 *   - Outer wrapper: `flex items-center justify-center bg-night-900/60 p-4`
 *     (centered, with backdrop + breathing room).
 *   - Inner panel: `flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden`
 *     (caps height, lets children manage their own scroll).
 *   - Header + footer are `shrink-0` (never collapse).
 *   - Body is `flex-1 overflow-y-auto` (the only scrollable region).
 *
 * Action buttons live in the FOOTER (outside the scroll container),
 * so they're always reachable. If the action submits a form inside
 * the body, the footer button uses `form="<form-id>"` to associate
 * with the body form.
 *
 * The component is dumb: it owns the layout, the parent owns the
 * state (open/close, submit handler, error). No portals, no
 * focus-trap (kept simple — the modal is rarely the only thing on
 * screen and the authed layout doesn't have other focusable content
 * competing for attention).
 */

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
}

interface ModalProps {
  /** Whether the modal is open. When false, renders nothing. */
  open: boolean
  /** Title shown in the sticky header. */
  title: ReactNode
  /** Modal body — typically a form, paragraph, or list. Scrolls internally. */
  children: ReactNode
  /** Footer content (typically Cancel + Confirm buttons). Always visible. */
  footer?: ReactNode
  /** Max-width of the modal panel. Default `xl` (= 672px). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  /** Accessible role. Use `alertdialog` for destructive confirmations
   *  (Delete, Reactivate) so screen readers announce the urgency. */
  role?: 'dialog' | 'alertdialog'
  /** id of the description element. Required when `role="alertdialog"`
   *  so the alert text is associated via `aria-describedby`. */
  descriptionId?: string
  /** Test id for the modal root (the backdrop wrapper). */
  dataTestid?: string
  /** Extra classes to merge onto the inner panel (rarely needed). */
  panelClassName?: string
}

export function Modal({
  open,
  title,
  children,
  footer,
  size = 'xl',
  role = 'dialog',
  descriptionId,
  dataTestid,
  panelClassName = '',
}: ModalProps) {
  const titleId = useId()

  if (!open) return null

  return (
    <div
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid={dataTestid}
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
    >
      <div
        className={`flex max-h-[calc(100vh-2rem)] w-full ${SIZE_CLASS[size]} flex-col overflow-hidden rounded-lg border border-ink-100 bg-surface shadow-2xl ${panelClassName}`}
      >
        <header className="shrink-0 border-b border-ink-100 px-8 py-5">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink-900">
            {title}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto px-8 py-6">{children}</div>
        {footer ? (
          <footer
            className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-ink-100 bg-surface px-8 py-4"
            data-testid={dataTestid ? `${dataTestid}-footer` : undefined}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
