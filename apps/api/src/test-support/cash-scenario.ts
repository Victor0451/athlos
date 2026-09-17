/**
 * cash-scenario.ts — Reusable caja scenario harness for cash-domain integration tests.
 *
 * Drives the REAL cash services (`CashDeskService`, `SettlementService`) against a REAL
 * disposable PostgreSQL database provisioned by `scripts/lib/disposable-postgres.sh` through
 * `ATHLOS_TEST_DATABASE_URL`. Financial evidence is never in-memory or simulated: the FULL
 * canonical drizzle chain is applied (journal-driven, never a hardcoded index), so assertions
 * run on the real accounting tables (`tesoreria.dues_cash_*`, `contabilidad.plan_cuentas`).
 *
 * Usage sketch:
 *   const scenario = await createCashScenario()
 *   const operatorId = await scenario.seedOperator()
 *   const socioId = await scenario.seedSocio()
 *   const obligationId = await scenario.seedObligation(socioId, 10_000, { start: '2099-01-01', end: '2099-02-01' })
 *   const shift = await scenario.openShift(scenario.actor(operatorId), { openingTenders: { CASH: 10_000 } })
 *   const settlement = await scenario.settle(scenario.actor(operatorId), { socioId, obligationIds: [obligationId], shiftId: shift.id, tender: 'CASH' })
 *   await scenario.expectOneCloseTransferPerClose()
 *   await scenario.end()
 *
 * Every action builds its own idempotency context: call `actor()` fresh per action — reusing
 * one actor object replays the same caller key (which is exactly what a replay test wants).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createCanonicalHarness, type CanonicalHarness } from '@athlos/db/testing'
import * as schema from '@athlos/db/schema'
import { createDb } from '@athlos/db'
import {
  businessDateForOpening,
  CashDeskService,
  type TenderCommand,
} from '../modules/dues/cash-desk.ts'
import { SettlementService, type SettlementResult } from '../modules/dues/settlements.ts'
import { selectFullOutstanding } from '../modules/dues/allocations.ts'
import { claimReceipt, insertObligation, type ObligationInput } from '../modules/dues/repository.ts'
import type { AuditContext } from '../modules/dues/service.ts'

/** Inclusive obligation/receipt period as stored in `tesoreria.dues_obligations`. */
export type ScenarioPeriod = { start: string; end: string }

/** Settlement tenders accepted by the full-selection payment flow. */
export type ScenarioTender = 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'

// The generated name must pass this allowlist before it is quoted as a PostgreSQL identifier.
const scenarioDatabaseName = /^athlos_cash_scenario_[0-9a-f]{32}$/

type Admin = { query: (statement: string) => Promise<unknown> }

const assertScenarioDatabaseName = (name: string) => {
  if (!scenarioDatabaseName.test(name)) throw new Error('unsafe disposable database name')
}

const createScenarioDatabase = async (admin: Admin, name: string) => {
  assertScenarioDatabaseName(name)
  await admin.query(['CREATE DATABASE "', name, '"'].join(''))
}

const dropScenarioDatabase = async (admin: Admin, name: string) => {
  assertScenarioDatabaseName(name)
  await admin.query(['DROP DATABASE IF EXISTS "', name, '"'].join(''))
}

const withDatabaseName = (databaseUrl: string, databaseName: string) => {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch (error) {
    throw new Error(`ATHLOS_TEST_DATABASE_URL is not a valid database URL: ${String(error)}`)
  }
  url.pathname = `/${databaseName}`
  return url.toString()
}

const drizzleDirectory = join(import.meta.dirname, '..', '..', '..', '..', 'packages/db/drizzle')

/**
 * Last canonical migration index, read from the drizzle journal at call time — never a
 * hardcoded index, so the scenario always matches the checked-out migrations.
 */
function lastCanonicalIndex(): number {
  const journalPath = join(drizzleDirectory, 'meta', '_journal.json')
  let journal: { entries: Array<{ idx: number }> }
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: Array<{ idx: number }>
    }
  } catch (error) {
    throw new Error(`Cannot read the canonical drizzle journal at ${journalPath}: ${String(error)}`)
  }
  const entries = [...journal.entries].sort((left, right) => left.idx - right.idx)
  const last = entries.at(-1)
  if (!last) throw new Error('The canonical drizzle journal has no migrations')
  return last.idx
}

const money = (value: number) => (value / 100).toFixed(2)
const cents = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}
const fingerprint = () => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)

/**
 * A disposable, fully-migrated caja scenario. Services are real, the database is real and
 * disposable; raw SQL is only used for seed rows and assertions, never to mutate through the
 * services' write paths.
 */
