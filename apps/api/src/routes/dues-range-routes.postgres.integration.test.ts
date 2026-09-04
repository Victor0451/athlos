import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { createDb } from '@athlos/db'
import { authPlugin, signAccessToken } from '@athlos/auth'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'
import { duesRoutes } from './dues.ts'

const testUrl = process.env.ATHLOS_TEST_DATABASE_URL
const migrationFiles = [
  '0049_dues_pricing_obligations.sql',
  '0050_dues_benefit_rules.sql',
  '0051_dues_family_groups.sql',
  '0052_dues_settlements.sql',
  '0065_dues_range_receipts.sql',
]
let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let app: FastifyInstance | undefined
let databaseName: string | undefined
let operatorId: string
let socioId: string

const auth = () => ({
  authorization: `Bearer ${signAccessToken(
    { sub: operatorId, role: 'ADMIN', permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )}`,
})

beforeAll(async () => {
  if (!testUrl) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  databaseName = `athlos_dues_range_routes_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(testUrl)
  adminUrl.pathname = '/postgres'
  const isolatedUrl = new URL(testUrl)
  isolatedUrl.pathname = `/${databaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`)
  db = createDb({ connectionString: isolatedUrl.toString(), poolMax: 4 })
  await db.pool.query(
    `CREATE SCHEMA socios; CREATE SCHEMA deportes; CREATE SCHEMA tesoreria; CREATE TABLE public.operators (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role char(1) NOT NULL); CREATE TABLE socios.socios (id uuid PRIMARY KEY, numero_socio text NOT NULL, nombre text NOT NULL, apellido text NOT NULL, dni text NOT NULL, fecha_alta date NOT NULL, estado text NOT NULL); CREATE TABLE deportes.disciplinas (id uuid PRIMARY KEY, codigo text UNIQUE NOT NULL, nombre text NOT NULL); CREATE TABLE deportes.ejercicios (id uuid PRIMARY KEY, anio integer NOT NULL, descripcion text NOT NULL, fecha_inicio date NOT NULL, fecha_fin date NOT NULL); CREATE TABLE deportes.inscripciones (id uuid PRIMARY KEY, socio_id uuid NOT NULL REFERENCES socios.socios, disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas, ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios, estado text NOT NULL, fecha_alta date NOT NULL, fecha_baja date); CREATE TABLE public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, old_value jsonb, new_value jsonb, source_ip text, metadata jsonb, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE tesoreria.dues_condonation_treatments (obligation_id uuid NOT NULL, amount numeric(14,2) NOT NULL)`,
  )
  for (const file of migrationFiles)
    await db.pool.query(
      await readFile(join(import.meta.dirname, '../../../../packages/db/drizzle', file), 'utf8'),
    )
  operatorId = randomUUID()
  socioId = randomUUID()
  await db.pool.query(
    `INSERT INTO public.operators VALUES ($1, 'range-route-admin', 'fixture', 'A')`,
    [operatorId],
  )
  await db.pool.query(
    `INSERT INTO socios.socios VALUES ($1, 'range-route-member', 'Route', 'Member', 'range-route-dni', DATE '2026-01-01', 'activo')`,
    [socioId],
  )
  await db.pool.query(
    `INSERT INTO tesoreria.dues_price_versions (kind, amount, currency, effective_from, effective_to, rule, created_by, authorization_evidence) VALUES ('BASE', '100.00', 'ARS', DATE '2026-01-01', DATE '2026-03-01', 'FULL_MONTH', $1, '{}')`,
    [operatorId],
  )
  const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true }
  app = Fastify({ logger: false })
  app.decorate('container', {
    db: db.db,
    env,
    clock: { now: () => new Date('2026-02-15T12:00:00Z') },
  } as AppContainer)
  await app.register(errorHandler)
  await app.register(authPlugin(() => env as never))
  await app.register(duesRoutes)
  await app.ready()
}, 60_000)

afterAll(async () => {
  await app?.close()
  await db?.pool.end()
  if (admin && databaseName) await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  await admin?.pool.end()
}, 60_000)

it('executes a reviewed range through Fastify routes and exposes replayed debt without duplication', async () => {
  const preview = await app!.inject({
    method: 'POST',
    url: '/api/v1/dues/assessments/preview',
    headers: auth(),
    payload: { socio_id: socioId, from_period: '2026-01', through_period: '2026-02' },
  })
  expect(preview.statusCode).toBe(200)
  const plan = preview.json<{
    fingerprint: string
    executable: boolean
    periods: Array<{ period: string }>
  }>()
  expect(plan).toMatchObject({
    executable: true,
    periods: [{ period: '2026-01' }, { period: '2026-02' }],
  })
  const request = {
    method: 'POST' as const,
    url: '/api/v1/dues/assessments/execute',
    headers: { ...auth(), 'idempotency-key': 'dues-range-route-replay' },
    payload: {
      socio_id: socioId,
      from_period: '2026-01',
      through_period: '2026-02',
      preview_fingerprint: plan.fingerprint,
    },
  }
  const first = await app!.inject(request)
  expect(first.statusCode).toBe(200)
  expect(first.json()).toMatchObject({
    created_obligation_ids: [expect.any(String), expect.any(String)],
    periods: ['2026-01', '2026-02'],
  })
  const debt = await app!.inject({
    method: 'GET',
    url: `/api/v1/dues/debt/${socioId}`,
    headers: auth(),
  })
  expect(debt.statusCode).toBe(200)
  expect(debt.json()).toMatchObject({
    status: 'ready',
    socio_id: socioId,
    total_debt_cents: 20_000,
    obligations: [
      expect.objectContaining({ period_start: '2026-01-01', outstanding_cents: 10_000 }),
      expect.objectContaining({ period_start: '2026-02-01', outstanding_cents: 10_000 }),
    ],
  })
  const replay = await app!.inject(request)
  expect(replay.statusCode).toBe(200)
  expect(replay.json()).toEqual(first.json())
  expect(
    (
      await db.pool.query(
        `SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1`,
        [socioId],
      )
    ).rows[0]?.count,
  ).toBe(2)
})
