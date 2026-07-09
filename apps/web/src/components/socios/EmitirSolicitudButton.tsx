'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { getFormUrl } from '@/lib/api/forms'
import { apiFetchBlob } from '@/lib/api'
import { notify } from '@/lib/notifications'

/**
 * `EmitirSolicitudButton` — secondary-variant button in the
 * `/socios/[id]` header that opens the Club Atlético Gorriti
 * membership inscription PDF in a new tab.
 *
 * Wired in PR 8d.2 (task B.2). The server route is
 * `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf`
 * (PR 8d.1 backend) which returns a server-rendered A4 PDF
 * pre-filled with the titular's data.
 *
 * **2026-07-09 fix (chore):** the original implementation used
 * `window.open(url, '_blank', ...)` directly. That fails with 401
 * because `window.open` does NOT send the `Authorization: Bearer
 * <token>` header (the auth flow uses in-memory tokens, not cookies).
 * The current implementation fetches the PDF with the auth header
 * via `apiFetchBlob` (single-flight refresh on 401 included), creates
 * a blob URL from the response, and opens that. The blob URL is
 * revoked after 60 s to free memory.
 *
 * Why `noopener,noreferrer` on the blob URL window: keeps
 * `window.opener === null` in the new tab so a malicious PDF
 * can't reach back into the operator console.
 *
 * The button is ALWAYS visible to any authenticated operator (not
 * gated by `isAdmin`) per the UI design delta R7 — printing the
 * inscription form is part of the standard operator workflow.
 * The caller passes `disabled` when `socio.direccion` is missing
 * (the form requires a domicilio for the FESCAG aceptance); the
 * disabled state hides the click, not the button itself.
 *
 * Stateful: tracks `loading` to disable the button + show a spinner
 * while the PDF is being fetched.
 */

interface EmitirSolicitudButtonProps {
  socioId: string
  /** Disable the button. Caller decides when (e.g. socio missing
   *  `direccion`). Disabled state hides the click, NOT the button
   *  itself — the operator should see why the action is unavailable. */
  disabled?: boolean
}

export function EmitirSolicitudButton({ socioId, disabled }: EmitirSolicitudButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (loading) return
    setLoading(true)
    notify('info', 'Generando PDF…')

    let blobUrl: string | null = null
    try {
      const blob = await apiFetchBlob(getFormUrl(socioId, 'solicitud-inscripcion'))
      blobUrl = URL.createObjectURL(blob)
      // `noopener,noreferrer` keeps `window.opener === null` in the new
      // tab so a malicious PDF can't reach back into the operator console.
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      // Free the blob after 60 s — the new tab will have loaded the PDF
      // into its own renderer by then, so the URL can be released.
      setTimeout(() => {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      }, 60_000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo generar el PDF'
      notify('error', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      data-testid="socio-detail-emitir-solicitud"
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
      {loading ? 'Generando…' : 'Emitir Solicitud'}
    </button>
  )
}
