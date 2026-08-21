import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as allocations from './allocations.ts'
import type { AuditContext } from './service.ts'

export { MAX_MONEY_CENTS } from './allocations.ts'

type DuesDb = Db | allocations.DuesDb
type Json = Record<string, unknown>
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Repository = Partial<
  Pick<typeof allocations, 'claimSettlement' | 'insertAllocation' | 'findAllocation' | 'getDebt'>
>
type Dependencies = { repository?: Repository; audit?: AuditEmitter; now?: () => Date }

export type SettlementCommand = AuditContext & {
  socioId: string
  kind: allocations.SettlementKind
  amountCents: number
  currency: string
  evidence: Json
  reason?: string
  allocations: Array<{ obligationId: string; amountCents: number }>
}
export type ReverseSettlementCommand = AuditContext & {
  settlementId: string
  allocationId: string
  reason: string
}
export type DebtCommand = Pick<AuditContext, 'role'> & { socioId: string }
export type SettlementResult = {
  settlementId: string
  kind: allocations.SettlementKind
  amountCents: number
  currency: string
  allocations: allocations.AllocationRecord[]
}

const authorize = (role: AuditContext['role']) => {
  if (role !== 'ADMIN' && role !== 'TESORERO')
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Settlement action is not authorized')
}

const auditMetadata = (input: AuditContext, now: string, extra: Json = {}) => ({
  actorId: input.actorId,
  role: input.role,
  permissions: input.permissions,
  authorizationEvidence: { role: input.role, permissions: input.permissions },
  callerKey: input.callerKey,
  requestFingerprint: input.requestFingerprint,
  time: now,
  ...extra,
})

const record = (
  audit: AuditEmitter,
  db: DuesDb,
  input: AuditContext,
  action: string,
  entityType: string,
  entityId: string,
  oldValue: Json | null,
  newValue: Json | null,
  now: string,
  extraMetadata: Json = {},
) =>
  audit(db, {
    action,
    operatorId: input.actorId,
    entityType,
    entityId,
    oldValue,
    newValue,
    sourceIp: input.sourceIp,
    callerKey: input.callerKey,
    metadata: auditMetadata(input, now, extraMetadata),
  })

const isConstraint = (error: unknown, constraint: string) => {
  const value = error as { code?: string; constraint?: string }
  return value?.code === '23505' && value.constraint === constraint
}

const isAllocationBalanceConstraint = (error: unknown) => {
  const value = error as { code?: string; constraint?: string }
  return (
    value?.code === '23514' &&
    (value.constraint === 'dues_allocations_obligation_amount_check' ||
      value.constraint === 'dues_allocations_settlement_amount_check')
  )
}

const result = (
  settlement: allocations.SettlementRecord,
  items: allocations.AllocationRecord[],
): SettlementResult => ({
  settlementId: settlement.id,
  kind: settlement.kind,
  amountCents: settlement.amountCents,
  currency: settlement.currency,
  allocations: items,
})

export class SettlementService {
  private readonly repository: Repository
  private readonly audit: AuditEmitter
  private readonly now: () => Date

  constructor(
    private readonly db: Db,
    dependencies: Dependencies = {},
  ) {
    this.repository = dependencies.repository ?? {}
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }

