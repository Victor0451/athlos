import { BusinessError, ErrorCode } from '@athlos/errors'
import type { Db } from '@athlos/db'
import {
  auditEvents,
  legacyMemberEvidence,
  legacyMemberEvidenceResolutions,
  legacyMembershipTypeCandidates,
  legacyMembershipTypeSourceRows,
  memberIdentities,
  rawEvents,
} from '@athlos/db/schema'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

export type ExceptionKind = 'unknown_type' | 'ambiguous_identity'
export type ExceptionStatus = 'unresolved' | 'resolved'

export interface EvidenceException {
  id: string
  kind: ExceptionKind
  status: ExceptionStatus
  fingerprint: string
  legacyTypeCode: string
  createdAt: Date
}

export interface EvidenceExceptionDetail extends EvidenceException {
  memberChoices: { id: string; memberNumber: number }[]
  typeChoices: { sourceRowId: string; code: string; name: string }[]
  deterministicTypeCandidateSourceRowId: string | null
}

export interface EvidenceResolution {
  id: string
  evidenceId: string
  kind: ExceptionKind
  selectedMemberId: string
  selectedTypeCandidateSourceRowId: string | null
  stewardOperatorId: string
  reason: string
  idempotencyKey: string
  evidenceFingerprint: string
  supersedesResolutionId: string | null
  createdAt: Date
}

export interface EvidenceExceptionRepository {
  transaction<T>(work: (tx: EvidenceExceptionRepository) => Promise<T>): Promise<T>
  listExceptions(input: {
    page: number
    limit: number
    kind?: ExceptionKind
    status?: ExceptionStatus
  }): Promise<{ items: EvidenceException[]; total: number }>
  findExceptionDetail(id: string): Promise<EvidenceExceptionDetail | null>
  findResolutionByIdempotencyKey(
    operatorId: string,
    key: string,
  ): Promise<EvidenceResolution | null>
  findResolutionContext(id: string): Promise<EvidenceExceptionDetail | null>
  hasMember(id: string): Promise<boolean>
  hasTypeCandidate(sourceRowId: string): Promise<boolean>
  findCurrentLeaf(evidenceId: string): Promise<EvidenceResolution | null>
  appendResolution(
    input: Omit<EvidenceResolution, 'id' | 'createdAt'>,
  ): Promise<EvidenceResolution | null>
  appendAudit(input: {
    operatorId: string
    evidenceId: string
    resolutionId: string
  }): Promise<void>
}

export interface ResolveEvidenceExceptionInput {
  evidenceId: string
  kind: ExceptionKind
  evidenceFingerprint: string
  operatorId: string
  idempotencyKey: string
  reason: string
  selectedMemberId?: string
  selectedTypeCandidateSourceRowId?: string
}

type ResolutionRow = typeof legacyMemberEvidenceResolutions.$inferSelect

function toResolution(row: ResolutionRow): EvidenceResolution {
  return {
    id: row.id,
    evidenceId: row.legacyMemberEvidenceId,
    kind: row.resolutionKind as ExceptionKind,
    selectedMemberId: row.selectedMemberId!,
    selectedTypeCandidateSourceRowId: row.selectedMembershipTypeCandidateSourceRowId,
    stewardOperatorId: row.stewardOperatorId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    evidenceFingerprint: row.evidenceFingerprint,
    supersedesResolutionId: row.supersedesResolutionId,
    createdAt: row.createdAt,
  }
}

function dbCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? ((error as { code?: unknown }).code as string | undefined)
    : undefined
}

function mapWriteError(error: unknown): never {
  if (error instanceof BusinessError) throw error
  switch (dbCode(error)) {
    case '23503':
      throw BusinessError(ErrorCode.NOT_FOUND, 'Referenced evidence or selection was not found')
    case '23514':
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'Resolution violates evidence selection rules',
      )
    case '40001':
    case '40P01':
      throw BusinessError(ErrorCode.CONFLICT, 'Evidence exception changed concurrently')
    default:
      throw error
  }
}

/** PostgreSQL/Drizzle implementation of the bounded exception-resolution port. */
export class DrizzleEvidenceExceptionRepository implements EvidenceExceptionRepository {
  constructor(private readonly db: Db) {}

