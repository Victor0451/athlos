import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { bearer, bootstrap, SOCIO_ID } from './ctacte-mutations.s1.test-support.ts'

describe('CTACTE comprobante permission', () => {
  let app: FastifyInstance
  let seedSocio: () => void

  beforeEach(async () => ({ app, seedSocio } = await bootstrap()))
  afterEach(async () => app.close())

  it('returns 403 when can_reprint is false', async () => {
    seedSocio()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: {
        authorization: `Bearer ${bearer('OPERADOR', false)}`,
        'idempotency-key': 'cannot-reprint',
      },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
  })
})
