import { randomUUID } from 'node:crypto'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { CommunityWorkExecutionService } from './community-work-execution.ts'
import { AgreementService } from './agreements.ts'
import {
  bootstrapCommunityWorkExecutionDb,
  count,
  db,
  executionCommand,
  fixtureObligation,
  insertWorkToken,
  obligationCounts,
  executionContext,
  requesterId,
  terms,
  teardownCommunityWorkExecutionDb,
} from './community-work-execution.postgres.test-support.ts'

beforeAll(bootstrapCommunityWorkExecutionDb, 60_000)

afterAll(teardownCommunityWorkExecutionDb, 60_000)

it('executes an approved decision once with exact persisted effects and replays its receipt', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const result = await service.executeApproved(executionCommand(token))
  expect(result).toMatchObject({
    status: 'executed',
    requestId: token.action_id,
    socioId: fixture.socioId,
    obligationId: fixture.obligationId,
    amountCents: 10_000,
    currency: 'ARS',
  })
  expect(result.settlementId).toEqual(expect.any(String))
  expect(result.allocationId).toEqual(expect.any(String))
  expect(result.workId).toEqual(expect.any(String))
  expect(
    await count(
      `SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL`,
      [token.id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1 AND settlement_id IS NOT NULL AND amount_cents=100.00 AND receipt IS NOT NULL`,
      [token.id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action='COMMUNITY_WORK_EXECUTED' AND entity_id=$1`,
      [token.execution_id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action IN ('DUES_SETTLEMENT_CREATED','DUES_ALLOCATION_CREATED','DUES_COMMUNITY_WORK_CREATED')`,
    ),
  ).toBe(3)
  const replay = await service.executeApproved(executionCommand(token))
  expect(replay).toMatchObject({
    status: 'replayed',
    workId: result.workId,
    settlementId: result.settlementId,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(
    await count('SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions'),
  ).toBe(1)
})

it('keeps an expired approval unexecutable and financially inert', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  await db.pool.query(
    `UPDATE approval_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [token.id],
  )
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('detects a stale outstanding snapshot and writes nothing', async () => {
  const fixture = await fixtureObligation(5_000)
  const token = await insertWorkToken(fixture, { frozenAmountCents: 10_000 })
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('revalidates the frozen agreement context at execution time and writes nothing when stale', async () => {
  const fixture = await fixtureObligation()
  const agreements = new AgreementService(db.db)
  const agreement = (
    await agreements.create({
      ...executionContext(),
      socioId: fixture.socioId,
      obligationId: fixture.obligationId,
      kind: 'INSTALLMENT',
      terms: terms(6_000),
      reason: 'Work plan',
    })
  ).agreement
  const missing = await insertWorkToken(fixture, { agreementUuid: randomUUID(), termsVersion: 0 })
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(missing))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  const drifted = await insertWorkToken(fixture, { agreementUuid: agreement.id, termsVersion: 3 })
  await expect(service.executeApproved(executionCommand(drifted))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  const matching = await insertWorkToken(fixture, { agreementUuid: agreement.id, termsVersion: 0 })
  const result = await service.executeApproved(executionCommand(matching))
  expect(result.status).toBe('executed')
  expect(
    await count(
      `SELECT count(*)::int AS count FROM tesoreria.dues_community_work WHERE agreement_id=$1`,
      [agreement.id],
    ),
  ).toBe(1)
})

it('refuses a different deciding actor and writes nothing', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token, requesterId))).rejects.toMatchObject(
    { code: ErrorCode.CONFLICT },
  )
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('rolls back every effect when the execution audit cannot be recorded', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db, {
    audit: async () => {
      throw new Error('audit failure')
    },
  })
  await expect(service.executeApproved(executionCommand(token))).rejects.toThrow('audit failure')
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL`,
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action='COMMUNITY_WORK_EXECUTED' AND entity_id=$1`,
      [token.execution_id],
    ),
  ).toBe(0)
})
