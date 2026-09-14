import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const schema = `plan_cuentas_${randomUUID().replaceAll('-', '')}`
const quotedSchema = `"${schema}"`
const migration = join(import.meta.dirname, '..', '..', 'drizzle', '0066_plan_cuentas.sql')
let pool: Pool

type Account = {
  code: string
  name: string
  parent_code: string | null
  root_code: string
  active: boolean
  imputable: boolean
}

const expectedCatalog: Account[] = [
  { code: '1', name: 'Activo', parent_code: null, root_code: '1', active: true, imputable: false },
  {
    code: '1.1',
    name: 'Activo Corriente',
    parent_code: '1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.1',
    name: 'Caja y Bancos',
    parent_code: '1.1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.1.01',
    name: 'Caja (Pesos)',
    parent_code: '1.1.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.1.02',
    name: 'Caja Moneda Extranjera',
    parent_code: '1.1.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.1.03',
    name: 'Fondo Fijo (Caja Chica)',
    parent_code: '1.1.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.1.04',
    name: 'Banco X Cuenta Corriente',
    parent_code: '1.1.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.2',
    name: 'Inversiones',
    parent_code: '1.1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.2.01',
    name: 'Plazo Fijo',
    parent_code: '1.1.2',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.2.02',
    name: 'Fondos Comunes de Inversión (FCI)',
    parent_code: '1.1.2',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.3',
    name: 'Créditos por Ventas',
    parent_code: '1.1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.3.01',
    name: 'Deudores por Ventas',
    parent_code: '1.1.3',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.3.02',
    name: 'Valores a Depositar',
    parent_code: '1.1.3',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.3.03',
    name: 'Deudores Morosos',
    parent_code: '1.1.3',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.3.04',
    name: 'Tarjetas de Crédito a Cobrar',
    parent_code: '1.1.3',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.4',
    name: 'Otros Créditos',
    parent_code: '1.1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.4.01',
    name: 'IVA Crédito Fiscal',
    parent_code: '1.1.4',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.4.02',
    name: 'Retenciones/Percepciones sufridas (IVA, Ingresos Brutos, Ganancias)',
    parent_code: '1.1.4',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.4.03',
    name: 'Anticipos a Proveedores',
    parent_code: '1.1.4',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.5',
    name: 'Bienes de Cambio',
    parent_code: '1.1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.1.5.01',
    name: 'Mercaderías',
    parent_code: '1.1.5',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.1.5.02',
    name: 'Materias Primas',
    parent_code: '1.1.5',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2',
    name: 'Activo No Corriente',
    parent_code: '1',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.2.1',
    name: 'Bienes de Uso',
    parent_code: '1.2',
    root_code: '1',
    active: true,
    imputable: false,
  },
  {
    code: '1.2.1.01',
    name: 'Inmuebles',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.02',
    name: 'Rodados',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.03',
    name: 'Muebles y Útiles',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.04',
    name: 'Instalaciones',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.05',
    name: 'Equipos de Computación',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.06',
    name: 'Depreciación Acumulada - Inmuebles',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.07',
    name: 'Depreciación Acumulada - Rodados',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.08',
    name: 'Depreciación Acumulada - Muebles y Útiles',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.09',
    name: 'Depreciación Acumulada - Instalaciones',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  {
    code: '1.2.1.10',
    name: 'Depreciación Acumulada - Equipos de Computación',
    parent_code: '1.2.1',
    root_code: '1',
    active: true,
    imputable: true,
  },
  { code: '2', name: 'Pasivo', parent_code: null, root_code: '2', active: true, imputable: false },
  {
    code: '2.1',
    name: 'Pasivo Corriente',
    parent_code: '2',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.1.1',
    name: 'Deudas Comerciales',
    parent_code: '2.1',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.1.1.01',
    name: 'Proveedores',
    parent_code: '2.1.1',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.1.02',
    name: 'Acreedores Varios',
    parent_code: '2.1.1',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.1.03',
    name: 'Cheques de Pago Diferido Entregados',
    parent_code: '2.1.1',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.2',
    name: 'Préstamos',
    parent_code: '2.1',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.1.2.01',
    name: 'Adelantos en Cuenta Corriente',
    parent_code: '2.1.2',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.2.02',
    name: 'Préstamos Bancarios a pagar',
    parent_code: '2.1.2',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.3',
    name: 'Remuneraciones y Cargas Sociales',
    parent_code: '2.1',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.1.3.01',
    name: 'Sueldos a Pagar',
    parent_code: '2.1.3',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.3.02',
    name: 'Cargas Sociales a Pagar (AFIP, Sindicatos, Obra Social)',
    parent_code: '2.1.3',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.3.03',
    name: 'Provisión para SAC y Vacaciones',
    parent_code: '2.1.3',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.4',
    name: 'Cargas Fiscales',
    parent_code: '2.1',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.1.4.01',
    name: 'IVA Débito Fiscal',
    parent_code: '2.1.4',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.4.02',
    name: 'IVA Saldo a Pagar',
    parent_code: '2.1.4',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.4.03',
    name: 'Ingresos Brutos a Pagar',
    parent_code: '2.1.4',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.4.04',
    name: 'Provisión Impuesto a las Ganancias',
    parent_code: '2.1.4',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.1.4.05',
    name: 'Moratorias AFIP',
    parent_code: '2.1.4',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '2.2',
    name: 'Pasivo No Corriente',
    parent_code: '2',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.2.1',
    name: 'Deudas a Largo Plazo',
    parent_code: '2.2',
    root_code: '2',
    active: true,
    imputable: false,
  },
  {
    code: '2.2.1.01',
    name: 'Préstamos Bancarios (cuotas con vencimiento a más de un año)',
    parent_code: '2.2.1',
    root_code: '2',
    active: true,
    imputable: true,
  },
  {
    code: '3',
    name: 'Patrimonio Neto',
    parent_code: null,
    root_code: '3',
    active: true,
    imputable: false,
  },
  {
    code: '3.1',
    name: 'Capital',
    parent_code: '3',
    root_code: '3',
    active: true,
    imputable: false,
  },
  {
    code: '3.1.01',
    name: 'Capital Social',
    parent_code: '3.1',
    root_code: '3',
    active: true,
    imputable: true,
  },
  {
    code: '3.1.02',
    name: 'Aportes Irrevocables',
    parent_code: '3.1',
    root_code: '3',
    active: true,
    imputable: true,
  },
  {
    code: '3.2',
    name: 'Resultados Acumulados',
    parent_code: '3',
    root_code: '3',
    active: true,
    imputable: false,
  },
  {
    code: '3.2.01',
    name: 'Reserva Legal',
    parent_code: '3.2',
    root_code: '3',
    active: true,
    imputable: true,
  },
  {
    code: '3.2.02',
    name: 'Resultados No Asignados',
    parent_code: '3.2',
    root_code: '3',
    active: true,
    imputable: true,
  },
  {
    code: '3.2.03',
    name: 'Resultado del Ejercicio',
    parent_code: '3.2',
    root_code: '3',
    active: true,
    imputable: true,
  },
  {
    code: '4',
    name: 'Ingresos',
    parent_code: null,
    root_code: '4',
    active: true,
    imputable: false,
  },
  {
    code: '4.1',
    name: 'Ingresos Operativos',
    parent_code: '4',
    root_code: '4',
    active: true,
    imputable: false,
  },
  {
    code: '4.1.01',
    name: 'Cuotas sociales',
    parent_code: '4.1',
    root_code: '4',
    active: true,
    imputable: true,
  },
  {
    code: '4.1.02',
    name: 'Ventas de Mercaderías',
    parent_code: '4.1',
    root_code: '4',
    active: true,
    imputable: true,
  },
  {
    code: '4.1.03',
    name: 'Ventas de Servicios',
    parent_code: '4.1',
    root_code: '4',
    active: true,
    imputable: true,
  },
  {
    code: '4.2',
    name: 'Otros Ingresos',
    parent_code: '4',
    root_code: '4',
    active: true,
    imputable: false,
  },
  {
    code: '4.2.01',
    name: 'Intereses Ganados',
    parent_code: '4.2',
    root_code: '4',
    active: true,
    imputable: true,
  },
  {
    code: '4.2.02',
    name: 'Diferencias de Cambio (positivas)',
    parent_code: '4.2',
    root_code: '4',
    active: true,
    imputable: true,
  },
  {
    code: '4.2.03',
    name: 'Descuentos Obtenidos',
    parent_code: '4.2',
    root_code: '4',
    active: true,
    imputable: true,
  },
  { code: '5', name: 'Egresos', parent_code: null, root_code: '5', active: true, imputable: false },
  {
    code: '5.1',
    name: 'Costos Operativos',
    parent_code: '5',
    root_code: '5',
    active: true,
    imputable: false,
  },
  {
    code: '5.1.01',
    name: 'Costo de Mercaderías Vendidas (CMV)',
    parent_code: '5.1',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2',
    name: 'Gastos de Administración y Comercialización',
    parent_code: '5',
    root_code: '5',
    active: true,
    imputable: false,
  },
  {
    code: '5.2.01',
    name: 'Sueldos y Jornales',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.02',
    name: 'Cargas Sociales',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.03',
    name: 'Alquileres Perdidos',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.04',
    name: 'Servicios (Luz, Agua, Internet)',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.05',
    name: 'Honorarios Profesionales',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.06',
    name: 'Seguros',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.07',
    name: 'Movilidad y Viáticos',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.08',
    name: 'Papelería y Útiles',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.2.09',
    name: 'Impuestos y Tasas (Municipales/Provinciales)',
    parent_code: '5.2',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.3',
    name: 'Gastos Financieros',
    parent_code: '5',
    root_code: '5',
    active: true,
    imputable: false,
  },
  {
    code: '5.3.01',
    name: 'Intereses Perdidos',
    parent_code: '5.3',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.3.02',
    name: 'Gastos y Comisiones Bancarias',
    parent_code: '5.3',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.3.03',
    name: 'Diferencias de Cambio (negativas)',
    parent_code: '5.3',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.3.04',
    name: 'Impuesto a los Débitos y Créditos Bancarios (Ley 25.413)',
    parent_code: '5.3',
    root_code: '5',
    active: true,
    imputable: true,
  },
  {
    code: '5.4',
    name: 'Depreciaciones',
    parent_code: '5',
    root_code: '5',
    active: true,
    imputable: false,
  },
  {
    code: '5.4.01',
    name: 'Amortización / Depreciación Bienes de Uso',
    parent_code: '5.4',
    root_code: '5',
    active: true,
    imputable: true,
  },
]

function migrationSql() {
  return readFileSync(migration, 'utf8').replaceAll('contabilidad', schema)
}

async function expectConstraintViolation(
  client: PoolClient,
  statement: string,
  code: '23503' | '23514',
) {
  await client.query('SAVEPOINT expected_constraint_violation')
  try {
    await expect(client.query(statement)).rejects.toMatchObject({ code })
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_constraint_violation')
  }
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

describe('0066 plan cuentas (PostgreSQL)', () => {
  it('seeds the complete requested hierarchy with explicit parent links and stable fields', async () => {
    await pool.query(migrationSql())

    const rows =
      await pool.query<Account>(`SELECT code, name, parent_code, root_code, active, imputable
      FROM ${quotedSchema}.plan_cuentas ORDER BY code`)
    expect(rows.rows).toEqual(
      [...expectedCatalog].sort((left, right) => left.code.localeCompare(right.code)),
    )
    expect(rows.rows.filter((row) => row.parent_code === null).map((row) => row.code)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
    expect(rows.rows.find((row) => row.code === '4.1')).toMatchObject({
      name: 'Ingresos Operativos',
      imputable: false,
    })
    expect(rows.rows.find((row) => row.code === '4.1.01')).toMatchObject({
      name: 'Cuotas sociales',
      parent_code: '4.1',
      active: true,
      imputable: true,
    })
    expect(rows.rows.find((row) => row.name === 'Valores a Depositar')).toMatchObject({
      parent_code: '1.1.3',
      active: true,
      imputable: true,
    })
  })

  it('is replay-safe and preserves catalog eligibility and hierarchy constraints', async () => {
    await pool.query(migrationSql())
    await pool.query(migrationSql())

    await expect(
      pool.query(`INSERT INTO ${quotedSchema}.plan_cuentas
        (code, name, parent_code, root_code, active, imputable)
        VALUES ('9.9', 'Orphan account', '9', '1', true, true)`),
    ).rejects.toMatchObject({ code: '23503' })
    await expect(
      pool.query(`INSERT INTO ${quotedSchema}.plan_cuentas
        (code, name, parent_code, root_code, active, imputable)
        VALUES ('1', 'Duplicate', NULL, '1', true, false)`),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      pool.query(`INSERT INTO ${quotedSchema}.plan_cuentas
        (code, name, parent_code, root_code, active, imputable)
        VALUES ('1.1.1.99', 'Invalid inactive leaf', '1.1.1', '1', false, true)`),
    ).rejects.toMatchObject({ code: '23514' })

    await pool.query(`INSERT INTO ${quotedSchema}.plan_cuentas
      (code, name, parent_code, root_code, active, imputable)
      VALUES ('5.9', 'Grupo inactivo de prueba', '5', '5', false, false)`)

    const eligibility = await pool.query<Account>(`SELECT code, active, imputable
      FROM ${quotedSchema}.plan_cuentas
      WHERE code IN ('4.1', '4.1.01', '5.4', '5.9') ORDER BY code`)
    expect(eligibility.rows).toEqual([
      { code: '4.1', active: true, imputable: false },
      { code: '4.1.01', active: true, imputable: true },
      { code: '5.4', active: true, imputable: false },
      { code: '5.9', active: false, imputable: false },
    ])
  })

  it('accepts only the five non-imputable roots and rejects malformed or cross-root hierarchy rows', async () => {
    await pool.query(migrationSql())
    const client = await pool.connect()
    try {
      await client.query(`BEGIN; TRUNCATE ${quotedSchema}.plan_cuentas CASCADE`)
      await client.query(`INSERT INTO ${quotedSchema}.plan_cuentas
          (code, name, parent_code, root_code, active, imputable)
          VALUES
            ('1', 'Activo', NULL, '1', true, false),
            ('2', 'Pasivo', NULL, '2', true, false),
            ('3', 'Patrimonio Neto', NULL, '3', true, false),
            ('4', 'Ingresos', NULL, '4', true, false),
            ('5', 'Egresos', NULL, '5', true, false)`)

      await expectConstraintViolation(
        client,
        `INSERT INTO ${quotedSchema}.plan_cuentas
            (code, name, parent_code, root_code, active, imputable)
            VALUES ('6', 'Invalid root', NULL, '6', true, false)`,
        '23514',
      )
      await expectConstraintViolation(
        client,
        `INSERT INTO ${quotedSchema}.plan_cuentas
            (code, name, parent_code, root_code, active, imputable)
            VALUES ('1.9', 'Mismatched root', NULL, '1', true, false)`,
        '23514',
      )
      await expectConstraintViolation(
        client,
        `INSERT INTO ${quotedSchema}.plan_cuentas
            (code, name, parent_code, root_code, active, imputable)
            VALUES ('1.8', 'Imputable root', NULL, '1', true, true)`,
        '23514',
      )
      await expectConstraintViolation(
        client,
        `INSERT INTO ${quotedSchema}.plan_cuentas
            (code, name, parent_code, root_code, active, imputable)
            VALUES ('2.9', 'Cross-root child', '1', '2', true, true)`,
        '23503',
      )

      await expect(
        client.query<{ code: string; imputable: boolean }>(`SELECT code, imputable
            FROM ${quotedSchema}.plan_cuentas WHERE parent_code IS NULL ORDER BY code`),
      ).resolves.toMatchObject({
        rows: [
          { code: '1', imputable: false },
          { code: '2', imputable: false },
          { code: '3', imputable: false },
          { code: '4', imputable: false },
          { code: '5', imputable: false },
        ],
      })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
