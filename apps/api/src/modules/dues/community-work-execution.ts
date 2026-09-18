import { createHash } from 'node:crypto'
import type { Db } from '@athlos/db'
import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { selectFullOutstanding, type DuesDb } from './allocations.ts'
import {
  CommunityWorkService,
  type CommunityWork,
  type CommunityWorkCommand,
} from './community-work.ts'
import type { AuditContext } from './service.ts'

// prettier-ignore
type CommunityWorkSnapshot = { memberId: string; obligations: Array<{ obligationId: string; currency: string; outstandingAmountCents: number }> }
// prettier-ignore
export type CommunityWorkExecutionReceipt = { executionId: string; approvalId: string; requestId: string; socioId: string; obligationId: string; amountCents: number; currency: string; workId: string; settlementId: string; allocationId: string; requesterKey: string; outstandingBeforeCents: number; outstandingAfterCents: number; executionReceiptId: string }
// prettier-ignore
type LockedCommunityWorkApproval = { id: string; actionId: string; status: string; usedAt: Date | null; expiresAt: Date; executionId: string | null; decidedByOperatorId: string | null; requesterKey: string | null; agreementUuid: string | null; termsVersion: number | null; actorFingerprint: string | null; communitySnapshot: CommunityWorkSnapshot | null; requestReason: string | null; requestEvidence: string | null; decisionReason: string | null }
// prettier-ignore
export type CommunityWorkExecutionCommand = { requestId: string; executionId: string; actorId: string; role: AuditContext['role']; permissions: string[]; callerKey: string; sourceIp: string | null }
export type CommunityWorkExecutionResult = CommunityWorkExecutionReceipt & {
  status: 'executed' | 'replayed'
}
// prettier-ignore
export type CommunityWorkExecutionRepository = { findReceipt(db: DuesDb, approvalId: string): Promise<CommunityWorkExecutionReceipt | null>; lockApproval(db: DuesDb, executionId: string): Promise<LockedCommunityWorkApproval | null>; lockAgreement(db: DuesDb, agreementId: string): Promise<{ termsVersion: number } | null>; outstanding(db: DuesDb, socioId: string, obligationId: string): Promise<{ currency: string; outstandingAmountCents: number } | null>; composeWork(tx: DuesDb, input: CommunityWorkCommand): Promise<CommunityWork>; appendExecution(db: DuesDb, row: { executionId: string; approvalId: string; actionId: string; requesterKey: string; socioId: string; obligationId: string; amountCents: number; actorFingerprint: string; receipt: string; settlementId: string }): Promise<{ executionReceiptId: string }>; consumeApproval(db: DuesDb, approvalId: string): Promise<boolean> }

const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const money = (cents: number) => (cents / 100).toFixed(2)
function conflict(message: string): never {
  throw BusinessError(ErrorCode.CONFLICT, message)
}
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
const executionFingerprint = (
  executionId: string,
  requestId: string,
  socioId: string,
  obligationId: string,
  amountCents: number,
) =>
  createHash('sha256')
    .update(JSON.stringify({ executionId, requestId, socioId, obligationId, amountCents }))
    .digest('hex')

