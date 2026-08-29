import { expect, it, vi } from 'vitest'
import { AuditAction } from '@athlos/audit'
import { SettlementService } from './settlements.ts'

const seam = vi.hoisted(() => ({ shift: vi.fn(), tender: vi.fn(), reversalTender: vi.fn() }))
vi.mock('./cash-desk.ts', () => ({
  validateSettlementShiftInTransaction: seam.shift,
  recordSettlementTenderInTransaction: seam.tender,
  recordReversalSettlementTenderInTransaction: seam.reversalTender,
}))

const command = {
  actorId: '00000000-0000-4000-8000-000000000001',
  role: 'ADMIN' as const,
  permissions: ['dues:settle'],
  sourceIp: '127.0.0.1',
  callerKey: 'atomic-key',
  requestFingerprint: 'a'.repeat(64),
  authorizationEvidence: { role: 'ADMIN' },
  socioId: '00000000-0000-4000-8000-000000000002',
  obligationIds: ['00000000-0000-4000-8000-000000000003'],
  shiftId: '00000000-0000-4000-8000-000000000004',
  tender: 'CASH' as const,
  selectionFingerprint: 'b'.repeat(64),
}

it.each(['selection', 'claim', 'allocation', 'tender', 'audit'] as const)(
  'does not call a later payment write after %s fails',
  async (failure) => {
    const calls: string[] = [],
      tx = {},
      fail = vi.fn(async () => {
        throw new Error(failure)
      })
    const repository = {
      findSettlementReplay: vi.fn(async () => undefined),
      selectFullOutstanding: vi.fn(async () => {
        calls.push('selection')
        if (failure === 'selection') await fail()
        return {
          currency: 'ARS',
          totalCents: 100,
          allocations: [{ obligationId: command.obligationIds[0], amountCents: 100 }],
        }
      }),
      claimSettlement: vi.fn(async () => {
        calls.push('claim')
        if (failure === 'claim') await fail()
        return {
          status: 'claimed' as const,
          settlement: {
            id: 'settlement',
            kind: 'MONETARY' as const,
            amountCents: 100,
            currency: 'ARS',
          },
        }
      }),
      insertAllocation: vi.fn(async () => {
        calls.push('allocation')
        if (failure === 'allocation') await fail()
        return { id: 'allocation', obligationId: command.obligationIds[0], amountCents: 100 }
      }),
    }
    seam.shift.mockImplementation(async () => {
      calls.push('shift')
    })
    seam.tender.mockImplementation(async () => {
      calls.push('tender')
      if (failure === 'tender') await fail()
    })
    seam.reversalTender.mockImplementation(async () => {
      calls.push('reversal-tender')
    })
    const audit = vi.fn(async (_: unknown, event: { action: string }) => {
      calls.push(event.action)
      if (failure === 'audit') await fail()
      return { inserted: true as const, id: 'audit' }
    })
    const service = new SettlementService(
      { transaction: async (work: (value: unknown) => unknown) => work(tx) } as never,
      { repository: repository as never, audit },
    )
    await expect(service.create(command)).rejects.toThrow(failure)
    expect(calls).toEqual(
      expect.arrayContaining([failure === 'audit' ? AuditAction.DUES_SETTLEMENT_CREATED : failure]),
    )
    if (failure !== 'audit') expect(calls.at(-1)).toBe(failure)
    expect(calls).not.toContain('reversal-tender')
  },
)
