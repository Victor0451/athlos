/**
 * caja-sim.ts — Interactive caja simulator over the real cash scenario harness.
 *
 * Provisions a REAL disposable PostgreSQL (via scripts/lib/disposable-postgres.sh), applies the
 * FULL canonical drizzle chain, loads a `CashScenario`, and opens a Node REPL where every action
 * goes through the real cash services (`CashDeskService`, `SettlementService`) — the same tools
 * the integration tests use, wired for a human at a prompt instead of a test file.
 *
 * Usage:
 *   pnpm caja:sim                      # interactive REPL over a fresh scenario database
 *   pnpm caja:sim close-flow           # run one named scenario, print the summary, exit
 *   pnpm caja:sim replay | status
 *
 * Inside the REPL:
 *   scenario                           the loaded CashScenario (pool, seeds, actions, assertions)
 *   await run('close-flow')            full accounted close: seeds, TRANSFER settlement, gasto,
 *                                      close with counted cash, pinned transfer, assertions
 *   await run('replay')                idempotent settle replay with one caller key
 *   await run('status')                read-only state summary of the scenario database
 *   await scenario.pool.query('...')   arbitrary read SQL for custom poking
 *
 * Lifetime: the disposable PostgreSQL container lives exactly as long as this process. Exiting
 * the REPL (`.exit`, Ctrl-D, or Ctrl-C) drops the scenario database and tears the container
 * down — nothing survives the session, by design.
 *
 * Everything the simulator exposes is already proven by
 * `apps/api/src/test-support/cash-scenario.test.ts`; the named scenarios re-run those proofs
 * with human-readable output.
 */
import process from 'node:process'
import repl from 'node:repl'
import { createCashScenario, type CashScenario } from '../test-support/cash-scenario.ts'

interface NamedScenario {
  readonly description: string
  readonly run: (scenario: CashScenario) => Promise<string>
}

const money = (cents: number) => (cents / 100).toFixed(2)

const closeFlow = async (scenario: CashScenario): Promise<string> => {
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
  const settlement = await scenario.settle(scenario.actor(operatorId), {
    socioId,
    obligationIds: [firstObligation, secondObligation],
    shiftId: shift.id,
    tender: 'TRANSFER',
  })
  const gastoId = await scenario.seedGasto({ amountCents: 2_000, fecha: shift.businessDate })
  await scenario.includeExpense(scenario.actor(operatorId), {
    shiftId: shift.id,
    gastoId,
    tender: 'CASH',
  })
  const close = await scenario.closeShift(scenario.actor(operatorId), {
    shiftId: shift.id,
    countedTenders: { CASH: 8_000 },
  })
  await scenario.expectOneCloseTransferPerClose()
  await scenario.expectCloseTransferPinned({
    closeId: close.id,
    shiftId: shift.id,
    accountCode: '1.1.3.02',
    minAmountCents: 8_000,
  })
  await scenario.expectSourceRows({ settlementId: settlement.settlementId, minCount: 1 })
  return [
    `close-flow complete on shift ${shift.id}`,
    `  operator   ${operatorId}`,
    `  socio      ${socioId}`,
    `  settle     ${settlement.kind} ${money(settlement.amountCents)} ARS, ${settlement.allocations.length} allocation(s), transfer`,
    `  gasto      ${gastoId} ${money(2_000)} CASH included as shift expense`,
    `  close      transfer ${money(close.closeTransfer?.amountCents ?? 0)} pinned to ${close.closeTransfer?.accountCodeSnapshot ?? '1.1.3.02'}, discrepancy ${JSON.stringify(close.discrepancy)}`,
    '  assertions one-transfer-per-close, pinned transfer, source rows: all pass',
  ].join('\n')
}

