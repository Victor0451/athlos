import type { Db } from '@athlos/db'
import { approvalTokens, type ApprovalToken } from '@athlos/db/schema'
import { and, eq, gt, isNull } from 'drizzle-orm'
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
