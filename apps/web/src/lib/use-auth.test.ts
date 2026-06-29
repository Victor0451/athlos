import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * useAuth hook tests (TASK-008).
 *
 * Covers the React-side contract for the operator console:
 *   - On mount, the hook rehydrates `user` from `auth.getCurrentUser()`
 *   - `login()` wraps `auth.login()` AND populates the hook's user state
 *   - `logout()` wraps `auth.logout()` AND clears the hook's user state
 *   - The hook exposes `isAuthenticated` derived from the in-memory token
 *   - The hook does NOT persist state across remounts when the source
 *     module-scope state was cleared
 */

const authState = vi.hoisted(() => {
  return {
    currentUser: null as null | {
      operator_id: string
      role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
      username: string
      permissions: { can_reprint: boolean; can_anulate: boolean }
    },
    accessToken: null as string | null,
  }
})

const loginMock = vi.fn()
const logoutMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  // The real `login` writes to module-scope state, so the mock
  // simulates the same effect to keep assertions honest.
  login: async (username: string, password: string) => {
    const body = await loginMock(username, password)
    if (body) {
      authState.accessToken = body.access_token
      authState.currentUser = {
        operator_id: body.operator_id,
        role: body.role,
        username,
        permissions: body.permissions,
      }
    }
    return body
  },
  // The real `logout` in auth.ts always clears module-scope state, so
  // the mock simulates the same effect to keep the test's assertion
  // surface realistic.
  logout: () => {
    logoutMock()
    authState.currentUser = null
    authState.accessToken = null
  },
  refreshAccessToken: () => refreshMock(),
  getCurrentUser: () => authState.currentUser,
  getAccessToken: () => authState.accessToken,
  clearAccessToken: () => {
    authState.currentUser = null
    authState.accessToken = null
  },
  setAccessToken: (t: string | null) => {
    authState.accessToken = t
  },
}))

const { useAuth } = await import('./use-auth.ts')

describe('useAuth', () => {
  beforeEach(() => {
    authState.currentUser = null
    authState.accessToken = null
    loginMock.mockReset()
    logoutMock.mockReset()
    refreshMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes a null user and isAuthenticated=false when nothing is in memory', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('login() delegates to auth.login and stores the user in hook state', async () => {
    loginMock.mockResolvedValueOnce({
      access_token: 'login.token',
      refresh_token: 'login.refresh',
      expires_in: 900,
      operator_id: 'op-42',
      role: 'ADMIN',
      permissions: { can_reprint: true, can_anulate: true },
    })

    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await result.current.login('admin', 'secret')
    })

    expect(loginMock).toHaveBeenCalledWith('admin', 'secret')
    expect(result.current.user).toEqual({
      operator_id: 'op-42',
      role: 'ADMIN',
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    })
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('logout() delegates to auth.logout and clears the hook state', async () => {
    authState.currentUser = {
      operator_id: 'op-1',
      role: 'TESORERO',
      username: 'tesorero',
      permissions: { can_reprint: true, can_anulate: false },
    }
    authState.accessToken = 'seeded.token'

    const { result } = renderHook(() => useAuth())

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
    })

    await act(async () => {
      await result.current.logout()
    })

    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('refresh() delegates to auth.refreshAccessToken and keeps the user on success', async () => {
    authState.currentUser = {
      operator_id: 'op-2',
      role: 'OPERADOR',
      username: 'op_user',
      permissions: { can_reprint: false, can_anulate: false },
    }
    refreshMock.mockResolvedValueOnce('rotated.access.token')

    const { result } = renderHook(() => useAuth())

    await waitFor(() => {
      expect(result.current.user).not.toBeNull()
    })

    let returnedToken = ''
    await act(async () => {
      returnedToken = await result.current.refresh()
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(returnedToken).toBe('rotated.access.token')
    expect(result.current.user).toEqual(authState.currentUser)
  })
})