const replayFlow = async (scenario: CashScenario): Promise<string> => {
  const operatorId = await scenario.seedOperator()
  const socioId = await scenario.seedSocio()
  const obligationId = await scenario.seedObligation(socioId, 7_000, {
    start: '2099-03-01',
    end: '2099-04-01',
  })
  const shift = await scenario.openShift(scenario.actor(operatorId))
  // One actor object = one caller key reused by both settles: the second call is a replay.
  const actor = scenario.actor(operatorId)
  const input = {
    socioId,
    obligationIds: [obligationId],
    shiftId: shift.id,
    tender: 'CASH' as const,
  }
  const first = await scenario.settle(actor, input)
  const replayed = await scenario.settle(actor, {
    ...input,
    selectionFingerprint: first.selectionFingerprint,
  })
  const settlements = await scenario.pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM tesoreria.dues_settlements WHERE operator_id = $1 AND caller_key = $2',
    [operatorId, actor.callerKey],
  )
  const allocations = await scenario.pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id = $1',
    [obligationId],
  )
  const deduped = replayed.settlementId === first.settlementId
  return [
    `replay complete on shift ${shift.id}`,
    `  first      ${first.settlementId} ${money(first.amountCents)} ARS`,
    `  replay     ${replayed.settlementId} ${replayed.settlementId === first.settlementId ? '(same settlement — idempotent)' : '(DIFFERENT — unexpected)'}`,
    `  evidence   settlements for caller_key: ${settlements.rows[0]?.count ?? 0}, allocations: ${allocations.rows[0]?.count ?? 0}`,
    ...(deduped ? [] : ['  WARNING    replay produced a different settlement id']),
  ].join('\n')
}

const statusFlow = async (scenario: CashScenario): Promise<string> => {
  const counts = await scenario.pool.query<{
    operators: number
    socios: number
    obligations: number
    shifts_open: number
    shifts_closed: number
    tenders: number
    settlements: number
    allocations: number
    close_transfers: number
    close_transfer_total: string
    sources: number
    manual_sources: number
  }>(
    `SELECT
       (SELECT count(*)::int FROM public.operators) AS operators,
       (SELECT count(*)::int FROM socios.socios) AS socios,
       (SELECT count(*)::int FROM tesoreria.dues_obligations) AS obligations,
       (SELECT count(*)::int FROM tesoreria.dues_cash_shifts WHERE status = 'OPEN') AS shifts_open,
       (SELECT count(*)::int FROM tesoreria.dues_cash_shifts WHERE status = 'CLOSED') AS shifts_closed,
       (SELECT count(*)::int FROM tesoreria.dues_cash_tenders) AS tenders,
       (SELECT count(*)::int FROM tesoreria.dues_settlements) AS settlements,
       (SELECT count(*)::int FROM tesoreria.dues_allocations) AS allocations,
       (SELECT count(*)::int FROM tesoreria.dues_cash_close_transfers) AS close_transfers,
       (SELECT coalesce(sum(amount), 0)::text FROM tesoreria.dues_cash_close_transfers) AS close_transfer_total,
       (SELECT count(*)::int FROM tesoreria.dues_cash_sources) AS sources,
       (SELECT count(*)::int FROM tesoreria.dues_cash_manual_sources) AS manual_sources`,
  )
  const row = counts.rows[0]
  return [
    'scenario database state',
    `  operators ${row?.operators ?? 0} | socios ${row?.socios ?? 0} | obligations ${row?.obligations ?? 0}`,
    `  shifts    ${row?.shifts_open ?? 0} open, ${row?.shifts_closed ?? 0} closed`,
    `  cash      ${row?.tenders ?? 0} tenders (${row?.sources ?? 0} settlement sources, ${row?.manual_sources ?? 0} manual)`,
    `  closes    ${row?.close_transfers ?? 0} transfer(s) totaling ${row?.close_transfer_total ?? '0.00'}`,
    `  dues      ${row?.settlements ?? 0} settlement(s), ${row?.allocations ?? 0} allocation(s)`,
  ].join('\n')
}

const NAMED_SCENARIOS: Record<string, NamedScenario> = {
  'close-flow': {
    description: 'full accounted close (seeds, TRANSFER settlement, gasto, close)',
    run: closeFlow,
  },
  replay: { description: 'idempotent settle replay with one caller key', run: replayFlow },
  status: { description: 'read-only state summary of the scenario database', run: statusFlow },
}

