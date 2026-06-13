/**
 * Default set of PII / secret field names whose values must be redacted
 * before they hit logs or error responses. Matched case-insensitively.
 *
 * Add to this set when a new sensitive column is added to the schema
 * (e.g. a future `operators.email`). The set is intentionally narrow —
 * over-redaction makes logs unreadable.
 */
const DEFAULT_FIELDS = new Set([
  'password',
  'token',
  'refresh_token',
  'dni',
  'cuit',
  'authorization',
])

/**
 * Deep-clone `obj` and replace values for any field whose name is in
 * `fields` (case-insensitive) with the literal string `[REDACTED]`.
 *
 * - Primitives, `null`, and `undefined` pass through unchanged.
 * - Arrays are mapped recursively.
 * - Plain objects are walked key-by-key.
 * - Field matching is by exact lowercase key — there is intentionally no
 *   suffix / prefix matching so `password_hash` is NOT redacted by the
 *   default set; callers that need it add it to their own set.
 */
export function redact<T>(obj: T, fields: Set<string> = DEFAULT_FIELDS): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    return obj.map((v) => redact(v, fields)) as unknown as T
  }
  if (typeof obj !== 'object') return obj

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (fields.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = redact(value, fields)
    }
  }
  return result as T
}