export interface CashScenario {
  /** Raw pool bound to the disposable scenario database — for seed rows and assertions only. */
  readonly pool: CanonicalHarness['pool']
  /** Insert one finance operator and return its id; the first one backs generation receipts. */
  seedOperator(): Promise<string>
  /** Insert one active member (`socios.socios`) and return its id. */
  seedSocio(): Promise<string>
  /**
   * Insert one OPEN obligation through the real repository (claimReceipt + insertObligation).
   * Defaults to the first operator seeded by {@link seedOperator}.
   */
  seedObligation(
    socioId: string,
    amountCents: number,
    period: ScenarioPeriod,
    operatorId?: string,
  ): Promise<string>
  /**
   * Insert one legacy gasto (expense) and return its id. `fecha` defaults to today's club
   * business date; `includeExpense` requires it to equal the shift business date.
   */
  seedGasto(input: {
    amountCents: number
    fecha?: string
    cuentaPrincipal?: string
  }): Promise<string>
  /** Build an ADMIN audit context with a fresh caller key (call once per action). */
  actor(operatorId: string, overrides?: Partial<AuditContext>): AuditContext
  /** Open a cash shift through the real service; defaults to a random desk and no float. */
  openShift(
    actor: AuditContext,
    input?: { deskId?: string; openingTenders?: Record<string, number> },
  ): Promise<Awaited<ReturnType<CashDeskService['open']>>>
  /** Record a manual or settlement-sourced tender through the real service. */
  recordTender(
    actor: AuditContext,
    input: Omit<TenderCommand, keyof AuditContext>,
  ): Promise<Awaited<ReturnType<CashDeskService['recordTender']>>>
  /** Include an existing gasto as a shift expense through the real service. */
  includeExpense(
    actor: AuditContext,
    input: { shiftId: string; gastoId: string; tender: string },
  ): Promise<Awaited<ReturnType<CashDeskService['includeExpense']>>>
  /**
   * Pay the full outstanding balance of the selected obligations through the real service.
   * Without `selectionFingerprint` the harness computes it with the real
   * `selectFullOutstanding`; a replay must instead reuse the first settle's fingerprint
   * (mirroring a retrying client that already holds the original selection), because the
   * balances are already allocated by then.
   */
  settle(
    actor: AuditContext,
    input: {
      socioId: string
      obligationIds: string[]
      shiftId: string
      tender: ScenarioTender
      selectionFingerprint?: string
    },
  ): Promise<SettlementResult & { selectionFingerprint: string }>
  /** Reverse a settlement by compensation through the real service. */
  reverseSettlement(
    actor: AuditContext,
    input: { settlementId: string; reason: string },
  ): Promise<SettlementResult>
  /** Close a cash shift through the real service (computes the close transfer). */
  closeShift(
    actor: AuditContext,
    input: {
      shiftId: string
      countedTenders: Record<string, number>
      reason?: string
      forceClose?: boolean
    },
  ): Promise<Awaited<ReturnType<CashDeskService['close']>>>
  /** Assert every close in the scenario database has exactly one close transfer. */
  expectOneCloseTransferPerClose(): Promise<void>
  /**
   * Assert a close transfer pinned to the given catalog account exists (default `1.1.3.02
   * Valores a Depositar`), optionally scoped to a close/shift and bounded below in cents.
   */
  expectCloseTransferPinned(input?: {
    closeId?: string
    shiftId?: string
    accountCode?: string
    minAmountCents?: number
  }): Promise<void>
  /**
   * Assert at least `minCount` cash source rows exist. Automatic sources
   * (`dues_cash_sources`) filter by settlement; manual sources (`dues_cash_manual_sources`)
   * join the count only when no settlement filter narrows the query to settlement-origin rows.
   */
  expectSourceRows(input?: {
    shiftId?: string
    settlementId?: string
    minCount?: number
  }): Promise<void>
  /** Count the rows returned by an arbitrary SQL query (custom assertions). */
  countRows(query: string): Promise<number>
  /** Close every pool and drop the disposable scenario database. */
  end(): Promise<void>
}

/**
 * Provision a cash scenario: disposable database, full canonical chain, real services.
 * Requires `ATHLOS_TEST_DATABASE_URL` (set by `scripts/lib/disposable-postgres.sh run`).
 */
