import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyCollectionsBaseline } from './collections-baseline.ts'

const { Pool } = pg
const connectionString = process.env['ATHLOS_TEST_DATABASE_URL']
const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const sparseTags = new Set(
  '0044_socios_member_evidence_resolutions,0048_socios_admin_route_relations_repair,0049_dues_pricing_obligations,0050_dues_benefit_rules,0051_dues_family_groups,0052_dues_settlements,0053_dues_agreements_community_work,0054_dues_cash_closes,0055_cash_policy_atomicity,0056_cash_recovery_policy,0057_cash_lifecycle_boundaries,0058_dues_open_agreements'.split(
    ',',
  ),
)

type Migration = { tag: string; when: number }
type Constraint = { name: string; definition: string; oid: string; validated: boolean }

if (!connectionString)
  throw new Error('ATHLOS_TEST_DATABASE_URL is required for PostgreSQL integration tests')

const pool = new Pool({ connectionString })
const migrations = (
  JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Migration[]
  }
).entries
const compatibilityIndex = migrations.findIndex(
  ({ tag }) => tag === '0059_collections_inscription_compatibility',
)

async function resetDatabase() {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS deportes CASCADE;')
  await pool.query(
    'DROP SCHEMA IF EXISTS contabilidad CASCADE; DROP SCHEMA IF EXISTS socios CASCADE;',
  )
  await pool.query(
    'DROP SCHEMA IF EXISTS tesoreria CASCADE; DROP TABLE IF EXISTS public.app_settings CASCADE;',
  )
  await pool.query(
    'DROP TABLE IF EXISTS public.audit_events CASCADE; DROP TABLE IF EXISTS public.operators CASCADE;',
  )
  await pool.query('DROP TABLE IF EXISTS public.unexpected_collections_fixture CASCADE;')
  await pool.query('DROP TYPE IF EXISTS socios.socio_estado CASCADE;')
  await pool.query(
    'CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL);',
  )
}

async function apply(entry: Migration) {
  await pool.query(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
  await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
    createHash('sha256')
      .update(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
      .digest('hex'),
    entry.when,
  ])
}

async function applyRange(from: number, to = migrations.length) {
  for (const entry of migrations.slice(from, to)) await apply(entry)
}

async function lifecycleConstraints(): Promise<Constraint[]> {
  const result = await pool.query<Constraint>(
    "SELECT conname AS name, pg_get_constraintdef(oid) AS definition, oid::text AS oid, convalidated AS validated FROM pg_constraint WHERE conrelid = 'deportes.inscripciones'::regclass AND conname IN ('inscripciones_estado_check', 'inscripciones_baja_metadata_check') ORDER BY conname",
  )
  return result.rows
}

async function makeSparsePredecessor() {
  await applyRange(0, compatibilityIndex)
  await pool.query(
    'ALTER TABLE deportes.inscripciones DROP CONSTRAINT inscripciones_estado_check, DROP CONSTRAINT inscripciones_baja_metadata_check, DROP COLUMN fecha_baja, DROP COLUMN baja_motivo, DROP COLUMN updated_at',
  )
  await pool.query('DELETE FROM drizzle.__drizzle_migrations')
  for (const entry of migrations
    .slice(0, compatibilityIndex)
    .filter(({ tag }) => sparseTags.has(tag))) {
    await pool.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [
        createHash('sha256')
          .update(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
          .digest('hex'),
        entry.when,
      ],
    )
  }
  const columns = await pool.query<{ column_name: string; is_nullable: 'YES' | 'NO' }>(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'deportes' AND table_name = 'inscripciones'",
  )
  const required = columns.rows
    .filter(
      ({ column_name: name, is_nullable }) =>
        is_nullable === 'NO' && !['id', 'estado'].includes(name),
    )
    .map(({ column_name: name }) => `ALTER COLUMN "${name}" DROP NOT NULL`)
  if (required.length > 0)
    await pool.query(`ALTER TABLE deportes.inscripciones ${required.join(', ')}`)
  await pool.query(
    "INSERT INTO deportes.inscripciones (id, estado) VALUES ('00000000-0000-0000-0000-000000000059', 'activa')",
  )
}

beforeAll(async () => {
  expect(compatibilityIndex).toBeGreaterThan(0)
})

afterAll(async () => {
  await resetDatabase()
  await pool.end()
}, 30_000)

describe.sequential('0059 collections compatibility PostgreSQL integration', () => {
  it('preserves the full predecessor lifecycle constraint definitions and OIDs through head', async () => {
    await resetDatabase()
    await applyRange(0, compatibilityIndex)
    const before = await lifecycleConstraints()

    await applyRange(compatibilityIndex)

    expect(await lifecycleConstraints()).toEqual(before)
    await expect(verifyCollectionsBaseline(connectionString)).resolves.toMatchObject({
      kind: 'compatible',
    })
  }, 30_000)

  it('migrates the exact sparse predecessor with an enrollment and preserves it through head', async () => {
    await resetDatabase()
    await makeSparsePredecessor()
    await expect(verifyCollectionsBaseline(connectionString)).resolves.toMatchObject({
      kind: 'forward',
    })

    await applyRange(compatibilityIndex)

    const enrollment = await pool.query<{
      estado: string
      fecha_baja: string | null
      baja_motivo: string | null
      updated_at: Date
    }>(
      "SELECT estado, fecha_baja, baja_motivo, updated_at FROM deportes.inscripciones WHERE id = '00000000-0000-0000-0000-000000000059'",
    )
    expect(enrollment.rows).toMatchObject([
      { estado: 'activa', fecha_baja: null, baja_motivo: null },
    ])
    expect(enrollment.rows[0]?.updated_at).toBeInstanceOf(Date)
    const constraints = await lifecycleConstraints()
    expect(constraints).toHaveLength(2)
    expect(constraints.every(({ validated }) => validated)).toBe(true)
    await expect(verifyCollectionsBaseline(connectionString)).resolves.toMatchObject({
      kind: 'compatible',
    })
  }, 30_000)

  it('fails the precheck closed when the migration ledger is absent beside an unknown object', async () => {
    await resetDatabase()
    await pool.query(
      'DROP SCHEMA drizzle CASCADE; CREATE TABLE public.unexpected_collections_fixture (id integer)',
    )

    await expect(verifyCollectionsBaseline(connectionString)).resolves.toMatchObject({
      kind: 'unsupported',
    })
  })

  it('fails closed for an unvalidated compatible-looking lifecycle constraint', async () => {
    await resetDatabase()
    await applyRange(0, compatibilityIndex)
    await pool.query(
      'ALTER TABLE deportes.inscripciones DROP CONSTRAINT inscripciones_estado_check',
    )
    await pool.query(
      "ALTER TABLE deportes.inscripciones ADD CONSTRAINT inscripciones_estado_check CHECK (estado IN ('activa', 'pendiente', 'baja')) NOT VALID",
    )

    await expect(verifyCollectionsBaseline(connectionString)).resolves.toMatchObject({
      kind: 'unsupported',
    })
    await expect(apply(migrations[compatibilityIndex]!)).rejects.toThrow(
      'collections compatibility migration requires an exact sparse or compatible inscripciones schema',
    )
  }, 30_000)
})
