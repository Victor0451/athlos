'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getAccessToken } from '@/lib/auth'

/**
 * AuthProvider — thin wrapper that probes `auth.getAccessToken()` on
 * mount and exposes an internal context used by client-side route
 * guards (PR 8a.2's `useAuth()` + `protected-route.tsx`).
 *
 * The actual user / token state lives in module-scope memory inside
 * `lib/auth.ts`. PR 8a.1 only needs the provider shell so the layout
 * can wire QueryProvider + AuthProvider in one place. The richer
 * Zustand-backed `useAuth()` hook ships in PR 8a.2.
 */

interface AuthContextValue {
  hasToken: boolean
}

const AuthContext = createContext<AuthContextValue>({ hasToken: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hasToken, setHasToken] = useState<boolean>(false)

  useEffect(() => {
    setHasToken(getAccessToken() !== null)
  }, [])

  return <AuthContext.Provider value={{ hasToken }}>{children}</AuthContext.Provider>
}

/**
 * Read-only hook for child components to check whether an access token
 * is present. PR 8a.2 replaces this with a full Zustand-backed
 * `useAuth()` returning user, role, and permissions.
 */
export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext)
}
