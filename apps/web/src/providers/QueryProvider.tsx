'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * TanStack Query v5 provider for the operator console.
 *
 * Cache config (per `web-frontend/spec.md` / `design.md` §6):
 *   - `staleTime: 5min` — dashboard / socios / ctacte pages don't refetch
 *     during normal navigation; 30s auto-refresh on the dashboard is
 *     driven by `useQuery({ refetchInterval: 30_000 })` per spec.
 *   - `retry: 1` — one automatic retry on network failure
 *   - `refetchOnWindowFocus: true` — surface fresh data when the operator
 *     switches back to the console after a side task
 *
 * Per PR 8a.3 the stale time / refetch tuning moves to a dedicated
 * dashboard-level config. This is the bootstrap default.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
