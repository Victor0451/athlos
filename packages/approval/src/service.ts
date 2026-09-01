import type { Db } from '@athlos/db'
import { approvalTokens, duesCondonationExecutions, type ApprovalToken } from '@athlos/db/schema'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { generateApprovalToken, hashApprovalToken } from './token.ts'

/**
 * Payload for {@link createApprovalToken}. The approver address is the
 * phone (E.164) or email the link will be sent to.
 */
export interface CreateApprovalLinkRequest {
  /** Coarse action class, e.g. `ctacte.anulate`, `payment_order`. */
  actionType: string
  /** PK of the target entity in its own table. String for cross-DB compat. */
  actionId: string
  /** Short human summary sent to the approver as the link body. */
  contextSummary: string
  /** Operator who initiated the action (audited). */
  operatorId: string
  approverChannel: 'whatsapp' | 'email'
  approverAddress: string
  /** Defaults to 48 hours per auth-login spec §"Generate approval link". */
  expiresInHours?: number
}

/**
 * Read view of an approval token record. Exported so the route layer
 * can serialise it without re-deriving the DTO shape.
 */
export type ApprovalTokenRecord = ApprovalToken

export interface CondonationSnapshot {
  memberId: string
  obligations: Array<{ obligationId: string; currency: string; outstandingAmountCents: number }>
}

export interface CreateCondonationApprovalRequest {
  requestId: string
  contextSummary: string
  requesterId: string
  approverChannel: 'whatsapp' | 'email'
  approverAddress: string
  snapshot: CondonationSnapshot
  reason: string
  evidence: string
  callerKey: string
  expiresInHours?: number
}

export interface CondonationDecision {
  requestId: string
  actorId: string
  decision: 'approved' | 'rejected'
  reason: string
  evidence: string
}

export type CondonationLifecycle = Pick<
  ApprovalToken,
  'actionId' | 'status' | 'expiresAt' | 'decidedAt' | 'executionId' | 'condonationSnapshot'
> & { executionReceiptId: string | null }

export type ListCondonationLifecycleInput = {
  memberId: string
  requesterId?: string
  limit: number
}

/** Read persisted approval rows joined to execution receipts; approval alone never implies execution. */
export async function listCondonationLifecycle(
  db: Db,
  input: ListCondonationLifecycleInput,
): Promise<CondonationLifecycle[]> {
  const where = and(
    eq(approvalTokens.actionType, 'dues.condonation'),
    sql`${approvalTokens.condonationSnapshot}->>'memberId' = ${input.memberId}`,
    ...(input.requesterId ? [eq(approvalTokens.createdByOperatorId, input.requesterId)] : []),
  )
  const rows = await db
    .select({ approval: approvalTokens, executionReceiptId: duesCondonationExecutions.executionId })
    .from(approvalTokens)
    .leftJoin(
      duesCondonationExecutions,
      eq(duesCondonationExecutions.approvalTokenId, approvalTokens.id),
    )
    .where(where)
    .orderBy(desc(approvalTokens.createdAt), desc(approvalTokens.id))
    .limit(input.limit)
  return rows
    .filter(
      (row) =>
        (row.approval.condonationSnapshot as CondonationSnapshot | null)?.memberId ===
        input.memberId,
    )
    .map(({ approval, executionReceiptId }) => ({
      actionId: approval.actionId,
      status: approval.status,
      expiresAt: approval.expiresAt,
      decidedAt: approval.decidedAt,
      executionId: approval.executionId,
      condonationSnapshot: approval.condonationSnapshot,
      executionReceiptId,
    }))
}

function assertCondonationSnapshot(snapshot: CondonationSnapshot): void {
  const ids = new Set(snapshot.obligations.map((obligation) => obligation.obligationId))
  const currencies = new Set(snapshot.obligations.map((obligation) => obligation.currency))
  if (
    !snapshot.memberId ||
    snapshot.obligations.length === 0 ||
    ids.size !== snapshot.obligations.length ||
    currencies.size !== 1 ||
    snapshot.obligations.some(
      (obligation) =>
        !obligation.obligationId ||
        !obligation.currency ||
        !Number.isInteger(obligation.outstandingAmountCents) ||
        obligation.outstandingAmountCents <= 0,
    )
  ) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Invalid condonation obligation snapshot')
  }
}

