'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  clearAccessToken,
  getAccessToken,
  getCurrentUser,
  login as authLogin,
  logout as authLogout,
  refreshAccessToken as authRefresh,
  type CurrentUser,
} from './auth'

/**
 * `useAuth` — React hook over the module-scope auth state in
 * `lib/auth.ts`. Exposes a rehydrated `{ user, token, isAuthenticated,
 * login, logout, refresh }` shape that React components can consume
 * directly. The hook does NOT own the source of truth — the tokens and
 * the current user are stored in `lib/auth.ts`'s module-scope
 * variables; the hook subscribes to them via a `useEffect` re-read on
 * every store tick.
 *
 * Why not just `useSyncExternalStore` directly on `auth.ts`? The auth
 * module doesn't expose a pub/sub, and we don't want to add one for a
 * single subscriber. A small local re-read on every render is plenty
 * fast for a 3–5 person console and keeps `auth.ts` dependency-free.
 *
 * Used by the AppShell, Sidebar (role gating), and Topbar (greeting +
 * logout button). PR 8a.2 ships this hook as the React-side facade.
 */

export interface UseAuthValue {
  user: CurrentUser | null
  token: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<string>
}

/**
 * Re-read the module-scope auth state. Cheap (object identity), safe
 * to call on every render.
 */
function snapshot(): { user: CurrentUser | null; token: string | null } {
  return { user: getCurrentUser(), token: getAccessToken() }
}

export function useAuth(): UseAuthValue {
  const [state, setState] = useState(snapshot)

  // Keep the hook in sync with the module-scope state. Polling the
  // snapshot on every render is fine because the React tree is small
  // and `getCurrentUser`/`getAccessToken` are O(1) reads.
  useEffect(() => {
    setState(snapshot())
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    await authLogin(username, password)
    setState(snapshot())
  }, [])

  const logout = useCallback(async () => {
    await authLogout()
    setState(snapshot())
  }, [])

  const refresh = useCallback(async () => {
    const token = await authRefresh()
    setState(snapshot())
    return token
  }, [])

  return {
    user: state.user,
    token: state.token,
    isAuthenticated: state.token !== null,
    login,
    logout,
    refresh,
  }
}

// Re-export `clearAccessToken` so the AppShell's redirect-on-no-token
// gate can clear state without reaching into `lib/auth` directly.
export { clearAccessToken }
