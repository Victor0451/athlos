import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../server.ts'
import type { StubEmail } from '@athlos/integrations-email'

const validInquiry = {
  name: 'Ada Lovelace',
  organization: 'Analytical Club',
  role: 'Treasurer',
  email: 'ada@example.test',
  primaryProblem: 'Need a clearer membership workflow.',
}

const apps: Array<Awaited<ReturnType<typeof buildServer>>> = []

async function buildTestApp() {
  const app = await buildServer({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test/test',
      CORS_ORIGINS: 'https://athlos.example.test',
      IMPLEMENTATION_CONTACT_RECIPIENT: 'implementation@example.test',
    },
    quietLogger: true,
  })
  apps.push(app)
  return app
}

function inquiry(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return {
    method: 'POST' as const,
    url: '/api/v1/implementation-contact',
    payload: { ...validInquiry, ...body },
    headers: { origin: 'https://athlos.example.test', ...headers },
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('POST /api/v1/implementation-contact', () => {
  it('is POST-only and allows only the approved request shape', async () => {
    const app = await buildTestApp()

    const get = await app.inject({ method: 'GET', url: '/api/v1/implementation-contact' })
    const extra = await app.inject(inquiry({ recipient: 'attacker@example.test' }))

    expect(get.statusCode).toBe(404)
    expect(extra.statusCode).toBe(400)
    expect((app.container.email as StubEmail).outbox).toHaveLength(0)
  })

  it('rejects missing, malformed-email, newline, and over-limit fields without delivery', async () => {
    const app = await buildTestApp()

    const missing = await app.inject({ ...inquiry({ name: '' }), remoteAddress: '198.51.100.1' })
    const badEmail = await app.inject({
      ...inquiry({ email: 'not-an-email' }),
      remoteAddress: '198.51.100.2',
    })
    const newline = await app.inject({
      ...inquiry({ name: 'Ada\nLovelace' }),
      remoteAddress: '198.51.100.3',
    })
    const overLimit = await app.inject({
      ...inquiry({ message: 'x'.repeat(2001) }),
      remoteAddress: '198.51.100.4',
    })

    for (const result of [missing, badEmail, newline, overLimit]) {
      expect(result.statusCode).toBe(400)
      expect(result.json().details).toBeDefined()
    }
    expect((app.container.email as StubEmail).outbox).toHaveLength(0)
  })

  it('enforces the 8 KiB body limit before delivery', async () => {
    const app = await buildTestApp()
    const result = await app.inject(inquiry({ message: 'x'.repeat(8 * 1024) }))

    expect(result.statusCode).toBe(413)
    expect((app.container.email as StubEmail).outbox).toHaveLength(0)
  })

  it('enforces origin policy without enabling wildcard credentialed CORS', async () => {
    const app = await buildTestApp()
    const denied = await app.inject(inquiry({}, { origin: 'https://attacker.example.test' }))
    const sameOrigin = await app.inject({
      ...inquiry({}, { origin: '' }),
      headers: { 'sec-fetch-site': 'same-origin' },
    })
    const credentialed = await app.inject(inquiry({}, { cookie: 'session=not-accepted' }))

    expect(denied.statusCode).toBe(403)
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
    expect(sameOrigin.statusCode).toBe(200)
    expect(sameOrigin.headers['access-control-allow-credentials']).toBeUndefined()
    expect(credentialed.statusCode).toBe(403)
    expect((app.container.email as StubEmail).outbox).toHaveLength(1)
  })

  it('neutralizes a filled honeypot without delivery', async () => {
    const app = await buildTestApp()
    const result = await app.inject(inquiry({ website: 'https://bot.example.test' }))

    expect(result.statusCode).toBe(202)
    expect(result.json()).toEqual({ status: 'received' })
    expect((app.container.email as StubEmail).outbox).toHaveLength(0)
  })

  it('uses only the configured recipient and escapes contact content', async () => {
    const app = await buildTestApp()
    const result = await app.inject(
      inquiry({ name: '<Ada>', message: '<script>alert(1)</script>' }),
    )
    const [sent] = (app.container.email as StubEmail).outbox

    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ status: 'sent' })
    expect(sent).toMatchObject({ to: 'implementation@example.test' })
    expect(sent?.html).not.toContain('<script>')
  })

  it('throttles the fourth request from one IP with Retry-After and no delivery', async () => {
    const app = await buildTestApp()
    const results = []
    for (let attempt = 0; attempt < 4; attempt++) {
      results.push(await app.inject({ ...inquiry(), remoteAddress: '198.51.100.25' }))
    }

    expect(results.slice(0, 3).map((result) => result.statusCode)).toEqual([200, 200, 200])
    expect(results[3]?.statusCode).toBe(429)
    expect(results[3]?.headers['retry-after']).toBeDefined()
    expect((app.container.email as StubEmail).outbox).toHaveLength(3)
  })

  it('returns a generic retry response and does not log or persist contact values on SMTP failure', async () => {
    const app = await buildTestApp()
    const email = app.container.email as StubEmail
    const logError = vi.spyOn(app.log, 'error')
    email.send = async () => {
      throw new Error('SMTP password=secret contact ada@example.test')
    }

    const result = await app.inject(inquiry())

    expect(result.statusCode).toBe(503)
    expect(result.json()).toEqual({
      error: 'DELIVERY_UNAVAILABLE',
      message: 'Please try again later.',
    })
    expect(result.body).not.toContain('ada@example.test')
    expect(result.body).not.toContain('secret')
    expect(email.outbox).toHaveLength(0)
    expect(logError).not.toHaveBeenCalled()
  })
})
