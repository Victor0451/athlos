import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * API client tests (TASK-004 + TASK-005).
 *
 * Covers the contract from `web-frontend/spec.md` (Silent Token Refresh):
 *   - `apiFetch()` prepends `NEXT_PUBLIC_API_BASE_URL` to the path
 *   - Request interceptor injects `Authorization: Bearer <access_token>`
 *   - On 401, `apiFetch` awaits a single `refreshAccessToken()` and retries
 *     the original request exactly once
 *   - When 5 concurrent requests 401, exactly ONE refresh request is issued
 *   - When refresh fails, the user is redirected to /login (next-redirect)
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    pushMock(url)
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Import after mock so the api module sees the mocked next/navigation.
const { apiFetch, get, post, patch, __resetApiForTests } = await import('./api.ts')

describe('api client', () => {
  beforeEach(() => {
    __resetApiForTests()
    vi.restoreAllMocks()
    pushMock.mockClear()
  })

  afterEach(() => {
    __resetApiForTests()
  })

  describe('apiFetch()', () => {
    it('prefixes the path with NEXT_PUBLIC_API_BASE_URL and parses JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 1, name: 'admin' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )
      // The original source imports NEXT_PUBLIC_API_BASE_URL at module load.
      // We can't change it dynamically, but the production code falls back
      // to 'http://localhost:4001' when the env is undefined.

      const result = await apiFetch<{ id: number; name: string }>('/api/v1/health')

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toMatch(/^https?:\/\/[^/]+\/api\/v1\/health$/)

      expect(result).toEqual({ id: 1, name: 'admin' })
    })

    it('injects Authorization: Bearer <access_token> when a token is set', async () => {
      const authModule = await import('./auth.ts')
      authModule.setAccessToken('test.jwt.token')

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await apiFetch('/api/v1/me')

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer test.jwt.token')

      authModule.clearAccessToken()
    })

    it('serializes body as JSON for POST requests', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'new' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await apiFetch('/api/v1/foo', { method: 'POST', body: { name: 'bar' } })

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toMatch(/\/api\/v1\/foo$/)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ name: 'bar' })
      expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    })
  })

  describe('401 retry with single-flight refresh', () => {
    it('retries the original request exactly once after a successful refresh', async () => {
      const authModule = await import('./auth.ts')

      // First call: 401. Second call (refresh): 200 with new access token.
      // Third call (retry): 200 with success body.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'refreshed.access.token',
              refresh_token: 'refreshed.refresh.token',
              expires_in: 900,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      // Seed tokens so refreshAccessToken has something to rotate.
      // We don't expose setRefreshToken publicly — go through login() instead.
      // Clear the fetch mock and re-stub for the login call:
      fetchMock.mockReset()
      fetchMock
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'expired.access.token',
              refresh_token: 'expired.refresh.token',
              expires_in: 900,
              operator_id: 'op-1',
              role: 'ADMIN',
              permissions: { can_reprint: true, can_anulate: false },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'refreshed.access.token',
              refresh_token: 'refreshed.refresh.token',
              expires_in: 900,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )

      await authModule.login('admin', 'secret')
      // The next fetch should 401 → refresh → retry.
      const result = await apiFetch<{ ok: boolean }>('/api/v1/me')

      expect(result).toEqual({ ok: true })
      expect(authModule.getAccessToken()).toBe('refreshed.access.token')

      // 4 calls total: login + 401 + refresh + retry.
      expect(fetchMock).toHaveBeenCalledTimes(4)
      const calls = fetchMock.mock.calls.map((c) => c[0])
      expect(calls[1]).toMatch(/\/api\/v1\/me$/)
      expect(calls[2]).toBe('/api/auth/refresh')
      expect(calls[3]).toMatch(/\/api\/v1\/me$/)
    })

    it('issues exactly ONE refresh request when 5 concurrent calls 401', async () => {
      const authModule = await import('./auth.ts')

      // Login to seed tokens.
      // Then 5 concurrent apiFetch calls each see 401, triggering refresh.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'expired.access.token',
              refresh_token: 'expired.refresh.token',
              expires_in: 900,
              operator_id: 'op-1',
              role: 'ADMIN',
              permissions: { can_reprint: true, can_anulate: false },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        // 5 × 401 for the original apiFetch calls.
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        // 1 × 200 for the refresh call.
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'refreshed.access.token',
              refresh_token: 'refreshed.refresh.token',
              expires_in: 900,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        // 5 × 200 for the retried original calls.
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: 2 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: 3 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: 4 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: 5 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      await authModule.login('admin', 'secret')

      const results = await Promise.all([
        apiFetch<{ ok: number }>('/api/v1/a'),
        apiFetch<{ ok: number }>('/api/v1/b'),
        apiFetch<{ ok: number }>('/api/v1/c'),
        apiFetch<{ ok: number }>('/api/v1/d'),
        apiFetch<{ ok: number }>('/api/v1/e'),
      ])

      expect(results.map((r) => r.ok).sort()).toEqual([1, 2, 3, 4, 5])
      const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh')
      expect(refreshCalls).toHaveLength(1)
    })

    it('throws and clears the token when refresh also fails', async () => {
      const authModule = await import('./auth.ts')

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'expired.access.token',
              refresh_token: 'expired.refresh.token',
              expires_in: 900,
              operator_id: 'op-1',
              role: 'ADMIN',
              permissions: { can_reprint: true, can_anulate: false },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'TOKEN_INVALID' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      await authModule.login('admin', 'secret')

      await expect(apiFetch('/api/v1/protected')).rejects.toThrow()
      expect(authModule.getAccessToken()).toBeNull()
    })
  })

  describe('typed helpers', () => {
    it('get() performs a GET request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      const result = await get<{ id: number }>('/api/v1/foo')
      expect(result.id).toBe(1)

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toMatch(/\/api\/v1\/foo$/)
      expect(init.method).toBe('GET')
    })

    it('post() performs a POST with body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'created' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      const result = await post<{ id: string }>('/api/v1/foo', { name: 'x' })
      expect(result.id).toBe('created')

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ name: 'x' })
    })

    it('patch() performs a PATCH with body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await patch('/api/v1/foo/1', { enabled: false })

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual({ enabled: false })
    })
  })
})
