import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { bearer, bootstrap, SOCIO_ID } from './ctacte-mutations.s1.test-support.ts'

describe('CTACTE mutation roles', () => {
  let app: FastifyInstance
  let seedSocio: () => void

  beforeEach(async () => ({ app, seedSocio } = await bootstrap()))
  afterEach(async () => app.close())

  it('returns 403 for CONSULTA before a debit mutation is evaluated', async () => {
    seedSocio()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer('CONSULTA')}`,
        'idempotency-key': 'consulta-debit',
      },
      payload: { monto: 10, fecha: '2026-07-09', motivo: 'Test' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
  })

  it.each(['ADMIN', 'TESORERO', 'OPERADOR'] as const)(
    'allows %s to evaluate a valid debit mutation',
    async (role) => {
      seedSocio()
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
        headers: { authorization: `Bearer ${bearer(role)}`, 'idempotency-key': `${role}-debit` },
        payload: { monto: 10, fecha: '2026-07-09', motivo: 'Test' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({ tipo: 'DEBITO', monto: 10 })
    },
  )
})
