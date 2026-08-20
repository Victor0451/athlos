import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const migration = '0036_padrones_inscription_lifecycle.sql'
const drizzleDir = join(import.meta.dirname, '..', '..', 'drizzle')
const schema = `padrones_lifecycle_${randomUUID().replaceAll('-', '')}`
const quotedSchema = `"${schema}"`
const inscripciones = `${quotedSchema}.inscripciones`
const receipts = `${quotedSchema}.inscripcion_command_receipts`
let pool: Pool
let createdPublicOperators = false

function migrationSql(): string {
  return `SET search_path TO ${quotedSchema};\n${readFileSync(join(drizzleDir, migration), 'utf8')
    .replaceAll('deportes.inscripciones', inscripciones)
    .replaceAll('deportes.inscripcion_command_receipts', receipts)}`
}

async function applyMigration(): Promise<void> {
  await pool.query(migrationSql())
}

async function createInscripciones(
  rows: Array<{ estado: string; bajaMotivo?: string | null; fechaBaja?: string | null }>,
): Promise<string[]> {
  await createPublicOperators()
  await pool.query(`CREATE TABLE ${inscripciones} (
      id uuid PRIMARY KEY,
      socio_id uuid NOT NULL,
      disciplina_id uuid NOT NULL,
      ejercicio_id uuid NOT NULL,
      estado text NOT NULL DEFAULT 'activa',
      fecha_alta date NOT NULL,
      baja_motivo text,
      fecha_baja date,
      CONSTRAINT inscripciones_unique UNIQUE (socio_id, disciplina_id, ejercicio_id)
    )`)
  const ids: string[] = []
  for (const row of rows) {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO ${inscripciones}
        (id, socio_id, disciplina_id, ejercicio_id, estado, fecha_alta, baja_motivo, fecha_baja)
       VALUES ($1, $2, $3, $4, $5, DATE '2026-01-01', $6, $7)`,
      [
        id,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        row.estado,
        row.bajaMotivo ?? null,
        row.fechaBaja ?? null,
      ],
    )
    ids.push(id)
  }
  return ids
}

async function createPublicOperators(): Promise<void> {
  const relation = await pool.query<{ relation: string | null }>(
    `SELECT to_regclass('public.operators') AS relation`,
  )
  if (relation.rows[0]?.relation) return
  await pool.query(
    `CREATE TABLE public.operators (id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL, role char(1) NOT NULL)`,
  )
  createdPublicOperators = true
}

async function insertReceipt(operatorId: string, callerKey: string, inscripcionId: string) {
  return pool.query(
    `INSERT INTO ${receipts}
      (operator_id, caller_key, command, request_fingerprint, inscripcion_id)
     VALUES ($1, $2, 'baja', 'fingerprint', $3)`,
    [operatorId, callerKey, inscripcionId],
  )
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 })
  await pool.query(`CREATE SCHEMA ${quotedSchema}`)
})

afterAll(async () => {
  if (!pool) return
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
  } finally {
    await pool.end()
  }
})

afterEach(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${receipts}; DROP TABLE IF EXISTS ${inscripciones}`)
  if (createdPublicOperators) {
    await pool.query(`DROP TABLE public.operators`)
    createdPublicOperators = false
  }
})