  async transaction<T>(work: (tx: EvidenceExceptionRepository) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction((tx) =>
        work(new DrizzleEvidenceExceptionRepository(tx as Db)),
      )
    } catch (error) {
      return mapWriteError(error)
    }
  }

  async listExceptions(input: {
    page: number
    limit: number
    kind?: ExceptionKind
    status?: ExceptionStatus
  }): Promise<{ items: EvidenceException[]; total: number }> {
    const page = Math.max(input.page, 1)
    const limit = Math.min(Math.max(input.limit, 1), 100)
    const resolved = exists(
      this.db
        .select({ id: legacyMemberEvidenceResolutions.id })
        .from(legacyMemberEvidenceResolutions)
        .where(eq(legacyMemberEvidenceResolutions.legacyMemberEvidenceId, legacyMemberEvidence.id)),
    )
    const filters: Array<SQL | undefined> = [
      inArray(legacyMemberEvidence.reviewState, ['unknown_type', 'ambiguous_identity']),
      input.kind ? eq(legacyMemberEvidence.reviewState, input.kind) : undefined,
      input.status === 'resolved'
        ? resolved
        : input.status === 'unresolved'
          ? notExists(
              this.db
                .select({ id: legacyMemberEvidenceResolutions.id })
                .from(legacyMemberEvidenceResolutions)
                .where(
                  eq(
                    legacyMemberEvidenceResolutions.legacyMemberEvidenceId,
                    legacyMemberEvidence.id,
                  ),
                ),
            )
          : undefined,
    ]
    const where = and(...filters.filter((filter): filter is SQL => filter !== undefined))
    const [totalRows, rows] = await Promise.all([
      this.db.select({ value: count() }).from(legacyMemberEvidence).where(where),
      this.db
        .select({
          id: legacyMemberEvidence.id,
          kind: legacyMemberEvidence.reviewState,
          fingerprint: rawEvents.contentHash,
          legacyTypeCode: legacyMemberEvidence.legacyTypeCode,
          createdAt: legacyMemberEvidence.createdAt,
          isResolved: resolved,
        })
        .from(legacyMemberEvidence)
        .innerJoin(rawEvents, eq(legacyMemberEvidence.rawEventId, rawEvents.id))
        .where(where)
        .orderBy(asc(resolved), desc(legacyMemberEvidence.createdAt), desc(legacyMemberEvidence.id))
        .limit(limit)
        .offset((page - 1) * limit),
    ])
    return {
      items: rows.map(({ isResolved, ...row }) => ({
        ...row,
        kind: row.kind as ExceptionKind,
        status: isResolved ? 'resolved' : 'unresolved',
      })),
      total: Number(totalRows[0]?.value ?? 0),
    }
  }

  async findExceptionDetail(id: string): Promise<EvidenceExceptionDetail | null> {
    const [evidence] = await this.db
      .select({
        id: legacyMemberEvidence.id,
        kind: legacyMemberEvidence.reviewState,
        fingerprint: rawEvents.contentHash,
        legacyTypeCode: legacyMemberEvidence.legacyTypeCode,
        createdAt: legacyMemberEvidence.createdAt,
        deterministicTypeCandidateSourceRowId:
          legacyMemberEvidence.membershipTypeCandidateSourceRowId,
      })
      .from(legacyMemberEvidence)
      .innerJoin(rawEvents, eq(legacyMemberEvidence.rawEventId, rawEvents.id))
      .where(eq(legacyMemberEvidence.id, id))
      .limit(1)
    if (!evidence || (evidence.kind !== 'unknown_type' && evidence.kind !== 'ambiguous_identity')) {
      return null
    }
    const [memberChoices, typeChoices, resolved] = await Promise.all([
      this.db
        .select({ id: memberIdentities.id, memberNumber: memberIdentities.memberNumber })
        .from(memberIdentities)
        .orderBy(asc(memberIdentities.memberNumber), asc(memberIdentities.id)),
      this.db
        .select({
          sourceRowId: legacyMembershipTypeCandidates.sourceRowId,
          code: legacyMembershipTypeCandidates.code,
          name: legacyMembershipTypeSourceRows.name,
        })
        .from(legacyMembershipTypeCandidates)
        .innerJoin(
          legacyMembershipTypeSourceRows,
          eq(legacyMembershipTypeCandidates.sourceRowId, legacyMembershipTypeSourceRows.id),
        )
        .orderBy(
          asc(legacyMembershipTypeCandidates.code),
          asc(legacyMembershipTypeSourceRows.name),
          asc(legacyMembershipTypeCandidates.sourceRowId),
        ),
      this.db
        .select({ id: legacyMemberEvidenceResolutions.id })
        .from(legacyMemberEvidenceResolutions)
        .where(eq(legacyMemberEvidenceResolutions.legacyMemberEvidenceId, id))
        .limit(1),
    ])
    return {
      id: evidence.id,
      kind: evidence.kind,
      status: resolved.length ? 'resolved' : 'unresolved',
      fingerprint: evidence.fingerprint,
      legacyTypeCode: evidence.legacyTypeCode,
      createdAt: evidence.createdAt,
      memberChoices,
      typeChoices,
      deterministicTypeCandidateSourceRowId: evidence.deterministicTypeCandidateSourceRowId,
    }
  }

  findResolutionContext(id: string): Promise<EvidenceExceptionDetail | null> {
    return this.findExceptionDetail(id)
  }

  async findResolutionByIdempotencyKey(operatorId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(legacyMemberEvidenceResolutions)
      .where(
        and(
          eq(legacyMemberEvidenceResolutions.stewardOperatorId, operatorId),
          eq(legacyMemberEvidenceResolutions.idempotencyKey, key),
        ),
      )
      .limit(1)
    return row ? toResolution(row) : null
  }

  async hasMember(id: string): Promise<boolean> {
    return (
      (
        await this.db
          .select({ id: memberIdentities.id })
          .from(memberIdentities)
          .where(eq(memberIdentities.id, id))
          .limit(1)
      ).length > 0
    )
  }

  async hasTypeCandidate(sourceRowId: string): Promise<boolean> {
    return (
      (
        await this.db
          .select({ id: legacyMembershipTypeCandidates.sourceRowId })
          .from(legacyMembershipTypeCandidates)
          .where(eq(legacyMembershipTypeCandidates.sourceRowId, sourceRowId))
          .limit(1)
      ).length > 0
    )
  }

  async findCurrentLeaf(evidenceId: string): Promise<EvidenceResolution | null> {
    const successor = alias(legacyMemberEvidenceResolutions, 'successor')
    const [row] = await this.db
      .select({ resolution: legacyMemberEvidenceResolutions })
      .from(legacyMemberEvidenceResolutions)
      .leftJoin(successor, eq(successor.supersedesResolutionId, legacyMemberEvidenceResolutions.id))
      .where(
        and(
          eq(legacyMemberEvidenceResolutions.legacyMemberEvidenceId, evidenceId),
          isNull(successor.id),
        ),
      )
      .orderBy(
        desc(legacyMemberEvidenceResolutions.createdAt),
        desc(legacyMemberEvidenceResolutions.id),
      )
      .limit(1)
    return row?.resolution ? toResolution(row.resolution) : null
  }

  async appendResolution(input: Omit<EvidenceResolution, 'id' | 'createdAt'>) {
    try {
      const [row] = await this.db
        .insert(legacyMemberEvidenceResolutions)
        .values({
          legacyMemberEvidenceId: input.evidenceId,
          resolutionKind: input.kind,
          selectedMemberId: input.selectedMemberId,
          selectedMembershipTypeCandidateSourceRowId: input.selectedTypeCandidateSourceRowId,
          stewardOperatorId: input.stewardOperatorId,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          evidenceFingerprint: input.evidenceFingerprint,
          supersedesResolutionId: input.supersedesResolutionId,
        })
        .onConflictDoNothing()
        .returning()
      return row ? toResolution(row) : null
    } catch (error) {
      return mapWriteError(error)
    }
  }

  async appendAudit(input: { operatorId: string; evidenceId: string; resolutionId: string }) {
    try {
      await this.db.insert(auditEvents).values({
        operatorId: input.operatorId,
        action: 'SOCIOS_EVIDENCE_EXCEPTION_RESOLVED',
        entityType: 'legacy_member_evidence_resolution',
        entityId: input.resolutionId,
        metadata: { evidence_id: input.evidenceId, resolution_id: input.resolutionId },
      })
    } catch (error) {
      return mapWriteError(error)
    }
  }
}

