/**
 * Auth state for the operator console — tokens + current user profile.
 *
 * **Provisional fix (2026-07-02): localStorage persistence.**
 * Originally the tokens lived ONLY in module-scope memory per the
 * `web-frontend/spec.md` design (Trade-off: tab close = logout for
 * a 3–5 person console). That made F5 / page refresh send the
 * operator back to `/login` — a real UX bug once the auth proxy
 * (commit df0af6a) made the login flow reliable.
 *
 * The fix persists `accessToken`, `refreshToken`, and `currentUser` to
 * a single `localStorage` entry (`athlos.auth`, JSON-encoded) on every
 * set, and hydrates from it on module-load. This means F5, full reload,
 * and tab restore all keep the operator signed in. Only an explicit
 * `logout()` (or the operator clicking "Salir") clears the entry.
 *
 * **XSS risk accepted**: a successful XSS in the operator console can
 * now read the tokens until the user logs out (or the access token
 * expires in ≤15 min and the refresh-token rotation is revoked).
 * Documented as a temporary measure for the 3–5 person console
 * operator surface. The correct architectural fix is the cookie
 * slice (`auth-cookies/spec.md`) — when the backend ships httpOnly
 * cookies + `athlos_refresh` rotation, this whole module-scope +
 * localStorage layer disappears and the (authed)/layout server
 * component reads the cookie to gate requests before any client JS
 * runs.
 *
 * Migration plan when the cookie slice lands:
 *   1. Drop the `athlos.auth` localStorage write/read.
 *   2. Drop the `refreshToken` body transport in `refreshAccessToken`.
 *   3. Switch `auth.ts` to be a thin client-side `useAuth()` facade
 *      that reads `useMe()` from the layout's server-fetched context.
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

/**
 * Profile of the authenticated operator, lifted from the
 * `LoginResponse` body. Held in module-scope memory alongside the
 * tokens so that the React UI (Sidebar role gating, Topbar greeting)
 * can read role/username without a server round-trip.
 */
export interface CurrentUser {
  operator_id: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  username: string
  permissions: { can_reprint: boolean; can_anulate: boolean; data_steward: boolean }
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

// ─── localStorage persistence (provisional, 2026-07-02) ────────────
//
// On module load we hydrate the three pieces of state from a single
// `localStorage` entry. Every set mirrors the new value to disk so a
// page refresh (F5) and a tab restore both keep the operator signed in.
// The writes are best-effort: if `localStorage` is unavailable
// (private mode, quota exceeded, SSR), we silently fall back to the
// original module-scope behaviour.

const STORAGE_KEY = 'athlos.auth'

interface PersistedAuth {
  accessToken: string | null
  refreshToken: string | null
  currentUser: CurrentUser | null
}

function readStorage(): PersistedAuth {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, currentUser: null }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { accessToken: null, refreshToken: null, currentUser: null }
    const parsed = JSON.parse(raw) as Partial<PersistedAuth>
    return {
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : null,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      currentUser:
        parsed.currentUser && typeof parsed.currentUser === 'object'
          ? {
              ...(parsed.currentUser as CurrentUser),
              permissions: {
                ...(parsed.currentUser as CurrentUser).permissions,
                data_steward:
                  (parsed.currentUser as CurrentUser).permissions?.data_steward === true,
              },
            }
          : null,
    }
  } catch {
    return { accessToken: null, refreshToken: null, currentUser: null }
  }
}

function writeStorage(state: PersistedAuth): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota exceeded or storage disabled — degrade to module-scope.
  }
}

function clearStorage(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Module-scope token state, hydrated from localStorage on first import.
const _hydrated = readStorage()
let accessToken: string | null = _hydrated.accessToken
let refreshToken: string | null = _hydrated.refreshToken
let currentUser: CurrentUser | null = _hydrated.currentUser

/** Read the current access token, or `null` if not authenticated. */
export function getAccessToken(): string | null {
  return accessToken
}

/** Replace the access token (and mirror to localStorage so F5 / tab
 *  restore keep the operator signed in). Internal helper, used by
 *  `login()` and `refreshAccessToken()`. */
export function setAccessToken(token: string | null): void {
  accessToken = token
  writeStorage({ accessToken, refreshToken, currentUser })
}

/** Read the current refresh token, or `null` if not authenticated. Internal helper. */
function getRefreshToken(): string | null {
  return refreshToken
}

/** Replace the refresh token (and mirror to localStorage). */
function setRefreshToken(token: string | null): void {
  refreshToken = token
  writeStorage({ accessToken, refreshToken, currentUser })
}

/** Drop both tokens. Used by logout() and after a failed refresh. */
export function clearAccessToken(): void {
  accessToken = null
  refreshToken = null
  currentUser = null
  clearStorage()
}

/** Read the current user profile, or `null` if not authenticated. */
export function getCurrentUser(): CurrentUser | null {
  return currentUser
}

/** Replace the in-memory user profile (and mirror to localStorage). */
function setCurrentUser(user: CurrentUser | null): void {
  currentUser = user
  writeStorage({ accessToken, refreshToken, currentUser })
}

async function syncDataStewardPermission(): Promise<void> {
  if (!accessToken || !currentUser) return
  try {
    const res = await fetch('/api/v1/auth/me/permissions', {
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
    const body = (await res.json()) as { data_steward?: unknown }
    setCurrentUser({
      ...currentUser,
      permissions: {
        ...currentUser.permissions,
        data_steward: res.ok && body.data_steward === true,
      },
    })
  } catch {
    setCurrentUser({
      ...currentUser,
      permissions: { ...currentUser.permissions, data_steward: false },
    })
  }
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
 * Authenticate against the first-party proxy `/api/v1/auth/login`, which in
 * turn forwards to `${API_BASE_URL}/api/v1/auth/login`. Stores both
 * tokens in module-scope memory and returns the full login response so
 * the caller can read `operator_id`, `role`, and `permissions`.
 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch('/api/v1/auth/login', {
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
  setCurrentUser({
    operator_id: body.operator_id,
    role: body.role,
    username,
    permissions: { ...body.permissions, data_steward: false },
  })
  await syncDataStewardPermission()
  return body
}

/**
 * Rotate the refresh token by calling `/api/v1/auth/refresh`. On success,
 * the new access token is stored and returned. On failure, the in-memory
 * token is cleared so the UI bounces the operator to `/login`.
 *
 * Body-based transport until the `auth-cookies` backend slice ships
 * (see file-level TODO and `auth-cookies/spec.md`). Once the backend
 * honors the `athlos_refresh` httpOnly cookie this function will drop
 * the body and call with `credentials: 'include'` only; the
 * module-scope `refreshToken` variable disappears at that point.
 */
export async function refreshAccessToken(): Promise<string> {
  const currentRefresh = getRefreshToken()
  if (!currentRefresh) {
    clearAccessToken()
    throw new AuthError('NO_REFRESH_TOKEN', 0, 'No refresh token in memory')
  }

  const res = await fetch('/api/v1/auth/refresh', {
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
  await syncDataStewardPermission()
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
      await fetch('/api/v1/auth/logout', {
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
