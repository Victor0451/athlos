import type { Db } from '@athlos/db'
import {
  approvalTokens,
  duesCommunityWorkExecutions,
  duesCondonationExecutions,
  operators,
  socios,
  type ApprovalToken,
} from '@athlos/db/schema'
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

export type CommunityWorkLifecycle = Pick<
  ApprovalToken,
  'actionId' | 'status' | 'expiresAt' | 'decidedAt' | 'executionId' | 'communitySnapshot'
> & { executionReceiptId: string | null }

export type ListCommunityWorkLifecycleInput = {
  memberId: string
  requesterId?: string
  limit: number
}

/** Read persisted community-work approval rows joined to execution receipts; approval alone never implies execution. */
export async function listCommunityWorkLifecycle(
  db: Db,
  input: ListCommunityWorkLifecycleInput,
): Promise<CommunityWorkLifecycle[]> {
  const where = and(
    eq(approvalTokens.actionType, 'dues.community-work-request'),
    sql`${approvalTokens.communitySnapshot}->>'memberId' = ${input.memberId}`,
    ...(input.requesterId ? [eq(approvalTokens.createdByOperatorId, input.requesterId)] : []),
  )
  const rows = await db
    .select({ approval: approvalTokens, executionReceiptId: duesCommunityWorkExecutions.id })
    .from(approvalTokens)
    .leftJoin(
      duesCommunityWorkExecutions,
      eq(duesCommunityWorkExecutions.approvalTokenId, approvalTokens.id),
    )
    .where(where)
    .orderBy(desc(approvalTokens.createdAt), desc(approvalTokens.id))
    .limit(input.limit)
  return rows
    .filter(
      (row) =>
        (row.approval.communitySnapshot as CondonationSnapshot | null)?.memberId === input.memberId,
    )
    .map(({ approval, executionReceiptId }) => ({
      actionId: approval.actionId,
      status: approval.status,
      expiresAt: approval.expiresAt,
      decidedAt: approval.decidedAt,
      executionId: approval.executionId,
      communitySnapshot: approval.communitySnapshot,
      executionReceiptId,
    }))
}

export type CondonationQueueEntry = CondonationLifecycle & {
  id: string
  createdAt: Date
  createdAtCursor: string
  contextSummary: string
  requestReason: string
  requestEvidence: string
  currentMember: { id: string; numeroSocio: string; nombre: string; apellido: string }
  requester: { id: string; username: string }
}
export type ListCondonationQueueInput = {
  view: 'actionable' | 'all'
  limit: number
  cursor?: string
}
const queueUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function unavailableQueue(): never {
  throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Condonation queue data is unavailable')
}

/** Preserve PostgreSQL microseconds; Date is used only to validate the calendar, never to seek. */
function decodeQueueCursor(raw: string | undefined): { t: string; id: string } | undefined {
  if (raw === undefined) return undefined
  try {
    if (!raw || raw.length > 256) throw new Error('Invalid cursor length')
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object') throw new Error('Invalid cursor object')
    const { t, id } = value as { t?: unknown; id?: unknown }
    if (
      typeof t !== 'string' ||
      typeof id !== 'string' ||
      !queueUuid.test(id) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(t) ||
      Number(t.slice(0, 4)) < 1
    )
      throw new Error('Invalid cursor fields')
    const milliseconds = `${t.slice(0, 23)}Z`
    if (
      new Date(milliseconds).toISOString() !== milliseconds ||
      Buffer.from(JSON.stringify({ t, id })).toString('base64url') !== raw
    )
      throw new Error('Invalid cursor encoding or calendar')
    return { t, id }
  } catch {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Invalid condonation queue cursor')
  }
}

function assertQueueSnapshot(value: unknown): asserts value is CondonationSnapshot {
  const snapshot = value as CondonationSnapshot | null
  if (
    !snapshot ||
    typeof snapshot.memberId !== 'string' ||
    !queueUuid.test(snapshot.memberId) ||
    !Array.isArray(snapshot.obligations) ||
    !snapshot.obligations.every(
      (item) =>
        item &&
        typeof item.obligationId === 'string' &&
        queueUuid.test(item.obligationId) &&
        typeof item.currency === 'string' &&
        /^[A-Z]{3}$/.test(item.currency) &&
        Number.isSafeInteger(item.outstandingAmountCents),
    )
  )
    unavailableQueue()
  try {
    assertCondonationSnapshot(snapshot)
  } catch {
    unavailableQueue()
  }
}