const scenarioNameList = () =>
  Object.entries(NAMED_SCENARIOS)
    .map(([name, named]) => `    ${name.padEnd(12)}${named.description}`)
    .join('\n')

const psqlUrlFor = (scenario: CashScenario): Promise<string | undefined> =>
  scenario.pool
    .query<{ name: string }>('SELECT current_database() AS name')
    .then((result) => {
      const raw = process.env['ATHLOS_TEST_DATABASE_URL']
      if (!raw) return undefined
      try {
        const url = new URL(raw)
        url.pathname = `/${result.rows[0]?.name ?? 'unknown'}`
        return url.toString()
      } catch {
        return undefined
      }
    })
    .catch(() => undefined)

const runNamedScenario = async (scenario: CashScenario, name: string): Promise<boolean> => {
  const named = NAMED_SCENARIOS[name]
  if (!named) {
    console.error(`unknown scenario "${name}". available:\n${scenarioNameList()}`)
    return false
  }
  console.info(await named.run(scenario))
  return true
}

const printBanner = (psqlUrl: string | undefined): void => {
  console.info(
    [
      '',
      'caja simulator — real cash services on a real disposable PostgreSQL',
      '',
      ...(psqlUrl ? [`  psql      ${psqlUrl}`, ''] : []),
      '  ready-made',
      "    await run('close-flow')   full accounted close, human-readable summary",
      "    await run('replay')       idempotent settle replay proof",
      "    await run('status')       read-only state summary",
      '',
      '  live poke (examples)',
      '    const op = await scenario.seedOperator()',
      '    const shift = await scenario.openShift(scenario.actor(op), { openingTenders: { CASH: 10000 } })',
      "    await scenario.settle(scenario.actor(op), { socioId: await scenario.seedSocio(), obligationIds: [], shiftId: shift.id, tender: 'CASH' })",
      "    await scenario.countRows('select id from tesoreria.dues_cash_tenders')",
      '',
      '  exit      .exit (or Ctrl-D / Ctrl-C) — drops the scenario database and the container',
      '',
    ].join('\n'),
  )
}

const main = async (): Promise<number> => {
  const requested = process.argv[2]
  if (requested !== undefined && !(requested in NAMED_SCENARIOS)) {
    console.error(`unknown scenario "${requested}". available:\n${scenarioNameList()}`)
    return 2
  }

  const scenario = await createCashScenario()
  const psqlUrl = await psqlUrlFor(scenario)
  let shutdownStarted = false
  // Piped/script-mode REPL does not await one line's promise before evaluating the next, so
  // `.exit` can arrive while a named scenario is still running. Teardown runs resetDatabase()
  // (DROP SCHEMA CASCADE) and must never race in-flight scenario work — chain every invocation
  // and let shutdown await the chain first.
  let inflight: Promise<void> = Promise.resolve()
  const track = <T>(promise: Promise<T>): Promise<T> => {
    const settled = promise.then(
      () => undefined,
      () => undefined,
    )
    inflight = inflight.then(
      () => settled,
      () => settled,
    )
    return promise
  }
  const shutdown = async (exitCode: number): Promise<void> => {
    if (shutdownStarted) process.exit(exitCode)
    shutdownStarted = true
    await inflight
    try {
      await scenario.end()
    } finally {
      process.exit(exitCode)
    }
  }

  if (requested !== undefined) {
    const ok = await track(runNamedScenario(scenario, requested))
    await shutdown(ok ? 0 : 1)
    return ok ? 0 : 1
  }

  printBanner(psqlUrl)
  const session = repl.start({ prompt: 'caja> ' })
  session.context.scenario = scenario
  session.context.run = (name: string) => track(runNamedScenario(scenario, name))
  session.context.help = () => printBanner(psqlUrl)
  session.on('exit', () => {
    void shutdown(0)
  })
  process.once('SIGINT', () => {
    void shutdown(130)
  })
  process.once('SIGTERM', () => {
    void shutdown(143)
  })
  return 0
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code)
  })
  .catch((error: unknown) => {
    console.error(
      `caja simulator failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
