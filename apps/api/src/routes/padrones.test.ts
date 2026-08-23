import { describe, it, expect } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/padrones.
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

function bearer(role: JWTPayload['role']): string {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: true, can_anulate: true },
    },
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

async function seed(standin: ReturnType<typeof createStandinDb>) {
  standin.state.disciplinas.push({
    id: 'd-futbol',
    codigo: 'FUTBOL',
    nombre: 'Fútbol',
    createdAt: new Date(),
  } as never)
  standin.state.disciplinas.push({
    id: 'd-hockey',
    codigo: 'HOCKEY',
    nombre: 'Hockey',
    createdAt: new Date(),
  } as never)
  standin.state.ejercicios.push({
    id: 'e-2024',
    anio: 2024,
    descripcion: 'Ejercicio 2024',
    fechaInicio: '2024-01-01',
    fechaFin: '2024-12-31',
    createdAt: new Date(),
  } as never)
  standin.state.socios.push({
    id: 's-1',
    numeroSocio: '0001',
    nombre: 'Juan',
    apellido: 'García',
    dni: '11111111',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: null,
    telefono: null,
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
  standin.state.socios.push({
    id: 's-2',
    numeroSocio: '0002',
    nombre: 'María',
    apellido: 'Pérez',
    dni: '22222222',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: null,
    telefono: null,
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
  standin.state.inscripciones.push({
    id: 'i-1',
    socioId: 's-1',
    disciplinaId: 'd-futbol',
    ejercicioId: 'e-2024',
    estado: 'activa',
    fechaAlta: '2024-03-01',
    createdAt: new Date(),
  } as never)
  standin.state.inscripciones.push({
    id: 'i-2',
    socioId: 's-2',
    disciplinaId: 'd-hockey',
    ejercicioId: 'e-2024',
    estado: 'activa',
    fechaAlta: '2024-03-01',
    createdAt: new Date(),
  } as never)
}

describe('GET /api/v1/padrones', () => {
  it('returns the current discipline catalog from the padrones source', async () => {
    const { app, standin } = await bootstrap()
    try {
      await seed(standin)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/padrones/disciplinas',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        items: [
          { id: 'd-futbol', codigo: 'FUTBOL', nombre: 'Fútbol' },
          { id: 'd-hockey', codigo: 'HOCKEY', nombre: 'Hockey' },
        ],
      })
    } finally {
      await app.close()
    }
  })

  it('returns only the matching disciplina + ejercicio', async () => {
    const { app, standin } = await bootstrap()
    try {
      await seed(standin)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/padrones?disciplina=FUTBOL&ejercicio=2024',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        disciplina: string
        ejercicio: number
        items: Array<{ socioId: string; disciplinaCodigo: string }>
        total: number
      }
      expect(body.disciplina).toBe('FUTBOL')
      expect(body.ejercicio).toBe(2024)
      expect(body.items).toHaveLength(1)
      expect(body.items[0]?.socioId).toBe('s-1')
    } finally {
      await app.close()
    }
  })

  it('returns 400 when disciplina is missing', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/padrones?ejercicio=2024',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('returns 400 when ejercicio is missing', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/padrones?disciplina=FUTBOL',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('returns 401 without an Authorization header', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/padrones?disciplina=FUTBOL&ejercicio=2024',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})
