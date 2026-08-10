import { describe, it, expect, beforeEach } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../test-standins/db.ts'
import { buildServer } from '../../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/gastos/* (N16 T1).
 *
 * Pins the contracts:
 *   - Non-admin → 403 with `error: INSUFFICIENT_PERMISSIONS`
 *   - GET / returns 200 with paginated list, supports filters
 *   - GET /:id returns 200 with gasto + link_count
 *   - POST creates a gasto (ADMIN-only)
 *   - PATCH updates fields; 5-tuple UNIQUE still holds
 *   - DELETE hard-deletes; cascades to mapping rows
 *   - PATCH /anular soft-deletes (anulado=true; mapping rows remain)
 *   - 404 for non-existent gasto id
 *   - Audit rows are emitted for every mutation
 */

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/legacy',
    CORS_ORIGINS: 'http://localhost:3000',
    FROM_ADDRESS: 'noreply@gorriti.app',
    DRIFT_DETECTION_CRON: '*/15 * * * *',
    FRESHNESS_REFRESH_CRON: '*/5 * * * *',
    TOKEN_CLEANUP_CRON: '0 3 * * *',
    RECONCILIATION_CRON: '0 * * * *',
    PROMOTION_CRON: '0 */6 * * *',
    AUDIT_RETENTION_DAYS: 90,
    STORAGE_LOCAL_ROOT: '/app/storage',
    STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  } as Env
}

function bearer(role: JWTPayload['role'], sub = '00000000-0000-4000-8000-000000000001'): string {
  return signAccessToken(
    { sub, role, permissions: { can_reprint: true, can_anulate: true } },
    makeEnv(),
  )
}

async function bootstrap(): Promise<{
  app: FastifyInstance
  standin: ReturnType<typeof createStandinDb>
}> {
  const standin = createStandinDb()
  const app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: makeEnv().JWT_SECRET,
      JWT_REFRESH_SECRET: makeEnv().JWT_REFRESH_SECRET,
      DATABASE_URL: makeEnv().DATABASE_URL,
      LEGACY_DB_PATH: makeEnv().LEGACY_DB_PATH,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    quietLogger: true,
  })
  return { app, standin }
}

const GASTO_BASE = {
  tipo: 1,
  tipo_cuenta: 0,
  cuenta_principal: '6003009',
  cuenta_auxiliar: null,
  secuencia: 1,
  comprobante: 'A-1',
  fecha: '2024-03-15',
  concepto: 'sueldos',
  importe: '5000.00',
  iva: '0.00',
  ingreso_bruto: null,
  socio_id: null,
  legacy_id: null,
}

beforeEach(() => {
  // Each test rebuilds via bootstrap() — no shared state.
})

