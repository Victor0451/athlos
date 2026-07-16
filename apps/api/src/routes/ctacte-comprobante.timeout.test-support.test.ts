import { describe, expect, it } from 'vitest'
import {
  comprobanteRequest,
  createTimeoutTelemetryHarness,
} from './ctacte-comprobante.timeout.test-support.ts'
describe('comprobante route timeout test support', () => {
  it('builds a reusable Fastify injection request', () => {
    expect(comprobanteRequest('token', { idempotencyKey: 'retry-2' })).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'retry-2' },
    })
  })
  it('captures bounded logs and rejects metric labels deterministically', () => {
    const telemetry = createTimeoutTelemetryHarness(2)
    telemetry.logger.warn({ event: 'owner', request_id: 'r-1' })
    telemetry.logger.warn({ event: 'follower', request_id: 'r-2' })
    telemetry.counter.inc()
    expect(telemetry.logs.map((entry) => entry.event)).toEqual(['owner', 'follower'])
    expect(telemetry.counter.value()).toBe(1)
    expect(() => telemetry.counter.inc({ actor_id: 'high-cardinality' })).toThrow(/no labels/)
    expect(() => telemetry.logger.warn({ event: 'overflow' })).toThrow(/event limit/)
    telemetry.reset()
    expect([telemetry.logs.length, telemetry.counter.value()]).toEqual([0, 0])
  })
})
