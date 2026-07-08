/**
 * Client wrapper for the socio-forms surface (PR 8d.2, task B.1).
 *
 * Pure URL composition — no `fetch`, no body. The actual HTTP call
 * for the PDF is `window.open(url, '_blank', 'noopener,noreferrer')`
 * issued by the `<EmitirSolicitudButton>` component (the browser
 * streams the PDF directly via the Chrome PDF plugin; no React
 * state is involved, so a `fetch` wrapper would only add ceremony).
 *
 * The URL shape is locked by `openspec/changes/athlos-socio-form-emit/design.md`:
 *   `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/${formId}.pdf`
 *
 * The trailing-slash trim on `NEXT_PUBLIC_API_BASE_URL` mirrors
 * `apps/web/src/lib/api.ts::buildUrl()` so a misconfigured `…/`
 * env var never produces `//api/v1` in the address bar (which
 * some proxies treat as a different origin).
 *
 * `formId` is typed as a literal union (currently only
 * `solicitud-inscripcion`) so the call site gets a compile-time
 * error if a future form ships with a typo'd id. The `.pdf`
 * suffix is appended by this helper, NOT by the caller — keeps
 * the route contract and the URL contract in lock-step.
 */

export type SocioFormId = 'solicitud-inscripcion'

/** Read `NEXT_PUBLIC_API_BASE_URL` defensively so an unset env var
 *  (e.g. in some CI runners) yields a path-only URL instead of
 *  `undefined/api/v1`. */
function readApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')
}

/**
 * Build the URL for a socio form PDF. Used by the header "Emitir
 * Solicitud" button on `/socios/[id]`; see `<EmitirSolicitudButton>`.
 *
 * @param socioId — UUID of the titular socio (any non-empty string is
 *                  accepted; the route 404s on unknown ids).
 * @param formId  — form identifier; locked to the literal union so
 *                  a future typo fails TypeScript.
 */
export function getFormUrl(socioId: string, formId: SocioFormId): string {
  const base = readApiBaseUrl()
  return `${base}/api/v1/socios/${socioId}/forms/${formId}.pdf`
}