export async function createCashScenario(): Promise<CashScenario> {
  const databaseUrl = process.env.ATHLOS_TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  const databaseName = `athlos_cash_scenario_${randomUUID().replaceAll('-', '')}`
  const adminDb = createDb({
    connectionString: withDatabaseName(databaseUrl, 'postgres'),
    poolMax: 2,
  })
  const harness = createCanonicalHarness(databaseUrl, databaseName)
  let ended = false
  const teardown = async () => {
    if (ended) return
    ended = true
    try {
      await harness.end()
    } finally {
      try {
        await dropScenarioDatabase(adminDb.pool, databaseName)
      } finally {
        await adminDb.pool.end()
      }
    }
  }
  try {
    await createScenarioDatabase(adminDb.pool, databaseName)
    await harness.connect()
    // resetDatabase creates the drizzle migration ledger the chain application records into.
    await harness.resetDatabase()
    const applied = await harness.applyCanonicalChain(lastCanonicalIndex())
    if (!applied.ok)
      throw new Error(`Canonical chain failed to apply: ${applied.error ?? 'unknown error'}`)

    const pool = harness.pool
    const db = drizzle(pool, { schema })
    let primaryOperatorId: string | null = null

    const seedOperator = async (): Promise<string> => {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO public.operators (id,username,password_hash,role) VALUES ($1,$2,'scenario','A')`,
        [id, `cash-scenario-${id}`],
      )
      primaryOperatorId ??= id
      return id
    }

    const seedSocio = async (): Promise<string> => {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO socios.socios (id,numero_socio,nombre,apellido,dni,fecha_alta,estado) VALUES ($1,$2,'Scenario','Fixture',$3,CURRENT_DATE,'activo')`,
        [id, `scenario-${id}`, `dni-${id}`],
      )
      return id
    }

    const seedObligation = async (
      socioId: string,
      amountCents: number,
      period: ScenarioPeriod,
      operatorId?: string,
    ): Promise<string> => {
      const actorId = operatorId ?? primaryOperatorId
      if (!actorId)
        throw new Error(
          'seedObligation requires an operator: call seedOperator() first or pass operatorId',
        )
      const receipt = await claimReceipt(db, {
        operatorId: actorId,
        callerKey: randomUUID(),
        requestFingerprint: fingerprint(),
        periodStart: period.start,
        periodEnd: period.end,
        authorizationEvidence: { source: 'cash-scenario' },
      })
      const input: ObligationInput = {
        socioId,
        periodStart: period.start,
        periodEnd: period.end,
        amountCents,
        generationReceiptId: receipt.receipt.id,
        actorId,
        snapshot: { source: 'cash-scenario' },
        authorizationEvidence: { source: 'cash-scenario' },
        components: [
          {
            kind: 'BASE',
            componentKey: `base-${randomUUID()}`,
            amountCents,
            calculationInputs: {},
            eligibilitySnapshot: {},
            priceSnapshot: {},
          },
        ],
      }
      return (await insertObligation(db, input)).obligation.id
    }

    const seedGasto = async (input: {
      amountCents: number
      fecha?: string
      cuentaPrincipal?: string
    }): Promise<string> => {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,$2,$3,$4)`,
        [
          id,
          input.cuentaPrincipal ?? '600',
          input.fecha ?? businessDateForOpening(new Date()),
          money(input.amountCents),
        ],
      )
      return id
    }

    const actor = (operatorId: string, overrides: Partial<AuditContext> = {}): AuditContext => ({
      actorId: operatorId,
      role: 'ADMIN',
      permissions: ['dues:settle'],
      sourceIp: '127.0.0.1',
      callerKey: randomUUID(),
      requestFingerprint: fingerprint(),
      authorizationEvidence: { role: 'ADMIN', permission: 'dues:settle' },
      ...overrides,
    })

    const openShift = (
      actorContext: AuditContext,
      input: { deskId?: string; openingTenders?: Record<string, number> } = {},
    ) =>
      new CashDeskService(db).open({
        ...actorContext,
        deskId: input.deskId ?? `scenario-desk-${randomUUID()}`,
        openingTenders: input.openingTenders ?? {},
      })

    const recordTender = (
      actorContext: AuditContext,
      input: Omit<TenderCommand, keyof AuditContext>,
    ) => new CashDeskService(db).recordTender({ ...actorContext, ...input })

    const includeExpense = (
      actorContext: AuditContext,
      input: { shiftId: string; gastoId: string; tender: string },
    ) => new CashDeskService(db).includeExpense({ ...actorContext, ...input })

    const settle = async (
      actorContext: AuditContext,
      input: {
        socioId: string
        obligationIds: string[]
        shiftId: string
        tender: ScenarioTender
        selectionFingerprint?: string
      },
    ): Promise<SettlementResult & { selectionFingerprint: string }> => {
      const selectionFingerprint =
        input.selectionFingerprint ??
        (
          await selectFullOutstanding(db, {
            socioId: input.socioId,
            obligationIds: input.obligationIds,
          })
        ).fingerprint
      const result = await new SettlementService(db).create({
        ...actorContext,
        socioId: input.socioId,
        obligationIds: input.obligationIds,
        shiftId: input.shiftId,
        tender: input.tender,
        selectionFingerprint,
      })
      return { ...result, selectionFingerprint }
    }

    const reverseSettlement = (
      actorContext: AuditContext,
      input: { settlementId: string; reason: string },
    ) => new SettlementService(db).reverse({ ...actorContext, ...input })

    const closeShift = (
      actorContext: AuditContext,
      input: {
        shiftId: string
        countedTenders: Record<string, number>
        reason?: string
        forceClose?: boolean
      },
    ) => new CashDeskService(db).close({ ...actorContext, ...input })

    const countRows = async (query: string): Promise<number> => {
      const result = await pool.query(query)
      return result.rows.length
    }

    const expectOneCloseTransferPerClose = async (): Promise<void> => {
      const result = await pool.query<{ id: string; transfers: number }>(
        `SELECT c.id, (SELECT count(*)::int FROM tesoreria.dues_cash_close_transfers t WHERE t.close_id = c.id) AS transfers
         FROM tesoreria.dues_cash_closes c`,
      )
      const offenders = result.rows.filter((row) => row.transfers !== 1)
      if (offenders.length > 0)
        throw new Error(
          `Expected exactly one close transfer per close; offending closes: ${offenders
            .map((row) => `${row.id} (${row.transfers} transfers)`)
            .join(', ')}`,
        )
    }

    const expectCloseTransferPinned = async (
      input: {
        closeId?: string
        shiftId?: string
        accountCode?: string
        minAmountCents?: number
      } = {},
    ): Promise<void> => {
      const accountCode = input.accountCode ?? '1.1.3.02'
      const conditions = ['account_code_snapshot = $1']
      const values: unknown[] = [accountCode]
      if (input.closeId) {
        values.push(input.closeId)
        conditions.push(`close_id = $${values.length}`)
      }
      if (input.shiftId) {
        values.push(input.shiftId)
        conditions.push(`shift_id = $${values.length}`)
      }
      const result = await pool.query<{ id: string; amount: string }>(
        `SELECT id, amount::text FROM tesoreria.dues_cash_close_transfers WHERE ${conditions.join(' AND ')}`,
        values,
      )
      const expected = input.closeId ? 'exactly one' : 'at least one'
      if (input.closeId ? result.rows.length !== 1 : result.rows.length === 0)
        throw new Error(
          `Expected ${expected} close transfer pinned to ${accountCode}` +
            `${input.closeId ? ` for close ${input.closeId}` : ''}` +
            `${input.shiftId ? ` on shift ${input.shiftId}` : ''}; found ${result.rows.length}`,
        )
      const minAmountCents = input.minAmountCents
      if (minAmountCents !== undefined) {
        const below = result.rows.filter((row) => cents(row.amount) < minAmountCents)
        if (below.length > 0)
          throw new Error(
            `Expected close transfers of at least ${minAmountCents} cents pinned to ${accountCode}; found ${below
              .map((row) => `${row.id} = ${row.amount}`)
              .join(', ')}`,
          )
      }
    }

    const expectSourceRows = async (
      input: { shiftId?: string; settlementId?: string; minCount?: number } = {},
    ): Promise<void> => {
      const minCount = input.minCount ?? 1
      const result = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM (
           SELECT s.id FROM tesoreria.dues_cash_sources s
           WHERE ($1::uuid IS NULL OR s.shift_id = $1::uuid) AND ($2::uuid IS NULL OR s.settlement_id = $2::uuid)
           UNION ALL
           SELECT ms.id FROM tesoreria.dues_cash_manual_sources ms
           JOIN tesoreria.dues_cash_tenders t ON t.id = ms.tender_id
           WHERE $2::uuid IS NULL AND ($1::uuid IS NULL OR t.shift_id = $1::uuid)
         ) sources`,
        [input.shiftId ?? null, input.settlementId ?? null],
      )
      const count = result.rows[0]?.count ?? 0
      if (count < minCount)
        throw new Error(
          `Expected at least ${minCount} cash source row(s)` +
            `${input.shiftId ? ` on shift ${input.shiftId}` : ''}` +
            `${input.settlementId ? ` for settlement ${input.settlementId} (manual sources excluded)` : ''};` +
            ` found ${count}`,
        )
    }

    const scenario: CashScenario = {
      pool,
      seedOperator,
      seedSocio,
      seedObligation,
      seedGasto,
      actor,
      openShift,
      recordTender,
      includeExpense,
      settle,
      reverseSettlement,
      closeShift,
      expectOneCloseTransferPerClose,
      expectCloseTransferPinned,
      expectSourceRows,
      countRows,
      end: teardown,
    }
    return scenario
  } catch (error) {
    // Never leak a half-provisioned scenario database.
    await teardown().catch(() => undefined)
    throw error
  }
}
