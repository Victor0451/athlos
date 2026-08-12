import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { authPlugin, signAccessToken, type JWTPayload } from '@athlos/auth'
import { clubStatusRoutes } from './club-status.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

const token = (role: JWTPayload['role']) =>
  signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: false, can_anulate: false },
    },
    mockEnv() as never,
  )
async function app() {
  const server = Fastify()
  server.decorate('container', {
    env: mockEnv(),
    clock: { now: () => new Date('2026-03-10T15:00:00Z') },
    freshnessService: { getFreshness: async () => [], refreshAll: async () => [] },
    db: { execute: async () => ({ rows: [{ value: '0.00' }] }) },
  } as never)
  authPlugin(mockEnv)(server, {}, () => {})
  await server.register(clubStatusRoutes)
  return server
}

describe('GET /api/v1/club-status', () => {
  it('requires auth and accepts exactly the documented periods', async () => {
    const server = await app()
    try {
      expect((await server.inject({ method: 'GET', url: '/api/v1/club-status' })).statusCode).toBe(
        401,
      )
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/v1/club-status',
            headers: { authorization: `Bearer ${token('CONSULTA')}` },
          })
        ).json(),
      ).toMatchObject({ period: 'current-month' })
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/v1/club-status?period=last-60-days',
            headers: { authorization: `Bearer ${token('CONSULTA')}` },
          })
        ).statusCode,
      ).toBe(200)
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/v1/club-status?period=last-90-days',
            headers: { authorization: `Bearer ${token('CONSULTA')}` },
          })
        ).statusCode,
      ).toBe(200)
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/v1/club-status?period=year',
            headers: { authorization: `Bearer ${token('CONSULTA')}` },
          })
        ).statusCode,
      ).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('omits finance for OPERADOR and CONSULTA even if role=ADMIN is supplied', async () => {
    const server = await app()
    try {
      for (const role of ['OPERADOR', 'CONSULTA'] as const) {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/club-status?role=ADMIN',
          headers: { authorization: `Bearer ${token(role)}` },
        })
        expect(response.statusCode).toBe(200)
        expect(response.json()).not.toHaveProperty('finance')
        expect(response.body).not.toMatch(/scheduler|readiness|evidence|steward/)
      }
    } finally {
      await server.close()
    }
  })
})
