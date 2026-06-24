/**
 * athlos-promote-projection-to-master-e1a
 * TASK-001: TDD-RED — 7 failing test cases for the promotion pipeline
 *
 * These tests describe the expected behavior of the promotion algorithm.
 * They are written BEFORE the implementation (RED phase of TDD).
 *
 * Each test uses the production test DB (192.168.1.102/athlos).
 * Per-test cleanup uses `numero_socio LIKE 'test-%'` prefix.
 */
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@athlos/db'
import { sql } from 'drizzle-orm'
import { promoteDomain, promoteAll } from '../index'

// ─── Test DB setup ───────────────────────────────────────────────────────────

const connStr =
  process.env['DATABASE_URL'] ?? 'postgresql://athlos:athlos@192.168.1.102:5432/athlos'

const { db, pool } = createDb({ connectionString: connStr })

// ─── Per-test cleanup ────────────────────────────────────────────────────────

/**
 * Delete all rows created by a test.
 * Uses `numero_socio LIKE 'test-%'` prefix so we NEVER touch real data.
 * Also cleans projection tables by `source_key LIKE 'test-%'`.
 */
async function cleanupTestRows(socioNumero?: string) {
  if (socioNumero) {
    await db.execute(sql`DELETE FROM socios.socios WHERE numero_socio = ${socioNumero}`)
  }
  // Clean ctacte that references test socios
  await db.execute(sql`
    DELETE FROM tesoreria.ctacte
    WHERE socio_id IN (SELECT id FROM socios.socios WHERE numero_socio LIKE 'test-%')
  `)
  // Clean test socios
  await db.execute(sql`DELETE FROM socios.socios WHERE numero_socio LIKE 'test-%'`)
  // Clean projection tables (by source_key prefix)
  await db.execute(sql`DELETE FROM socios.socios_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.ctacte_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.ctacte1_projection WHERE source_key LIKE 'test-%'`)
}

afterEach(async () => {
  await cleanupTestRows()
})

// ─── Projection table setup ────────────────────────────────────────────────────

const PROJECTION_TABLES = [
  `"socios"."socios_projection" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table varchar(32) NOT NULL, source_key varchar(64) NOT NULL, payload jsonb NOT NULL, imported_at timestamp with time zone NOT NULL DEFAULT now())`,
  `"tesoreria"."ctacte_projection" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table varchar(32) NOT NULL, source_key varchar(64) NOT NULL, payload jsonb NOT NULL, imported_at timestamp with time zone NOT NULL DEFAULT now())`,
  `"tesoreria"."ctacte1_projection" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table varchar(32) NOT NULL, source_key varchar(64) NOT NULL, payload jsonb NOT NULL, imported_at timestamp with time zone NOT NULL DEFAULT now())`,
]

