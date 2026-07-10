import { apiFetch } from '@/lib/api'

/**
 * ctacte-mutations API wrappers (PR A2 — athlos-ctacte-mutations).
 *
 * Four write endpoints for the cuenta-corriente mutation surface:
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/payment
 *     Multipart form: monto + fecha + concepto + optional comprobante.
 *     Returns 201 + the created movement.
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/debit
 *     JSON body: monto + fecha + motivo.
 *     Returns 201 + the created movement.
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes
 *     JSON body: body (note text).
 *     Returns 201 + the created note.
 *
 *   GET  /api/v1/socios/:socioId/ctacte/comprobante.pdf?from=&to=&cuenta=
 *     Returns PDF blob — consumed via apiFetchBlob in the ComprobanteButton.
 */

/** Wire DTO for the payment movement created response. */
export interface CtactePaymentResponse {
  id: string
  tipo: 'CREDITO'
  monto: string
  fecha: string
  concepto: string
  comprobante_attachment_id: string | null
}

/** Wire DTO for the debit movement created response. */
export interface CtacteDebitResponse {
  id: string
  tipo: 'DEBITO'
  monto: string
  fecha: string
  motivo: string
}

/** Wire DTO for the note created response. */
export interface CtacteNoteResponse {
  id: string
  ctacte_movement_id: string
  body: string
  author_operator_id: string
  created_at: string
}

/** Input for `registerCtactePayment`. */
export interface CtactePaymentInput {
  monto: number
  fecha: string
  concepto: string
  /** Optional comprobante file (PDF or image). */
  comprobante?: File
  /** Stable key reused if a submission must be retried after an ambiguous response. */
  idempotencyKey: string
}

/** Input for `registerCtacteDebit`. */
export interface CtacteDebitInput {
  monto: number
  fecha: string
  motivo: string
}

/**
 * `registerCtactePayment(socioId, input)` — POST
 * `/api/v1/socios/:socioId/ctacte/movements/payment`.
 *
 * Builds a `FormData` with four fields:
 *   - `monto`    — numeric value as string
 *   - `fecha`    — YYYY-MM-DD
 *   - `concepto` — free-form text
 *   - `comprobante` — optional file (PDF or image)
 *
 * The `apiFetch` FormData branch detects `body instanceof FormData`
 * and skips JSON content-type serialisation so the browser sets
 * the multipart boundary automatically.
 */
export async function registerCtactePayment(
  socioId: string,
  input: CtactePaymentInput,
): Promise<CtactePaymentResponse> {
  const formData = new FormData()
  formData.append('monto', String(input.monto))
  formData.append('fecha', input.fecha)
  formData.append('concepto', input.concepto)
  if (input.comprobante !== undefined) {
    formData.append('comprobante', input.comprobante)
  }
  return apiFetch<CtactePaymentResponse>(`/api/v1/socios/${socioId}/ctacte/movements/payment`, {
    method: 'POST',
    body: formData,
    headers: { 'Idempotency-Key': input.idempotencyKey },
  })
}

/**
 * `registerCtacteDebit(socioId, input)` — POST
 * `/api/v1/socios/:socioId/ctacte/movements/debit`.
 *
 * JSON body: { monto, fecha, motivo }.
 */
export async function registerCtacteDebit(
  socioId: string,
  input: CtacteDebitInput,
): Promise<CtacteDebitResponse> {
  return apiFetch<CtacteDebitResponse>(`/api/v1/socios/${socioId}/ctacte/movements/debit`, {
    method: 'POST',
    body: input,
  })
}

/**
 * `addCtacteNote(socioId, movementId, body)` — POST
 * `/api/v1/socios/:socioId/ctacte/movements/:movementId/notes`.
 *
 * JSON body: { body }. Returns the created note DTO.
 */
export async function addCtacteNote(
  socioId: string,
  movementId: string,
  body: string,
): Promise<CtacteNoteResponse> {
  return apiFetch<CtacteNoteResponse>(
    `/api/v1/socios/${socioId}/ctacte/movements/${movementId}/notes`,
    { method: 'POST', body: { body } },
  )
}

/** List active notes for a movement. */
export async function getCtacteNotes(
  socioId: string,
  movementId: string,
): Promise<CtacteNoteResponse[]> {
  return apiFetch<CtacteNoteResponse[]>(
    `/api/v1/socios/${socioId}/ctacte/movements/${movementId}/notes`,
  )
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''

/**
 * `getCtacteComprobanteUrl(socioId, cuenta, from, to)` — builds the
 * full URL for the `/api/v1/socios/:socioId/ctacte/comprobante.pdf`
 * PDF download endpoint.
 *
 * The `cuenta` parameter is encoded via `encodeURIComponent` so that
 * special characters (spaces, slashes, etc.) in the cuenta value
 * do not corrupt the query string.
 *
 * Returns the composed URL string. Callers pass it to `apiFetchBlob`
 * to retrieve the PDF blob.
 */
export function getCtacteComprobanteUrl(
  socioId: string,
  cuenta: string,
  from: string,
  to: string,
): string {
  const base = `${API_BASE_URL}/api/v1/socios/${socioId}/ctacte/comprobante.pdf`
  const params = new URLSearchParams({
    from,
    to,
    // URLSearchParams encodes automatically; wrapping in encodeURIComponent
    // would cause double-encoding (e.g. " " → "%20" → "%2520").
    cuenta,
  })
  return `${base}?${params.toString()}`
}
