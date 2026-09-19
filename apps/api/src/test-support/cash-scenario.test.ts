/**
 * cash-scenario.test.ts — Integration proof for the caja scenario harness.
 *
 * Runs a full accounted-close scenario and an idempotent settle replay against a REAL
 * disposable PostgreSQL (provisioned by scripts/lib/disposable-postgres.sh), driving only the
 * real cash services. Raw SQL is used for assertions, never to bypass the services.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCashScenario, type CashScenario } from './cash-scenario.ts'

let scenario: CashScenario

beforeAll(async () => {
  scenario = await createCashScenario()
}, 60_000)

afterAll(async () => {
  await scenario?.end()
}, 30_000)

describe('cash scenario harness on real PostgreSQL', () => {
  it('drives a full accounted close through the real services', async () => {
    const operatorId = await scenario.seedOperator()
    const socioId = await scenario.seedSocio()
    const firstObligation = await scenario.seedObligation(socioId, 10_000, {
      start: '2099-01-01',
      end: '2099-02-01',
    })
    const secondObligation = await scenario.seedObligation(socioId, 5_000, {
      start: '2099-02-01',
      end: '2099-03-01',
    })

    const shift = await scenario.openShift(scenario.actor(operatorId), {
      openingTenders: { CASH: 10_000 },
    })
    expect(shift.status).toBe('OPEN')

    const settlement = await scenario.settle(scenario.actor(operatorId), {
      socioId,
      obligationIds: [firstObligation, secondObligation],
      shiftId: shift.id,
      tender: 'TRANSFER',
    })
    expect(settlement).toMatchObject({ kind: 'MONETARY', amountCents: 15_000, currency: 'ARS' })
    expect(settlement.allocations).toHaveLength(2)

    const gastoId = await scenario.seedGasto({ amountCents: 2_000, fecha: shift.businessDate })
    const expense = await scenario.includeExpense(scenario.actor(operatorId), {
      shiftId: shift.id,
      gastoId,
      tender: 'CASH',
    })
    expect(expense).toMatchObject({ gastoId, tender: 'CASH', amountCents: 2_000 })

    // Computed close cash = opening 100.00 − 20.00 CASH expense = 80.00; the TRANSFER
    // settlement never enters physical cash — the same recomputation the service performs.
    const close = await scenario.closeShift(scenario.actor(operatorId), {
      shiftId: shift.id,
      countedTenders: { CASH: 8_000 },
    })
    expect(close.discrepancy).toEqual({})
    expect(close.closeTransfer).toMatchObject({
      accountCodeSnapshot: '1.1.3.02',
      amountCents: 8_000,
    })

    await scenario.expectOneCloseTransferPerClose()
    await scenario.expectCloseTransferPinned({
      closeId: close.id,
      shiftId: shift.id,
      accountCode: '1.1.3.02',
      minAmountCents: 8_000,
    })
    await scenario.expectSourceRows({ settlementId: settlement.settlementId, minCount: 1 })

    const transfer = await scenario.pool.query<{
      amount: string
      account_code_snapshot: string
      account_name_snapshot: string
    }>(
      'SELECT amount::text, account_code_snapshot, account_name_snapshot FROM tesoreria.dues_cash_close_transfers WHERE close_id = $1',
      [close.id],
    )
    expect(transfer.rows[0]).toMatchObject({
      amount: '80.00',
      account_code_snapshot: '1.1.3.02',
      account_name_snapshot: 'Valores a Depositar',
    })

    const settlementTender = await scenario.pool.query<{
      tender: string
      direction: string
      amount: string
      source_type: string
    }>(
      'SELECT tender, direction, amount::text, source_type FROM tesoreria.dues_cash_tenders WHERE source_id = $1',
      [settlement.settlementId],
    )
    expect(settlementTender.rows[0]).toMatchObject({
      tender: 'TRANSFER',
      direction: 'INCOME',
      amount: '150.00',
      source_type: 'SETTLEMENT',
    })

    const source = await scenario.pool.query<{ origin: string; account_code_snapshot: string }>(
      'SELECT origin, account_code_snapshot FROM tesoreria.dues_cash_sources WHERE settlement_id = $1',
      [settlement.settlementId],
    )
    expect(source.rows[0]).toMatchObject({
      origin: 'AUTOMATIC_DUES_PRODUCTION',
      account_code_snapshot: '4.1.01',
    })

    expect(
      (
        await scenario.pool.query('SELECT status FROM tesoreria.dues_cash_shifts WHERE id = $1', [
          shift.id,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'CLOSED' })
    // One income tender for the settlement plus one expense tender for the gasto.
    expect(
      await scenario.countRows(
        `SELECT id FROM tesoreria.dues_cash_tenders WHERE shift_id = '${shift.id}'`,
      ),
    ).toBe(2)
  }, 30_000)

  it('replays settle with the same caller key to the same settlement without duplicates', async () => {
    const operatorId = await scenario.seedOperator()
    const socioId = await scenario.seedSocio()
    const obligationId = await scenario.seedObligation(socioId, 7_000, {
      start: '2099-03-01',
      end: '2099-04-01',
    })
    const shift = await scenario.openShift(scenario.actor(operatorId))
    // One actor object = one caller key reused by both calls: the second settle is a replay.
    const actor = scenario.actor(operatorId)
    const input = {
      socioId,
      obligationIds: [obligationId],
      shiftId: shift.id,
      tender: 'CASH' as const,
    }

    const first = await scenario.settle(actor, input)
    // A replaying client already holds the original selection fingerprint; it never re-selects
    // (the balances are allocated by then), so the replay reuses the first settle's one.
    const replay = await scenario.settle(actor, {
      ...input,
      selectionFingerprint: first.selectionFingerprint,
    })
    expect(replay).toEqual(first)
    expect(
      (
        await scenario.pool.query(
          'SELECT count(*)::int AS count FROM tesoreria.dues_settlements WHERE operator_id = $1 AND caller_key = $2',
          [operatorId, actor.callerKey],
        )
      ).rows[0],
    ).toMatchObject({ count: 1 })
    expect(
      (
        await scenario.pool.query(
          'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id = $1',
          [obligationId],
        )
      ).rows[0],
    ).toMatchObject({ count: 1 })
  }, 30_000)
})
