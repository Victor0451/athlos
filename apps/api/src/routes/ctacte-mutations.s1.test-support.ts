import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import type { Db } from '@athlos/db'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import { createStandinDb } from '../test-standins/db.ts'

export const SOCIO_ID = '11111111-1111-4111-8111-111111111111'

function env(): Env {
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
    TOKEN_CLEANUP_CRON: '0 3 * * * *',
    RECONCILIATION_CRON: '0 * * * *',
    PROMOTION_CRON: '0 */6 * * * *',
    AUDIT_RETENTION_DAYS: 90,
  } as Env
}

export function bearer(role: JWTPayload['role'] = 'OPERADOR', canReprint = true): string {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: canReprint, can_anulate: true },
    },
    env(),
  )
}

export async function bootstrap(): Promise<{ app: FastifyInstance; seedSocio: () => void }> {
  const standin = createStandinDb()
  const pdfGenerator: PdfGenerator = {
    init: async () => undefined,
    generate: async () => Buffer.from('%PDF-1.7 stub\n%%EOF\n'),
    close: async () => undefined,
  }
  const app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: env().JWT_SECRET,
      JWT_REFRESH_SECRET: env().JWT_REFRESH_SECRET,
      DATABASE_URL: env().DATABASE_URL,
      LEGACY_DB_PATH: env().LEGACY_DB_PATH,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    pdfGenerator,
    quietLogger: true,
  })
  return {
    app,
    seedSocio: () =>
      standin.state.socios.push({
        id: SOCIO_ID,
        numeroSocio: '12345',
        nombre: 'Juan',
        apellido: 'Pérez',
        dni: '28765432',
        fechaAlta: '2024-01-01',
        estado: 'activo',
        categoria: null,
        direccion: 'Av. Siempre Viva 742',
        telefono: '3885123456',
        email: 'juan@test.com',
        fechaNacimiento: '1990-05-15',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as never),
  }
}
