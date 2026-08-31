import type { Db } from '@athlos/db'
import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit } from '@athlos/audit'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { selectFullOutstanding, type DuesDb } from './allocations.ts'

type Treatment = { obligationId: string; amountCents: number }
type Receipt = {
  executionId: string
  approvalId: string
  memberId: string
  actorId: string
  currency: string
  totalAmountCents: number
  treatments: Treatment[]
  treatmentIds: string[]
}
type Approval = {
  id: string
  actionId: string
  status: string
  usedAt: Date | null
  expiresAt: Date
  executionId: string | null
  decidedByOperatorId: string | null
  condonationSnapshot: {
    memberId: string
    obligations: Array<{ obligationId: string; currency: string; outstandingAmountCents: number }>
  } | null
  requestReason: string | null
  requestEvidence: string | null
  decisionReason: string | null
  decisionEvidence: string | null
}
type Current = { memberId: string; currency: string; treatments: Treatment[] }
export type CondonationExecutionCommand = {
  executionId: string
  actorId: string
  memberId: string
  obligationIds: string[]
}
export type CondonationExecutionResult = Receipt & { status: 'executed' | 'replayed' }
export type ApprovedCondonationExecutionCommand = {
  requestId: string
  executionId: string
  actorId: string
  callerKey: string
  sourceIp: string | null
}
export type CondonationRepository = {
  findReceipt(db: DuesDb, executionId: string): Promise<Receipt | null>
  lockApproval(db: DuesDb, executionId: string): Promise<Approval | null>
  lockOutstanding(db: DuesDb, command: CondonationExecutionCommand): Promise<Current>
  appendReceipt(
    db: DuesDb,
    receipt: Receipt & {
      snapshot: Approval['condonationSnapshot']
      reason: string
      evidence: string
    },
  ): Promise<Receipt>
  appendTreatments(
    db: DuesDb,
    receipt: Receipt & {
      snapshot: Approval['condonationSnapshot']
      reason: string
      evidence: string
    },
  ): Promise<string[]>
  consumeApproval(db: DuesDb, approvalId: string): Promise<boolean>
}

const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const money = (cents: number) => (cents / 100).toFixed(2)
const ordered = (items: Treatment[]) =>
  [...items].sort((a, b) => a.obligationId.localeCompare(b.obligationId))
const same = (left: Treatment[], right: Treatment[]) =>
  JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))
const conflict = (message: string): never => {
  throw BusinessError(ErrorCode.CONFLICT, message)
}

