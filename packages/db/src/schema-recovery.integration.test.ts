import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const root = join(import.meta.dirname, '..')
const schema = `schema_recovery_${randomUUID().replaceAll('-', '')}`
const quotedSchema = `"${schema}"`
let pool: Pool

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 })
  await pool.query(`
    CREATE SCHEMA ${quotedSchema};
    CREATE TYPE ${quotedSchema}.socio_estado AS ENUM ('activo', 'baja', 'suspendido');
    CREATE TABLE ${quotedSchema}.socios (
      id uuid PRIMARY KEY,
      numero_socio text NOT NULL,
      nombre text NOT NULL,
      apellido text NOT NULL,
      dni text NOT NULL,
      fecha_alta date NOT NULL,
      estado ${quotedSchema}.socio_estado NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO ${quotedSchema}.socios
      (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'QA-001', 'Manual', 'QA',
       '99999999', DATE '2026-01-01', 'activo');
  `)
})

afterAll(async () => {
  if (!pool) return
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
  } finally {
    await pool.end()
  }
})

describe('production schema recovery SQL', () => {
  it('applies the attachment enum migration twice on PostgreSQL', async () => {
    const migration = readFileSync(join(root, 'drizzle', '0021_socio_attachments.sql'), 'utf8')
      .replaceAll('"socios"."socios"', `${quotedSchema}."__socios_table__"`)
      .replaceAll('"socios"', quotedSchema)
      .replaceAll('"__socios_table__"', '"socios"')

    await pool.query(migration)
    await pool.query(migration)

    const labels = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1 AND t.typname = 'attachment_category'
       ORDER BY e.enumsortorder`,
      [schema],
    )
    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      'dni',
      'comprobante',
      'foto',
      'contrato',
      'otro',
    ])
    await expect(
      pool.query(`SELECT count(*) FROM ${quotedSchema}.socio_attachments`),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] })
  })

  it('adds all nullable socio columns twice without changing existing rows', async () => {
    const recovery = readFileSync(
      join(root, 'recovery', '0002_socios_columns.sql'),
      'utf8',
    ).replaceAll('socios.socios', `${quotedSchema}.socios`)

    await pool.query(recovery)
    await pool.query(recovery)

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'socios'
         AND column_name = ANY($2::text[])
       ORDER BY column_name`,
      [schema, ['fecha_nacimiento', 'categoria', 'direccion', 'telefono', 'email', 'deleted_at']],
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'categoria',
      'deleted_at',
      'direccion',
      'email',
      'fecha_nacimiento',
      'telefono',
    ])
    const existing = await pool.query(
      `SELECT numero_socio, categoria, deleted_at FROM ${quotedSchema}.socios`,
    )
    expect(existing.rows).toEqual([{ numero_socio: 'QA-001', categoria: null, deleted_at: null }])
  })
})