export async function listEvidenceExceptions(
  repo: EvidenceExceptionRepository,
  input: { page: number; limit: number; kind?: ExceptionKind; status?: ExceptionStatus },
) {
  return repo.listExceptions(input)
}

export async function getEvidenceException(
  repo: EvidenceExceptionRepository,
  id: string,
): Promise<EvidenceExceptionDetail> {
  const detail = await repo.findExceptionDetail(id)
  if (!detail) throw BusinessError(ErrorCode.NOT_FOUND, 'Evidence exception not found')
  return detail
}

function sameCommand(row: EvidenceResolution, input: ResolveEvidenceExceptionInput): boolean {
  return (
    row.evidenceId === input.evidenceId &&
    row.kind === input.kind &&
    row.evidenceFingerprint === input.evidenceFingerprint &&
    row.stewardOperatorId === input.operatorId &&
    row.reason === input.reason.trim() &&
    row.selectedMemberId === input.selectedMemberId &&
    row.selectedTypeCandidateSourceRowId === (input.selectedTypeCandidateSourceRowId ?? null)
  )
}

function conflict(message: string): never {
  throw BusinessError(ErrorCode.CONFLICT, message)
}

async function validateSelection(
  repo: EvidenceExceptionRepository,
  detail: EvidenceExceptionDetail,
  input: ResolveEvidenceExceptionInput,
): Promise<string | null> {
  if (!input.selectedMemberId || !(await repo.hasMember(input.selectedMemberId))) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'An existing member must be selected')
  }
  const selectedType = input.selectedTypeCandidateSourceRowId
  if (detail.kind === 'unknown_type') {
    if (!selectedType || !(await repo.hasTypeCandidate(selectedType))) {
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'An existing type candidate must be selected')
    }
    return selectedType
  }
  if (detail.deterministicTypeCandidateSourceRowId) {
    if (selectedType)
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Type is already deterministic')
    return null
  }
  if (!selectedType || !(await repo.hasTypeCandidate(selectedType))) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'An existing type candidate must be selected')
  }
  return selectedType
}

