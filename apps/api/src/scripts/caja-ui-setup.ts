/**
 * caja-ui-setup.ts — Seeds the local UI/UX walkthrough database.
 *
 * Applies the FULL canonical drizzle chain to the walkthrough database and seeds the demo
 * state the caja screens are meaningful against: one admin operator with a real login
 * password, active socios with outstanding obligations (the collections / tesorería flows),
 * and a legacy gasto (the admin gastos screens). Uses the same canonical harness as the
 * integration tests, so the walkthrough database is exactly the shipped schema.
 *
 * Usage (invoked by scripts/caja-ui.sh, not meant for direct use):
 *   ATHLOS_TEST_DATABASE_URL=postgres://... pnpm --filter @athlos/api exec tsx \
 *     src/scripts/caja-ui-setup.ts <databaseName> <operatorUsername> <operatorPassword>
 *
 * Idempotent by reset: every run drops and re-applies the chain, so the walkthrough always
 * starts from a clean, predictable state.
 */
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { createDb } from '@athlos/db'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@athlos/db/schema'
import { createCanonicalHarness } from '@athlos/db/testing'
import { hashPassword } from '@athlos/auth'
import { businessDateForOpening, CashDeskService } from '../modules/dues/cash-desk.ts'
import { claimReceipt, insertObligation, type ObligationInput } from '../modules/dues/repository.ts'
import { lastCanonicalIndex, withDatabaseName } from '../test-support/cash-scenario.ts'

const fingerprint = () => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)

interface SeedObligation {
  readonly periodStart: string
  readonly periodEnd: string
  readonly amountCents: number
}

interface SeedSocio {
  readonly numeroSocio: string
  readonly nombre: string
  readonly apellido: string
  readonly obligations: readonly [SeedObligation, SeedObligation]
}

const SEED_SOCIOS: readonly [SeedSocio, SeedSocio, SeedSocio] = [
  {
    numeroSocio: 'sim-ana',
    nombre: 'Ana',
    apellido: 'García',
    obligations: [
      { periodStart: '2099-01-01', periodEnd: '2099-02-01', amountCents: 15_000 },
      { periodStart: '2099-02-01', periodEnd: '2099-03-01', amountCents: 22_500 },
    ],
  },
  {
    numeroSocio: 'sim-bruno',
    nombre: 'Bruno',
    apellido: 'Díaz',
    obligations: [
      { periodStart: '2099-01-01', periodEnd: '2099-02-01', amountCents: 8_000 },
      { periodStart: '2099-02-01', periodEnd: '2099-03-01', amountCents: 15_000 },
    ],
  },
  {
    numeroSocio: 'sim-carla',
    nombre: 'Carla',
    apellido: 'Suárez',
    obligations: [
      { periodStart: '2099-01-01', periodEnd: '2099-02-01', amountCents: 22_500 },
      { periodStart: '2099-02-01', periodEnd: '2099-03-01', amountCents: 8_000 },
    ],
  },
]

const seedObligation = async (
  db: ReturnType<typeof drizzle<typeof schema>>,
  input: {
    readonly operatorId: string
    readonly socioId: string
    readonly periodStart: string
    readonly periodEnd: string
    readonly amountCents: number
  },
): Promise<void> => {
  const receipt = await claimReceipt(db, {
    operatorId: input.operatorId,
    callerKey: randomUUID(),
    requestFingerprint: fingerprint(),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    authorizationEvidence: { source: 'caja-ui-setup' },
  })
  const obligation: ObligationInput = {
    socioId: input.socioId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    amountCents: input.amountCents,
    generationReceiptId: receipt.receipt.id,
    actorId: input.operatorId,
    snapshot: { source: 'caja-ui-setup' },
    authorizationEvidence: { source: 'caja-ui-setup' },
    components: [
      {
        kind: 'BASE',
        componentKey: `base-${randomUUID()}`,
        amountCents: input.amountCents,
        calculationInputs: {},
        eligibilitySnapshot: {},
        priceSnapshot: {},
      },
    ],
  }
  await insertObligation(db, obligation)
}

