import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Client wrapper tests for the socio-forms URL helper (PR 8d.2,
 * task B.1).
 *
 * The wrapper is a pure URL composer — no fetch, no body — that
 * prefixes `NEXT_PUBLIC_API_BASE_URL` to the form path. The tests
 * stub the env var via `vi.stubEnv` (vitest's recommended helper)
 * so they don't depend on `.env.local` or `.env.production`.
 *
 * URL shape (locked by design §10 + orchestrator prompt):
 *   `${NEXT_PUBLIC_API_BASE_URL}/api/v1/socios/${socioId}/forms/${formId}.pdf`
 *
 * Edge cases pinned by the test:
 *   - The base URL may end with a trailing slash → the wrapper must
 *     avoid the `//api/v1` double-slash bug.
 *   - The base URL may be empty (local dev / test envs without
 *     `NEXT_PUBLIC_API_BASE_URL` set) → the wrapper must produce a
 *     path-only URL (avoids `undefined` in the string).
 *   - The socioId is interpolated verbatim (UUIDs / passes are the
 *     only callers in v1).
 */

describe('getFormUrl', () => {
  const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  const FORM_ID = 'solicitud-inscripcion' as const

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3000')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the PDF URL with the configured API base', async () => {
    const { getFormUrl } = await import('./forms')
    expect(getFormUrl(SOCIO_ID, FORM_ID)).toBe(
      `http://localhost:3000/api/v1/socios/${SOCIO_ID}/forms/${FORM_ID}.pdf`,
    )
  })

  it('trims a trailing slash on NEXT_PUBLIC_API_BASE_URL to avoid double-slash', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3000/')
    const { getFormUrl } = await import('./forms')
    expect(getFormUrl(SOCIO_ID, FORM_ID)).toBe(
      `http://localhost:3000/api/v1/socios/${SOCIO_ID}/forms/${FORM_ID}.pdf`,
    )
  })

  it('produces a path-only URL when NEXT_PUBLIC_API_BASE_URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '')
    const { getFormUrl } = await import('./forms')
    expect(getFormUrl(SOCIO_ID, FORM_ID)).toBe(`/api/v1/socios/${SOCIO_ID}/forms/${FORM_ID}.pdf`)
  })

  it('interpolates the socioId verbatim into the path', async () => {
    const { getFormUrl } = await import('./forms')
    const id = 'Z9X8Y7'
    expect(getFormUrl(id, FORM_ID)).toBe(
      `http://localhost:3000/api/v1/socios/${id}/forms/${FORM_ID}.pdf`,
    )
  })
})
