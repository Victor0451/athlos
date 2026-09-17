import { randomUUID } from 'node:crypto'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { CommunityWorkExecutionService } from './community-work-execution.ts'
import { CommunityWorkService } from './community-work.ts'
import { selectFullOutstanding } from './allocations.ts'
import {
  approverId,
  bootstrapCommunityWorkExecutionDb,
  count,
  db,
  executionCommand,
  fixtureObligation,
  insertWorkToken,
  obligationCounts,
  requesterId,
  teardownCommunityWorkExecutionDb,
} from './community-work-execution.postgres.test-support.ts'

beforeAll(bootstrapCommunityWorkExecutionDb, 60_000)

afterAll(teardownCommunityWorkExecutionDb, 60_000)

const directCommand = (fixture: { socioId: string; obligationId: string }) => ({
  actorId: requesterId,
  role: 'TESORERO' as const,
  permissions: ['dues:settle'],
  sourceIp: '127.0.0.1',
  callerKey: `direct-${randomUUID()}`,
  requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  authorizationEvidence: { role: 'TESORERO', permission: 'dues:settle' },
  socioId: fixture.socioId,
  obligationId: fixture.obligationId,
  amountCents: 10_000,
  evidence: { source: 'direct-finance-race' },
  reason: 'Direct settlement race',
})
const conflicts = (reason: unknown) => (reason as { code?: string }).code === ErrorCode.CONFLICT
const executionRowsFor = (tokenId: string) =>
  count(
    'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
    [tokenId],
  )
const executedAuditsFor = (executionId: string) =>
  count(
    `SELECT count(*)::int AS count FROM audit_events WHERE action='COMMUNITY_WORK_EXECUTED' AND entity_id=$1`,
    [executionId],
  )

it('elects exactly one winner when two approvals race the same obligation', async () => {
  const fixture = await fixtureObligation()
  const first = await insertWorkToken(fixture)
  const second = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const outcomes = await Promise.allSettled([
    service.executeApproved(executionCommand(first)),
    service.executeApproved(executionCommand(second)),
  ])
  const winners = outcomes.filter((o) => o.status === 'fulfilled')
  const losers = outcomes.filter((o) => o.status === 'rejected')
  expect(winners).toHaveLength(1)
  expect(losers).toHaveLength(1)
  expect((winners[0] as PromiseFulfilledResult<{ status: string }>).value.status).toBe('executed')
  expect(conflicts((losers[0] as PromiseRejectedResult).reason)).toBe(true)
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(await executionRowsFor(first.id)).toBe(1)
  expect(await executionRowsFor(second.id)).toBe(0)
  expect(await executedAuditsFor(first.execution_id)).toBe(1)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id IN ($1,$2) AND used_at IS NOT NULL',
      [first.id, second.id],
    ),
  ).toBe(1)
})

it('serializes a direct settlement racing the executor and never double-spends', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const direct = new CommunityWorkService(db.db)
  const outcomes = await Promise.allSettled([
    service.executeApproved(executionCommand(token)),
    direct.create(directCommand(fixture)),
  ])
  const winners = outcomes.filter((o) => o.status === 'fulfilled')
  expect(winners).toHaveLength(1)
  const winnerValue = (winners[0] as PromiseFulfilledResult<{ status?: string }>).value
  const executorWon = winnerValue.status === 'executed'
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(await executionRowsFor(token.id)).toBe(executorWon ? 1 : 0)
  expect(await executedAuditsFor(token.execution_id)).toBe(executorWon ? 1 : 0)
  const outstanding = await count(
    `SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1`,
    [fixture.obligationId],
  )
  expect(outstanding).toBe(1)
})

it('replays one receipt for duplicate concurrent retries of the same execution identity', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const command = executionCommand(token)
  const outcomes = await Promise.allSettled([
    service.executeApproved(command),
    service.executeApproved(command),
  ])
  expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true)
  const statuses = outcomes.map(
    (o) => (o as PromiseFulfilledResult<{ status: string }>).value.status,
  )
  expect(statuses.sort()).toEqual(['executed', 'replayed'])
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(await executionRowsFor(token.id)).toBe(1)
  expect(await executedAuditsFor(token.execution_id)).toBe(1)
})

it('rejects a foreign execution identity while the rightful one wins', async () => {
  const fixture = await fixtureObligation()
  const rightful = await insertWorkToken(fixture)
  const foreign = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const foreignCommand = {
    ...executionCommand(foreign),
    executionId: rightful.execution_id,
  }
  const outcomes = await Promise.allSettled([
    service.executeApproved(executionCommand(rightful)),
    service.executeApproved(foreignCommand),
  ])
  const fulfilled = outcomes.find((o) => o.status === 'fulfilled') as PromiseFulfilledResult<{
    status: string
    requestId: string
  }>
  expect(fulfilled.value.status).toBe('executed')
  expect(fulfilled.value.requestId).toBe(rightful.action_id)
  const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult
  expect(conflicts(rejected.reason)).toBe(true)
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(await executionRowsFor(rightful.id)).toBe(1)
  expect(await executionRowsFor(foreign.id)).toBe(0)
  expect(await executedAuditsFor(rightful.execution_id)).toBe(1)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id IN ($1,$2) AND used_at IS NOT NULL',
      [rightful.id, foreign.id],
    ),
  ).toBe(1)
})

it('rolls back cleanly on a serialization failure and recovers on retry', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  let outstandingCalls = 0
  const flaky = new CommunityWorkExecutionService(db.db, {
    repository: {
      outstanding: async (tx, socioId, obligationId) => {
        outstandingCalls += 1
        if (outstandingCalls === 1) {
          throw Object.assign(new Error('serialization failure'), { code: '40001' })
        }
        const selected = await selectFullOutstanding(tx, { socioId, obligationIds: [obligationId] })
        const target = selected.allocations.find((i) => i.obligationId === obligationId)
        return target
          ? { currency: selected.currency, outstandingAmountCents: target.amountCents }
          : null
      },
    },
  })
  const command = executionCommand(token)
  await expect(flaky.executeApproved(command)).rejects.toThrow('serialization failure')
  expect(outstandingCalls).toBe(1)
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(await executionRowsFor(token.id)).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
  expect(await executedAuditsFor(token.execution_id)).toBe(0)
  const retry = await flaky.executeApproved({ ...command, callerKey: `retry-${randomUUID()}` })
  expect(retry.status).toBe('executed')
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(approverId).toBeTruthy()
})
