import { redirect } from 'next/navigation'
import { getAccessToken, refreshAccessToken } from './auth.ts'

/**
 * Typed `fetch` wrapper for the operator console.
 *
 * Why a wrapper (not axios): keeps the bundle lean (~5kB for fetch +
 * interceptors vs ~40kB for axios) and matches the design's "native
 * `fetch` wrapper — no axios" constraint.
 *
 * Single-flight refresh: when N concurrent requests 401 (typically
 * because the access token just expired), only ONE `/api/auth/refresh`
 * request is issued. The other N `await` the same `refreshInFlight`
 * Promise. This prevents the v0.5.8 backend from invalidating the new
 * refresh token after the first rotation (it deletes the old one).
 *
 * Auth flow (per `web-frontend/spec.md` and `auth-cookies/spec.md`):
 *   - Request interceptor injects `Authorization: Bearer <access_token>`
 *   - On 401: refresh → retry once → if still 401, clear + redirect to /login
 *   - PR 8a.2 will switch `/api/auth/refresh` to cookie-only transport
 *     once the backend cookie slice lands.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Internal: track the in-flight refresh so concurrent 401s share it. */
let refreshInFlight: Promise<string> | null = null

/** Test-only escape hatch to reset the singleton between cases. */
export function __resetApiForTests(): void {
  refreshInFlight = null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  headers?: Record<string, string>
  /** Set true to skip the Authorization header (e.g., /api/auth/login). */
  skipAuth?: boolean
}

/**
 * Build the full URL for an API call. Appends `NEXT_PUBLIC_API_BASE_URL`
 * to the path and serializes the optional query object.
 */
function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const base = path.startsWith('http') ? path : `${API_BASE_URL}${path}`
  if (!query) return base
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue
    params.append(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** Issue a single fetch with auth + JSON handling. Does NOT handle 401. */
async function rawFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let body: { code?: string; message?: string } = {}
    try {
      body = (await res.json()) as { code?: string; message?: string }
    } catch {
      // body wasn't JSON; use empty
    }
    throw new ApiError(res.status, body.code ?? 'HTTP_ERROR', body.message ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Public API: typed fetch with auth + single-flight refresh on 401.
 *
 * Retries the original request EXACTLY once after a successful refresh.
 * If the retry also fails with 401, clears the in-memory token and
 * redirects to `/login?expired=1` so the operator sees "Sesión expirada".
 */
export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, query, headers = {}, skipAuth = false } = opts

  const url = buildUrl(path, query)
  const requestInit: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...headers,
    },
  }
  if (!skipAuth) {
    const token = getAccessToken()
    if (token) {
      ;(requestInit.headers as Record<string, string>)['authorization'] = `Bearer ${token}`
    }
  }
  if (body !== undefined) {
    ;(requestInit.headers as Record<string, string>)['content-type'] = 'application/json'
    requestInit.body = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await fetch(url, requestInit)
  } catch (err) {
    // Network failure: don't try to refresh.
    throw err
  }

  if (res.status !== 401) {
    return parseResponse<T>(res)
  }

  // 401 path: refresh once, retry once.
  try {
    await ensureRefresh()
  } catch {
    // Refresh failed: clear local token + bounce to /login.
    const { clearAccessToken } = await import('./auth.ts')
    clearAccessToken()
    redirect('/login?expired=1')
  }

  // Retry with the new token.
  const token = getAccessToken()
  if (token) {
    ;(requestInit.headers as Record<string, string>)['authorization'] = `Bearer ${token}`
  }
  const retryRes = await fetch(url, requestInit)
  if (retryRes.status === 401) {
    // Refresh succeeded but the API still rejects → token revoked or
    // operator disabled. Clear and bounce.
    const { clearAccessToken } = await import('./auth.ts')
    clearAccessToken()
    redirect('/login?expired=1')
  }
  return parseResponse<T>(retryRes)
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: { code?: string; message?: string } = {}
    try {
      body = (await res.json()) as { code?: string; message?: string }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body.code ?? 'HTTP_ERROR', body.message ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Single-flight refresh: N concurrent callers share one Promise. */
function ensureRefresh(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/* ── Typed convenience helpers ─────────────────────────────────── */

export function get<T>(path: string, query?: Record<string, string | number | undefined>) {
  return apiFetch<T>(path, query ? { method: 'GET', query } : { method: 'GET' })
}

export function post<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, body === undefined ? { method: 'POST' } : { method: 'POST', body })
}

export function patch<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, body === undefined ? { method: 'PATCH' } : { method: 'PATCH', body })
}

export function put<T>(path: string, body?: unknown) {
  return apiFetch<T>(path, body === undefined ? { method: 'PUT' } : { method: 'PUT', body })
}

export function del<T>(path: string) {
  return apiFetch<T>(path, { method: 'DELETE' })
}

// Re-export for callers that want to avoid reaching into `./auth.ts`.
export { getAccessToken } from './auth.ts'

// Keep `rawFetch` referenced so tree-shaking doesn't drop it — useful
// escape hatch for the rare case where a caller needs to bypass 401
// handling (e.g., the auth proxy routes themselves).
export { rawFetch }
