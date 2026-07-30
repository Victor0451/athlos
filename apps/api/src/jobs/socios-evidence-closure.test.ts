import { describe, expect, it, vi } from 'vitest'
import { runSociosEvidenceClosure } from './socios-evidence-closure.ts'

const base = {
  phase: 'members' as const,
  eligibleCount: 1,
  projectedCount: 1,
  exceptionCount: 0,
  unknownTypeCount: 0,
  ambiguousIdentityCount: 0,
  missingIdentityCount: 0,
  status: 'committed' as const,
}
const metadata = (resolutionApplication?: {
  executionIdentity: string
  resolutionSetFingerprint: string
}) => ({
  catalogBatchId: 'catalog',
  sociosBatchId: 'members',
  previewId: 'preview',
  fingerprint: 'f'.repeat(64),
  idempotencyKey: 'original-execution',
  leaseOwner: 'owner',
  leaseFence: 1,
  resolutionApplication,
})
const receipt = (overrides = {}) => ({
  applicationFingerprint: 'a'.repeat(64),
  eligibleCount: 1,
  appliedCount: 1,
  unresolvedCount: 0,
  unresolvedUnknownTypeCount: 0,
  unresolvedAmbiguousIdentityCount: 0,
  staleCount: 0,
  technicalCount: 0,
  status: 'committed' as const,
  ...overrides,
})
const resolution = {
  executionIdentity: 'resolution-execution',
  resolutionSetFingerprint: 'a'.repeat(64),
}

function deps(
  members = base,
  apply = vi.fn(async () => receipt()),
  renew = vi.fn(async () => true),
) {
  return {
    renew,
    release: vi.fn(async () => true),
    now: () => new Date(),
    catalog: vi.fn(async () => undefined),
    candidates: vi.fn(async () => base),
    members: vi.fn(async () => members),
    apply,
  }
}

describe('runSociosEvidenceClosure resolution application', () => {
  it('preserves ordinary closure behavior when no application is requested', async () => {
    const run = deps()
    await expect(runSociosEvidenceClosure(metadata(), run)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: { eligible: 1 },
    })
    expect(run.apply).not.toHaveBeenCalled()
    expect(run.renew).toHaveBeenCalledTimes(3)
  })

  it('succeeds for a fresh execution when every business exception is applied', async () => {
    const run = deps({ ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 })
    await expect(runSociosEvidenceClosure(metadata(resolution), run)).resolves.toMatchObject({
      status: 'succeeded',
      metadata: { applied: 1, resolutionSetFingerprint: 'a'.repeat(64) },
    })
    expect(run.renew).toHaveBeenCalledTimes(5)
  })

  it('finishes with review when an unknown-type resolution remains unresolved', async () => {
    const run = deps(
      { ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 },
      vi.fn(async () =>
        receipt({ appliedCount: 0, unresolvedCount: 1, unresolvedUnknownTypeCount: 1 }),
      ),
    )
    await expect(runSociosEvidenceClosure(metadata(resolution), run)).resolves.toMatchObject({
      status: 'completed_with_review',
      metadata: { unresolvedUnknownType: 1 },
    })
  })

  it.each([
    receipt({ appliedCount: 0, staleCount: 1 }),
    receipt({ appliedCount: 0, technicalCount: 1 }),
  ])('fails when application has stale or technical exceptions', async (application) => {
    const run = deps(
      {
        ...base,
        projectedCount: 0,
        exceptionCount: 1,
        missingIdentityCount: application.technicalCount,
      },
      vi.fn(async () => application),
    )
    await expect(runSociosEvidenceClosure(metadata(resolution), run)).rejects.toThrow(
      'incomplete closure reconciliation',
    )
  })

  it('does not apply or publish after a stale lease fence', async () => {
    const applicationLeases = [true, true, true, false]
    const beforeApplication = deps(
      { ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 },
      vi.fn(async () => receipt()),
      vi.fn(async () => applicationLeases.shift()!),
    )
    await expect(runSociosEvidenceClosure(metadata(resolution), beforeApplication)).rejects.toThrow(
      'lease lost',
    )
    expect(beforeApplication.apply).not.toHaveBeenCalled()

    const publicationLeases = [true, true, true, true, false]
    const beforePublication = deps(
      { ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 },
      vi.fn(async () => receipt()),
      vi.fn(async () => publicationLeases.shift()!),
    )
    await expect(runSociosEvidenceClosure(metadata(resolution), beforePublication)).rejects.toThrow(
      'lease lost',
    )
    expect(beforePublication.apply).toHaveBeenCalledOnce()
  })

  it('replays committed application truth without a duplicate overlay', async () => {
    let applications = 0
    const apply = vi.fn(async () => {
      if (!applications) applications++
      return receipt()
    })
    const first = await runSociosEvidenceClosure(
      metadata(resolution),
      deps({ ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 }, apply),
    )
    const replay = await runSociosEvidenceClosure(
      metadata(resolution),
      deps({ ...base, projectedCount: 0, exceptionCount: 1, unknownTypeCount: 1 }, apply),
    )
    expect(replay.metadata).toEqual(first.metadata)
    expect(applications).toBe(1)
  })
})