/** Central read model only: decisions and execution retain their dedicated authenticated services. */
export async function listCondonationQueue(
  db: Db,
  input: ListCondonationQueueInput,
): Promise<CondonationQueueEntry[]> {
  const cursor = decodeQueueCursor(input.cursor)
  const conditions = [eq(approvalTokens.actionType, 'dues.condonation')]
  if (input.view === 'actionable')
    conditions.push(
      eq(approvalTokens.status, 'pending'),
      isNull(approvalTokens.usedAt),
      gt(approvalTokens.expiresAt, new Date()),
      isNull(duesCondonationExecutions.executionId),
    )
  if (cursor)
    conditions.push(
      sql`(${approvalTokens.createdAt}, ${approvalTokens.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
    )
  const rows = await db
    .select({
      id: approvalTokens.id,
      actionId: approvalTokens.actionId,
      status: approvalTokens.status,
      expiresAt: approvalTokens.expiresAt,
      decidedAt: approvalTokens.decidedAt,
      executionId: approvalTokens.executionId,
      executionReceiptId: duesCondonationExecutions.executionId,
      condonationSnapshot: approvalTokens.condonationSnapshot,
      createdAt: approvalTokens.createdAt,
      createdAtCursor: sql<string>`to_char(${approvalTokens.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      contextSummary: approvalTokens.contextSummary,
      requestReason: approvalTokens.requestReason,
      requestEvidence: approvalTokens.requestEvidence,
      memberId: socios.id,
      numeroSocio: socios.numeroSocio,
      nombre: socios.nombre,
      apellido: socios.apellido,
      requesterId: operators.id,
      username: operators.username,
    })
    .from(approvalTokens)
    .leftJoin(
      duesCondonationExecutions,
      eq(duesCondonationExecutions.approvalTokenId, approvalTokens.id),
    )
    .leftJoin(
      socios,
      sql`${socios.id}::text = lower(${approvalTokens.condonationSnapshot}->>'memberId')`,
    )
    .leftJoin(operators, eq(operators.id, approvalTokens.createdByOperatorId))
    .where(and(...conditions))
    .orderBy(desc(approvalTokens.createdAt), desc(approvalTokens.id))
    .limit(input.limit)
  return rows.map((row) => {
    assertQueueSnapshot(row.condonationSnapshot)
    if (
      !['pending', 'approved', 'rejected'].includes(row.status) ||
      !queueUuid.test(row.actionId) ||
      !row.memberId ||
      !row.numeroSocio ||
      !row.nombre ||
      !row.apellido ||
      !row.requesterId ||
      !row.username ||
      !row.contextSummary.trim() ||
      !row.requestReason?.trim() ||
      !row.requestEvidence?.trim() ||
      row.memberId !== row.condonationSnapshot.memberId.toLowerCase() ||
      (row.executionReceiptId !== null &&
        (row.executionReceiptId !== row.executionId || row.status !== 'approved'))
    )
      unavailableQueue()
    return {
      id: row.id,
      actionId: row.actionId,
      status: row.status,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      executionId: row.executionId,
      executionReceiptId: row.executionReceiptId,
      condonationSnapshot: row.condonationSnapshot,
      createdAt: row.createdAt,
      createdAtCursor: row.createdAtCursor,
      contextSummary: row.contextSummary,
      requestReason: row.requestReason,
      requestEvidence: row.requestEvidence,
      currentMember: {
        id: row.memberId,
        numeroSocio: row.numeroSocio,
        nombre: row.nombre,
        apellido: row.apellido,
      },
      requester: { id: row.requesterId, username: row.username },
    }
  })
}

export type CommunityWorkQueueEntry = CommunityWorkLifecycle & {
  id: string
  createdAt: Date
  createdAtCursor: string
  contextSummary: string
  requestReason: string
  requestEvidence: string
  currentMember: { id: string; numeroSocio: string; nombre: string; apellido: string }
  requester: { id: string; username: string }
}
export type ListCommunityWorkQueueInput = {
  view: 'actionable' | 'all'
  limit: number
  cursor?: string
}

/** Central read model only: decisions and execution retain their dedicated authenticated services. */
export async function listCommunityWorkQueue(
  db: Db,
  input: ListCommunityWorkQueueInput,
): Promise<CommunityWorkQueueEntry[]> {
  const cursor = decodeQueueCursor(input.cursor)
  const conditions = [eq(approvalTokens.actionType, 'dues.community-work-request')]
  if (input.view === 'actionable')
    conditions.push(
      eq(approvalTokens.status, 'pending'),
      isNull(approvalTokens.usedAt),
      gt(approvalTokens.expiresAt, new Date()),
      isNull(duesCommunityWorkExecutions.id),
    )
  if (cursor)
    conditions.push(
      sql`(${approvalTokens.createdAt}, ${approvalTokens.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
    )
  const rows = await db
    .select({
      id: approvalTokens.id,
      actionId: approvalTokens.actionId,
      status: approvalTokens.status,
      expiresAt: approvalTokens.expiresAt,
      decidedAt: approvalTokens.decidedAt,
      executionId: approvalTokens.executionId,
      executionReceiptId: duesCommunityWorkExecutions.id,
      communitySnapshot: approvalTokens.communitySnapshot,
      createdAt: approvalTokens.createdAt,
      createdAtCursor: sql<string>`to_char(${approvalTokens.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      contextSummary: approvalTokens.contextSummary,
      requestReason: approvalTokens.requestReason,
      requestEvidence: approvalTokens.requestEvidence,
      memberId: socios.id,
      numeroSocio: socios.numeroSocio,
      nombre: socios.nombre,
      apellido: socios.apellido,
      requesterId: operators.id,
      username: operators.username,
    })
    .from(approvalTokens)
    .leftJoin(
      duesCommunityWorkExecutions,
      eq(duesCommunityWorkExecutions.approvalTokenId, approvalTokens.id),
    )
    .leftJoin(
      socios,
      sql`${socios.id}::text = lower(${approvalTokens.communitySnapshot}->>'memberId')`,
    )
    .leftJoin(operators, eq(operators.id, approvalTokens.createdByOperatorId))
    .where(and(...conditions))
    .orderBy(desc(approvalTokens.createdAt), desc(approvalTokens.id))
    .limit(input.limit)
  return rows.map((row) => {
    assertQueueSnapshot(row.communitySnapshot)
    if (
      !['pending', 'approved', 'rejected'].includes(row.status) ||
      !queueUuid.test(row.actionId) ||
      !row.memberId ||
      !row.numeroSocio ||
      !row.nombre ||
      !row.apellido ||
      !row.requesterId ||
      !row.username ||
      !row.contextSummary.trim() ||
      !row.requestReason?.trim() ||
      !row.requestEvidence?.trim() ||
      row.memberId !== row.communitySnapshot.memberId.toLowerCase() ||
      (row.executionReceiptId !== null &&
        (row.executionReceiptId !== row.executionId || row.status !== 'approved'))
    )
      throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Community work queue data is unavailable')
    return {
      id: row.id,
      actionId: row.actionId,
      status: row.status,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      executionId: row.executionId,
      executionReceiptId: row.executionReceiptId,
      communitySnapshot: row.communitySnapshot,
      createdAt: row.createdAt,
      createdAtCursor: row.createdAtCursor,
      contextSummary: row.contextSummary,
      requestReason: row.requestReason,
      requestEvidence: row.requestEvidence,
      currentMember: {
        id: row.memberId,
        numeroSocio: row.numeroSocio,
        nombre: row.nombre,
        apellido: row.apellido,
      },
      requester: { id: row.requesterId, username: row.username },
    }
  })
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
 * Unresolved-obligation snapshot for a community-work request. Same shape as
 * the condonation snapshot: member plus the obligations the request covered.
 */
export type CommunityWorkSnapshot = CondonationSnapshot

export interface CreateCommunityWorkApprovalRequest {
  requestId: string
  contextSummary: string
  requesterId: string
  /** Stable server-generated claim key, separate from HTTP identity. */
  requesterKey: string
  approverChannel: 'whatsapp' | 'email'
  approverAddress: string
  snapshot: CommunityWorkSnapshot
  reason: string
  evidence: string
  callerKey: string
  agreementUuid?: string | null
  termsVersion?: number | null
  expiresInHours?: number
}

export interface CommunityWorkDecision {
  requestId: string
  actorId: string
  decision: 'approved' | 'rejected'
  reason: string
  evidence: string
  /** Server-captured decider fingerprint; part of exact-decision identity. */
  actorFingerprint?: string | null
}

export function communityWorkRequestFingerprint(req: CreateCommunityWorkApprovalRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        requesterId: req.requesterId,
        requesterKey: req.requesterKey,
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
        agreementUuid: req.agreementUuid ?? null,
        termsVersion: req.termsVersion ?? null,
      }),
    )
    .digest('hex')
}