async function findReceipt(
  db: DuesDb,
  approvalId: string,
): Promise<CommunityWorkExecutionReceipt | null> {
  const row = rows<{ id: string; receipt: string }>(
    await db.execute(
      sql`SELECT id,receipt FROM tesoreria.dues_community_work_executions WHERE approval_token_id=${approvalId}`,
    ),
  )[0]
  if (!row) return null
  let receipt: Omit<CommunityWorkExecutionReceipt, 'executionReceiptId'>
  try {
    receipt = JSON.parse(row.receipt) as Omit<CommunityWorkExecutionReceipt, 'executionReceiptId'>
  } catch {
    throw BusinessError(ErrorCode.CONFLICT, 'Community work execution receipt is unreadable')
  }
  if (!receipt || receipt.executionId === undefined || receipt.workId === undefined)
    conflict('Community work execution receipt is unreadable')
  return { ...receipt, executionReceiptId: row.id }
}
async function lockApproval(
  db: DuesDb,
  executionId: string,
): Promise<LockedCommunityWorkApproval | null> {
  const row = rows<LockedCommunityWorkApproval>(
    await db.execute(
      sql`SELECT id,action_id AS "actionId",status,used_at AS "usedAt",expires_at AS "expiresAt",execution_id AS "executionId",decided_by_operator_id AS "decidedByOperatorId",requester_key AS "requesterKey",agreement_uuid AS "agreementUuid",terms_version AS "termsVersion",actor_fingerprint AS "actorFingerprint",community_snapshot AS "communitySnapshot",request_reason AS "requestReason",request_evidence AS "requestEvidence",decision_reason AS "decisionReason" FROM approval_tokens WHERE action_type='dues.community-work-request' AND execution_id=${executionId} FOR UPDATE`,
    ),
  )[0]
  if (!row) return null
  return {
    ...row,
    expiresAt: new Date(row.expiresAt as unknown as string),
    usedAt: row.usedAt ? new Date(row.usedAt as unknown as string) : null,
  }
}
async function lockAgreement(
  db: DuesDb,
  agreementId: string,
): Promise<{ termsVersion: number } | null> {
  return (
    rows<{ termsVersion: number }>(
      await db.execute(
        sql`SELECT terms_version AS "termsVersion" FROM tesoreria.dues_agreements WHERE id=${agreementId} AND status='ACTIVE' FOR UPDATE`,
      ),
    )[0] ?? null
  )
}
async function outstanding(db: DuesDb, socioId: string, obligationId: string) {
  const selected = await selectFullOutstanding(db, { socioId, obligationIds: [obligationId] })
  const target = selected.allocations.find((item) => item.obligationId === obligationId)
  return target ? { currency: selected.currency, outstandingAmountCents: target.amountCents } : null
}
async function appendExecution(
  db: DuesDb,
  row: {
    executionId: string
    approvalId: string
    actionId: string
    requesterKey: string
    socioId: string
    obligationId: string
    amountCents: number
    actorFingerprint: string
    receipt: string
    settlementId: string
  },
) {
  const inserted = rows<{ id: string }>(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_community_work_executions (approval_token_id,settlement_id,action_id,requester_key,amount_cents,allocation_id,snapshot_actor_fingerprint,receipt) VALUES (${row.approvalId},${row.settlementId},${row.actionId},${row.requesterKey},${money(row.amountCents)},${row.obligationId},${row.actorFingerprint},${row.receipt}) RETURNING id`,
    ),
  )[0]
  if (!inserted) conflict('Community work execution receipt was not created')
  return { executionReceiptId: inserted.id }
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

export class CommunityWorkExecutionService {
  private readonly repository: CommunityWorkExecutionRepository
  private readonly audit: AuditEmitter
  constructor(
    private readonly db: Db,
    dependencies: {
      repository?: Partial<CommunityWorkExecutionRepository>
      audit?: AuditEmitter
    } = {},
  ) {
    this.repository = {
      findReceipt,
      lockApproval,
      lockAgreement,
      outstanding,
      composeWork: (tx: DuesDb, input: CommunityWorkCommand) =>
        new CommunityWorkService(this.db).createInTransaction(tx, input),
      appendExecution,
      consumeApproval,
      ...dependencies.repository,
    }
    this.audit = dependencies.audit ?? emitAudit
  }
  async executeApproved(
    command: CommunityWorkExecutionCommand,
  ): Promise<CommunityWorkExecutionResult> {
    if (!command.requestId || !command.executionId || !command.actorId || !command.callerKey)
      conflict('Community work execution identity is required')
    return this.db.transaction(async (tx) => {
      const approval = await this.repository.lockApproval(tx, command.executionId)
      if (!approval)
        throw BusinessError(ErrorCode.CONFLICT, 'Community work execution is not executable')
      if (approval.actionId !== command.requestId)
        conflict('Community work execution is not executable')
      const snapshot = approval.communitySnapshot
      if (!snapshot)
        throw BusinessError(ErrorCode.CONFLICT, 'Community work execution is not executable')
      const result = await this.executeInTransaction(tx, command, approval)
      if (result.status === 'executed') {
        const emitted = await this.audit(tx, {
          operatorId: command.actorId,
          action: AuditAction.COMMUNITY_WORK_EXECUTED,
          entityType: 'community_work_execution',
          entityId: result.executionId,
          oldValue: { outstanding_amount_cents: result.outstandingBeforeCents },
          newValue: { outstanding_amount_cents: result.outstandingAfterCents },
          sourceIp: command.sourceIp,
          callerKey: command.callerKey,
          metadata: {
            request_id: command.requestId,
            approval_id: result.approvalId,
            execution_id: result.executionId,
            actor_id: command.actorId,
            approved_snapshot: snapshot,
            approval_reason: approval.requestReason,
            agreement_uuid: approval.agreementUuid,
            terms_version: approval.termsVersion,
            idempotency_key: command.callerKey,
          },
        } satisfies AuditRecord)
        if (!emitted.inserted)
          throw new Error('community work execution audit event was not inserted')
      }
      return result
    })
  }
  private async executeInTransaction(
    tx: DuesDb,
    command: CommunityWorkExecutionCommand,
    approval: LockedCommunityWorkApproval,
  ): Promise<CommunityWorkExecutionResult> {
    const replay = await this.repository.findReceipt(tx, approval.id)
    if (replay) {
      if (replay.requestId !== command.requestId)
        conflict('Community work execution identity conflicts with its receipt')
      return { ...replay, status: 'replayed' }
    }
    if (
      approval.status !== 'approved' ||
      approval.usedAt ||
      approval.expiresAt <= new Date() ||
      approval.executionId !== command.executionId ||
      approval.decidedByOperatorId !== command.actorId ||
      !approval.requestReason ||
      !approval.decisionReason
    )
      conflict('Community work execution is not executable')
    const snapshot = approval.communitySnapshot
    if (
      !snapshot ||
      snapshot.obligations.length !== 1 ||
      !approval.requesterKey ||
      !approval.actorFingerprint
    )
      conflict('Community work execution is not executable')
    const frozen = snapshot.obligations[0]!
    if (approval.agreementUuid) {
      const agreement = await this.repository.lockAgreement(tx, approval.agreementUuid)
      if (
        !agreement ||
        approval.termsVersion === null ||
        agreement.termsVersion !== approval.termsVersion
      )
        conflict('Community work approval agreement context is stale')
    }
    const current = await this.repository.outstanding(tx, snapshot.memberId, frozen.obligationId)
    if (
      !current ||
      current.currency !== frozen.currency ||
      current.outstandingAmountCents < frozen.outstandingAmountCents
    )
      conflict('Community work approval snapshot is stale')
    const composed = await this.repository.composeWork(tx, {
      actorId: command.actorId,
      role: command.role,
      permissions: command.permissions,
      sourceIp: command.sourceIp,
      callerKey: command.executionId,
      requestFingerprint: executionFingerprint(
        command.executionId,
        command.requestId,
        snapshot.memberId,
        frozen.obligationId,
        frozen.outstandingAmountCents,
      ),
      authorizationEvidence: { role: command.role, permissions: command.permissions },
      socioId: snapshot.memberId,
      obligationId: frozen.obligationId,
      ...(approval.agreementUuid ? { agreementId: approval.agreementUuid } : {}),
      amountCents: frozen.outstandingAmountCents,
      evidence: {
        request_evidence: approval.requestEvidence ?? '',
        decision_reason: approval.decisionReason ?? '',
      },
      reason: approval.requestReason ?? '',
    })
    const receipt: Omit<CommunityWorkExecutionReceipt, 'executionReceiptId'> = {
      executionId: command.executionId,
      approvalId: approval.id,
      requestId: command.requestId,
      socioId: snapshot.memberId,
      obligationId: frozen.obligationId,
      amountCents: frozen.outstandingAmountCents,
      currency: current.currency,
      workId: composed.id,
      settlementId: composed.settlementId,
      allocationId: composed.allocationId!,
      requesterKey: approval.requesterKey,
      outstandingBeforeCents: current.outstandingAmountCents,
      outstandingAfterCents: current.outstandingAmountCents - frozen.outstandingAmountCents,
    }
    const saved = await this.repository.appendExecution(tx, {
      executionId: command.executionId,
      approvalId: approval.id,
      actionId: approval.actionId,
      requesterKey: approval.requesterKey,
      socioId: snapshot.memberId,
      obligationId: frozen.obligationId,
      amountCents: frozen.outstandingAmountCents,
      actorFingerprint: approval.actorFingerprint,
      receipt: JSON.stringify(receipt),
      settlementId: composed.settlementId,
    })
    if (!(await this.repository.consumeApproval(tx, approval.id)))
      conflict('Community work approval was consumed concurrently')
    return { ...receipt, executionReceiptId: saved.executionReceiptId, status: 'executed' }
  }
}
