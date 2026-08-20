import { expect, it, vi } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { MAX_MONEY_CENTS, SettlementService } from './settlements.ts'
import type { AuditContext } from './service.ts'

const context: AuditContext = {
  actorId: '00000000-0000-4000-8000-000000000001',
  role: 'ADMIN',
  permissions: ['dues:settle'],
  sourceIp: '127.0.0.1',
  callerKey: 'settlement-1',
  requestFingerprint: 'a'.repeat(64),
  authorizationEvidence: { role: 'ADMIN', permission: 'dues:settle' },
}
const db = () => {
  const tx = {}
  return { transaction: vi.fn(async (work: (value: unknown) => unknown) => work(tx)) } as never
}
const auditLog = () => {
  const records: AuditRecord[] = []
  return {
    records,
    emit: vi.fn(async (_db: unknown, record: AuditRecord) => {
      records.push(record)
      return { inserted: true as const, id: `audit-${records.length}` }
    }),
  }
}

// prettier-ignore
it('creates an explicit non-cash settlement and its allocation atomically',async()=>{const audit=auditLog(),repository={claimSettlement:vi.fn().mockResolvedValue({status:'claimed',settlement:{id:'settlement-1',socioId:'socio-1',kind:'NON_CASH',amountCents:5_000,currency:'ARS'}}),insertAllocation:vi.fn().mockResolvedValue({id:'allocation-1',obligationId:'obligation-2',amountCents:5_000})},service=new SettlementService(db(),{repository,audit:audit.emit}); await expect(service.create({...context,socioId:'socio-1',kind:'NON_CASH',amountCents:5_000,currency:'ARS',evidence:{approval:'fixture'},reason:'Approved settlement',allocations:[{obligationId:'obligation-2',amountCents:5_000}]})).resolves.toMatchObject({settlementId:'settlement-1',kind:'NON_CASH'}); expect(repository.insertAllocation).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({settlementId:'settlement-1',obligationId:'obligation-2',amountCents:5_000})); expect(audit.records.map(({action})=>action)).toEqual([AuditAction.DUES_SETTLEMENT_CREATED,AuditAction.DUES_ALLOCATION_CREATED])})
// prettier-ignore
it('rejects unauthorized settlement commands before persistence',async()=>{const repository={claimSettlement:vi.fn(),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit}); await expect(service.create({...context,role:'OPERADOR',socioId:'socio-1',kind:'MONETARY',amountCents:1_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1_000}]})).rejects.toMatchObject({code:ErrorCode.INSUFFICIENT_PERMISSIONS}); expect(repository.claimSettlement).not.toHaveBeenCalled()})
// prettier-ignore
it('rejects allocations that exceed the settlement value before claiming it',async()=>{const repository={claimSettlement:vi.fn(),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit}); await expect(service.create({...context,socioId:'socio-1',kind:'MONETARY',amountCents:1_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1_001}]})).rejects.toMatchObject({code:ErrorCode.VALIDATION_ERROR}); expect(repository.claimSettlement).not.toHaveBeenCalled()})
// prettier-ignore
it('returns an exact idempotent replay without inserting allocations or audit',async()=>{const audit=auditLog(),repository={claimSettlement:vi.fn().mockResolvedValue({status:'replayed',settlement:{id:'settlement-1',socioId:'socio-1',kind:'MONETARY',amountCents:2_000,currency:'ARS'},allocations:[{id:'allocation-1',obligationId:'obligation-1',amountCents:2_000}]}),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:audit.emit}); await expect(service.create({...context,socioId:'socio-1',kind:'MONETARY',amountCents:2_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:2_000}]})).resolves.toMatchObject({settlementId:'settlement-1',allocations:[{id:'allocation-1'}]}); expect(repository.insertAllocation).not.toHaveBeenCalled(); expect(audit.records).toEqual([])})

it('persists privacy-safe snapshots and reversal reason through the emitter fields', async () => {
  const audit = auditLog()
  const repository = {
    claimSettlement: vi.fn().mockResolvedValue({
      status: 'claimed',
      settlement: {
        id: 'settlement-1',
        socioId: 'socio-1',
        kind: 'MONETARY',
        amountCents: 2_000,
        currency: 'ARS',
        reversalOfSettlementId: null,
      },
    }),
    insertAllocation: vi.fn().mockResolvedValue({
      id: 'allocation-1',
      settlementId: 'settlement-1',
      obligationId: 'obligation-1',
      kind: 'ALLOCATION',
      amountCents: 2_000,
      compensatesAllocationId: null,
    }),
  }
  const service = new SettlementService(db(), { repository, audit: audit.emit })

  await service.create({
    ...context,
    socioId: 'socio-1',
    kind: 'MONETARY',
    amountCents: 2_000,
    currency: 'ARS',
    evidence: { private: 'must-not-be-audited' },
    allocations: [{ obligationId: 'obligation-1', amountCents: 2_000 }],
  })

  expect(audit.records).toHaveLength(2)
  expect(audit.records[0]).toMatchObject({
    action: AuditAction.DUES_SETTLEMENT_CREATED,
    oldValue: null,
    newValue: {
      settlementId: 'settlement-1',
      kind: 'MONETARY',
      amountCents: 2_000,
      currency: 'ARS',
    },
  })
  expect(audit.records[0]).not.toHaveProperty('payload')
  expect(audit.records[0]?.metadata).not.toHaveProperty('evidence')
})

it('maps a duplicate different-key reversal to a domain conflict', async () => {
  const repository = {
    findAllocation: vi.fn().mockResolvedValue({
      id: 'allocation-1',
      settlementId: 'settlement-1',
      obligationId: 'obligation-1',
      socioId: 'socio-1',
      settlementKind: 'MONETARY',
      amountCents: 2_000,
      currency: 'ARS',
      kind: 'ALLOCATION',
      compensatesAllocationId: null,
    }),
    claimSettlement: vi.fn().mockResolvedValue({
      status: 'claimed',
      settlement: {
        id: 'reversal-1',
        socioId: 'socio-1',
        kind: 'MONETARY',
        amountCents: 2_000,
        currency: 'ARS',
      },
    }),
    insertAllocation: vi.fn().mockRejectedValue({
      code: '23505',
      constraint: 'dues_allocations_compensation_unique',
    }),
  }
  const service = new SettlementService(db(), { repository, audit: auditLog().emit })

  await expect(
    service.reverse({
      ...context,
      settlementId: 'settlement-1',
      allocationId: 'allocation-1',
      reason: 'Duplicate correction',
    }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, statusCode: 409 })
})

it('rejects amounts outside PostgreSQL numeric(14,2) bounds', async () => {
  const repository = { claimSettlement: vi.fn(), insertAllocation: vi.fn() }
  const service = new SettlementService(db(), { repository, audit: auditLog().emit })

  await expect(
    service.create({
      ...context,
      socioId: 'socio-1',
      kind: 'MONETARY',
      amountCents: MAX_MONEY_CENTS + 1,
      currency: 'ARS',
      evidence: {},
      allocations: [{ obligationId: 'obligation-1', amountCents: MAX_MONEY_CENTS + 1 }],
    }),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.claimSettlement).not.toHaveBeenCalled()
})