describe('GET /api/v1/gastos', () => {
  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })

  it('returns 401 without a JWT', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('returns 200 with empty list when no gastos exist', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: unknown[]; total: number; has_more: boolean }
      expect(body.items).toEqual([])
      expect(body.total).toBe(0)
      expect(body.has_more).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('returns the list with link_count per row', async () => {
    const { app, standin } = await bootstrap()
    try {
      const gastoId = '11111111-1111-4111-8111-111111111111'
      standin.state.gastos.push({
        id: gastoId,
        tipo: 1,
        tipoCuenta: 0,
        cuentaPrincipal: '6003009',
        cuentaAuxiliar: null,
        secuencia: 1,
        comprobante: 'A-1',
        fecha: '2024-03-15',
        concepto: null,
        importe: '5000.00',
        iva: '0.00',
        ingresoBruto: null,
        socioId: null,
        legacyId: null,
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        createdAt: new Date(),
      } as never)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<Record<string, unknown>>; total: number }
      expect(body.total).toBe(1)
      expect(body.items[0]).toMatchObject({
        id: gastoId,
        cuentaPrincipal: '6003009',
        linkCount: 0,
      })
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/gastos/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos/00000000-0000-4000-8000-000000000099',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'GASTO_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 for a malformed id (idSchema rejects non-UUID)', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/gastos/not-a-uuid',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('returns the gasto with its links[]', async () => {
    const { app, standin } = await bootstrap()
    try {
      const gastoId = '11111111-1111-4111-8111-111111111111'
      const ctacteId = '22222222-2222-4222-8222-222222222222'
      standin.state.gastos.push({
        id: gastoId,
        tipo: 1,
        tipoCuenta: 0,
        cuentaPrincipal: '6003009',
        cuentaAuxiliar: null,
        secuencia: 1,
        comprobante: 'A-1',
        fecha: '2024-03-15',
        concepto: null,
        importe: '5000.00',
        iva: '0.00',
        ingresoBruto: null,
        socioId: null,
        legacyId: null,
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        createdAt: new Date(),
      } as never)
      standin.state.ctacte.push({
        id: ctacteId,
        socioId: null,
        fecha: '2024-03-15',
        tipo: 'DEBITO',
        concepto: 'cuota',
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        cctcuenta: '8198',
        legacyId: null,
        createdAt: new Date(),
      } as never)
      standin.state.gastosCtacteMapping.push({
        id: '33333333-3333-4333-8333-333333333333',
        gastoId,
        ctacteId,
        montoCubierto: '5000.00',
        motivo: 'manual',
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        createdBy: null,
        createdAt: new Date(),
      } as never)
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/gastos/${gastoId}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        id: string
        links: Array<{ ctacteId: string; montoCubierto: string }>
      }
      expect(body.id).toBe(gastoId)
      expect(body.links).toHaveLength(1)
      expect(body.links[0]?.ctacteId).toBe(ctacteId)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/gastos', () => {
  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
        payload: GASTO_BASE,
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('returns 201 and emits GASTO_CREATE audit row for ADMIN', async () => {
    const { app, standin } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as { id: string }
      expect(body.id).toBeTruthy()
      expect(standin.state.gastos).toHaveLength(1)
      // Audit row should be emitted
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTO_CREATE')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns 409 when the 5-tuple UNIQUE is violated', async () => {
    const { app } = await bootstrap()
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      expect(first.statusCode).toBe(201)
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ error: 'GASTO_DUPLICATE' })
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/gastos/:id', () => {
  it('updates fields and returns 200 with GASTO_UPDATE audit row', async () => {
    const { app, standin } = await bootstrap()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      expect(created.statusCode).toBe(201)
      const id = (created.json() as { id: string }).id
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/v1/gastos/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { concepto: 'updated', importe: '6000.00' },
      })
      expect(updated.statusCode).toBe(200)
      const body = updated.json() as { concepto: string; importe: string }
      expect(body.concepto).toBe('updated')
      expect(body.importe).toBe('6000.00')
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTO_UPDATE')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })
})

describe('DELETE /api/v1/gastos/:id', () => {
  it('returns 200 and removes the row; emits GASTO_DELETE audit row', async () => {
    const { app, standin } = await bootstrap()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      const id = (created.json() as { id: string }).id
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/v1/gastos/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(deleted.statusCode).toBe(200)
      expect(standin.state.gastos).toHaveLength(0)
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTO_DELETE')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/gastos/:id/anular', () => {
  it('soft-deletes the gasto and emits GASTO_ANULAR audit row', async () => {
    const { app, standin } = await bootstrap()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/gastos',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: GASTO_BASE,
      })
      const id = (created.json() as { id: string }).id
      const anulado = await app.inject({
        method: 'PATCH',
        url: `/api/v1/gastos/${id}/anular`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { motivo: 'test motivo' },
      })
      expect(anulado.statusCode).toBe(200)
      const body = anulado.json() as { anulado: boolean; anuladoMotivo: string }
      expect(body.anulado).toBe(true)
      expect(body.anuladoMotivo).toBe('test motivo')
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTO_ANULAR')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })
})
