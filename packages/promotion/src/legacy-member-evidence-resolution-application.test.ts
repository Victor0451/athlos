import { describe, expect, it } from 'vitest'
import {
  applyLegacyMemberEvidenceResolutions,
  resolutionApplicationFingerprint,
} from './legacy-member-evidence-resolution-application.ts'

const valid: Parameters<typeof resolutionApplicationFingerprint>[0][number] = {
  evidence_id: 'evidence-a',
  evidence_kind: 'unknown_type' as const,
  content_hash: 'a'.repeat(64),
  resolution_id: 'resolution-a',
  resolution_kind: 'unknown_type',
  evidence_fingerprint: 'a'.repeat(64),
  resolution_reason: 'verified source',
  steward_operator_id: 'steward-a',
  resolution_key: 'resolution-a',
  selected_member_id: 'member-a',
  selected_type_id: 'type-a',
  member_exists: true,
  type_exists: true,
}
function source(leaves = [valid], existing?: Record<string, unknown>, fail = false) {
  const calls: string[] = []
  return {
    calls,
    async acquire() {
      return {
        async query(text: string) {
          calls.push(text)
          if (text.includes('FROM socios.legacy_member_evidence e')) return { rows: leaves }
          if (text.includes('application_receipts') && text.startsWith('SELECT'))
            return { rows: existing ? [existing] : [] }
          if (
            fail &&
            text.startsWith('INSERT INTO socios.legacy_member_evidence_resolution_applications')
          )
            throw new Error('insert failed')
          return { rows: [] }
        },
        release() {},
      }
    },
  }
}

describe('applyLegacyMemberEvidenceResolutions', () => {
  it('binds active leaves deterministically independent of query ordering', () => {
    expect(resolutionApplicationFingerprint([valid, { ...valid, evidence_id: 'evidence-b' }])).toBe(
      resolutionApplicationFingerprint([{ ...valid, evidence_id: 'evidence-b' }, valid]),
    )
  })

  it('appends an overlay and a receipt atomically without mutating source evidence', async () => {
    const db = source()
    await expect(
      applyLegacyMemberEvidenceResolutions(db, 'batch-a', 'execution-a'),
    ).resolves.toMatchObject({
      eligibleCount: 1,
      appliedCount: 1,
      unresolvedCount: 0,
      unresolvedUnknownTypeCount: 0,
      unresolvedAmbiguousIdentityCount: 0,
      staleCount: 0,
      technicalCount: 0,
    })
    expect(db.calls.some((sql) => /^\s*(UPDATE|DELETE)/.test(sql))).toBe(false)
    expect(db.calls.at(-1)).toBe('COMMIT')
  })

  it('plans a deterministic ambiguous-identity resolution as applied', async () => {
    await expect(
      applyLegacyMemberEvidenceResolutions(
        source([
          { ...valid, evidence_kind: 'ambiguous_identity', resolution_kind: 'ambiguous_identity' },
        ]),
        'batch-a',
        'execution-ambiguous',
      ),
    ).resolves.toMatchObject({ appliedCount: 1, staleCount: 0 })
  })

  it('replays exact committed truth and rejects incompatible or forked leaves', async () => {
    const fingerprint = resolutionApplicationFingerprint([valid])
    const existing = {
      selected_batch_id: 'batch-a',
      applicationFingerprint: fingerprint,
      eligibleCount: 1,
      appliedCount: 1,
      unresolvedCount: 0,
      unresolvedUnknownTypeCount: 0,
      unresolvedAmbiguousIdentityCount: 0,
      staleCount: 0,
      technicalCount: 0,
      status: 'committed',
    }
    await expect(
      applyLegacyMemberEvidenceResolutions(source([valid], existing), 'batch-a', 'execution-a'),
    ).resolves.toMatchObject({ appliedCount: 1 })
    await expect(
      applyLegacyMemberEvidenceResolutions(
        source([{ ...valid, resolution_id: 'successor' }], existing),
        'batch-a',
        'execution-a',
      ),
    ).rejects.toThrow('Incompatible resolution application binding')
    await expect(
      applyLegacyMemberEvidenceResolutions(
        source([{ ...valid, evidence_fingerprint: 'b'.repeat(64) }]),
        'batch-a',
        'execution-b',
      ),
    ).resolves.toMatchObject({ staleCount: 1 })
  })

  it('rolls back an incomplete overlay and keeps technical cases out of business resolution', async () => {
    const db = source(
      [{ ...valid, evidence_kind: 'missing_identity', resolution_id: null }],
      undefined,
      true,
    )
    await expect(
      applyLegacyMemberEvidenceResolutions(db, 'batch-a', 'execution-a'),
    ).resolves.toMatchObject({ technicalCount: 1, appliedCount: 0 })
    const failed = source([valid], undefined, true)
    await expect(
      applyLegacyMemberEvidenceResolutions(failed, 'batch-a', 'execution-b'),
    ).rejects.toThrow('insert failed')
    expect(failed.calls.at(-1)).toBe('ROLLBACK')
  })
})