export function condonationRequestFingerprint(req: CreateCondonationApprovalRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        requesterId: req.requesterId,
        contextSummary: req.contextSummary,
        approverChannel: req.approverChannel,
        approverAddress: req.approverAddress,
        snapshot: {
          memberId: req.snapshot.memberId,
          obligations: [...req.snapshot.obligations].sort((left, right) =>
            left.obligationId.localeCompare(right.obligationId),
          ),
        },
        reason: req.reason,
        evidence: req.evidence,
      }),
    )
    .digest('hex')
}

export async function findCondonationRequest(db: Db, requesterId: string, callerKey: string) {
  const [row] = await db
    .select()
    .from(approvalTokens)
    .where(
      and(
        eq(approvalTokens.actionType, 'dues.condonation'),
        eq(approvalTokens.createdByOperatorId, requesterId),
        eq(approvalTokens.callerKey, callerKey),
      ),
    )
    .limit(1)
  return row
}

/** Persist a financially inert, immutable condonation request in approval_tokens. */
export async function createCondonationApprovalRequest(
  db: Db,
  req: CreateCondonationApprovalRequest,
): Promise<{ expiresAt: Date; record: ApprovalToken }> {
  assertCondonationSnapshot(req.snapshot)
  if (
    !req.requestId ||
    !req.contextSummary ||
    !req.reason ||
    !req.evidence ||
    !req.callerKey.trim()
  ) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Condonation request details are required')
  }
  const requestFingerprint = condonationRequestFingerprint(req)
  const existing = await findCondonationRequest(db, req.requesterId, req.callerKey)
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint)
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different request',
      )
    return { expiresAt: existing.expiresAt, record: existing }
  }
  const { hash } = generateApprovalToken()
  const expiresAt = new Date(Date.now() + (req.expiresInHours ?? 48) * 60 * 60 * 1000)
  let row: ApprovalToken | undefined
  try {
    ;[row] = await db
      .insert(approvalTokens)
      .values({
        tokenHash: hash,
        actionType: 'dues.condonation',
        actionId: req.requestId,
        contextSummary: req.contextSummary,
        createdByOperatorId: req.requesterId,
        approverChannel: req.approverChannel,
        approverAddress: req.approverAddress,
        expiresAt,
        condonationSnapshot: req.snapshot,
        requestReason: req.reason,
        requestEvidence: req.evidence,
        callerKey: req.callerKey,
        requestFingerprint,
      })
      .returning()
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error
    const raced = await findCondonationRequest(db, req.requesterId, req.callerKey)
    if (!raced) throw error
    if (raced.requestFingerprint !== requestFingerprint)
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different request',
      )
    return { expiresAt: raced.expiresAt, record: raced }
  }
  if (!row) throw BusinessError(ErrorCode.INTERNAL_ERROR, 'approval_tokens insert returned no row')
  return { expiresAt, record: row }
}

function isExactDecision(row: ApprovalToken, input: CondonationDecision): boolean {
  return (
    row.status === input.decision &&
    row.decidedByOperatorId === input.actorId &&
    row.decisionReason === input.reason &&
    row.decisionEvidence === input.evidence
  )
}

/**
 * Record one authenticated decision for a scoped condonation request. This only
 * authorizes later execution: it never consumes the token or touches financial facts.
 */
export async function decideCondonationApproval(
  db: Db,
  input: CondonationDecision,
): Promise<ApprovalToken> {
  const [current] = await db
    .select()
    .from(approvalTokens)
    .where(
      and(
        eq(approvalTokens.actionType, 'dues.condonation'),
        eq(approvalTokens.actionId, input.requestId),
      ),
    )
    .limit(1)
  if (!current) throw BusinessError(ErrorCode.NOT_FOUND, 'Condonation request not found')
  if (current.createdByOperatorId === input.actorId) {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Requester cannot decide this condonation',
    )
  }
  if (current.status !== 'pending' || current.decidedAt || current.usedAt) {
    if (isExactDecision(current, input)) return current
    throw BusinessError(ErrorCode.CONFLICT, 'Condonation request already decided')
  }
  if (current.expiresAt <= new Date()) {
    throw BusinessError(ErrorCode.APPROVAL_LINK_EXPIRED, 'Condonation request has expired')
  }

  const decisionAt = new Date()
  const [updated] = await db
    .update(approvalTokens)
    .set({
      status: input.decision,
      decidedByOperatorId: input.actorId,
      decisionReason: input.reason,
      decisionEvidence: input.evidence,
      decidedAt: decisionAt,
      executionId: input.decision === 'approved' ? randomUUID() : null,
    })
    .where(
      and(
        eq(approvalTokens.id, current.id),
        eq(approvalTokens.status, 'pending'),
        isNull(approvalTokens.decidedAt),
        isNull(approvalTokens.usedAt),
        gt(approvalTokens.expiresAt, decisionAt),
      ),
    )
    .returning()
  if (updated) return updated

  const [raced] = await db
    .select()
    .from(approvalTokens)
    .where(eq(approvalTokens.id, current.id))
    .limit(1)
  if (raced && isExactDecision(raced, input)) return raced
  throw BusinessError(ErrorCode.CONFLICT, 'Condonation request lifecycle changed')
}

