/**
 * @athlos/errors — public API.
 *
 * Re-exports the three concerns this package owns:
 *   1. Typed business / technical errors (api-error.ts).
 *   2. Stable error code enum (codes.ts) — clients branch on these.
 *   3. Zod adapter that turns validation issues into 400 responses.
 *   4. PII redaction for log payloads (redact.ts).
 *
 * Convention for downstream code:
 *   throw BusinessError(ErrorCode.NOT_FOUND, 'socio not found')
 *
 * The error handler in apps/api/plugins/error-handler.ts maps these to
 * HTTP responses — never construct an HTTP reply from a route handler
 * when a `BusinessError` is the right shape.
 */
export { ErrorCode } from './codes.ts'
export type { ErrorCode as ErrorCodeType } from './codes.ts'

export { ApiError, BusinessError, TechnicalError } from './api-error.ts'

export { mapZodErrors, throwIfInvalid } from './zod.ts'
export type { FieldError } from './zod.ts'

export { redact } from './redact.ts'
