import { describe, expect, it } from 'vitest'
import { ErrorCode, type ApiError } from '@athlos/errors'
import {
  getEvidenceException,
  listEvidenceExceptions,
  resolveEvidenceException,
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
  memberChoices: [{ id: 'member-1', memberNumber: 1 }],
  typeChoices: [{ sourceRowId: 'type-1', code: 'A', name: 'Active' }],
  deterministicTypeCandidateSourceRowId: null,
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
    ).resolves.toMatchObject({ selectedTypeCandidateSourceRowId: null })
  })

  it('uses the current leaf as the correction predecessor and rejects a concurrent loser', async () => {
    const { repo, resolutions } = fake()
    const first = await resolveEvidenceException(repo, command)
    const correction = await resolveEvidenceException(repo, {
      ...command,
      idempotencyKey: 'request-2',
    })
    expect(correction.supersedesResolutionId).toBe(first.id)
    expect(resolutions).toHaveLength(2)
    await rejects(
      resolveEvidenceException(fake({ appendResolution: async () => null }).repo, command),
      ErrorCode.CONFLICT,
    )
  })

  it('does not expose a scheduling dependency', async () => {
    const { repo, audits } = fake()
    await resolveEvidenceException(repo, command)
    expect(audits[0]).toMatchObject({ evidenceId: detail.id, resolutionId: 'resolution-1' })
  })
})
