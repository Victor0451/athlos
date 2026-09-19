import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

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
 * The parent owns open/close, submission and errors. The inline modal
 * contains keyboard focus and restores a usable opener without changing
 * the parent's cancellation policy.
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
  /** Optional dismissal handler. When provided, Escape and a pointer press on the
   *  backdrop (outside the panel) invoke it, matching standard dialog dismissal. */
  onDismiss?: () => void
}

function isUsable(element: HTMLElement) {
  if (!element.isConnected || element.matches(':disabled, input[type="hidden"]')) return false
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.hasAttribute('inert')) return false
    const style = window.getComputedStyle(ancestor)
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false
    if (
      ancestor instanceof HTMLDetailsElement &&
      !ancestor.open &&
      !ancestor.querySelector('summary')?.contains(element)
    )
      return false
  }
  return true
}

function topModal(excluded?: HTMLElement) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-focus-root]'))
    .filter((element) => element !== excluded && isUsable(element))
    .at(-1)
}

function tabbables(modal: HTMLElement) {
  const candidates = Array.from(
    modal.querySelectorAll<HTMLElement>(
      'a[href],area[href],button,input,select,textarea,iframe,object,embed,summary,[contenteditable],[tabindex]',
    ),
  ).filter((element) => element.tabIndex >= 0 && isUsable(element))
  return candidates
    .filter((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name)
        return true
      const group = candidates.filter(
        (other): other is HTMLInputElement =>
          other instanceof HTMLInputElement &&
          other.type === 'radio' &&
          other.name === element.name &&
          other.form === element.form,
      )
      return element === (group.find((radio) => radio.checked) ?? group[0])
    })
    .sort((left, right) => (left.tabIndex || Infinity) - (right.tabIndex || Infinity))
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
  onDismiss,
}: ModalProps) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  // Capture before child layout effects can focus an internal alert.
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  wasOpen.current = open

  useLayoutEffect(() => {
    const modal = modalRef.current
    if (!open || !modal) return
    const opener = openerRef.current
    const focusFirst = () => (tabbables(modal)[0] ?? modal).focus()
    if (topModal() === modal && !modal.contains(document.activeElement)) focusFirst()
    const containFocus = (event: FocusEvent) => {
      if (topModal() === modal && event.target instanceof Node && !modal.contains(event.target))
        focusFirst()
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      const remaining = topModal(modal)
      if (opener && isUsable(opener) && (!remaining || remaining.contains(opener))) opener.focus()
    }
  }, [open])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && onDismiss && topModal() === modalRef.current) {
      event.stopPropagation()
      onDismiss()
      return
    }
    const modal = modalRef.current
    if (event.defaultPrevented || event.key !== 'Tab' || !modal || topModal() !== modal) return
    const controls = tabbables(modal)
    const index = controls.indexOf(document.activeElement as HTMLElement)
    if (index === -1 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
      event.preventDefault()
      const destination = event.shiftKey ? controls.at(-1) : controls[0]
      ;(destination ?? modal).focus()
    }
  }

  if (!open) return null

  return (
    <div
      ref={modalRef}
      data-modal-focus-root
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // Backdrop dismissal: only a press on the backdrop itself, never a press that
        // bubbles from inside the panel (portal targets fail the identity check by DOM
        // node, so dropdown portals cannot dismiss the modal).
        if (event.target === event.currentTarget) onDismiss?.()
      }}
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
        <header className="shrink-0 border-b border-ink-100 px-5 py-4 sm:px-8 sm:py-5">
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink-900">
            {title}
          </h2>
        </header>
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">{children}</div>
        {footer ? (
          <footer
            className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-ink-100 bg-surface px-5 py-4 sm:px-8"
            data-testid={dataTestid ? `${dataTestid}-footer` : undefined}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