async function findReceipt(db: DuesDb, executionId: string): Promise<Receipt | null> {
  const row = rows<{
    executionId: string
    approvalId: string
    memberId: string
    actorId: string
    currency: string
    totalAmount: string
    treatments: Array<Treatment & { treatmentId: string }>
  }>(
    await db.execute(
      sql`SELECT e.execution_id AS "executionId",e.approval_token_id AS "approvalId",e.socio_id AS "memberId",e.actor_id AS "actorId",btrim(e.currency) AS currency,e.total_amount::text AS "totalAmount",COALESCE(jsonb_agg(jsonb_build_object('treatmentId',t.id,'obligationId',t.obligation_id,'amountCents',(t.amount*100)::integer) ORDER BY t.obligation_id) FILTER (WHERE t.id IS NOT NULL),'[]'::jsonb) AS treatments FROM tesoreria.dues_condonation_executions e LEFT JOIN tesoreria.dues_condonation_treatments t ON t.execution_id=e.execution_id WHERE e.execution_id=${executionId} GROUP BY e.execution_id,e.approval_token_id,e.socio_id,e.actor_id,e.currency,e.total_amount`,
    ),
  )[0]
  return row
    ? {
        ...row,
        totalAmountCents: Math.round(Number(row.totalAmount) * 100),
        treatments: row.treatments.map(({ treatmentId: _id, ...treatment }) => treatment),
        treatmentIds: row.treatments.map((treatment) => treatment.treatmentId),
      }
    : null
}
async function lockApproval(db: DuesDb, executionId: string): Promise<Approval | null> {
  return (
    rows<Approval>(
      await db.execute(
        sql`SELECT id,action_id AS "actionId",status,used_at AS "usedAt",expires_at AS "expiresAt",execution_id AS "executionId",decided_by_operator_id AS "decidedByOperatorId",condonation_snapshot AS "condonationSnapshot",request_reason AS "requestReason",request_evidence AS "requestEvidence",decision_reason AS "decisionReason",decision_evidence AS "decisionEvidence" FROM approval_tokens WHERE action_type='dues.condonation' AND execution_id=${executionId} FOR UPDATE`,
      ),
    )[0] ?? null
  )
}
async function lockOutstanding(db: DuesDb, command: CondonationExecutionCommand): Promise<Current> {
  const selected = await selectFullOutstanding(db, {
    socioId: command.memberId,
    obligationIds: command.obligationIds,
  })
  return {
    memberId: command.memberId,
    currency: selected.currency,
    treatments: selected.allocations,
  }
}
async function appendReceipt(
  db: DuesDb,
  receipt: Receipt & {
    snapshot: Approval['condonationSnapshot']
    reason: string
    evidence: string
  },
) {
  const inserted = rows<{ executionId: string }>(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_condonation_executions (execution_id,approval_token_id,socio_id,actor_id,currency,total_amount,approved_snapshot,reason,evidence) VALUES (${receipt.executionId},${receipt.approvalId},${receipt.memberId},${receipt.actorId},${receipt.currency},${money(receipt.totalAmountCents)},${JSON.stringify(receipt.snapshot)}::jsonb,${receipt.reason},${receipt.evidence}) RETURNING execution_id AS "executionId"`,
    ),
  )[0]
  if (!inserted) conflict('Condonation execution receipt was not created')
  return receipt
}
async function appendTreatments(
  db: DuesDb,
  receipt: Receipt & {
    snapshot: Approval['condonationSnapshot']
    reason: string
    evidence: string
  },
) {
  return rows<{ treatmentId: string }>(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_condonation_treatments (execution_id,approval_token_id,socio_id,obligation_id,actor_id,amount,currency,approved_snapshot,reason,evidence) VALUES ${sql.join(
        ordered(receipt.treatments).map(
          (treatment) =>
            sql`(${receipt.executionId},${receipt.approvalId},${receipt.memberId},${treatment.obligationId},${receipt.actorId},${money(treatment.amountCents)},${receipt.currency},${JSON.stringify(receipt.snapshot)}::jsonb,${receipt.reason},${receipt.evidence})`,
        ),
        sql`,`,
      )} RETURNING id AS "treatmentId"`,
    ),
  ).map((row) => row.treatmentId)
}
async function consumeApproval(db: DuesDb, approvalId: string) {
  return (
    rows(
      await db.execute(
        sql`UPDATE approval_tokens SET used_at=now() WHERE id=${approvalId} AND used_at IS NULL RETURNING id`,
      ),
    ).length === 1
  )
}
const repository: CondonationRepository = {
  findReceipt,
  lockApproval,
  lockOutstanding,
  appendReceipt,
  appendTreatments,
  consumeApproval,
}

