import type { z } from 'zod'
import { BusinessError } from './api-error.ts'
import { ErrorCode } from './codes.ts'

/**
 * One Zod issue, flattened to a shape the API returns to clients.
 *
 * `field` is namespaced with the request surface (`body`, `query`,
 * `params`) so a client can tell at a glance which part of the request
 * is broken — useful when the same field name appears in both the body
 * and the query (e.g. `id`).
 */
export interface FieldError {
  field: string
  message: string
  code?: string
}

/**
 * Convert a `z.ZodError` into a flat array of `FieldError` objects. The
 * `surface` parameter prefixes every field path so a validation failure
 * on `body.email` is distinguishable from `query.email` at the client.
 */
export function mapZodErrors(
  error: z.ZodError,
  surface: 'body' | 'query' | 'params' = 'body',
): FieldError[] {
  return error.issues.map((issue) => ({
    field: `${surface}.${issue.path.join('.')}`,
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Validate `data` against `schema` and return the parsed value. On failure
 * throw a `BusinessError(VALIDATION_ERROR)` carrying the field-level errors
 * in `details` — the error handler in apps/api turns this into a 400.
 *
 * Use this at the top of every route handler instead of repeating
 * `schema.safeParse(...)` + `BusinessError(...)` + the cast.
 */
export function throwIfInvalid<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  surface: 'body' | 'query' | 'params' = 'body',
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw BusinessError(
      ErrorCode.VALIDATION_ERROR,
      'Request validation failed',
      mapZodErrors(result.error, surface),
    )
  }
  return result.data
}