export async function resolveEvidenceException(
  repo: EvidenceExceptionRepository,
  input: ResolveEvidenceExceptionInput,
): Promise<EvidenceResolution> {
  const reason = input.reason.trim()
  if (!input.operatorId.trim())
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Trusted operator is required')
  if (!reason) throw BusinessError(ErrorCode.REASON_REQUIRED, 'A resolution reason is required')
  if (!input.idempotencyKey.trim())
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Idempotency key is required')

  return repo.transaction(async (tx) => {
    const replay = await tx.findResolutionByIdempotencyKey(input.operatorId, input.idempotencyKey)
    if (replay) {
      if (sameCommand(replay, input)) return replay
      return conflict('Idempotency key was already used for a different resolution')
    }
    const detail = await tx.findResolutionContext(input.evidenceId)
    if (!detail) throw BusinessError(ErrorCode.NOT_FOUND, 'Evidence exception not found')
    if (detail.kind !== input.kind || detail.fingerprint !== input.evidenceFingerprint) {
      return conflict('Evidence exception is stale')
    }
    const selectedTypeCandidateSourceRowId = await validateSelection(tx, detail, input)
    const leaf = await tx.findCurrentLeaf(input.evidenceId)
    const resolution = await tx.appendResolution({
      evidenceId: input.evidenceId,
      kind: input.kind,
      selectedMemberId: input.selectedMemberId!,
      selectedTypeCandidateSourceRowId,
      stewardOperatorId: input.operatorId,
      reason,
      idempotencyKey: input.idempotencyKey,
      evidenceFingerprint: input.evidenceFingerprint,
      supersedesResolutionId: leaf?.id ?? null,
    })
    if (!resolution) {
      const raced = await tx.findResolutionByIdempotencyKey(input.operatorId, input.idempotencyKey)
      if (raced && sameCommand(raced, input)) return raced
      return conflict('Evidence exception was resolved concurrently')
    }
    await tx.appendAudit({
      operatorId: input.operatorId,
      evidenceId: input.evidenceId,
      resolutionId: resolution.id,
    })
    return resolution
  })
}
