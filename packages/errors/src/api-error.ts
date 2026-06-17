import { ErrorCode } from './codes.ts'

/**
 * The single error type the API layer throws. Three properties matter:
 *
 *   - `code`     — stable, machine-readable, listed in {@link ErrorCode}
 *   - `statusCode` — HTTP status the error handler should emit
 *   - `isBusiness` — `true` when the error is expected and the message is
 *                    safe to return to the client; `false` for technical
 *                    failures (DB down, parse crash) where the handler
 *                    must redact the message and emit a generic 500.
 *
 * `details` is an optional machine-readable payload (Zod field errors,
 * upstream error metadata, ...). It is always returned to the client
 * when present — callers should redact sensitive fields themselves.
 */
export class ApiError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly isBusiness: boolean
  public readonly details?: unknown

  constructor(opts: {
    code: ErrorCode
    message: string
    statusCode: number
    isBusiness: boolean
    details?: unknown
    cause?: unknown
  }) {
    super(opts.message)
    this.name = 'ApiError'
    this.code = opts.code
    this.statusCode = opts.statusCode
    this.isBusiness = opts.isBusiness
    this.details = opts.details
    if (opts.cause !== undefined) {
      // `cause` was added to Error in ES2022; assign through the prototype
      // escape hatch to support older targets and to keep the option
      // optional without a constructor signature that forces `undefined`.
      ;(this as Error & { cause?: unknown }).cause = opts.cause
    }
  }
}

/**
 * Build a business error (expected, safe to surface). Status code is
 * derived from the code via {@link mapToStatus} so callers never have
 * to remember "is 401 INVALID_CREDENTIALS or TOKEN_EXPIRED?".
 */
export function BusinessError(code: ErrorCode, message: string, details?: unknown): ApiError {
  return new ApiError({
    code,
    message,
    statusCode: mapToStatus(code),
    isBusiness: true,
    details,
  })
}

/**
 * Build a technical error (unexpected, message redacted by the handler).
 * Always emits 500; the `cause` is preserved for the log so operators can
 * trace the original failure.
 */
export function TechnicalError(code: ErrorCode, message: string, cause?: unknown): ApiError {
  return new ApiError({
    code,
    message,
    statusCode: 500,
    isBusiness: false,
    cause,
  })
}

/**
 * Map an error code to its HTTP status. Centralized here so a new code
 * forces the reviewer to ask "what status does this return?" — a missing
 * branch falls through to 500 and the lint rule on `noFallthroughCasesInSwitch`
 * keeps the switch exhaustive.
 */
function mapToStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.REASON_REQUIRED:
      return 400
    case ErrorCode.INVALID_CREDENTIALS:
    case ErrorCode.TOKEN_EXPIRED:
    case ErrorCode.TOKEN_INVALID:
      return 401
    case ErrorCode.INSUFFICIENT_PERMISSIONS:
      return 403
    case ErrorCode.NOT_FOUND:
      return 404
    case ErrorCode.CONFLICT:
      return 409
    case ErrorCode.APPROVAL_LINK_EXPIRED:
    case ErrorCode.APPROVAL_ALREADY_USED:
      return 410
    case ErrorCode.ACCOUNT_LOCKED:
      return 423
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 503
    case ErrorCode.CONFIG_MISSING:
      return 500
    case ErrorCode.INTERNAL_ERROR:
      return 500
  }
}
