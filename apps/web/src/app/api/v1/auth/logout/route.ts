/**
 * Auth logout proxy — `/api/v1/auth/logout` (PR 8b.2 follow-up, 2026-07-02).
 * See `login/route.ts` for the design notes.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001'

export async function POST(request: Request): Promise<Response> {
  const body = await request.json()
  const res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: {
      'content-type': 'application/json',
      'set-cookie': res.headers.get('set-cookie') ?? '',
    },
  })
}