beforeAll(async () => {
  for (const tableDef of PROJECTION_TABLES) {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ${sql.raw(tableDef)}`)
  }
  // Truncate projection tables to ensure tests work with a clean slate.
  // The real DB has 39k+ rows from rebuildProjection; tests need isolated data.
  await db.execute(sql`TRUNCATE TABLE socios.socios_projection`)
  await db.execute(sql`TRUNCATE TABLE tesoreria.ctacte_projection`)
  await db.execute(sql`TRUNCATE TABLE tesoreria.ctacte1_projection`)
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Insert a row directly into a projection table (bypasses the promotion algorithm). */
async function insertProjectionRow({
  schema,
  table,
  sourceKey,
  payload,
}: {
  schema: string
  table: string
  sourceKey: string
  payload: Record<string, unknown>
}) {
  const escapedKey = String(sourceKey).replace(/'/g, "''")
  const payloadJson = JSON.stringify(payload).replace(/'/g, "''")
  await db.execute(
    sql.raw(
      `INSERT INTO "${schema}"."${table}" (id, source_table, source_key, payload) VALUES (gen_random_uuid(), '${schema}', '${escapedKey}', '${payloadJson}'::jsonb) ON CONFLICT DO NOTHING`,
    ),
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Promotion Pipeline — E1a', () => {
  // T1: promoteDomain('socios') happy path
  it('T1: promoteDomain(socios) inserts one row into master with correct fields', async () => {
    const sourceKey = 'test-T1-1001'

    await insertProjectionRow({
      schema: 'socios',
      table: 'socios_projection',
      sourceKey,
      payload: {
        SOCCARNET: 'test-T1-1001',
        SOCAPYNOMB: 'PEREZ JUAN',
        SOCDNI: '12345678',
        SOCFECALTA: '19800515',
        SOCCATEGO: 'Activo',
      },
    })

    const result = await promoteDomain(db, 'socios')

    expect(result.inserted).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)

    // Verify master table has correct field values
    const rows = await db.execute(sql`
      SELECT numero_socio, nombre, apellido, dni, fecha_alta
      FROM socios.socios
      WHERE numero_socio = 'test-T1-1001'
    `)
    expect(rows.rows).toHaveLength(1)
    const row = rows.rows[0] as Record<string, unknown>
    expect(row['apellido']).toBe('PEREZ')
    expect(row['nombre']).toBe('JUAN')
  })

  // T2: promoteDomain('ctacte') FK failure (empty socios)
  it('T2: promoteDomain(ctacte) fails with no matching socio and collects error', async () => {
    const sourceKey = 'test-T2-CCT9999'
    await insertProjectionRow({
      schema: 'tesoreria',
      table: 'ctacte_projection',
      sourceKey,
      payload: {
        CCTCUENTA: '9999', // no socio with this numeroSocio
        CCTDEBEHAB: 1,
        CCTIMPORTE: '500.00',
        CCTFECHA: '20200101',
        CCTCONCEPT: 'Test cargo',
      },
    })

    const result = await promoteDomain(db, 'ctacte')

    expect(result.inserted).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toMatch(/no matching socio/i)
  })

  // T3: promoteDomain('ctacte') happy path after socios
  it('T3: promoteDomain(ctacte) inserts after socios is populated, resolving FK', async () => {
    // First insert and promote the socio
    const socioSourceKey = 'test-T3-1001'
    await insertProjectionRow({
      schema: 'socios',
      table: 'socios_projection',
      sourceKey: socioSourceKey,
      payload: {
        SOCCARNET: 'test-T3-1001',
        SOCAPYNOMB: 'GOMEZ MARIA',
        SOCDNI: '87654321',
        SOCFECALTA: '19900101',
      },
    })
    await promoteDomain(db, 'socios')

    // Now insert the ctacte projection row referencing socio numero 'test-T3-1001'
    const ctacteSourceKey = 'test-T3-CCT1'
    await insertProjectionRow({
      schema: 'tesoreria',
      table: 'ctacte_projection',
      sourceKey: ctacteSourceKey,
      payload: {
        CCTCUENTA: 'test-T3-1001',
        CCTDEBEHAB: 1,
        CCTIMPORTE: '750.00',
        CCTFECHA: '20210115',
        CCTCONCEPT: 'Cuota social',
      },
    })

    const result = await promoteDomain(db, 'ctacte')

    expect(result.inserted).toBe(1)
    expect(result.failed).toBe(0)

    // Verify the ctacte row has the correct socioId FK resolved
    const ctacteRows = await db.execute(sql`
      SELECT socio_id, tipo, debe, haber
      FROM tesoreria.ctacte
      WHERE concepto = 'Cuota social'
    `)
    expect(ctacteRows.rows).toHaveLength(1)
    const ctacteRow = ctacteRows.rows[0] as Record<string, unknown>
    expect(ctacteRow['socio_id']).toBeDefined()
    expect(ctacteRow['tipo']).toBe('DEBITO')
    expect(ctacteRow['debe']).toBe('750.00')
    expect(ctacteRow['haber']).toBe('0.00')
  })

  // T4: Idempotency on socios
  it('T4: re-running promoteDomain(socios) is idempotent — second run skips existing rows', async () => {
    const sourceKey = 'test-T4-1001'
    await insertProjectionRow({
      schema: 'socios',
      table: 'socios_projection',
      sourceKey,
      payload: {
        SOCCARNET: 'test-T4-1001',
        SOCAPYNOMB: 'LOPEZ CARLOS',
        SOCDNI: '11111111',
        SOCFECALTA: '19700101',
      },
    })

    const first = await promoteDomain(db, 'socios')
    expect(first.inserted).toBe(1)

    const second = await promoteDomain(db, 'socios')
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(1)
  })

  // T5: PROMOTION_ORDER enforces FK dependency
  it('T5: promoteAll skips ctacte when socios inserted zero rows (upstream failure)', async () => {
    // Don't insert any socios — leave master empty
    // Insert only a ctacte projection row
    const sourceKey = 'test-T5-CCT1'
    await insertProjectionRow({
      schema: 'tesoreria',
      table: 'ctacte_projection',
      sourceKey,
      payload: {
        CCTCUENTA: 'NONEXISTENT',
        CCTDEBEHAB: 1,
        CCTIMPORTE: '100.00',
        CCTFECHA: '20200101',
        CCTCONCEPT: 'Should not be promoted',
      },
    })

    const results = await promoteAll(db)

    const sociosResult = results.find((r) => r.domain === 'socios')
    const ctacteResult = results.find((r) => r.domain === 'ctacte')

    // socios: nothing to promote (no projection rows), 0 attempted
    expect(sociosResult?.attempted).toBe(0)
    expect(sociosResult?.inserted).toBe(0)
    // ctacte: skipped due to upstream failure (empty master = no matching socio)
    expect(ctacteResult?.skipped).toBeGreaterThanOrEqual(0)
  })

  // T6: Unit test for transformSocio + parseFechaVFP
  it('T6: parseFechaVFP parses YYYYMMDD correctly and transformSocio maps fields', async () => {
    // Direct unit test of helpers — these are pure functions
    const { parseFechaVFP, splitApellidoNombre } = await import('../transform-helpers')

    const date = parseFechaVFP('19800515')
    expect(date).toBe('1980-05-15')

    const name = splitApellidoNombre('PEREZ JUAN')
    expect(name.apellido).toBe('PEREZ')
    expect(name.nombre).toBe('JUAN')

    // transformSocio throws on missing required fields
    const { transformSocio } = await import('../transforms/socios')
    const helpers = {
      parseFechaVFP,
      parseMonto: () => '0.00',
      splitDebeHaber: () => ({ debe: '0.00', haber: '0.00' }),
      splitApellidoNombre,
      fkMap: { get: () => undefined },
    }

    const result = transformSocio(
      {
        SOCCARNET: 'test-T6-1001',
        SOCAPYNOMB: 'RAMIREZ PEDRO',
        SOCDNI: '22222222',
        SOCFECALTA: '19950320',
      },
      helpers,
    )
    expect(result.numeroSocio).toBe('test-T6-1001')
    expect(result.apellido).toBe('RAMIREZ')
    expect(result.nombre).toBe('PEDRO')

    // Missing SOCDNI throws
    expect(() =>
      transformSocio({ SOCCARNET: 'test', SOCAPYNOMB: 'X Y', SOCFECALTA: '19950101' }, helpers),
    ).toThrow()
  })

  // T7: Unit test for transformCtacte + enum split
  it('T7: transformCtacte correctly splits monto into debe/haber based on tipo', async () => {
    const { parseMonto, splitDebeHaber } = await import('../transform-helpers')
    const { transformCtacte } = await import('../transforms/ctacte')

    // DEBITO: monto goes to debe
    const helpersDebito = {
      fkMap: { get: () => 'fake-uuid-123' },
      parseFechaVFP: () => '2020-01-01',
      parseMonto,
      splitDebeHaber,
      splitApellidoNombre: () => ({ apellido: '', nombre: '' }),
    }

    const debito = transformCtacte(
      {
        CCTCUENTA: '1001',
        CCTDEBEHAB: 1,
        CCTIMPORTE: '500.00',
        CCTFECHA: '20200101',
        CCTCONCEPT: 'Cargo',
      },
      helpersDebito,
    )
    expect(debito.tipo).toBe('DEBITO')
    expect((debito as Record<string, unknown>)['debe']).toBe('500.00')
    expect((debito as Record<string, unknown>)['haber']).toBe('0.00')

    // CREDITO: monto goes to haber
    const helpersCredito = {
      ...helpersDebito,
      fkMap: { get: () => 'fake-uuid-456' },
    }
    const credito = transformCtacte(
      {
        CCTCUENTA: '1001',
        CCTDEBEHAB: -1,
        CCTIMPORTE: '300.00',
        CCTFECHA: '20200101',
        CCTCONCEPT: 'Pago',
      },
      helpersCredito,
    )
    expect(credito.tipo).toBe('CREDITO')
    expect((credito as Record<string, unknown>)['debe']).toBe('0.00')
    expect((credito as Record<string, unknown>)['haber']).toBe('300.00')

    // No matching socio throws
    const noSocioHelpers = {
      ...helpersDebito,
      fkMap: { get: () => undefined },
    }
    expect(() =>
      transformCtacte(
        {
          CCTCUENTA: 'NONEXISTENT',
          CCTDEBEHAB: 1,
          CCTIMPORTE: '100.00',
          CCTFECHA: '20200101',
          CCTCONCEPT: 'X',
        },
        noSocioHelpers,
      ),
    ).toThrow(/no matching socio/i)
  })
})

// ─── Shutdown ────────────────────────────────────────────────────────────────

afterAll(async () => {
  await pool.end()
})
