import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R4 corrective batch — defects #2 + #3 — REAL TRANSPORT tests.
 *
 * The companion `api.test.ts` covers the auth path / single-flight /
 * typed helpers. This sibling focuses on the envelope → ApiError
 * contract that the front-end forms rely on:
 *
 *   - Non-2xx JSON envelope `{ error, message, details }` must surface
 *     as `ApiError.code === body.error` and `ApiError.details ===
 *     body.details`. (Defect #2 — before the fix, `ApiError.code`
 *     always fell back to `'HTTP_ERROR'` because the constructor
 *     read `body.code`, which the server envelope never set.)
 *
 *   - `apiFetchBlob` after a successful 401 → refresh cycle MUST
 *     propagate a retry non-2xx (e.g. 400 cap exceeded, 409
 *     idempotency conflict) as an `ApiError` so the caller can
 *     render inline / top-level feedback. The redirect-to-/login
 *     behaviour must ONLY fire when the retry itself is 401 (real
 *     token invalidation).
 *
 * The existing mocks in `api.test.ts` use `{ code: '...' }` (the old
 * AuthError body shape) which makes them ALL PASS even though the
 * real server uses `{ error: '...' }`. This file feeds the actual
 * server envelope through the transport so a regression in the
 * envelope mapping is caught.
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

// Import after the `next/navigation` mock so api.ts sees it.
const { apiFetch, apiFetchBlob, __resetApiForTests } = await import('./api.ts')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  __resetApiForTests()
  vi.restoreAllMocks()
  pushMock.mockClear()
})

afterEach(() => {
  __resetApiForTests()
})

describe('envelope → ApiError.code mapping (defect #2)', () => {
  it('apiFetch: 400 VALIDATION_ERROR envelope sets ApiError.code and forwards details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'VALIDATION_ERROR',
            message: 'monto must be > 0',
            details: [{ field: 'monto', message: 'monto must be > 0' }],
          },
          400,
        ),
      ),
    )

    const err = await apiFetch('/api/v1/socios/x/ctacte/movements/payment', {
      method: 'POST',
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR: monto must be > 0',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
  })

  it('apiFetch: 409 CONFLICT envelope sets ApiError.code = CONFLICT (note idempotency contract)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'CONFLICT',
            message: 'Idempotency-Key already used for a different body',
          },
          409,
        ),
      ),
    )

    const err = await apiFetch('/api/v1/socios/x/ctacte/movements/x/notes', {
      method: 'POST',
    }).catch((e: unknown) => e)

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'CONFLICT',
      message: expect.stringContaining('CONFLICT') as unknown as string,
    })
    // The message must contain the `CONFLICT` substring so the
    // CtacteNoteForm CONFLICT branch (rotates the idempotency key +
    // surfaces the "retry with a fresh key" toast) activates.
    expect((err as { message: string }).message).toContain('CONFLICT')
  })

  it('apiFetchBlob: 400 with cap-exceeded details forward details verbatim to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'VALIDATION_ERROR',
            message: 'cap exceeded',
            details: { cap: 50, requested: 51 },
          },
          400,
        ),
      ),
    )

    const err = await apiFetchBlob('/api/v1/socios/x/ctacte/comprobante.pdf').catch(
      (e: unknown) => e,
    )

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { cap: 50, requested: 51 },
    })
  })

  it('apiFetch: 500 INTERNAL_ERROR envelope still maps to a code (graceful degradation)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: 'INTERNAL_ERROR', message: 'boom' }, 500)),
    )

    const err = await apiFetch('/api/v1/foo').catch((e: unknown) => e)

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'INTERNAL_ERROR',
    })
  })
})