describe('0036 padrones inscription lifecycle', () => {
  it('normalizes known statuses and backfills deterministic historical baja metadata', async () => {
    await createInscripciones([
      { estado: ' ACTIVA ' },
      { estado: 'pendiente' },
      { estado: ' BAJA ' },
    ])
    await applyMigration()

    const rows = await pool.query(
      `SELECT estado, baja_motivo, fecha_baja FROM ${inscripciones} ORDER BY estado`,
    )
    expect(rows.rows).toEqual([
      { estado: 'activa', baja_motivo: null, fecha_baja: null },
      {
        estado: 'baja',
        baja_motivo: '[historic reason unavailable]',
        fecha_baja: expect.any(Date),
      },
      { estado: 'pendiente', baja_motivo: null, fecha_baja: null },
    ])
  })

  it('aborts atomically when an unknown historical status exists', async () => {
    await createInscripciones([{ estado: ' activa ' }, { estado: 'archivada' }])

    await expect(pool.query(migrationSql())).rejects.toMatchObject({ code: 'P0001' })
    const rows = await pool.query(`SELECT estado FROM ${inscripciones} ORDER BY estado`)
    expect(rows.rows).toEqual([{ estado: ' activa ' }, { estado: 'archivada' }])
  })

  it('enforces the status vocabulary, baja metadata, and existing unique tuple', async () => {
    await createInscripciones([{ estado: 'activa' }])
    await applyMigration()
    const existing = await pool.query(
      `SELECT socio_id, disciplina_id, ejercicio_id FROM ${inscripciones} LIMIT 1`,
    )
    const [{ socio_id, disciplina_id, ejercicio_id }] = existing.rows

    await expect(
      pool.query(`UPDATE ${inscripciones} SET estado = 'archivada'`),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query(`UPDATE ${inscripciones} SET estado = 'baja'`)).rejects.toMatchObject({
      code: '23514',
    })
    await expect(
      pool.query(`UPDATE ${inscripciones}
        SET estado = 'baja', baja_motivo = '   ', fecha_baja = CURRENT_DATE`),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      pool.query(`UPDATE ${inscripciones}
        SET estado = 'baja', baja_motivo = NULL, fecha_baja = CURRENT_DATE`),
    ).rejects.toMatchObject({ code: '23514' })
    await pool.query(`UPDATE ${inscripciones}
      SET estado = 'baja', baja_motivo = 'relocation', fecha_baja = CURRENT_DATE`)
    await expect(
      pool.query(
        `INSERT INTO ${inscripciones}
        (id, socio_id, disciplina_id, ejercicio_id, estado, fecha_alta)
       VALUES ($1, $2, $3, $4, 'activa', CURRENT_DATE)`,
        [randomUUID(), socio_id, disciplina_id, ejercicio_id],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('backfills only missing historical baja metadata', async () => {
    const [reasonOnlyId = '', dateOnlyId = ''] = await createInscripciones([
      { estado: 'baja', bajaMotivo: 'legacy reason' },
      { estado: 'baja', fechaBaja: '2024-03-15' },
    ])
    await applyMigration()
    const rows = await pool.query<{ id: string; baja_motivo: string; fecha_baja: string }>(
      `SELECT id, baja_motivo, fecha_baja::text FROM ${inscripciones} WHERE id IN ($1, $2)`,
      [reasonOnlyId, dateOnlyId],
    )
    const byId = new Map(rows.rows.map((row) => [row.id, row]))
    expect(byId.get(reasonOnlyId)).toMatchObject({
      baja_motivo: 'legacy reason',
      fecha_baja: expect.any(String),
    })
    expect(byId.get(dateOnlyId)).toEqual({
      id: dateOnlyId,
      baja_motivo: '[historic reason unavailable]',
      fecha_baja: '2024-03-15',
    })
  })

  it('creates receipt metadata and keeps migration logs free of reason and caller-key values', async () => {
    await createInscripciones([{ estado: 'activa' }])
    await applyMigration()

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'inscripcion_command_receipts'
        ORDER BY column_name`,
      [schema],
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'caller_key',
        'command',
        'inscripcion_id',
        'operator_id',
        'request_fingerprint',
        'result',
        'updated_at',
      ]),
    )
    expect(migrationSql()).not.toMatch(/RAISE\s+LOG[^;]*(baja_motivo|caller_key)/i)
  })

  it('rejects receipts with unknown operator or enrollment references', async () => {
    await createInscripciones([{ estado: 'activa' }])
    await applyMigration()
    const [{ id: inscripcionId }] = (await pool.query(`SELECT id FROM ${inscripciones}`)).rows

    await expect(
      insertReceipt(randomUUID(), 'operator-missing', inscripcionId),
    ).rejects.toMatchObject({ code: '23503' })

    const operatorId = randomUUID()
    await pool.query(
      `INSERT INTO public.operators (id, username, password_hash, role) VALUES ($1, $2, 'fixture', 'O')`,
      [operatorId, `deportes-${operatorId}`],
    )
    await expect(
      insertReceipt(operatorId, 'inscripcion-missing', randomUUID()),
    ).rejects.toMatchObject({ code: '23503' })
  })
})
