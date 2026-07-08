'use client'

import { Printer } from 'lucide-react'
import { getFormUrl } from '@/lib/api/forms'
import { notify } from '@/lib/notifications'

/**
 * `EmitirSolicitudButton` — secondary-variant button in the
 * `/socios/[id]` header that opens the Club Atlético Gorriti
 * membership inscription PDF in a new tab.
 *
 * Wired in PR 8d.2 (task B.2). The server route is
 * `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`
 * (PR 8d.1 backend) which returns a server-rendered A4 PDF
 * pre-filled with the titular's data. The button intentionally
 * uses `window.open(url, '_blank', 'noopener,noreferrer')` instead
 * of a `<a target="_blank" download>` so:
 *   - The PDF stays open in the browser tab (operator can read it
 *     before printing — the form has handwritten-only fields).
 *   - `noopener,noreferrer` prevents the new tab from accessing
 *     `window.opener` (defence in depth against reverse-tabnabbing).
 *
 * Because the PDF is server-rendered, the click cannot tell
 * synchronously whether the render succeeded. We surface an
 * **info** toast ("Generando PDF…") on click so the operator
 * gets immediate feedback; the eventual success / error path is
 * driven by the route itself (PDF loads in the new tab on success,
 * 404 lands on a JSON error page for unknown socio ids).
 *
 * The button is ALWAYS visible to any authenticated operator (not
 * gated by `isAdmin`) per the UI design delta R7 — printing the
 * inscription form is part of the standard operator workflow.
 * The caller passes `disabled` when `socio.direccion` is missing
 * (the form requires a domicilio for the FESCAG aceptance); the
 * disabled state hides the click, not the button itself.
 *
 * Stateless: no React state, no fetching. `notify()` + `window.open`
 * are the only side effects.
 */

interface EmitirSolicitudButtonProps {
  socioId: string
  /** Disable the button. Caller decides when (e.g. socio missing
   *  `direccion`). Disabled state hides the click, NOT the button
   *  itself — the operator should see why the action is unavailable. */
  disabled?: boolean
}

const TOAST_MESSAGE = 'Generando PDF…'

export function EmitirSolicitudButton({ socioId, disabled }: EmitirSolicitudButtonProps) {
  function handleClick() {
    const url = getFormUrl(socioId, 'solicitud-inscripcion')
    // `noopener,noreferrer` keeps `window.opener === null` in the new
    // tab so a malicious PDF can't reach back into the operator console.
    window.open(url, '_blank', 'noopener,noreferrer')
    notify('info', TOAST_MESSAGE)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      data-testid="socio-detail-emitir-solicitud"
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
      Emitir Solicitud
    </button>
  )
}
