import Fastify, { type FastifyInstance } from 'fastify'
import { authPlugin, signAccessToken } from '@athlos/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'
import { accountChartRoutes } from './account-chart.ts'

const apps: FastifyInstance[] = []
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA') => ({
  authorization: `Bearer ${signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: false, can_anulate: false },
    },
    mockEnv() as never,
  )}`,
})

async function app(list = vi.fn()) {
  const env = mockEnv()
  const fastify = Fastify({ logger: false })
  fastify.decorate('container', { db: {}, env } as AppContainer)
  await fastify.register(errorHandler)
  await fastify.register(authPlugin(() => env as never))
  await fastify.register(accountChartRoutes, { list })
  apps.push(fastify)
  return { fastify, list }
}

afterEach(async () => Promise.all(apps.splice(0).map((fastify) => fastify.close())))

describe('GET /api/v1/account-chart', () => {
  it('requires an authorized finance or Caja role and returns hierarchy-safe DTOs', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        code: '1.1.3.02',
        name: 'Valores a Depositar',
        parent: { code: '1.1.3', name: 'Créditos por Ventas' },
        root: { code: '1', name: 'Activo' },
        path: [
          { code: '1', name: 'Activo' },
          { code: '1.1', name: 'Activo Corriente' },
          { code: '1.1.3', name: 'Créditos por Ventas' },
          { code: '1.1.3.02', name: 'Valores a Depositar' },
        ],
        active: true,
        imputable: true,
      },
    ])
    const { fastify } = await app(list)

    expect((await fastify.inject({ method: 'GET', url: '/api/v1/account-chart' })).statusCode).toBe(
      401,
    )
    expect(
      (
        await fastify.inject({
          method: 'GET',
          url: '/api/v1/account-chart',
          headers: auth('CONSULTA'),
        })
      ).statusCode,
    ).toBe(403)
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/account-chart?code=1.1.3.02&active=true',
      headers: auth('OPERADOR'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      items: [
        {
          code: '1.1.3.02',
          name: 'Valores a Depositar',
          parent: { code: '1.1.3', name: 'Créditos por Ventas' },
          root: { code: '1', name: 'Activo' },
          path: [
            { code: '1', name: 'Activo' },
            { code: '1.1', name: 'Activo Corriente' },
            { code: '1.1.3', name: 'Créditos por Ventas' },
            { code: '1.1.3.02', name: 'Valores a Depositar' },
          ],
          active: true,
          imputable: true,
          eligible: true,
        },
      ],
    })
    expect(list).toHaveBeenCalledWith(expect.anything(), { code: '1.1.3.02', active: true })
  })

  it('rejects unknown, oversized, and non-boolean filters before reading the catalog', async () => {
    const { fastify, list } = await app()

    for (const url of [
      '/api/v1/account-chart?active=yes',
      '/api/v1/account-chart?unexpected=1',
      `/api/v1/account-chart?name=${'x'.repeat(101)}`,
    ]) {
      const response = await fastify.inject({ method: 'GET', url, headers: auth('ADMIN') })
      expect(response.statusCode).toBe(400)
    }
    expect(list).not.toHaveBeenCalled()
  })
})
