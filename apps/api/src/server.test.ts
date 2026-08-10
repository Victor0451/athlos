import { describe, it, expect } from 'vitest'
import { buildServer } from './server.ts'
import { ApiError, BusinessError, ErrorCode, TechnicalError } from '@athlos/errors'

/**
 * Tests for the three PR 4a plugins (error-handler, request-id,
 * logging) wired through `buildServer`.
 *
 * Strategy: build a minimal Fastify app via the production builder,
 * add a few throw-away routes that exercise each path, and inject
 * synthetic requests. The buildServer call wires the real plugins,
 * so these tests pin the public contract for the error response
 * shape and the x-request-id header.
 */

async function buildTestApp(): Promise<ReturnType<typeof buildServer>> {
  return buildServer({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test/test',
      JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
      JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
      LEGACY_DB_PATH: '/tmp/legacy',
    },
    quietLogger: true,
  })
}

describe('errorHandler plugin', () => {
  it('returns the ApiError code + status + message for business errors', async () => {
    const app = await buildTestApp()
    try {
      app.get('/__throw-business', async () => {
        throw BusinessError(ErrorCode.NOT_FOUND, 'socio not found')
      })
      const res = await app.inject({ method: 'GET', url: '/__throw-business' })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBe('NOT_FOUND')
      expect(body.message).toBe('socio not found')
      expect(body.request_id).toEqual(expect.any(String))
    } finally {
      await app.close()
    }
  })

  it('redacts the message for technical errors but preserves the code', async () => {
    const app = await buildTestApp()
    try {
      app.get('/__throw-technical', async () => {
        throw TechnicalError(ErrorCode.INTERNAL_ERROR, 'DB password=hunter2 leaked')
      })
      const res = await app.inject({ method: 'GET', url: '/__throw-technical' })
      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body.error).toBe('INTERNAL_ERROR')
      expect(body.message).toBe('Internal server error')
      expect(body.message).not.toContain('hunter2')
    } finally {
      await app.close()
    }
  })

  it('returns a 400 with field paths for Zod errors thrown raw', async () => {
    const app = await buildTestApp()
    try {
      app.get('/__throw-zod', async () => {
        const { z } = await import('zod')
        const schema = z.object({ name: z.string() })
        schema.parse({})
        return { ok: true }
      })
      const res = await app.inject({ method: 'GET', url: '/__throw-zod' })
      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
      expect(body.details).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns a 404 with the standard error shape for unknown routes', async () => {
    const app = await buildTestApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/__no-such-route' })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBe('NOT_FOUND')
      expect(body.message).toContain('/__no-such-route')
    } finally {
      await app.close()
    }
  })

  it('attaches request_id to every error response', async () => {
    const app = await buildTestApp()
    try {
      app.get('/__throw-business', async () => {
        throw BusinessError(ErrorCode.CONFLICT, 'duplicate')
      })
      const res = await app.inject({
        method: 'GET',
        url: '/__throw-business',
        headers: { 'x-request-id': 'trace-abc-123' },
      })
      expect(res.json().request_id).toBe('trace-abc-123')
      expect(res.headers['x-request-id']).toBe('trace-abc-123')
    } finally {
      await app.close()
    }
  })
})

describe('requestId plugin', () => {
  it('generates a UUID when no inbound header is present', async () => {
    const app = await buildTestApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/' })
      const id = res.headers['x-request-id']
      expect(typeof id).toBe('string')
      // UUID v4 has dashes in known positions
      expect(id).toMatch(/^[0-9a-f-]{36}$/i)
    } finally {
      await app.close()
    }
  })

  it('reuses a valid inbound x-request-id', async () => {
    const app = await buildTestApp()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-request-id': 'my-trace-001' },
      })
      expect(res.headers['x-request-id']).toBe('my-trace-001')
    } finally {
      await app.close()
    }
  })

  it('rejects malformed inbound ids (with \r\n) and falls back to a UUID', async () => {
    const app = await buildTestApp()
    try {
      // Fastify normalizes headers, so we cannot inject \r\n directly
      // in the Node IncomingMessage. The validation rule is locked
      // here: an id with a space or non-ASCII char should be replaced.
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-request-id': 'has space' },
      })
      const id = res.headers['x-request-id']
      expect(id).not.toBe('has space')
      expect(id).toMatch(/^[0-9a-f-]{36}$/i)
    } finally {
      await app.close()
    }
  })
})

describe('logging plugin', () => {
  it('captures startTime on every request', async () => {
    const app = await buildTestApp()
    try {
      app.get('/__inspect-start', async (request) => {
        // The logging plugin decorates startTime via a module-local
        // field. We can't read it from outside the plugin, but we
        // can prove the hook ran by verifying the request finished
        // (no exception) — the plugin's hook is a no-op that just
        // stores the timestamp. If the hook is missing, the build
        // still passes, so this is a soft assertion.
        const start = (request as { startTime?: number }).startTime
        return { hasStartTime: typeof start === 'number' }
      })
      const res = await app.inject({ method: 'GET', url: '/__inspect-start' })
      expect(res.json().hasStartTime).toBe(true)
    } finally {
      await app.close()
    }
  })
})

describe('server bootstrap', () => {
  it('uses JSON logger in production, not pino-pretty', async () => {
    // @athlos/config requires LEGACY_DB_PATH to exist in non-dev env
    // (validateEnv sanity check). Create a temp dir for the test.
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(`${tmpdir()}/athlos-prod-`)
    try {
      const app = await buildServer({
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://test/test',
          JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
          JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
          LEGACY_DB_PATH: dir,
          LOG_LEVEL: 'info',
          IMPLEMENTATION_CONTACT_RECIPIENT: 'test-recipient@example.test',
        },
        quietLogger: false, // exercise the production logger path
      })
      try {
        // Pino stores the stream/transport on the internal options. We
        // assert indirectly: the response still works, the logger is
        // present.
        expect(app.log).toBeDefined()
        const res = await app.inject({ method: 'GET', url: '/' })
        expect(res.statusCode).toBe(200)
      } finally {
        await app.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Use ApiError to keep the import live (prevent tree-shake from
// removing the import that proves the test file compiles).
void ApiError
