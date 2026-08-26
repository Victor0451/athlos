import { expect, it, vi, type Mock } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { getDebt } from './allocations.ts'
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
it('rejects legacy monetary settlement commands before persistence',async()=>{const repository={claimSettlement:vi.fn(),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit}); await expect(service.create({...context,role:'OPERADOR',socioId:'socio-1',kind:'MONETARY',amountCents:1_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1_000}]})).rejects.toMatchObject({code:ErrorCode.NOT_FOUND}); expect(repository.claimSettlement).not.toHaveBeenCalled()})
// prettier-ignore
it('rejects allocations that exceed the settlement value before claiming it',async()=>{const repository={claimSettlement:vi.fn(),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit}); await expect(service.create({...context,socioId:'socio-1',kind:'MONETARY',amountCents:1_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1_001}]})).rejects.toMatchObject({code:ErrorCode.NOT_FOUND}); expect(repository.claimSettlement).not.toHaveBeenCalled()})
// prettier-ignore
it('rejects duplicate legacy monetary allocations before claiming',async()=>{const repository={claimSettlement:vi.fn(),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit});await expect(service.create({...context,socioId:'socio-1',kind:'MONETARY',amountCents:2_000,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1_000},{obligationId:'obligation-1',amountCents:1_000}]})).rejects.toMatchObject({code:ErrorCode.NOT_FOUND});expect(repository.claimSettlement).not.toHaveBeenCalled()})
// prettier-ignore
it('rejects legacy monetary settlement before transaction, repository, or audit',async()=>{const database=db() as {transaction:Mock},repository={claimSettlement:vi.fn()},audit=auditLog(),service=new SettlementService(database as never,{repository,audit:audit.emit});await expect(service.create({...context,socioId:'socio-1',kind:'MONETARY',amountCents:1,currency:'ARS',evidence:{},allocations:[{obligationId:'obligation-1',amountCents:1}]})).rejects.toMatchObject({code:ErrorCode.NOT_FOUND});expect(database.transaction).not.toHaveBeenCalled();expect(repository.claimSettlement).not.toHaveBeenCalled();expect(audit.records).toEqual([])})