export class CondonationExecutionService {
  private readonly repository: CondonationRepository
  constructor(
    private readonly db: Db,
    dependencies: { repository?: CondonationRepository } = {},
  ) {
    this.repository = dependencies.repository ?? repository
  }
  async execute(command: CondonationExecutionCommand): Promise<CondonationExecutionResult> {
    return this.db.transaction((tx) => this.executeInTransaction(tx, command))
  }
  async executeApproved(
    command: ApprovedCondonationExecutionCommand,
  ): Promise<CondonationExecutionResult> {
    if (!command.requestId || !command.executionId || !command.actorId || !command.callerKey)
      conflict('Condonation execution identity is required')
    return this.db.transaction(async (tx) => {
      const approval = await this.repository.lockApproval(tx, command.executionId)
      if (!approval)
        throw BusinessError(ErrorCode.CONFLICT, 'Condonation approval is not executable')
      if (approval.actionId !== command.requestId)
        conflict('Condonation approval is not executable')
      const snapshot = approval.condonationSnapshot
      if (!snapshot)
        throw BusinessError(ErrorCode.CONFLICT, 'Condonation approval is not executable')
      const result = await this.executeInTransaction(
        tx,
        {
          executionId: command.executionId,
          actorId: command.actorId,
          memberId: snapshot.memberId,
          obligationIds: snapshot.obligations.map((item) => item.obligationId),
        },
        approval,
      )
      if (result.status === 'executed') {
        const emitted = await emitAudit(tx, {
          operatorId: command.actorId,
          action: AuditAction.CONDONATION_EXECUTED,
          entityType: 'condonation_execution',
          entityId: result.executionId,
          oldValue: { debt_amount_cents: result.totalAmountCents },
          newValue: { debt_amount_cents: 0 },
          sourceIp: command.sourceIp,
          callerKey: command.callerKey,
          metadata: {
            request_id: command.requestId,
            approval_id: result.approvalId,
            execution_id: result.executionId,
            actor_id: command.actorId,
            approved_snapshot: snapshot,
            approval_reason: approval.decisionReason,
            approval_evidence: approval.decisionEvidence,
            idempotency_key: command.callerKey,
          },
        })
        if (!emitted.inserted) throw new Error('condonation execution audit event was not inserted')
      }
      return result
    })
  }
  private async executeInTransaction(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    command: CondonationExecutionCommand,
    lockedApproval?: Approval | null,
  ): Promise<CondonationExecutionResult> {
    const targetIds = [...command.obligationIds].sort()
    if (
      !command.executionId ||
      !command.actorId ||
      !command.memberId ||
      !targetIds.length ||
      new Set(targetIds).size !== targetIds.length
    )
      conflict('Condonation execution identity and targets are required')
    const replay = await this.repository.findReceipt(tx, command.executionId)
    if (replay) return this.replay(replay, command, targetIds)
    const approval = lockedApproval ?? (await this.repository.lockApproval(tx, command.executionId))
    if (!approval) throw BusinessError(ErrorCode.CONFLICT, 'Condonation approval is not executable')
    if (
      approval.status !== 'approved' ||
      approval.usedAt ||
      approval.expiresAt <= new Date() ||
      approval.executionId !== command.executionId ||
      approval.decidedByOperatorId !== command.actorId
    )
      conflict('Condonation approval is not executable')
    const snapshot = approval.condonationSnapshot
    if (!snapshot) throw BusinessError(ErrorCode.CONFLICT, 'Condonation approval is not executable')
    const afterLockReplay = await this.repository.findReceipt(tx, command.executionId)
    if (afterLockReplay) return this.replay(afterLockReplay, command, targetIds)
    const current = await this.repository.lockOutstanding(tx, {
      ...command,
      obligationIds: targetIds,
    })
    const expected = ordered(
      snapshot.obligations.map(({ obligationId, outstandingAmountCents }) => ({
        obligationId,
        amountCents: outstandingAmountCents,
      })),
    )
    if (
      snapshot.memberId !== command.memberId ||
      !same(expected, current.treatments) ||
      !same(
        expected,
        targetIds.map((obligationId) => ({
          obligationId,
          amountCents:
            expected.find((item) => item.obligationId === obligationId)?.amountCents ?? 0,
        })),
      ) ||
      current.memberId !== command.memberId ||
      snapshot.obligations.some((item) => item.currency !== current.currency)
    )
      conflict('Condonation approval snapshot is stale or ineligible')
    const receipt = {
      executionId: command.executionId,
      approvalId: approval.id,
      memberId: command.memberId,
      actorId: command.actorId,
      currency: current.currency,
      totalAmountCents: expected.reduce((sum, item) => sum + item.amountCents, 0),
      treatments: expected,
      treatmentIds: [],
      snapshot,
      reason: approval.requestReason ?? '',
      evidence: approval.requestEvidence ?? '',
    }
    const saved = await this.repository.appendReceipt(tx, receipt)
    const treatmentIds = await this.repository.appendTreatments(tx, receipt)
    if (!(await this.repository.consumeApproval(tx, approval.id)))
      conflict('Condonation approval was consumed concurrently')
    return { ...saved, treatmentIds, status: 'executed' }
  }
  private replay(
    receipt: Receipt,
    command: CondonationExecutionCommand,
    targetIds: string[],
  ): CondonationExecutionResult {
    if (
      receipt.memberId !== command.memberId ||
      receipt.actorId !== command.actorId ||
      !same(
        receipt.treatments,
        targetIds.map(
          (obligationId) =>
            receipt.treatments.find((item) => item.obligationId === obligationId) ?? {
              obligationId,
              amountCents: 0,
            },
        ),
      )
    )
      conflict('Condonation execution identity conflicts with its receipt')
    return { ...receipt, status: 'replayed' }
  }
}