describe('apiFetchBlob retry-after-refresh (defect #3)', () => {
  /**
   * Scenario: a comprobante request 401s; the auth layer refreshes
   * the token; the retry then returns 400 VALIDATION_ERROR
   * (cap-exceeded). The transport MUST:
   *
   *   - throw ApiError with code=VALIDATION_ERROR + details={cap,…}
   *   - NOT call clearAccessToken() (no auth failure happened)
   *   - NOT call redirect('/login?expired=1')
   *
   * The previous code wrongly funneled every `!retry.ok` through
   * the auth-failure path, silently clearing the operator's
   * session and bouncing to /login on a benign cap-exceeded.
   */
  it('throws ApiError on a 400 retry (cap exceeded) after a successful refresh — keeps the session', async () => {
    const authModule = await import('./auth.ts')
    // Seed tokens via login (so refreshAccessToken has a body to send).
    const fetchMock = vi
      .fn()
      // 1) login
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'expired.access.token',
          refresh_token: 'expired.refresh.token',
          expires_in: 900,
          operator_id: 'op-1',
          role: 'ADMIN',
          permissions: { can_reprint: true, can_anulate: false },
        }),
      )
      // login() synchronizes data-steward permissions before resolving.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      // 2) comprobante.pdf → 401 (token expired)
      .mockResolvedValueOnce(jsonResponse({ error: 'TOKEN_EXPIRED' }, 401))
      // 3) /auth/refresh → 200 (success)
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'refreshed.access.token',
          refresh_token: 'refreshed.refresh.token',
          expires_in: 900,
        }),
      )
      // refreshAccessToken() synchronizes data-steward permissions before retrying.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      // 4) comprobante.pdf → 400 (cap exceeded) — the retry
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'VALIDATION_ERROR',
            message: 'cap exceeded',
            details: { cap: 50, requested: 51 },
          },
          400,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await authModule.login('admin', 'secret')

    const err = await apiFetchBlob('/api/v1/socios/x/ctacte/comprobante.pdf').catch(
      (e: unknown) => e,
    )

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { cap: 50, requested: 51 },
    })
    // No auth failure: token survives, no redirect.
    expect(authModule.getAccessToken()).toBe('refreshed.access.token')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('throws ApiError on a 409 retry (idempotency conflict) after a successful refresh', async () => {
    const authModule = await import('./auth.ts')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'expired.access.token',
          refresh_token: 'expired.refresh.token',
          expires_in: 900,
          operator_id: 'op-1',
          role: 'ADMIN',
          permissions: { can_reprint: true, can_anulate: false },
        }),
      )
      // login() synchronizes data-steward permissions before resolving.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      .mockResolvedValueOnce(jsonResponse({ error: 'TOKEN_EXPIRED' }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'refreshed.access.token',
          refresh_token: 'refreshed.refresh.token',
          expires_in: 900,
        }),
      )
      // refreshAccessToken() synchronizes data-steward permissions before retrying.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'CONFLICT',
            message: 'Idempotency-Key already used',
          },
          409,
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await authModule.login('admin', 'secret')
    const err = await apiFetchBlob('/api/v1/socios/x/ctacte/comprobante.pdf').catch(
      (e: unknown) => e,
    )

    expect(err).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'CONFLICT',
    })
    expect(authModule.getAccessToken()).toBe('refreshed.access.token')
    expect(pushMock).not.toHaveBeenCalled()
  })

  /**
   * Sanity: when the retry itself is 401 (i.e. the refresh
   * succeeded but the new token is still rejected by the API —
   * the operator was disabled or the refresh token was revoked)
   * the transport MUST clear the access token and redirect to
   * /login?expired=1. This is the pre-existing behaviour the fix
   * narrows — it must not be lost.
   */
  it('still clears + redirects when the retry itself returns 401 (preserve auth-failure behaviour)', async () => {
    const authModule = await import('./auth.ts')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'expired.access.token',
          refresh_token: 'expired.refresh.token',
          expires_in: 900,
          operator_id: 'op-1',
          role: 'ADMIN',
          permissions: { can_reprint: true, can_anulate: false },
        }),
      )
      // login() synchronizes data-steward permissions before resolving.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      .mockResolvedValueOnce(jsonResponse({ error: 'TOKEN_EXPIRED' }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'refreshed.access.token',
          refresh_token: 'refreshed.refresh.token',
          expires_in: 900,
        }),
      )
      // refreshAccessToken() synchronizes data-steward permissions before retrying.
      .mockResolvedValueOnce(jsonResponse({ data_steward: false }))
      .mockResolvedValueOnce(jsonResponse({ error: 'TOKEN_INVALID' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await authModule.login('admin', 'secret')

    await expect(apiFetchBlob('/api/v1/socios/x/ctacte/comprobante.pdf')).rejects.toThrow(
      /NEXT_REDIRECT/,
    )

    expect(authModule.getAccessToken()).toBeNull()
    expect(pushMock).toHaveBeenCalledWith('/login?expired=1')
  })
})
