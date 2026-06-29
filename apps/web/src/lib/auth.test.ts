import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccessToken,
  getAccessToken,
  login,
  logout,
  refreshAccessToken,
  setAccessToken,
} from './auth.ts'

/**
 * Auth store + memory-only token state tests (TASK-002 + TASK-003).
 *
 * Covers the contract from `web-frontend/spec.md`:
 *   - access token is held in module-scope memory (never localStorage/sessionStorage)
 *   - login() POSTs `/api/auth/login` and stores the returned access token
 *   - logout() POSTs `/api/auth/logout` and clears the in-memory token
 *   - refreshAccessToken() rotates via `/api/auth/refresh` (body-based for v0.5.8)
 *   - when the refresh token is missing or rejected, refreshAccessToken() rejects
 *     and clears the in-memory token (caller will redirect to /login)
 */

describe('auth module', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearAccessToken()
  })

  afterEach(() => {
    clearAccessToken()
  })

  describe('access token state', () => {
    it('returns null when no token has been set', () => {
      expect(getAccessToken()).toBeNull()
    })

    it('returns the token after setAccessToken', () => {
      setAccessToken('abc.def.ghi')
      expect(getAccessToken()).toBe('abc.def.ghi')
    })

    it('clears the token after clearAccessToken', () => {
      setAccessToken('abc.def.ghi')
      clearAccessToken()
      expect(getAccessToken()).toBeNull()
    })

    it('never writes the token to localStorage or sessionStorage', () => {
      setAccessToken('abc.def.ghi')
      expect(localStorage.getItem('access_token')).toBeNull()
      expect(localStorage.getItem('token')).toBeNull()
      expect(sessionStorage.getItem('access_token')).toBeNull()
      expect(sessionStorage.getItem('token')).toBeNull()
      clearAccessToken()
      expect(localStorage.length).toBe(0)
      expect(sessionStorage.length).toBe(0)
    })
  })

  describe('login()', () => {
    it('POSTs to /api/auth/login with credentials and stores the access token', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'login.access.token',
            refresh_token: 'login.refresh.token',
            expires_in: 900,
            operator_id: 'op-1',
            role: 'ADMIN',
            permissions: { can_reprint: true, can_anulate: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      vi.stubGlobal('fetch', fetchMock)

      const result = await login('admin', 'secret123')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/login')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        username: 'admin',
        password: 'secret123',
      })

      expect(result.access_token).toBe('login.access.token')
      expect(result.role).toBe('ADMIN')
      expect(getAccessToken()).toBe('login.access.token')
    })

    it('throws with the API error code on 401 invalid credentials', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await expect(login('admin', 'wrong')).rejects.toThrow(/INVALID_CREDENTIALS|credentials/i)
      expect(getAccessToken()).toBeNull()
    })

    it('throws an AccountLockedError on 429 ACCOUNT_LOCKED', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'ACCOUNT_LOCKED', retryAfterMinutes: 15 }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      try {
        await login('admin', 'secret')
        expect.unreachable('expected login to throw')
      } catch (err) {
        expect((err as { code?: string }).code).toBe('ACCOUNT_LOCKED')
      }
      expect(getAccessToken()).toBeNull()
    })
  })

  describe('refreshAccessToken()', () => {
    it('POSTs /api/auth/refresh with the stored refresh token and updates the access token', async () => {
      // Seed: previous login stored both tokens.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'first.access.token',
              refresh_token: 'first.refresh.token',
              expires_in: 900,
              operator_id: 'op-1',
              role: 'ADMIN',
              permissions: { can_reprint: true, can_anulate: false },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'second.access.token',
              refresh_token: 'second.refresh.token',
              expires_in: 900,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      vi.stubGlobal('fetch', fetchMock)

      await login('admin', 'secret')
      const refreshed = await refreshAccessToken()

      expect(refreshed).toBe('second.access.token')
      expect(getAccessToken()).toBe('second.access.token')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const refreshCall = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(refreshCall[0]).toBe('/api/auth/refresh')
      expect(JSON.parse(refreshCall[1].body as string)).toEqual({
        refresh_token: 'first.refresh.token',
      })
    })

    it('clears the access token and rejects when the API returns 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      )

      await expect(refreshAccessToken()).rejects.toThrow()
      expect(getAccessToken()).toBeNull()
    })

    it('rejects when there is no refresh token in memory', async () => {
      await expect(refreshAccessToken()).rejects.toThrow(/no refresh token/i)
    })
  })

  describe('logout()', () => {
    it('POSTs /api/auth/logout, clears the access token, and resolves', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'login.access.token',
              refresh_token: 'login.refresh.token',
              expires_in: 900,
              operator_id: 'op-1',
              role: 'ADMIN',
              permissions: { can_reprint: true, can_anulate: false },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'Logged out' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      await login('admin', 'secret')
      expect(getAccessToken()).toBe('login.access.token')

      await logout()

      const logoutCall = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(logoutCall[0]).toBe('/api/auth/logout')
      expect(logoutCall[1].method).toBe('POST')
      expect(getAccessToken()).toBeNull()
    })

    it('clears the access token locally even when the API call throws', async () => {
      setAccessToken('stale.token')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')))

      await logout()
      expect(getAccessToken()).toBeNull()
    })
  })
})
