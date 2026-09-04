import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { AssessmentService, type AuditContext } from './service.ts'

const context: AuditContext = {
  actorId: '00000000-0000-4000-8000-000000000001',
  role: 'TESORERO',
  permissions: ['dues:write'],
  sourceIp: null,
  callerKey: 'range-key',
  requestFingerprint: 'a'.repeat(64),
  authorizationEvidence: {},
}
const facts = (
  obligations: Array<{ id: string; periodStart: string; amountCents: number }> = [],
) => ({
  member: { socioId: 'member-1', fechaAlta: '2026-01-01', familyGroupId: null, enrollments: [] },
  prices: [
    {
      versionId: 'base-1',
      kind: 'BASE' as const,
      disciplinaId: null,
      amountCents: 3100,
      currency: 'ARS',
      rule: 'FULL_MONTH' as const,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
  obligations,
})
function repository(overrides: Record<string, unknown> = {}) {
  return {
    claimReceipt: vi.fn().mockResolvedValue({ status: 'claimed', receipt: { id: 'receipt-1' } }),
    finalizeReceipt: vi.fn(),
    lockRange: vi.fn(),
    listAssessmentFacts: vi.fn().mockResolvedValue(facts()),
    resolveBenefitRuleCandidates: vi.fn().mockResolvedValue([]),
    insertObligationInTransaction: vi.fn(async (_tx, input) => ({
      obligation: { id: `ob-${input.periodStart}` },
    })),
    ...overrides,
  }
}
function db() {
  const tx = {}
  return { transaction: vi.fn(async (work: (tx: object) => unknown) => work(tx)) } as never
}
const audit = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' })
const command = {
  ...context,
  socioId: 'member-1',
  fromPeriod: '2026-01',
  throughPeriod: '2026-02',
  previewFingerprint: '',
}

describe('reviewed assessment range execution', () => {
  it('creates each inclusive missing positive period from the reviewed fingerprint with ordered snapshots', async () => {
    const repo = repository(),
      service = new AssessmentService(db(), {
        repository: repo as never,
        audit,
        now: () => new Date('2026-02-15T00:00:00Z'),
      })
    const preview = await service.preview(command)
    const result = await service.executeRange({
      ...command,
      previewFingerprint: preview.fingerprint,
    })
    expect(result).toEqual({
      createdObligationIds: ['ob-2026-01-01', 'ob-2026-02-01'],
      periods: ['2026-01', '2026-02'],
    })
    expect(repo.insertObligationInTransaction).toHaveBeenCalledTimes(2)
    expect(
      repo.insertObligationInTransaction.mock.calls[0]![1].components[0].priceSnapshot.segments,
    ).toEqual([
      expect.objectContaining({ priceVersionId: 'base-1', from: '2026-01-01', to: '2026-02-01' }),
    ])
    expect(repo.finalizeReceipt).toHaveBeenCalledWith(expect.anything(), 'receipt-1', result)
  })

  it.each(['insert', 'audit', 'receipt'] as const)(
    'rolls back the complete range when %s persistence fails',
    async (failure) => {
      const repo = repository(),
        failingAudit = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' })
      if (failure === 'insert')
        repo.insertObligationInTransaction.mockRejectedValueOnce(new Error('insert failed'))
      if (failure === 'receipt')
        repo.finalizeReceipt.mockRejectedValueOnce(new Error('receipt failed'))
      if (failure === 'audit') failingAudit.mockRejectedValueOnce(new Error('audit failed'))
      const service = new AssessmentService(db(), {
        repository: repo as never,
        audit: failingAudit,
        now: () => new Date('2026-02-15T00:00:00Z'),
      })
      const preview = await service.preview(command)
      await expect(
        service.executeRange({ ...command, previewFingerprint: preview.fingerprint }),
      ).rejects.toThrow(`${failure} failed`)
      expect(repo.lockRange).toHaveBeenCalledWith(expect.anything(), 'member-1')
    },
  )

  it.each([
    ['enrollment', { ...facts(), member: { ...facts().member!, fechaAlta: '2026-01-02' } }],
    ['pricing', { ...facts(), prices: [{ ...facts().prices[0], amountCents: 3200 }] }],
    [
      'existing obligation',
      facts([{ id: 'new-obligation', periodStart: '2026-01-01', amountCents: 3100 }]),
    ],
  ])('rejects changed %s facts before every insert', async (_kind, changedFacts) => {
    const repo = repository(),
      service = new AssessmentService(db(), {
        repository: repo as never,
        audit,
        now: () => new Date('2026-02-15T00:00:00Z'),
      })
    const preview = await service.preview(command)
    repo.listAssessmentFacts.mockResolvedValue(changedFacts)
    await expect(
      service.executeRange({ ...command, previewFingerprint: preview.fingerprint }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    expect(repo.insertObligationInTransaction).not.toHaveBeenCalled()
  })

  it('serializes overlapping ranges through the same socio lock', async () => {
    const entered: string[] = [],
      repo = repository({ lockRange: vi.fn(async (_tx, socioId: string) => entered.push(socioId)) })
    const service = new AssessmentService(db(), {
      repository: repo as never,
      audit,
      now: () => new Date('2026-02-15T00:00:00Z'),
    })
    const preview = await service.preview(command)
    await Promise.all([
      service.executeRange({
        ...command,
        callerKey: 'range-a',
        throughPeriod: '2026-01',
        previewFingerprint: (await service.preview({ ...command, throughPeriod: '2026-01' }))
          .fingerprint,
      }),
      service.executeRange({
        ...command,
        callerKey: 'range-b',
        previewFingerprint: preview.fingerprint,
      }),
    ])
    expect(entered).toEqual(['member-1', 'member-1'])
    expect(repo.lockRange).toHaveBeenCalledWith(expect.anything(), 'member-1')
  })

  it('returns zero and existing ranges without inserting and replays the original result', async () => {
    const zeroRepo = repository({
      listAssessmentFacts: vi
        .fn()
        .mockResolvedValue({ ...facts(), prices: [{ ...facts().prices[0], amountCents: 0 }] }),
    })
    const zeroService = new AssessmentService(db(), {
      repository: zeroRepo as never,
      audit,
      now: () => new Date('2026-02-15T00:00:00Z'),
    })
    const zeroPreview = await zeroService.preview(command)
    await expect(
      zeroService.executeRange({ ...command, previewFingerprint: zeroPreview.fingerprint }),
    ).resolves.toEqual({ createdObligationIds: [], periods: ['2026-01', '2026-02'] })
    expect(zeroRepo.insertObligationInTransaction).not.toHaveBeenCalled()
    const replay = { createdObligationIds: ['ob-1'], periods: ['2026-01'] }
    const replayRepo = repository({
      claimReceipt: vi.fn().mockResolvedValue({ status: 'replayed', receipt: {}, result: replay }),
    })
    const replayService = new AssessmentService(db(), { repository: replayRepo as never, audit })
    await expect(
      replayService.executeRange({ ...command, previewFingerprint: 'ignored' }),
    ).resolves.toEqual(replay)
    expect(replayRepo.listAssessmentFacts).not.toHaveBeenCalled()
  })
})
