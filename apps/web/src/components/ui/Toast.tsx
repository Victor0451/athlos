'use client'

import { useEffect, type ReactElement } from 'react'
import { Toaster, toast, useSonner } from 'sonner'

/**
 * Toast primitive — thin wrapper around `sonner` that owns every
 * project default so call sites never import sonner directly.
 *
 * Two exports:
 *   - `notify(kind, message, opts?)` — render a toast via sonner
 *     with the locked visual / accessibility / lifetime contract.
 *   - `<ToasterMount />` — render once inside the root layout to
 *     attach the sonner portal. No-op if mounted more than once.
 *
 * Locked defaults (see design D5/D6/D7 + spec
 * `toast-notifications/spec.md`):
 *   - position: `top-right`
 *   - theme: `light` (no OS preference follow-through)
 *   - richColors: true
 *   - closeButton: true
 *   - success/info auto-dismiss: 4000 ms
 *   - error auto-dismiss: 6000 ms (NOT sticky)
 *   - per-toast ARIA role: success/info → `status`, error → `alert`
 *
 * ARIA role mechanism: sonner 1.7.x exposes no first-party per-toast
 * `role` API, so we use the `classNames.toast` slot to stamp an
 * `athlos-toast--<kind>` class on every toast `<li>`. The
 * `useEffect` in `<ToasterMount />` subscribes to sonner's toast
 * store (via `useSonner()`) and re-runs whenever the toast list
 * changes; on each run it walks `[data-sonner-toast]` and stamps
 * the right `role` attribute + a `data-kind` marker.
 */

const ROLE_BY_KIND = {
  success: 'status',
  info: 'status',
  error: 'alert',
} as const

const KIND_PREFIX = 'athlos-toast--'
const KIND_VALUES = ['success', 'info', 'error'] as const

export type NotifyKind = (typeof KIND_VALUES)[number]

export interface NotifyOptions {
  /** Override auto-dismiss duration (ms). Omit to use the kind default. */
  durationMs?: number
  /** Optional id for future dismiss-by-id flows. */
  id?: string
  /** Optional secondary line under the title. */
  description?: string
}

const DEFAULT_DURATION_MS: Record<NotifyKind, number> = {
  success: 4000,
  info: 4000,
  error: 6000,
}

function readKindFromClassName(el: Element): NotifyKind | null {
  for (const kind of KIND_VALUES) {
    if (el.classList.contains(`${KIND_PREFIX}${kind}`)) return kind
  }
  return null
}

/**
 * Render a toast via sonner with the project defaults. Returns the
 * sonner toast id (string) so callers can dismiss-by-id later if
 * needed.
 */
export function notify(kind: NotifyKind, message: string, opts?: NotifyOptions): string {
  const duration = opts?.durationMs ?? DEFAULT_DURATION_MS[kind]
  // Sonner's ExternalToast uses exactOptionalPropertyTypes: a
  // missing key is fine, but `id: undefined` is not. Build the
  // payload conditionally so optional fields stay absent.
  const shared: {
    description?: string
    duration: number
    id?: string
    classNames: { toast: string }
  } = {
    duration,
    classNames: {
      toast: `athlos-toast ${KIND_PREFIX}${kind}`,
    },
  }
  if (opts?.description !== undefined) shared.description = opts.description
  if (opts?.id !== undefined) shared.id = opts.id

  let rawId: string | number
  switch (kind) {
    case 'success':
      rawId = toast.success(message, shared)
      break
    case 'error':
      rawId = toast.error(message, shared)
      break
    case 'info':
      rawId = toast.info(message, shared)
      break
  }
  return String(rawId)
}

/**
 * Mount the sonner portal once. The component is idempotent in
 * practice (sonner mounts a single portal regardless of how many
 * times the component is rendered), but the design contract is
 * "exactly one mount in the root layout".
 *
 * The component stamps per-toast `role` + `data-kind` attributes
 * via a `useEffect` that depends on the live toasts list from
 * `useSonner()`. The effect skips toasts that already carry
 * `data-kind` (idempotent across re-runs).
 */
export function ToasterMount(): ReactElement {
  const { toasts } = useSonner()
  // Depend on the toasts list length so we re-run when a new
  // toast is added or removed. The exact id list would also work
  // but the length check is cheaper and equally correct here.
  const toastsKey = toasts.length

  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>('[data-sonner-toast]')
    items.forEach((el) => {
      if (el.dataset.kind) return
      const kind = readKindFromClassName(el)
      if (!kind) return
      const role = ROLE_BY_KIND[kind]
      el.setAttribute('role', role)
      el.setAttribute('data-kind', kind)
    })
  }, [toastsKey])

  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      theme="light"
      toastOptions={{
        classNames: {
          toast: 'athlos-toast',
        },
      }}
    />
  )
}
