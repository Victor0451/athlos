import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

/**
 * One server-side field error entry. The server's ApiError envelope
 * carries `details` as an array of these for Pago / Débito / Nota
 * routes and as an object for comprobante cap-exceeded errors
 * (see {@link CapRangeDetails}).
 *
 * R4 — these entries are routed to react-hook-form via `setError` so
 * the message renders inline (under the matching input) while the
 * top-level failure toast still fires (toasts are NOT silenced).
 */
export interface FieldErrorEntry {
  field: string
  message: string
}

/**
 * Server-side cap-exceeded shape for comprobante. The route emits
 * `details: { cap: 50, requested: 51 }` when the date range would
 * return more than the 50-movement cap; this is NOT an array of
 * field entries so it gets its own normaliser.
 */
export interface CapRangeDetails {
  cap: number
  requested: number
}

/**
 * Normalise the `details` payload of a server `ApiError` into a flat
 * array of `{ field, message }` entries. Returns `[]` when:
 *
 *   - `details` is undefined / not an array (e.g. cap-exceeded object
 *     shape, generic 4xx/5xx with no details, etc.)
 *   - any individual entry is missing `field` or `message` strings
 *
 * The cap-exceeded object shape is detected separately by
 * {@link parseCapDetails}.
 */
export function parseFieldErrors(details: unknown): FieldErrorEntry[] {
  if (!Array.isArray(details)) return []
  const out: FieldErrorEntry[] = []
  for (const raw of details) {
    if (
      raw &&
      typeof raw === 'object' &&
      'field' in raw &&
      'message' in raw &&
      typeof (raw as { field: unknown }).field === 'string' &&
      typeof (raw as { message: unknown }).message === 'string'
    ) {
      out.push({
        field: (raw as { field: string }).field,
        message: (raw as { message: string }).message,
      })
    }
  }
  return out
}

/**
 * Detect the comprobante cap-exceeded shape. Returns the parsed
 * `{ cap, requested }` pair when `details` is the cap object,
 * otherwise `null`.
 */
export function parseCapDetails(details: unknown): CapRangeDetails | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const cap = (details as { cap?: unknown }).cap
  const requested = (details as { requested?: unknown }).requested
  if (typeof cap !== 'number' || typeof requested !== 'number') return null
  return { cap, requested }
}

/**
 * Apply a list of `{ field, message }` entries to a react-hook-form
 * via `setError`. Each entry becomes a server-side error on the
 * matching input — the form's per-field error region (`aria-invalid`,
 * inline message) renders the message automatically.
 *
 * `setError` in react-hook-form accepts an arbitrary string path even
 * for fields that don't exist on `T`; we still return the list of
 * entries the caller asked us to set so a caller can render a
 * top-level "unknown field" banner if it ever needs to.
 */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  details: unknown,
): FieldErrorEntry[] {
  const entries = parseFieldErrors(details)
  for (const entry of entries) {
    // Cast: react-hook-form accepts any string path; we can't verify
    // it belongs to T at runtime without compiling against the form
    // schema. Unknown fields simply don't render inline — the caller's
    // returned `entries` list lets it decide whether to surface them.
    setError(entry.field as Path<T>, {
      type: 'server',
      message: entry.message,
    })
  }
  return entries
}
