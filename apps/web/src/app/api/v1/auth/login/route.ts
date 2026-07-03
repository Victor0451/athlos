/**
 * Auth login proxy — `/api/v1/auth/login` (PR 8b.2 follow-up, 2026-07-02).
 *
 * First-party Next.js route that forwards login requests to the API
 * container at `${API_INTERNAL_URL}/api/v1/auth/login`. The browser sees
 * same-origin (the web origin), so `credentials: 'include'` cookies
 * work without CORS preflight.
 *
 * The auth.ts wrapper in `lib/auth.ts` hits `/api/v1/auth/login`
 * (relative) per the original PR 8a.2 design — this route implements
 * the proxy side of that contract.
 *
 * This file (and its siblings `refresh/route.ts` + `logout/route.ts`)
 * are the missing piece that makes the auth flow work in the browser.
 * Build the web, sync `.next/` to the server, restart, and the
 * existing auth.ts calls will resolve to these routes server-side.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001'

export async function POST(request: Request): Promise<Response> {
  const body = await request.json()
  const res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: {
      'content-type': 'application/json',
      // Forward Set-Cookie headers (auth flow sets refresh cookie)
      'set-cookie': res.headers.get('set-cookie') ?? '',
    },
  })
}
