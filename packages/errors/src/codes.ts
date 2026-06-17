/**
 * Stable error codes. Every `ApiError` carries one of these so clients can
 * branch on the code without parsing the human-readable message.
 *
 * Codes are namespaced by domain (AUTH_*, APPROVAL_*, ...) so log filters
 * and metric labels are easy to write. Adding a new code: append it here
 * AND add the mapping in `api-error.ts:mapToStatus`. Forgetting either
 * side fails typecheck.
 */
export const ErrorCode = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  REASON_REQUIRED: 'REASON_REQUIRED',
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Approval links
  APPROVAL_LINK_EXPIRED: 'APPROVAL_LINK_EXPIRED',
  APPROVAL_ALREADY_USED: 'APPROVAL_ALREADY_USED',
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // Config
  CONFIG_MISSING: 'CONFIG_MISSING',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