  async create(input: SettlementCommand): Promise<SettlementResult> {
    authorize(input.role)
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > allocations.MAX_MONEY_CENTS ||
      allocations.allocationTotal(input.allocations) > input.amountCents
    )
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'Settlement amount must cover its explicit allocations within the supported money range',
      )
    if (
      input.kind === 'NON_CASH' &&
      (!input.reason?.trim() || Object.keys(input.evidence).length === 0)
    )
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'Non-cash settlements require reason and evidence',
      )

    return this.db.transaction(async (tx) => {
      const claim = await (this.repository.claimSettlement ?? allocations.claimSettlement)(tx, {
        operatorId: input.actorId,
        socioId: input.socioId,
        kind: input.kind,
        amountCents: input.amountCents,
        currency: input.currency,
        evidence: input.evidence,
        ...(input.reason ? { reason: input.reason } : {}),
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
        authorizationEvidence: input.authorizationEvidence,
      })
      if (claim.status === 'replayed') return result(claim.settlement, claim.allocations)

      const created: allocations.AllocationRecord[] = []
      for (const item of input.allocations) {
        try {
          created.push(
            await (this.repository.insertAllocation ?? allocations.insertAllocation)(tx, {
              settlementId: claim.settlement.id,
              socioId: input.socioId,
              obligationId: item.obligationId,
              amountCents: item.amountCents,
            }),
          )
        } catch (error) {
          if (isAllocationBalanceConstraint(error))
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Allocation exceeds the available settlement or obligation balance',
            )
          throw error
        }
      }

      const now = this.now().toISOString()
      await record(
        this.audit,
        tx,
        input,
        AuditAction.DUES_SETTLEMENT_CREATED,
        'dues_settlement',
        claim.settlement.id,
        null,
        {
          settlementId: claim.settlement.id,
          kind: input.kind,
          amountCents: input.amountCents,
          currency: input.currency,
        },
        now,
      )
      for (const item of created)
        await record(
          this.audit,
          tx,
          input,
          AuditAction.DUES_ALLOCATION_CREATED,
          'dues_allocation',
          item.id,
          null,
          {
            allocationId: item.id,
            settlementId: claim.settlement.id,
            obligationId: item.obligationId,
            amountCents: item.amountCents,
          },
          now,
        )
      return result(claim.settlement, created)
    })
  }

  async reverse(input: ReverseSettlementCommand): Promise<SettlementResult> {
    authorize(input.role)
    if (!input.reason.trim())
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A settlement reversal reason is required')

    return this.db.transaction(async (tx) => {
      const original = await (this.repository.findAllocation ?? allocations.findAllocation)(
        tx,
        input.allocationId,
      )
      if (!original) throw BusinessError(ErrorCode.NOT_FOUND, 'Allocation not found')
      if (original.settlementId !== input.settlementId || original.kind !== 'ALLOCATION')
        throw BusinessError(ErrorCode.CONFLICT, 'Allocation does not belong to the settlement')

      const claim = await (this.repository.claimSettlement ?? allocations.claimSettlement)(tx, {
        operatorId: input.actorId,
        socioId: original.socioId,
        kind: original.settlementKind,
        amountCents: original.amountCents,
        currency: original.currency,
        evidence: { compensatesAllocationId: input.allocationId },
        reason: input.reason,
        reversalOfSettlementId: input.settlementId,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
        authorizationEvidence: input.authorizationEvidence,
      })
      if (claim.status === 'replayed') return result(claim.settlement, claim.allocations)

      let compensation: allocations.AllocationRecord
      try {
        compensation = await (this.repository.insertAllocation ?? allocations.insertAllocation)(
          tx,
          {
            settlementId: claim.settlement.id,
            socioId: original.socioId,
            obligationId: original.obligationId,
            amountCents: original.amountCents,
            kind: 'COMPENSATION',
            compensatesAllocationId: original.id,
            reason: input.reason,
          },
        )
      } catch (error) {
        if (isConstraint(error, 'dues_allocations_compensation_unique'))
          throw BusinessError(ErrorCode.CONFLICT, 'Allocation was already reversed')
        throw error
      }

      const now = this.now().toISOString()
      await record(
        this.audit,
        tx,
        input,
        AuditAction.DUES_SETTLEMENT_REVERSED,
        'dues_settlement',
        claim.settlement.id,
        { settlementId: input.settlementId, allocationId: original.id },
        {
          settlementId: claim.settlement.id,
          reversalOfSettlementId: input.settlementId,
          kind: claim.settlement.kind,
          amountCents: claim.settlement.amountCents,
          currency: claim.settlement.currency,
        },
        now,
        { reason: input.reason },
      )
      await record(
        this.audit,
        tx,
        input,
        AuditAction.DUES_ALLOCATION_COMPENSATED,
        'dues_allocation',
        compensation.id,
        {
          allocationId: original.id,
          obligationId: original.obligationId,
          amountCents: original.amountCents,
        },
        {
          allocationId: compensation.id,
          compensatesAllocationId: original.id,
          obligationId: original.obligationId,
          amountCents: compensation.amountCents,
        },
        now,
        { reason: input.reason },
      )
      return result(claim.settlement, [compensation])
    })
  }

  async debt(input: DebtCommand) {
    authorize(input.role)
    try {
      return await (this.repository.getDebt ?? allocations.getDebt)(this.db, input.socioId)
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Debt detail is unavailable')
    }
  }
}
