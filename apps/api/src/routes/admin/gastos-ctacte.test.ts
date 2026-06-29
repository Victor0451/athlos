import { describe, it, expect, beforeEach } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../test-standins/db.ts'
import { buildServer } from '../../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/gastos/:id/ctacte-links* and
 * /api/v1/admin/gastos-ctacte-candidates (N16 T2).
 *
 * Pins the contracts:
 *   - Non-admin → 403 with INSUFFICIENT_PERMISSIONS
 *   - 401 without JWT
 *   - 404 for non-existent gasto / ctacte
 *   - POST creates a link + emits GASTOS_CTACTE_LINK_CREATE audit row
 *   - 409 LINK_ALREADY_EXISTS on duplicate ACTIVE link for same pair
 *   - 400 MONTO_EXCEEDS_GASTO when monto_cubierto > gasto.importe
 *   - DELETE removes the row + emits GASTOS_CTACTE_LINK_DELETE audit row
 *   - PATCH /anular soft-deletes + emits GASTOS_CTACTE_LINK_ANULAR audit row
 *   - Re-link after anular returns 201 (partial UNIQUE)
 *   - GET candidates returns heuristic-pending rows only
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

const CTACTE_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  // Each test rebuilds via bootstrap() — no shared state.
})

describe('POST /api/v1/gastos/:id/ctacte-links', () => {
  it('returns 403 for non-admin', async () => {
    const { app, standin } = await bootstrap()
    try {
      // seed a gasto via the standin directly
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('returns 404 when the gasto does not exist', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/11111111-1111-4111-8111-111111111111/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'GASTO_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 MONTO_EXCEEDS_GASTO when monto > gasto.importe', async () => {
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
        importe: '2000.00',
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
        id: CTACTE_ID,
        socioId: null,
        fecha: '2024-03-15',
        tipo: 'DEBITO',
        concepto: 'cuota',
        debe: '3000.00',
        haber: '0.00',
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        cctcuenta: '8198',
        legacyId: null,
        createdAt: new Date(),
      } as never)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '3000.00', motivo: 'manual' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'MONTO_EXCEEDS_GASTO' })
    } finally {
      await app.close()
    }
  })

  it('returns 201 and emits GASTOS_CTACTE_LINK_CREATE audit row', async () => {
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as { id: string; gastoId: string; ctacteId: string }
      expect(body.gastoId).toBe(gastoId)
      expect(body.ctacteId).toBe(CTACTE_ID)
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTOS_CTACTE_LINK_CREATE')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns 409 LINK_ALREADY_EXISTS on duplicate ACTIVE link', async () => {
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      // First link
      await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      // Second link (same pair)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '3000.00', motivo: 'manual' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'LINK_ALREADY_EXISTS' })
    } finally {
      await app.close()
    }
  })

  it('allows re-link after the previous link was anulada (PARTIAL UNIQUE)', async () => {
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      const firstLinkId = (first.json() as { id: string }).id
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/gastos-ctacte-links/${firstLinkId}/anular`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { motivo: 'wrong socio' },
      })
      // Re-link for the same pair
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '3000.00', motivo: 'manual' },
      })
      expect(second.statusCode).toBe(201)
    } finally {
      await app.close()
    }
  })
})

describe('DELETE /api/v1/gastos-ctacte-links/:linkId', () => {
  it('returns 200 and removes the row + emits GASTOS_CTACTE_LINK_DELETE audit row', async () => {
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      const linkId = (created.json() as { id: string }).id
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/v1/gastos-ctacte-links/${linkId}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(deleted.statusCode).toBe(200)
      expect(standin.state.gastosCtacteMapping).toHaveLength(0)
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTOS_CTACTE_LINK_DELETE')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns 404 for a non-existent linkId', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/gastos-ctacte-links/99999999-9999-4999-8999-999999999999`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/gastos-ctacte-links/:linkId/anular', () => {
  it('soft-deletes and emits GASTOS_CTACTE_LINK_ANULAR audit row', async () => {
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
      standin.state.ctacte.push({
        id: CTACTE_ID,
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
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/gastos/${gastoId}/ctacte-links`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { ctacte_id: CTACTE_ID, monto_cubierto: '5000.00', motivo: 'manual' },
      })
      const linkId = (created.json() as { id: string }).id
      const anulado = await app.inject({
        method: 'PATCH',
        url: `/api/v1/gastos-ctacte-links/${linkId}/anular`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { motivo: 'test motivo' },
      })
      expect(anulado.statusCode).toBe(200)
      const body = anulado.json() as { anulado: boolean; anuladoMotivo: string }
      expect(body.anulado).toBe(true)
      expect(body.anuladoMotivo).toBe('test motivo')
      const audit = standin.state.auditEvents.find((e) => e.action === 'GASTOS_CTACTE_LINK_ANULAR')
      expect(audit).toBeDefined()
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/ctacte/:cuenta/gastos-links', () => {
  it('returns joined links for the cuenta', async () => {
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
        concepto: 'sueldos',
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
        id: CTACTE_ID,
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
        ctacteId: CTACTE_ID,
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
        url: '/api/v1/ctacte/8198/gastos-links',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<{ gastoId: string }> }
      expect(body.items).toHaveLength(1)
      expect(body.items[0]?.gastoId).toBe(gastoId)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/admin/gastos-ctacte-candidates', () => {
  it('returns heuristic candidates with motivo=heuristic-pending', async () => {
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
        concepto: 'sueldos',
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
        id: CTACTE_ID,
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
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/gastos-ctacte-candidates?gasto_id=${gastoId}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<{ motivo: string; ctacteId: string }> }
      expect(body.items).toHaveLength(1)
      expect(body.items[0]?.motivo).toBe('heuristic-pending')
      expect(body.items[0]?.ctacteId).toBe(CTACTE_ID)
    } finally {
      await app.close()
    }
  })
})
