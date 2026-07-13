import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { bearer, bootstrap, SOCIO_ID } from './ctacte-mutations.s1.test-support.ts'

describe('CTACTE mutation normalized validation', () => {
  let app: FastifyInstance
  let seedSocio: () => void

  beforeEach(async () => ({ app, seedSocio } = await bootstrap()))
  afterEach(async () => app.close())

  it.each([
    [
      'bad UUID',
      '/api/v1/socios/not-a-uuid/ctacte/movements/debit',
      { monto: 10, fecha: '2026-07-09', motivo: 'Test' },
      'valid-key',
    ],
    [
      'blank key',
      `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      { monto: 10, fecha: '2026-07-09', motivo: 'Test' },
      '   ',
    ],
    [
      '129-character key',
      `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      { monto: 10, fecha: '2026-07-09', motivo: 'Test' },
      'x'.repeat(129),
    ],
    [
      'invalid calendar date',
      `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      { monto: 10, fecha: '2026-02-30', motivo: 'Test' },
      'date-key',
    ],
    [
      'non-positive money',
      `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      { monto: 0, fecha: '2026-07-09', motivo: 'Test' },
      'money-key',
    ],
    [
      'blank trimmed motivo',
      `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      { monto: 10, fecha: '2026-07-09', motivo: '   ' },
      'trim-key',
    ],
  ])('returns 400 VALIDATION_ERROR for %s', async (_case, url, payload, key) => {
    seedSocio()
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': key },
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns 400 VALIDATION_ERROR for an inverted comprobante date range', async () => {
    seedSocio()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-31&to=2026-07-01&cuenta=PRINCIPAL`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'range-key' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})
