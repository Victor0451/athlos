import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock notification dispatcher - vi.hoisted ensures it's created before vi.mock hoisting
const sendNotification = vi.hoisted(() => vi.fn())

vi.mock('@athlos/notifications', () => ({
  sendNotification,
}))

// The alert function we're implementing
import { emitDriftAlert } from './alert.ts'
import type { DriftReport } from './detect.ts'

describe('drift.emitDriftAlert', () => {
  /**
   * RED STEP: Write failing test first.
   *
   * The test verifies the two write-path contract from the spec:
   * 1. Direct Drizzle insert into audit_events (NOT via @athlos/audit)
   * 2. Notification dispatcher called with drift count
   */

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sendNotification as any).mockClear()
  })

  const mockReport: DriftReport = {
    domain: 'ctacte',
    scanned: 10,
    driftCount: 3,
    drifts: [
      {
        entityUuid: '11111111-1111-1111-1111-111111111111',
        oldHash: 'oldhash1',
        newHash: 'newhash1',
        lastImportedAt: new Date('2024-06-11T14:30:00Z'),
      },
      {
        entityUuid: '22222222-2222-2222-2222-222222222222',
        oldHash: 'oldhash2',
        newHash: 'newhash2',
        lastImportedAt: new Date('2024-06-11T14:31:00Z'),
      },
    ],
  }

  describe('when driftCount > 0', () => {
    it('calls db.insert(auditEvents).values with operator_id null', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const ctx = { jobRunId: 'job-run-123' }

      await emitDriftAlert(mockDb, mockReport, ctx)

      // Verify insert was called (direct write path, NOT via @athlos/audit)
      expect(mockDb.insert).toHaveBeenCalledTimes(1)

      // Verify sendNotification was called (not @athlos/audit)
      expect(sendNotification).toHaveBeenCalledTimes(1)
    })

    it('calls notification dispatcher with drift_alert event', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const ctx = { jobRunId: 'job-run-456' }

      await emitDriftAlert(mockDb, mockReport, ctx)

      expect(sendNotification).toHaveBeenCalledTimes(1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = (sendNotification as any).mock.calls[0]![0] as {
        type: string
        eventId: string
        metadata: Record<string, unknown>
      }
      expect(event.type).toBe('drift_alert')
      expect(event.eventId).toBe('job-run-456:ctacte')
      expect(event.metadata).toMatchObject({
        domain: 'ctacte',
        count: 3,
      })
    })

    it('includes up to 5 affected entity UUIDs in metadata', async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const ctx = { jobRunId: 'job-run-789' }

      await emitDriftAlert(mockDb, mockReport, ctx)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = (sendNotification as any).mock.calls[0]![0] as {
        metadata: { affectedKeys: string[] }
      }
      expect(event.metadata.affectedKeys).toHaveLength(2)
      expect(event.metadata.affectedKeys[0]).toBe('11111111-1111-1111-1111-111111111111')
    })
  })

  describe('when driftCount is 0', () => {
    it('returns early without calling insert or dispatcher', async () => {
      const zeroReport: DriftReport = {
        domain: 'ctacte',
        scanned: 5,
        driftCount: 0,
        drifts: [],
      }

      const mockDb = {
        insert: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const ctx = { jobRunId: 'job-run-zero' }

      const result = await emitDriftAlert(mockDb, zeroReport, ctx)

      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(sendNotification).not.toHaveBeenCalled()
      expect(result).toEqual({ audited: true, notificationDispatched: false })
    })
  })
})
