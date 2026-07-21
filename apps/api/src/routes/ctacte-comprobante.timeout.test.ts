import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  ComprobanteRenderTimeoutError,
  renderComprobante,
} from '../modules/socios/forms/ctacte-comprobante.ts'
import type * as ComprobanteModule from '../modules/socios/forms/ctacte-comprobante.ts'
import { ctacteComprobanteRenderTimeoutTotal, metricsRegistry } from '../plugins/metrics.ts'
import { bearer, bootstrap } from './ctacte-mutations.s1.test-support.ts'
import { comprobanteRequest } from './ctacte-comprobante.timeout.test-support.ts'

vi.mock('../modules/socios/forms/ctacte-comprobante.ts', async (importOriginal) => {
  const original = await importOriginal<typeof ComprobanteModule>()
  return { ...original, renderComprobante: vi.fn() }
})

const mockedRender = vi.mocked(renderComprobante)

describe('CTACTE comprobante timeout route', () => {
  let app: FastifyInstance
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    ;({ app } = await bootstrap())
    warn = vi.spyOn(app.log, 'warn')
    ctacteComprobanteRenderTimeoutTotal.reset()
  })
  afterEach(async () => app.close())

  it.each(['owner', 'follower'] as const)(
    'maps a live %s timeout to 504, one bounded log, and one zero-label increment',
    async (role) => {
      mockedRender.mockRejectedValueOnce(new ComprobanteRenderTimeoutError(role, true))
      const response = await app.inject({
        ...comprobanteRequest(bearer()),
        headers: { ...comprobanteRequest(bearer()).headers, 'x-request-id': `request-${role}` },
      })
      expect(response.statusCode).toBe(504)
      expect(response.json()).toEqual({
        error: 'RENDER_TIMEOUT',
        message: 'Comprobante rendering exceeded the 30-second deadline',
        request_id: `request-${role}`,
      })
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event:
            role === 'owner'
              ? 'ctacte_comprobante_render_failed'
              : 'ctacte_comprobante_wait_timeout',
          error_code: 'RENDER_TIMEOUT',
          request_id: `request-${role}`,
          timeout_role: role,
        }),
        expect.any(String),
      )
      expect((await ctacteComprobanteRenderTimeoutTotal.get()).values[0]?.value).toBe(1)
    },
  )

  it('does not recount or log a persisted terminal timeout and exposes no metric labels', async () => {
    mockedRender.mockRejectedValueOnce(new ComprobanteRenderTimeoutError('owner', false))
    const response = await app.inject(comprobanteRequest(bearer()))
    expect(response.statusCode).toBe(504)
    expect(warn).not.toHaveBeenCalled()
    expect((await ctacteComprobanteRenderTimeoutTotal.get()).values[0]?.value ?? 0).toBe(0)
    const exposition = await metricsRegistry.metrics()
    expect(exposition).toContain('# TYPE ctacte_comprobante_render_timeout_total counter')
    expect(exposition).not.toMatch(/ctacte_comprobante_render_timeout_total\{/)
  })

  it('rethrows unexpected failures to the global redacted 5xx handler', async () => {
    mockedRender.mockRejectedValueOnce(new Error('secret database detail'))
    const response = await app.inject(comprobanteRequest(bearer()))
    expect(response.statusCode).toBeGreaterThanOrEqual(500)
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' })
    expect(response.body).not.toContain('secret database detail')
  })
})
