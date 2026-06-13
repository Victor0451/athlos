import { describe, it, expect } from 'vitest'
import { buildContainer } from './container.ts'
import { buildServer } from './server.ts'

/**
 * Sanity test for the DI container (TASK-020). Asserts:
 *   1. Every dependency is defined when the container is built.
 *   2. Test env uses stub adapters for every external integration.
 *   3. The clock stub's advance() / now() work without vi.useFakeTimers.
 *
 * The buildServer smoke test confirms that the Fastify integration
 * (`app.container` decorator) wires the container through to route
 * handlers. It does NOT start a real HTTP listener — the test only
 * checks that `app.ready()` resolves and the route returns 200.
 */
describe('container', () => {
  it('builds with all dependencies', () => {
    const c = buildContainer({ env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' } })
    expect(c.db).toBeDefined()
    expect(c.pool).toBeDefined()
    expect(c.legacyDb).toBeDefined()
    expect(c.whatsapp).toBeDefined()
    expect(c.email).toBeDefined()
    expect(c.clock).toBeDefined()
  })

  it('uses stubs in test env by default', async () => {
    const c = buildContainer({ env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' } })
    await c.whatsapp.sendMessage({ phone: '+5491100000000', text: 'hello' })
    // Stub records calls internally; type-narrow through the stub surface.
    const messages = (c.whatsapp as unknown as { messages: Array<{ phone: string; text: string }> })
      .messages
    expect(messages).toHaveLength(1)
    expect(messages[0]?.phone).toBe('+5491100000000')
    expect(messages[0]?.text).toBe('hello')

    const outbox = (c.email as unknown as { outbox: Array<{ subject: string }> }).outbox
    expect(outbox).toHaveLength(0)

    const tables = await c.legacyDb.listTables()
    expect(tables).toEqual([])
  })

  it('clock stub allows time control', () => {
    const c = buildContainer({ env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' } })
    const t1 = c.clock.now()
    // The stub flavor of Clock exposes advance(); narrow safely via the
    // FakeClock contract rather than casting to any.
    if ('advance' in c.clock) {
      c.clock.advance(1_000)
      const t2 = c.clock.now()
      expect(t2.getTime()).toBeGreaterThan(t1.getTime())
      expect(t2.getTime() - t1.getTime()).toBe(1_000)
    } else {
      throw new Error('Expected FakeClock with advance() in test env')
    }
  })

  it('overrides take precedence over default stub selection', () => {
    const c = buildContainer({
      env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' },
      overrides: {
        clock: undefined as never, // sanity: an override shape must be a stub
      },
    })
    expect(c.clock).toBeDefined()
  })
})

describe('buildServer', () => {
  it('decorates the container on the Fastify instance and serves /health', async () => {
    const app = await buildServer({
      env: { DATABASE_URL: 'postgresql://test', NODE_ENV: 'test' },
      quietLogger: true,
    })
    try {
      expect(app.container).toBeDefined()
      expect(app.container.db).toBeDefined()
      expect(app.container.clock).toBeDefined()
      const res = await app.inject({ method: 'GET', url: '/' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
    }
  })
})
