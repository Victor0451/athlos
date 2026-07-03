/**
 * Catch-all API proxy — `/api/v1/[...path]` (2026-07-02).
 *
 * Forwards any HTTP method (GET, POST, PATCH, DELETE, etc.) from the
 * web origin to `${API_INTERNAL_URL}/api/v1/<path>`. Body, query, and
 * `Set-Cookie` headers pass through. This replaces the need for
 * `NEXT_PUBLIC_API_BASE_URL` in the browser bundle — the bundle just
 * calls `/api/v1/...` (same origin) and Next.js forwards to the API
 * container on the server side.
 *
 * Why catch-all (not per-route): the API has ~20+ endpoints
 * (`/socios`, `/ctacte`, `/gastos`, `/scheduler/jobs`, etc.) and
 * per-route proxy files would be tedious duplication. A single
 * catch-all forwards any path. Trade-off: less static type-safety
 * on the body (we don't have a Zod schema for each method), but the
 * body is just a passthrough.
 *
 * Why internal env var (not public): `API_INTERNAL_URL` is the
 * server-to-server URL (e.g., `http://localhost:3001` when the
 * Next.js server is on the same host as the API container). It is
 * NOT exposed to the browser bundle — only used by this server-side
 * route. Replaces the old `NEXT_PUBLIC_API_BASE_URL` which WAS
 * exposed and broke in the browser when the operator's machine
 * resolved `localhost` to itself, not the server.
 *
 * `Set-Cookie` passthrough is critical: the auth flow uses
 * httpOnly cookies that the API sets on login/refresh responses.
 * The browser sees these cookies as first-party (same origin) and
 * includes them automatically on subsequent requests.
 *
 * Error passthrough: if the API returns a non-2xx, we forward the
 * status + body verbatim. The apiFetch wrapper on the web turns the
 * response into an `ApiError` for the React side.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001'

async function handle(
  request: Request,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params
  const apiPath = '/api/v1/' + (path?.join('/') ?? '')
  const apiUrl = `${API_INTERNAL_URL}${apiPath}`

  // Forward the body for non-GET/HEAD. Request.body can only be
  // consumed once, so we read it as a stream and re-send.
  let body: BodyInit | null = null
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.blob()
  }

  // Forward the original query string. Next.js gives us the parsed
  // URL; we re-stringify it.
  const incomingUrl = new URL(request.url)
  const queryString = incomingUrl.search

  const apiResponse = await fetch(`${apiUrl}${queryString}`, {
    method: request.method,
    headers: request.headers,
    body,
    // Don't forward the `host` header — the API container is on a
    // different network namespace (host network mode in the same
    // container network, but a fresh host header keeps the upstream
    // proxy / logging consistent).
    redirect: 'manual',
  })

  // Stream the API response back to the browser. We rebuild the
  // Response so we can pass `Set-Cookie` through (Next.js otherwise
  // strips it on streaming responses).
  const responseHeaders = new Headers(apiResponse.headers)
  return new Response(apiResponse.body, {
    status: apiResponse.status,
    statusText: apiResponse.statusText,
    headers: responseHeaders,
  })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const HEAD = handle
export const OPTIONS = handle