export async function findCommunityWorkRequest(db: Db, requesterId: string, callerKey: string) {
  const [row] = await db
    .select()
    .from(approvalTokens)
    .where(
      and(
        eq(approvalTokens.actionType, 'dues.community-work-request'),
        eq(approvalTokens.createdByOperatorId, requesterId),
        eq(approvalTokens.callerKey, callerKey),
      ),
    )
    .limit(1)
  return row
}

/** Persist a financially inert, immutable community-work request in approval_tokens. */
export async function createCommunityWorkApprovalRequest(
  db: Db,
  req: CreateCommunityWorkApprovalRequest,
): Promise<{ expiresAt: Date; record: ApprovalToken }> {
  assertCondonationSnapshot(req.snapshot)
  if (
    !req.requestId ||
    !req.contextSummary ||
    !req.reason ||
    !req.evidence ||
    !req.callerKey.trim() ||
    !req.requesterKey.trim()
  ) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Community work request details are required')
  }
  const requestFingerprint = communityWorkRequestFingerprint(req)
  const existing = await findCommunityWorkRequest(db, req.requesterId, req.callerKey)
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
        actionType: 'dues.community-work-request',
        actionId: req.requestId,
        contextSummary: req.contextSummary,
        createdByOperatorId: req.requesterId,
        approverChannel: req.approverChannel,
        approverAddress: req.approverAddress,
        expiresAt,
        communitySnapshot: req.snapshot,
        requesterKey: req.requesterKey,
        agreementUuid: req.agreementUuid ?? null,
        termsVersion: req.termsVersion ?? null,
        requestReason: req.reason,
        requestEvidence: req.evidence,
        callerKey: req.callerKey,
        requestFingerprint,
      })
      .returning()
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error
    const raced = await findCommunityWorkRequest(db, req.requesterId, req.callerKey)
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

