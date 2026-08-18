import { describe, expect, it, vi } from 'vitest'
import { AuditAction } from '@athlos/audit'
import { FamilyGroupService } from './dues-family-groups.ts'
const context = {
  actorId: 'operator-1',
  role: 'ADMIN' as const,
  permissions: ['dues:write'],
  sourceIp: '127.0.0.1',
  callerKey: 'family-command-1',
  requestFingerprint: 'a'.repeat(64),
  authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
}
const db = { transaction: async (callback: (tx: object) => Promise<unknown>) => callback({}) }

describe('family eligibility commands', () => {
  it('audits group and membership mutations without member identity in evidence payloads', async () => {
    const audit = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' })
    const repository = {
      createFamilyGroup: vi.fn().mockResolvedValue({
        id: 'group-1',
      }),
      createFamilyMembership: vi.fn().mockResolvedValue({
        id: 'membership-1',
        familyGroupId: 'group-1',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      }),
      revokeFamilyMembership: vi.fn(),
    }
    const service = new FamilyGroupService(db as never, { repository, audit })
    await service.create({ ...context, id: 'group-1', reason: 'Approved' })
    await service.addMembership({
      ...context,
      familyGroupId: 'group-1',
      socioId: 'member-1',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      reason: 'Approved',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.DUES_FAMILY_GROUP_CREATED,
        newValue: null,
        payload: { familyGroupId: 'group-1' },
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.DUES_FAMILY_MEMBERSHIP_CREATED,
        newValue: null,
        payload: expect.not.objectContaining({ socioId: 'member-1' }),
      }),
    )
  })

  it('rejects non-admin mutations before touching the repository', async () => {
    const createFamilyGroup = vi.fn()
    const service = new FamilyGroupService(db as never, {
      repository: {
        createFamilyGroup,
        createFamilyMembership: vi.fn(),
        revokeFamilyMembership: vi.fn(),
      },
    })
    await expect(
      service.create({ ...context, role: 'TESORERO', reason: 'Denied' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSIONS' })
    expect(createFamilyGroup).not.toHaveBeenCalled()
  })
})
