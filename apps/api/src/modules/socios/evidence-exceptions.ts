import { BusinessError, ErrorCode } from '@athlos/errors'

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
    if (!resolution) return conflict('Evidence exception was resolved concurrently')
    await tx.appendAudit({
      operatorId: input.operatorId,
      evidenceId: input.evidenceId,
      resolutionId: resolution.id,
    })
    return resolution
  })
}