it('persists privacy-safe snapshots and reversal reason through the emitter fields', async () => {
  const audit = auditLog()
  const repository = {
    claimSettlement: vi.fn().mockResolvedValue({
      status: 'claimed',
      settlement: {
        id: 'settlement-1',
        socioId: 'socio-1',
        kind: 'NON_CASH',
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
    kind: 'NON_CASH',
    amountCents: 2_000,
    currency: 'ARS',
    evidence: { private: 'must-not-be-audited' },
    reason: 'Approved non-cash settlement',
    allocations: [{ obligationId: 'obligation-1', amountCents: 2_000 }],
  })

  expect(audit.records).toHaveLength(2)
  expect(audit.records[0]).toMatchObject({
    action: AuditAction.DUES_SETTLEMENT_CREATED,
    oldValue: null,
    newValue: {
      settlementId: 'settlement-1',
      kind: 'NON_CASH',
      amountCents: 2_000,
      currency: 'ARS',
    },
  })
  expect(audit.records[0]).not.toHaveProperty('payload')
  expect(audit.records[0]?.metadata).not.toHaveProperty('evidence')
})

// prettier-ignore
it('reverses every original allocation under one linked settlement',async()=>{const repository={findReversibleSettlement:vi.fn().mockResolvedValue({id:'settlement-1',socioId:'socio-1',kind:'MONETARY',amountCents:3_000,currency:'ARS',reversalOfSettlementId:null,allocations:[{id:'allocation-1',obligationId:'obligation-1',amountCents:1_000,kind:'ALLOCATION',compensatesAllocationId:null},{id:'allocation-2',obligationId:'obligation-2',amountCents:2_000,kind:'ALLOCATION',compensatesAllocationId:null}]}),claimSettlement:vi.fn().mockResolvedValue({status:'claimed',settlement:{id:'reversal-1',socioId:'socio-1',kind:'MONETARY',amountCents:3_000,currency:'ARS',reversalOfSettlementId:'settlement-1'}}),insertAllocation:vi.fn(async(_:unknown,input:{obligationId:string;amountCents:number;compensatesAllocationId:string})=>({id:`compensation-${input.obligationId}`,settlementId:'reversal-1',kind:'COMPENSATION',...input}))},service=new SettlementService(db(),{repository:repository as never,audit:auditLog().emit,cash:async()=>({}as never)});await expect(service.reverse({...context,role:'TESORERO',authorizationEvidence:{approval:'ticket-1'},settlementId:'settlement-1',reason:'Incorrect payment'} as never)).resolves.toMatchObject({settlementId:'reversal-1',amountCents:3_000,allocations:[{compensatesAllocationId:'allocation-1'},{compensatesAllocationId:'allocation-2'}]});expect(repository.insertAllocation).toHaveBeenCalledTimes(2)})

// prettier-ignore
it('emits redacted reversal and compensation audits after a claimed reversal',async()=>{const audit=auditLog(),repository={findReversibleSettlement:vi.fn().mockResolvedValue({id:'settlement-1',socioId:'socio-1',kind:'MONETARY',amountCents:100,currency:'ARS',reversalOfSettlementId:null,allocations:[{id:'allocation-1',obligationId:'obligation-1',amountCents:100,kind:'ALLOCATION',compensatesAllocationId:null}]}),claimSettlement:vi.fn().mockResolvedValue({status:'claimed',settlement:{id:'reversal-1',socioId:'socio-1',kind:'MONETARY',amountCents:100,currency:'ARS',reversalOfSettlementId:'settlement-1'}}),insertAllocation:vi.fn().mockResolvedValue({id:'compensation-1',settlementId:'reversal-1',obligationId:'obligation-1',amountCents:100,kind:'COMPENSATION',compensatesAllocationId:'allocation-1'})},service=new SettlementService(db(),{repository:repository as never,audit:audit.emit,cash:async()=>({}as never)});await service.reverse({...context,settlementId:'settlement-1',reason:'Correction'});expect(audit.records.map(({action})=>action)).toEqual([AuditAction.DUES_SETTLEMENT_REVERSED,AuditAction.DUES_ALLOCATION_COMPENSATED]);expect(JSON.stringify(audit.records)).not.toContain('reversalOfSettlementId')})

// prettier-ignore
it.each([{role:'OPERADOR',authorizationEvidence:{approval:'ticket'},reason:'reason'},{role:'TESORERO',authorizationEvidence:{},reason:'reason'},{role:'TESORERO',authorizationEvidence:{approval:'ticket'},reason:'   '}])('rejects reversal without Treasury authority, evidence, or reason before persistence',async input=>{const repository={findReversibleSettlement:vi.fn()},service=new SettlementService(db(),{repository:repository as never,audit:auditLog().emit});await expect(service.reverse({...context,...input,settlementId:'settlement-1'} as never)).rejects.toMatchObject({code:input.role==='OPERADOR'?ErrorCode.INSUFFICIENT_PERMISSIONS:ErrorCode.VALIDATION_ERROR});expect(repository.findReversibleSettlement).not.toHaveBeenCalled()})

// prettier-ignore
it.each([null,{id:'settlement-1',socioId:'socio-1',kind:'NON_CASH',amountCents:100,currency:'ARS',reversalOfSettlementId:null,allocations:[]},{id:'settlement-1',socioId:'socio-1',kind:'MONETARY',amountCents:100,currency:'ARS',reversalOfSettlementId:'older',allocations:[{id:'a',obligationId:'o',amountCents:100,kind:'ALLOCATION',compensatesAllocationId:null}]}])('rejects an unknown or invalid original settlement',async original=>{const repository={findReversibleSettlement:vi.fn().mockResolvedValue(original),claimSettlement:vi.fn()},service=new SettlementService(db(),{repository:repository as never,audit:auditLog().emit});await expect(service.reverse({...context,settlementId:'settlement-1',reason:'reason'})).rejects.toMatchObject({code:original?ErrorCode.CONFLICT:ErrorCode.NOT_FOUND});expect(repository.claimSettlement).not.toHaveBeenCalled()})

// prettier-ignore
it.each([{status:'replayed',settlement:{id:'reversal-1',socioId:'socio-1',kind:'MONETARY',amountCents:100,currency:'ARS',reversalOfSettlementId:'settlement-1'},allocations:[{id:'c',settlementId:'reversal-1',obligationId:'o',amountCents:100,kind:'COMPENSATION',compensatesAllocationId:'a'}]},{error:{code:'23505',constraint:'dues_settlements_reversal_of_settlement_unique'}}])('replays matching reversal keys and conflicts for an already-reversed settlement',async outcome=>{const repository={findReversibleSettlement:vi.fn().mockResolvedValue({id:'settlement-1',socioId:'socio-1',kind:'MONETARY',amountCents:100,currency:'ARS',reversalOfSettlementId:null,allocations:[{id:'a',obligationId:'o',amountCents:100,kind:'ALLOCATION',compensatesAllocationId:null}]}),claimSettlement:vi.fn().mockImplementation(async()=>{if('error'in outcome)throw outcome.error;return outcome}),insertAllocation:vi.fn()},service=new SettlementService(db(),{repository:repository as never,audit:auditLog().emit});const reversal=service.reverse({...context,settlementId:'settlement-1',reason:'reason'});if('error'in outcome)await expect(reversal).rejects.toMatchObject({code:ErrorCode.CONFLICT});else {await expect(reversal).resolves.toMatchObject({settlementId:'reversal-1'});expect(repository.insertAllocation).not.toHaveBeenCalled()}})

// prettier-ignore
it('requires a non-empty trimmed reversal reason before opening a transaction',async()=>{const repository={findReversibleSettlement:vi.fn(),claimSettlement:vi.fn()},service=new SettlementService(db(),{repository,audit:auditLog().emit});await expect(service.reverse({...context,settlementId:'settlement-1',reason:'   '})).rejects.toMatchObject({code:ErrorCode.VALIDATION_ERROR});expect(repository.findReversibleSettlement).not.toHaveBeenCalled()})

// prettier-ignore

it('prepares a full-selection payment command without monetary fields or writes', async () => {
  const selection = {
    socioId: 'socio-1',
    currency: 'ARS',
    totalCents: 1_000,
    allocations: [{ obligationId: 'obligation-1', amountCents: 1_000 }],
    fingerprint: 'b'.repeat(64),
  }
  const repository = { selectFullOutstanding: vi.fn().mockResolvedValue(selection) }
  const database = db() as { transaction: Mock }
  const service = new SettlementService(database as never, { repository, audit: auditLog().emit })
  const command = {
    ...context,
    socioId: '00000000-0000-4000-8000-000000000001',
    obligationIds: ['00000000-0000-4000-8000-000000000002'],
    shiftId: '00000000-0000-4000-8000-000000000003',
    tender: 'CASH' as const,
    selectionFingerprint: selection.fingerprint,
  }

  await expect(service.prepareFullSelectionPayment(command)).resolves.toEqual({
    command,
    selection,
  })
  expect(repository.selectFullOutstanding).toHaveBeenCalledWith(expect.anything(), {
    socioId: command.socioId,
    obligationIds: command.obligationIds,
    selectionFingerprint: command.selectionFingerprint,
  })
  expect(database.transaction).toHaveBeenCalledOnce()

  await expect(
    service.prepareFullSelectionPayment({ ...command, amountCents: 1_000 } as typeof command),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.selectFullOutstanding).toHaveBeenCalledOnce()
})

// prettier-ignore
it.each([['socioId','not-a-uuid'],['obligationIds',['not-a-uuid']],['shiftId','not-a-uuid'],['tender','CARD']])('rejects invalid full-selection %s before reads or writes',async(field,value)=>{const repository={selectFullOutstanding:vi.fn()},database=db() as {transaction:Mock},service=new SettlementService(database as never,{repository,audit:auditLog().emit}),command={...context,socioId:'00000000-0000-4000-8000-000000000001',obligationIds:['00000000-0000-4000-8000-000000000002'],shiftId:'00000000-0000-4000-8000-000000000003',tender:'CASH' as const,selectionFingerprint:'b'.repeat(64),[field]:value};await expect(service.prepareFullSelectionPayment(command as never)).rejects.toMatchObject({code:ErrorCode.VALIDATION_ERROR});expect(database.transaction).not.toHaveBeenCalled();expect(repository.selectFullOutstanding).not.toHaveBeenCalled()})

// prettier-ignore
it.each(['DEBIT','CREDIT'])('accepts %s as an electronic full-selection tender',async tender=>{const selection={socioId:'socio-1',currency:'ARS',totalCents:1_000,allocations:[],fingerprint:'b'.repeat(64)},repository={selectFullOutstanding:vi.fn().mockResolvedValue(selection)},service=new SettlementService(db(),{repository,audit:auditLog().emit});await expect(service.prepareFullSelectionPayment({...context,socioId:'00000000-0000-4000-8000-000000000001',obligationIds:['00000000-0000-4000-8000-000000000002'],shiftId:'00000000-0000-4000-8000-000000000003',tender,selectionFingerprint:selection.fingerprint} as never)).resolves.toMatchObject({command:{tender}})})

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
  ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  expect(repository.claimSettlement).not.toHaveBeenCalled()
})

