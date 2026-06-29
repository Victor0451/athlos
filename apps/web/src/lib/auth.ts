/**
 * In-memory access + refresh token state for the operator console.
 *
 * Per the `web-frontend/spec.md` (Operator Login and Logout requirement),
 * the access token lives ONLY in module-scope memory. Any XSS that reads
 * it has ≤15 min of damage before the JWT expires. The refresh token is
 * stored next to the access token here ONLY because the v0.5.8 backend
 * accepts body-based refresh (`auth-cookies/spec.md` Scenario: Backend
 * slice not yet shipped). Once the cookie-transport backend slice lands
 * (PR 8a.2), `refreshAccessToken()` will drop the body and call
 * `/api/auth/refresh` with `credentials: 'include'` only — `refreshToken`
 * disappears entirely.
 *
 * Tab close = logout, because the module-scope variable dies with the
 * tab. This is the documented trade-off for a 3–5 person console.
 */

/** Shape of the JSON body returned by POST /api/v1/auth/login. */
export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  operator_id: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  permissions: { can_reprint: boolean; can_anulate: boolean }
}

/** Shape of the JSON body returned by POST /api/v1/auth/refresh. */
export interface RefreshResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

/** Error body shape returned by the API on 4xx/5xx. */
interface ApiErrorBody {
  code?: string
  message?: string
  retryAfterMinutes?: number
}

/** Error thrown by the auth module when the API rejects the request. */
export class AuthError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterMinutes?: number

  constructor(code: string, status: number, message: string, retryAfterMinutes?: number) {
    super(`${code}: ${message}`)
    this.name = 'AuthError'
    this.code = code
    this.status = status
    if (retryAfterMinutes !== undefined) {
      this.retryAfterMinutes = retryAfterMinutes
    }
  }
}

// Module-scope token state. NEVER exported directly.
let accessToken: string | null = null
let refreshToken: string | null = null

/** Read the current access token, or `null` if not authenticated. */
export function getAccessToken(): string | null {
  return accessToken
}

/** Replace the in-memory access token. Internal helper, used by login() and refreshAccessToken(). */
export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Read the current refresh token, or `null` if not authenticated. Internal helper. */
function getRefreshToken(): string | null {
  return refreshToken
}

/** Replace the in-memory refresh token. */
function setRefreshToken(token: string | null): void {
  refreshToken = token
}

/** Drop both tokens. Used by logout() and after a failed refresh. */
export function clearAccessToken(): void {
  accessToken = null
  refreshToken = null
}

async function parseError(res: Response): Promise<AuthError> {
  let body: ApiErrorBody = {}
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    // Body wasn't JSON; fall through with empty body.
  }
  return new AuthError(
    body.code ?? 'UNKNOWN_ERROR',
    res.status,
    body.message ?? `HTTP ${res.status}`,
    body.retryAfterMinutes,
  )
}

/**
 * Authenticate against the first-party proxy `/api/auth/login`, which in
 * turn forwards to `${API_BASE_URL}/api/v1/auth/login`. Stores both
 * tokens in module-scope memory and returns the full login response so
 * the caller can read `operator_id`, `role`, and `permissions`.
 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  })

  if (!res.ok) {
    throw await parseError(res)
  }

  const body = (await res.json()) as LoginResponse
  setAccessToken(body.access_token)
  setRefreshToken(body.refresh_token)
  return body
}

/**
 * Rotate the refresh token by calling `/api/auth/refresh`. On success,
 * the new access token is stored and returned. On failure, the in-memory
 * token is cleared so the UI bounces the operator to `/login`.
 *
 * Body-based for v0.5.8; will become cookie-only in PR 8a.2 once the
 * `auth-cookies` backend slice lands.
 */
export async function refreshAccessToken(): Promise<string> {
  const currentRefresh = getRefreshToken()
  if (!currentRefresh) {
    clearAccessToken()
    throw new AuthError('NO_REFRESH_TOKEN', 0, 'No refresh token in memory')
  }

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ refresh_token: currentRefresh }),
  })

  if (!res.ok) {
    clearAccessToken()
    throw await parseError(res)
  }

  const body = (await res.json()) as RefreshResponse
  setAccessToken(body.access_token)
  setRefreshToken(body.refresh_token)
  return body.access_token
}

/**
 * Revoke the current refresh token and clear the in-memory access
 * token. Always clears locally, even if the API call fails — losing
 * the local token is the correct UX (the operator should log in again).
 */
export async function logout(): Promise<void> {
  const currentRefresh = getRefreshToken()
  try {
    if (currentRefresh) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: currentRefresh }),
      })
    }
  } catch {
    // Network failure is acceptable: local state must still be cleared.
  }
  clearAccessToken()
}