const main = async (): Promise<void> => {
  const [databaseName, operatorUsername, operatorPassword] = process.argv.slice(2)
  const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
  if (!databaseName || !operatorUsername || !operatorPassword || !databaseUrl) {
    throw new Error(
      'usage: caja-ui-setup.ts <databaseName> <operatorUsername> <operatorPassword> (ATHLOS_TEST_DATABASE_URL required)',
    )
  }

  const adminDb = createDb({
    connectionString: withDatabaseName(databaseUrl, 'postgres'),
    poolMax: 2,
  })
  const harness = createCanonicalHarness(databaseUrl, databaseName)
  try {
    await harness.connect()
    await harness.resetDatabase()
    const applied = await harness.applyCanonicalChain(lastCanonicalIndex())
    if (!applied.ok)
      throw new Error(`Canonical chain failed to apply: ${applied.error ?? 'unknown error'}`)

    const pool = harness.pool
    const db = drizzle(pool, { schema })

    // Admin operator with a REAL login password (verifyPassword-compatible). The first
    // operator also backs every seeded generation receipt (FK: receipts.operator_id).
    const operatorId = randomUUID()
    const passwordHash = await hashPassword(operatorPassword)
    await pool.query(
      `INSERT INTO public.operators (id,username,password_hash,role,can_reprint,can_anulate,is_active,failed_login_attempts)
       VALUES ($1,$2,$3,'A',true,true,true,0)`,
      [operatorId, operatorUsername, passwordHash],
    )

    // A second OPERADOR account: the designed caja journey is the operator-personal Caja
    // (caja-first entry, own shift, own closed history), which only renders for role O.
    const cajeroId = randomUUID()
    await pool.query(
      `INSERT INTO public.operators (id,username,password_hash,role,can_reprint,can_anulate,is_active,failed_login_attempts)
       VALUES ($1,'cajero',$2,'O',false,false,true,0)`,
      [cajeroId, await hashPassword('cajero123')],
    )

    // Active socios with outstanding obligations: the collections and tesorería flows need debt.
    let seededObligations = 0
    for (const socio of SEED_SOCIOS) {
      const socioId = randomUUID()
      await pool.query(
        `INSERT INTO socios.socios (id,numero_socio,nombre,apellido,dni,fecha_alta,estado)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'activo')`,
        [socioId, socio.numeroSocio, socio.nombre, socio.apellido, `dni-${socioId}`],
      )
      for (const obligation of socio.obligations) {
        await seedObligation(db, { operatorId, socioId, ...obligation })
        seededObligations += 1
      }
    }

    // A legacy gasto for the admin gastos screens. Its fecha equals today's business date so
    // the treasury seed below can include it in the closed demo shift.
    const gastoId = randomUUID()
    await pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe)
       VALUES ($1,1,1,'600',$2,'45.00')`,
      [gastoId, businessDateForOpening(new Date())],
    )

    // Cash desk state for /tesoreria, owned by the cajero so the operator-personal journey
    // renders out of the box. Roles follow the shipped boundaries: the OPERADOR opens shifts
    // (opening is operator work); expense inclusion and close are finance actions, so the
    // ADMIN acts on the cajero's demo shift. Everything goes through the real CashDeskService,
    // so audit entries, idempotency rows and close snapshots match the shipped flow.
    const cash = new CashDeskService(db)
    const cashContext = (actorId: string, role: 'ADMIN' | 'OPERADOR', callerKey: string) => ({
      actorId,
      role,
      permissions: [],
      sourceIp: null,
      callerKey,
      requestFingerprint: fingerprint(),
      authorizationEvidence: { source: 'caja-ui-setup' },
    })
    const demoShift = await cash.open({
      ...cashContext(cajeroId, 'OPERADOR', 'ui-walkthrough-closed-shift'),
      deskId: 'front-desk',
      openingTenders: { CASH: 20_000 },
    })
    await cash.includeExpense({
      ...cashContext(operatorId, 'ADMIN', 'ui-walkthrough-closed-expense'),
      shiftId: demoShift.id,
      gastoId,
      tender: 'CASH',
    })
    await cash.close({
      ...cashContext(operatorId, 'ADMIN', 'ui-walkthrough-closed-shift-close'),
      shiftId: demoShift.id,
      countedTenders: { CASH: 15_500 },
    })
    await cash.open({
      ...cashContext(cajeroId, 'OPERADOR', 'ui-walkthrough-open-shift'),
      deskId: 'ventanilla-2',
      openingTenders: { CASH: 10_000 },
    })

    console.info(
      [
        'caja UI walkthrough database ready',
        `  database        ${databaseName}`,
        `  operators       ${operatorUsername} (ADMIN), cajero (OPERADOR / cajero123)`,
        `  socios          ${SEED_SOCIOS.length} active, ${seededObligations} open obligations`,
        '  tesoreria       cajero owns 1 closed shift (balanced) + 1 open shift, 1 gasto included',
      ].join('\n'),
    )
  } finally {
    // harness.end() runs resetDatabase() — it would wipe the walkthrough database we just
    // seeded. Close the pool only; the running walkthrough stack keeps using this database.
    await harness.pool.end()
    await adminDb.pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(`caja UI setup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