// prettier-ignore
it('returns only evidence-backed debt detail fields and links',async()=>{const database={execute:vi.fn().mockResolvedValueOnce({rows:[{exists:true}]}).mockResolvedValueOnce({rows:[{id:'obligation-1',periodStart:'2026-01-01',periodEnd:'2026-02-01',amount:'125.00',outstanding:'100.00',currency:'ARS',components:[{id:'component-1',kind:'BASE',componentKey:'base',amount:'125.00'},{id:'component-2',kind:'BENEFIT',componentKey:'benefit-1',amount:'-25.00'}],allocations:[{id:'allocation-1',settlementId:'settlement-1',settlementKind:'MONETARY',settlementAmount:'25.00',currency:'ARS',amount:'25.00',kind:'ALLOCATION',compensatesAllocationId:null,reversalEligible:true}]}]})};const result=await getDebt(database as never,'socio-1');expect(result).toMatchObject({status:'ready',socioId:'socio-1',currency:'ARS',totalCents:10_000,obligations:[{originalCents:12_500,outstandingCents:10_000,status:'OPEN',components:[{kind:'BASE',amountCents:12_500},{kind:'BENEFIT',amountCents:-2_500}],benefits:[{componentKey:'benefit-1',amountCents:-2_500}],allocations:[{settlementId:'settlement-1',amountCents:2_500,reversalEligible:true}]}]});expect(JSON.stringify(result)).not.toMatch(/audit|authorization|evidence/i)})

// prettier-ignore
it('distinguishes an unknown socio and maps read failures to unavailable',async()=>{
  const unknown = { execute: vi.fn().mockResolvedValueOnce({ rows: [{ exists: false }] }) }
  await expect(getDebt(unknown as never, 'missing-socio')).resolves.toMatchObject({
    status: 'not_found',
    obligations: [],
  })

  const unavailable = { execute: vi.fn().mockRejectedValue(new Error('database offline')) }
  await expect(getDebt(unavailable as never, 'socio-1')).rejects.toMatchObject({
    code: ErrorCode.SERVICE_UNAVAILABLE,
  })
})

// prettier-ignore
it('denies debt reads outside finance roles before repository access',async()=>{
  const repository = { getDebt: vi.fn() }
  const service = new SettlementService(db(), { repository, audit: auditLog().emit })

  await expect(service.debt({ role: 'OPERADOR', socioId: 'socio-1' })).rejects.toMatchObject({
    code: ErrorCode.INSUFFICIENT_PERMISSIONS,
  })
  expect(repository.getDebt).not.toHaveBeenCalled()
})
