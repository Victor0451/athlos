import { describe, expect, it } from 'vitest'
import { ErrorCode, type ApiError } from '@athlos/errors'
import {
  getEvidenceException,
  listEvidenceExceptions,
  resolveEvidenceException,
  searchMemberOptions,
  searchMembershipTypeOptions,
  type EvidenceExceptionDetail,
  type EvidenceExceptionRepository,
  type EvidenceResolution,
} from './evidence-exceptions.ts'

const detail: EvidenceExceptionDetail = {
  id: 'evidence-1',
  kind: 'unknown_type',
  status: 'unresolved',
  fingerprint: 'a'.repeat(64),
  legacyTypeCode: 'A',
  createdAt: new Date(),
  sociosBatchId: '00000000-0000-4000-8000-000000000011',
  catalogBatchId: '00000000-0000-4000-8000-000000000010',
  deterministicTypeCandidateSourceRowId: null,
  knownMember: null,
  currentResolution: null,
}
const command = {
  evidenceId: detail.id,
  kind: detail.kind,
  evidenceFingerprint: detail.fingerprint,
  operatorId: 'operator-1',
  idempotencyKey: 'request-1',
  reason: 'Reviewed source record',
  selectedMemberId: 'member-1',
  selectedTypeCandidateSourceRowId: 'type-1',
} as const

function fake(overrides: Partial<EvidenceExceptionRepository> = {}) {
  const resolutions: EvidenceResolution[] = []
  const audits: unknown[] = []
  const repo: EvidenceExceptionRepository = {
    transaction: (work) => work(repo),
    listExceptions: async () => ({ items: [detail], total: 1 }),
    findExceptionDetail: async () => detail,
    searchMemberOptions: async () => [],
    searchMembershipTypeOptions: async () => [],
    findResolutionByIdempotencyKey: async (operatorId, key) =>
      resolutions.find(
        (row) => row.stewardOperatorId === operatorId && row.idempotencyKey === key,
      ) ?? null,
    findResolutionContext: async () => detail,
    hasMember: async (id) => id === 'member-1',
    hasTypeCandidate: async (id) => id === 'type-1',
    findCurrentLeaf: async () => resolutions.at(-1) ?? null,
    appendResolution: async (row) => {
      const created = { ...row, id: `resolution-${resolutions.length + 1}`, createdAt: new Date() }
      resolutions.push(created)
      return created
    },
    appendAudit: async (audit) => void audits.push(audit),
    ...overrides,
  }
  return { repo, resolutions, audits }
}

async function rejects(promise: Promise<unknown>, code: ApiError['code']) {
  await expect(promise).rejects.toMatchObject({ code } satisfies Partial<ApiError>)
}

describe('Socios evidence exceptions', () => {
  it('exposes only the safe paginated query and immutable detail contracts', async () => {
    const { repo } = fake()
    await expect(
      listEvidenceExceptions(repo, { page: 1, limit: 20, status: 'unresolved' }),
    ).resolves.toMatchObject({ total: 1 })
    await expect(getEvidenceException(repo, detail.id)).resolves.toEqual(detail)
  })

  it('caps selectable option searches even if a repository returns more rows', async () => {
    const members = Array.from({ length: 21 }, (_, memberNumber) => ({
      id: `member-${memberNumber}`,
      memberNumber,
      credentialRef: null,
      lifecycleState: 'imported' as const,
    }))
    const types = Array.from({ length: 21 }, (_, index) => ({
      sourceRowId: `type-${index}`,
      snapshotBatchId: 'batch-1',
      code: `A${index}`,
      name: 'Active',
      letter: 'A',
    }))
    const { repo } = fake({
      searchMemberOptions: async () => members,
      searchMembershipTypeOptions: async () => types,
    })
    await expect(searchMemberOptions(repo, '12')).resolves.toHaveLength(20)
    await expect(searchMembershipTypeOptions(repo, 'ac')).resolves.toHaveLength(20)
  })

  it('replays an identical command and conflicts for a changed command with the same key', async () => {
    const { repo, audits } = fake()
    const first = await resolveEvidenceException(repo, command)
    await expect(resolveEvidenceException(repo, command)).resolves.toEqual(first)
    await rejects(
      resolveEvidenceException(repo, { ...command, reason: 'Different' }),
      ErrorCode.CONFLICT,
    )
    expect(audits).toHaveLength(1)
  })

  it('rejects stale evidence and invalid required selections', async () => {
    const withoutType = (({ selectedTypeCandidateSourceRowId: _, ...input }) => input)(command)
    const stale = fake({
      findResolutionContext: async () => ({ ...detail, fingerprint: 'b'.repeat(64) }),
    })
    await rejects(resolveEvidenceException(stale.repo, command), ErrorCode.CONFLICT)
    const invalid = fake()
    await rejects(resolveEvidenceException(invalid.repo, withoutType), ErrorCode.VALIDATION_ERROR)
    const deterministic = fake({
      findResolutionContext: async () => ({
        ...detail,
        kind: 'ambiguous_identity',
        deterministicTypeCandidateSourceRowId: 'type-1',
      }),
    })
    await expect(
      resolveEvidenceException(deterministic.repo, {
        ...withoutType,
        kind: 'ambiguous_identity',
      }),
    ).resolves.toMatchObject({ selectedTypeCandidateSourceRowId: 'type-1' })
    await expect(
      resolveEvidenceException(deterministic.repo, {
        ...withoutType,
        kind: 'ambiguous_identity',
      }),
    ).resolves.toMatchObject({ selectedTypeCandidateSourceRowId: 'type-1' })
  })

  it('rejects a second root resolution because correction is not supported here', async () => {
    const { repo, resolutions } = fake()
    await resolveEvidenceException(repo, command)
    await rejects(
      resolveEvidenceException(repo, {
        ...command,
        idempotencyKey: 'request-2',
      }),
      ErrorCode.CONFLICT,
    )
    expect(resolutions).toHaveLength(1)
    await rejects(
      resolveEvidenceException(fake({ appendResolution: async () => null }).repo, command),
      ErrorCode.CONFLICT,
    )
  })

  it('replays a same-command insert race without emitting a second audit event', async () => {
    const resolution: EvidenceResolution = {
      id: 'resolution-race',
      evidenceId: command.evidenceId,
      kind: command.kind,
      selectedMemberId: command.selectedMemberId,
      selectedTypeCandidateSourceRowId: command.selectedTypeCandidateSourceRowId,
      stewardOperatorId: command.operatorId,
      reason: command.reason,
      idempotencyKey: command.idempotencyKey,
      evidenceFingerprint: command.evidenceFingerprint,
      supersedesResolutionId: null,
      createdAt: new Date(),
    }
    let lookupCount = 0
    const { repo, audits } = fake({
      findResolutionByIdempotencyKey: async () => {
        lookupCount += 1
        return lookupCount === 1 ? null : resolution
      },
      appendResolution: async () => null,
    })
    await expect(resolveEvidenceException(repo, command)).resolves.toEqual(resolution)
    expect(audits).toHaveLength(0)
  })

  it('does not expose a scheduling dependency', async () => {
    const { repo, audits } = fake()
    await resolveEvidenceException(repo, command)
    expect(audits[0]).toMatchObject({ evidenceId: detail.id, resolutionId: 'resolution-1' })
  })
})