/**
 * Create a fresh approval link. Returns the raw token (the one and only
 * time the caller sees it) plus the DB record. The service layer
 * downstream should embed `raw` in the link and pass `record.id` to
 * the notification dispatcher.
 */
export async function createApprovalToken(
  db: Db,
  req: CreateApprovalLinkRequest,
): Promise<{ raw: string; expiresAt: Date; record: ApprovalToken }> {
  const { raw, hash } = generateApprovalToken()
  const expiresAt = new Date(Date.now() + (req.expiresInHours ?? 48) * 60 * 60 * 1000)
  const [row] = await db
    .insert(approvalTokens)
    .values({
      tokenHash: hash,
      actionType: req.actionType,
      actionId: req.actionId,
      contextSummary: req.contextSummary,
      createdByOperatorId: req.operatorId,
      approverChannel: req.approverChannel,
      approverAddress: req.approverAddress,
      expiresAt,
    })
    .returning()
  if (!row) {
    throw BusinessError(ErrorCode.INTERNAL_ERROR, 'approval_tokens insert returned no row')
  }
  return { raw, expiresAt, record: row }
}

/**
 * Look up a token by its raw value, asserting it is unused and not
 * expired. On failure, distinguish "doesn't exist" (NOT_FOUND) from
 * "exists but already used" (APPROVAL_ALREADY_USED → 410) and
 * "exists but expired" (APPROVAL_LINK_EXPIRED → 410). The two 410
 * codes are required by the auth-login spec §"Approval Link Access".
 */
export async function getApprovalToken(db: Db, raw: string): Promise<ApprovalTokenRecord> {
  const hash = hashApprovalToken(raw)
  const [row] = await db
    .select()
    .from(approvalTokens)
    .where(
      and(
        eq(approvalTokens.tokenHash, hash),
        isNull(approvalTokens.usedAt),
        gt(approvalTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (row) return row

  // Disambiguate the failure mode for the caller. One extra query is
  // acceptable because the hot path (token valid) skips it.
  const [existing] = await db
    .select()
    .from(approvalTokens)
    .where(eq(approvalTokens.tokenHash, hash))
    .limit(1)
  if (existing?.usedAt) {
    throw BusinessError(ErrorCode.APPROVAL_ALREADY_USED, 'Approval link already used')
  }
  if (existing) {
    throw BusinessError(ErrorCode.APPROVAL_LINK_EXPIRED, 'Approval link has expired')
  }
  throw BusinessError(ErrorCode.NOT_FOUND, 'Approval link not found')
}

/**
 * Consume a token: validate it (same checks as {@link getApprovalToken})
 * and atomically mark it used. Two callers racing on the same token
 * will see one success and one APPROVAL_ALREADY_USED because the
 * `WHERE used_at IS NULL` predicate on UPDATE guarantees only the
 * first writer wins.
 */
export async function consumeApprovalToken(db: Db, raw: string): Promise<ApprovalTokenRecord> {
  const token = await getApprovalToken(db, raw)
  const [updated] = await db
    .update(approvalTokens)
    .set({ usedAt: new Date(), status: 'approved' })
    .where(and(eq(approvalTokens.id, token.id), isNull(approvalTokens.usedAt)))
    .returning()
  if (!updated) {
    // Lost a race with another consumer.
    throw BusinessError(ErrorCode.APPROVAL_ALREADY_USED, 'Approval link already used')
  }
  return updated
}