function isExactCommunityWorkDecision(row: ApprovalToken, input: CommunityWorkDecision): boolean {
  return (
    row.status === input.decision &&
    row.decidedByOperatorId === input.actorId &&
    row.decisionReason === input.reason &&
    row.decisionEvidence === input.evidence &&
    row.actorFingerprint === (input.actorFingerprint ?? null)
  )
}

/**
 * Record one authenticated decision for a scoped community-work request. This
 * only authorizes later execution: it never consumes the token or touches
 * financial facts.
 */
export async function decideCommunityWorkApproval(
  db: Db,
  input: CommunityWorkDecision,
): Promise<ApprovalToken> {
  const [current] = await db
    .select()
    .from(approvalTokens)
    .where(
      and(
        eq(approvalTokens.actionType, 'dues.community-work-request'),
        eq(approvalTokens.actionId, input.requestId),
      ),
    )
    .limit(1)
  if (!current) throw BusinessError(ErrorCode.NOT_FOUND, 'Community work request not found')
  if (current.createdByOperatorId === input.actorId) {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Requester cannot decide this community work request',
    )
  }
  if (current.status !== 'pending' || current.decidedAt || current.usedAt) {
    if (isExactCommunityWorkDecision(current, input)) return current
    throw BusinessError(ErrorCode.CONFLICT, 'Community work request already decided')
  }
  if (current.expiresAt <= new Date()) {
    throw BusinessError(ErrorCode.APPROVAL_LINK_EXPIRED, 'Community work request has expired')
  }

  const decisionAt = new Date()
  const [updated] = await db
    .update(approvalTokens)
    .set({
      status: input.decision,
      decidedByOperatorId: input.actorId,
      decisionReason: input.reason,
      decisionEvidence: input.evidence,
      actorFingerprint: input.actorFingerprint ?? null,
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
  if (raced && isExactCommunityWorkDecision(raced, input)) return raced
  throw BusinessError(ErrorCode.CONFLICT, 'Community work request lifecycle changed')
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
