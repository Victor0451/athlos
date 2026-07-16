const SOCIO_ID = '11111111-1111-4111-8111-111111111111'

export function comprobanteRequest(
  token: string,
  options: { idempotencyKey?: string; socioId?: string } = {},
) {
  const socioId = options.socioId ?? SOCIO_ID
  return {
    method: 'GET' as const,
    url: `/api/v1/socios/${socioId}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=principal`,
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': options.idempotencyKey ?? 'timeout-retry',
    },
  }
}

export function createTimeoutTelemetryHarness(maxEvents = 8) {
  const logs: Array<Record<string, unknown>> = []
  let count = 0
  return {
    logs,
    logger: {
      warn(entry: Record<string, unknown>) {
        if (logs.length >= maxEvents) throw new Error('telemetry event limit exceeded')
        logs.push({ ...entry })
      },
    },
    counter: {
      inc(labels?: Record<string, unknown>) {
        if (labels && Object.keys(labels).length > 0)
          throw new Error('timeout counter accepts no labels')
        count++
      },
      value: () => count,
    },
    reset() {
      logs.splice(0)
      count = 0
    },
  }
}
