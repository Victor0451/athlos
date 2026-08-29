import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as allocations from './allocations.ts'
import {
  recordReversalSettlementTenderInTransaction,
  recordSettlementTenderInTransaction,
  validateSettlementShiftInTransaction,
} from './cash-desk.ts'
import type { AuditContext } from './service.ts'

export { MAX_MONEY_CENTS } from './allocations.ts'

type DuesDb = Db | allocations.DuesDb
type Json = Record<string, unknown>
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Repository = Partial<
  Pick<
    typeof allocations,
    | 'claimSettlement'
    | 'findSettlementReplay'
    | 'findReversibleSettlement'
    | 'insertAllocation'
    | 'findAllocation'
    | 'getDebt'
    | 'selectFullOutstanding'
  >
>
type Dependencies = {
  repository?: Repository
  audit?: AuditEmitter
  now?: () => Date
  cash?: typeof recordReversalSettlementTenderInTransaction
}

export type SettlementCommand = AuditContext & {
  socioId: string
  kind: allocations.SettlementKind
  amountCents: number
  currency: string
  evidence: Json
  reason?: string
  allocations: Array<{ obligationId: string; amountCents: number }>
}
export type FullSelectionTender = 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'
export type FullSelectionPaymentCommand = AuditContext & {
  socioId: string
  obligationIds: string[]
  shiftId: string
  tender: FullSelectionTender
  selectionFingerprint: string
}
export type FullSelectionPaymentPreparation = {
  command: FullSelectionPaymentCommand
  selection: allocations.FullOutstandingSelection
}
export type ReverseSettlementCommand = AuditContext & {
  settlementId: string
  reason: string
  allocationId?: string
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fullSelectionTenders = new Set<FullSelectionTender>(['CASH', 'DEBIT', 'CREDIT', 'TRANSFER'])

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
  private readonly cash: typeof recordReversalSettlementTenderInTransaction

  constructor(
    private readonly db: Db,
    dependencies: Dependencies = {},
  ) {
    this.repository = dependencies.repository ?? {}
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
    this.cash = dependencies.cash ?? recordReversalSettlementTenderInTransaction
  }

  async create(input: SettlementCommand | FullSelectionPaymentCommand): Promise<SettlementResult> {
    if ('tender' in input) return this.createFullSelectionPayment(input)
    if (input.kind === 'MONETARY')
      throw BusinessError(ErrorCode.NOT_FOUND, 'Monetary settlement creation is unavailable')
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

  private async createFullSelectionPayment(
    input: FullSelectionPaymentCommand,
  ): Promise<SettlementResult> {
    const allowed = new Set([
      'actorId',
      'role',
      'permissions',
      'sourceIp',
      'callerKey',
      'requestFingerprint',
      'authorizationEvidence',
      'socioId',
      'obligationIds',
      'shiftId',
      'tender',
      'selectionFingerprint',
    ])
    if (
      Object.keys(input).some((key) => !allowed.has(key)) ||
      !uuidPattern.test(input.socioId) ||
      !uuidPattern.test(input.shiftId) ||
      !/^[a-f0-9]{64}$/.test(input.selectionFingerprint) ||
      !fullSelectionTenders.has(input.tender) ||
      !input.obligationIds.length ||
      input.obligationIds.some((id) => !uuidPattern.test(id)) ||
      new Set(input.obligationIds).size !== input.obligationIds.length
    )
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Full selection payment command is invalid')
    authorize(input.role)
    const command = { ...input, obligationIds: [...input.obligationIds].sort() }
    return this.db.transaction(async (tx) => {
      const replay = await (
        this.repository.findSettlementReplay ?? allocations.findSettlementReplay
      )(tx, command.actorId, command.callerKey, command.requestFingerprint)
      if (replay) return result(replay.settlement, replay.allocations)
      const selection = await (
        this.repository.selectFullOutstanding ?? allocations.selectFullOutstanding
      )(tx, {
        socioId: command.socioId,
        obligationIds: command.obligationIds,
        selectionFingerprint: command.selectionFingerprint,
      })
      await validateSettlementShiftInTransaction(tx, command)
      const claim = await (this.repository.claimSettlement ?? allocations.claimSettlement)(tx, {
        operatorId: command.actorId,
        socioId: command.socioId,
        kind: 'MONETARY',
        amountCents: selection.totalCents,
        currency: selection.currency,
        evidence: {
          shiftId: command.shiftId,
          tender: command.tender,
          selectionFingerprint: command.selectionFingerprint,
        },
        callerKey: command.callerKey,
        requestFingerprint: command.requestFingerprint,
        authorizationEvidence: command.authorizationEvidence,
      })
      if (claim.status === 'replayed') return result(claim.settlement, claim.allocations)
      const created: allocations.AllocationRecord[] = []
      for (const allocation of selection.allocations)
        created.push(
          await (this.repository.insertAllocation ?? allocations.insertAllocation)(tx, {
            settlementId: claim.settlement.id,
            socioId: command.socioId,
            obligationId: allocation.obligationId,
            amountCents: allocation.amountCents,
          }),
        )
      await recordSettlementTenderInTransaction(tx, {
        ...command,
        settlementId: claim.settlement.id,
      })
      const now = this.now().toISOString()
      await record(
        this.audit,
        tx,
        command,
        AuditAction.DUES_SETTLEMENT_CREATED,
        'dues_settlement',
        claim.settlement.id,
        null,
        {
          settlementId: claim.settlement.id,
          kind: 'MONETARY',
          amountCents: selection.totalCents,
          currency: selection.currency,
        },
        now,
      )
      for (const allocation of created)
        await record(
          this.audit,
          tx,
          command,
          AuditAction.DUES_ALLOCATION_CREATED,
          'dues_allocation',
          allocation.id,
          null,
          {
            allocationId: allocation.id,
            settlementId: claim.settlement.id,
            obligationId: allocation.obligationId,
            amountCents: allocation.amountCents,
          },
          now,
        )
      return result(claim.settlement, created)
    })
  }

  async prepareFullSelectionPayment(
    input: FullSelectionPaymentCommand,
  ): Promise<FullSelectionPaymentPreparation> {
    const allowed = new Set([
      'actorId',
      'role',
      'permissions',
      'sourceIp',
      'callerKey',
      'requestFingerprint',
      'authorizationEvidence',
      'socioId',
      'obligationIds',
      'shiftId',
      'tender',
      'selectionFingerprint',
    ])
    if (
      Object.keys(input).some((key) => !allowed.has(key)) ||
      !uuidPattern.test(input.socioId) ||
      !uuidPattern.test(input.shiftId) ||
      !/^[a-f0-9]{64}$/.test(input.selectionFingerprint) ||
      !fullSelectionTenders.has(input.tender) ||
      !input.obligationIds.length ||
      input.obligationIds.some((id) => !uuidPattern.test(id)) ||
      new Set(input.obligationIds).size !== input.obligationIds.length
    )
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Full selection payment command is invalid')
    authorize(input.role)
    const command = { ...input, obligationIds: [...input.obligationIds].sort() }
    return this.db.transaction(async (tx) => ({
      command,
      selection: await (this.repository.selectFullOutstanding ?? allocations.selectFullOutstanding)(
        tx,
        {
          socioId: command.socioId,
          obligationIds: command.obligationIds,
          selectionFingerprint: command.selectionFingerprint,
        },
      ),
    }))
  }

  async reverse(input: ReverseSettlementCommand): Promise<SettlementResult> {
    authorize(input.role)
    if (!input.reason.trim() || !Object.keys(input.authorizationEvidence ?? {}).length)
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A settlement reversal reason is required')

    return this.db.transaction(async (tx) => {
      const original = await (
        this.repository.findReversibleSettlement ?? allocations.findReversibleSettlement
      )(tx, input.settlementId)
      if (!original) throw BusinessError(ErrorCode.NOT_FOUND, 'Settlement not found')
      const total = original.allocations.reduce((sum, item) => sum + item.amountCents, 0)
      if (
        original.kind !== 'MONETARY' ||
        original.reversalOfSettlementId ||
        !original.allocations.length ||
        total !== original.amountCents ||
        original.allocations.some(
          (item) => item.kind !== 'ALLOCATION' || item.compensatesAllocationId,
        )
      )
        throw BusinessError(ErrorCode.CONFLICT, 'Settlement is not eligible for reversal')
      let claim: allocations.SettlementClaim
      try {
        claim = await (this.repository.claimSettlement ?? allocations.claimSettlement)(tx, {
          operatorId: input.actorId,
          socioId: original.socioId,
          kind: original.kind,
          amountCents: original.amountCents,
          currency: original.currency,
          evidence: { reversalOfSettlementId: original.id },
          reason: input.reason,
          reversalOfSettlementId: original.id,
          callerKey: input.callerKey,
          requestFingerprint: input.requestFingerprint,
          authorizationEvidence: input.authorizationEvidence,
        })
      } catch (error) {
        if (isConstraint(error, 'dues_settlements_reversal_of_settlement_unique'))
          throw BusinessError(ErrorCode.CONFLICT, 'Settlement was already reversed')
        throw error
      }
      if (claim.status === 'replayed') return result(claim.settlement, claim.allocations)

      const compensations: allocations.AllocationRecord[] = []
      try {
        for (const originalAllocation of original.allocations)
          compensations.push(
            await (this.repository.insertAllocation ?? allocations.insertAllocation)(tx, {
              settlementId: claim.settlement.id,
              socioId: original.socioId,
              obligationId: originalAllocation.obligationId,
              amountCents: originalAllocation.amountCents,
              kind: 'COMPENSATION',
              compensatesAllocationId: originalAllocation.id,
              reason: input.reason,
            }),
          )
      } catch (error) {
        if (isConstraint(error, 'dues_allocations_compensation_unique'))
          throw BusinessError(ErrorCode.CONFLICT, 'Settlement was already reversed')
        throw error
      }
      await this.cash(tx, {
        ...input,
        settlementId: claim.settlement.id,
        originalSettlementId: original.id,
      })
      const now = this.now().toISOString()
      await record(
        this.audit,
        tx,
        input,
        AuditAction.DUES_SETTLEMENT_REVERSED,
        'dues_settlement',
        claim.settlement.id,
        null,
        {
          settlementId: claim.settlement.id,
          amountCents: claim.settlement.amountCents,
          currency: claim.settlement.currency,
        },
        now,
        { reason: input.reason },
      )
      for (const compensation of compensations)
        await record(
          this.audit,
          tx,
          input,
          AuditAction.DUES_ALLOCATION_COMPENSATED,
          'dues_allocation',
          compensation.id,
          null,
          {
            allocationId: compensation.id,
            settlementId: claim.settlement.id,
            obligationId: compensation.obligationId,
            amountCents: compensation.amountCents,
          },
          now,
        )
      return result(claim.settlement, compensations)
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
