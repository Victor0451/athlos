import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Approvals API tests (TASK-035 prerequisite, PR 8c.2).
 *
 * Covers the approval read + decision contract from
 * `apps/api/src/routes/approval.ts`:
 *
 *   - `getApproval(token)`
 *       → `GET /api/v1/approval/:token`
 *       → `{ action_type, action_id, context_summary, created_by,
 *             expires_at, status }`
 *
 *   - `recordApprovalDecision(token, decision, reason?)`
 *       → `POST /api/v1/approval/:token`
 *       body: `{ decision: 'approve' | 'reject', reason?: string }`
 *       → `{ decision: 'approved' | 'rejected', action_type, action_id,
 *             decided_at }`
 *
 * The detail page uses both: it loads the context on mount and POSTs
 * the decision on confirm. The executor is a backend STUB per the
 * approval route's TODO — the UI records intent, not action.
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + body + return shape). The auth header /
 * 401 retry logic is already covered by `src/lib/api.test.ts`.
 *
 * The wire shape mirrors `apps/api/src/routes/approval.ts:58-65`
 * (the public `ApprovalContextResponse` interface).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getApproval, recordApprovalDecision } = await import('./approvals')

const SAMPLE_CONTEXT = {
  action_type: 'ctacte.anulate',
  action_id: 'mov-12345',
  context_summary: 'Anulación de movimiento por error de carga',
  created_by: { operator_id: 'op-tesorero-1' },
  expires_at: '2026-06-30T10:00:00.000Z',
  status: 'pending' as const,
}

describe('approvals API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getApproval(token)', () => {
    it('calls GET /api/v1/approval/<token> and returns the approval context', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CONTEXT)

      const result = await getApproval('abc123token')

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/approval/abc123token')
      expect(result).toEqual(SAMPLE_CONTEXT)
    })

    it('returns the wire shape: action_type, action_id, context_summary, created_by, expires_at, status', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CONTEXT)

      const result = await getApproval('abc123token')

      expect(result.action_type).toBe('ctacte.anulate')
      expect(result.action_id).toBe('mov-12345')
      expect(result.context_summary).toBe('Anulación de movimiento por error de carga')
      expect(result.created_by).toEqual({ operator_id: 'op-tesorero-1' })
      expect(result.expires_at).toBe('2026-06-30T10:00:00.000Z')
      expect(result.status).toBe('pending')
    })

    it('propagates ApiError(410) for an expired or already-used token', async () => {
      const gone = Object.assign(new Error('APPROVAL_TOKEN_GONE: token used or expired'), {
        status: 410,
        code: 'APPROVAL_TOKEN_GONE',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(gone)

      await expect(getApproval('used-token')).rejects.toMatchObject({
        status: 410,
        code: 'APPROVAL_TOKEN_GONE',
      })
    })

    it('preserves the token in the URL path (URL-encoded)', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_CONTEXT)

      await getApproval('token-with/slash')

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/approval/token-with%2Fslash')
    })
  })

  describe('recordApprovalDecision(token, decision, reason?)', () => {
    it('POSTs to /api/v1/approval/<token> with { decision: "approve" } and no reason', async () => {
      const response = {
        decision: 'approved' as const,
        action_type: 'ctacte.anulate',
        action_id: 'mov-12345',
        decided_at: '2026-06-28T12:00:00.000Z',
      }
      apiFetchMock.mockResolvedValueOnce(response)

      const result = await recordApprovalDecision('abc123token', 'approve')

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/approval/abc123token', {
        method: 'POST',
        body: { decision: 'approve' },
      })
      expect(result).toEqual(response)
    })

    it('POSTs with { decision: "reject", reason } when rejecting', async () => {
      const response = {
        decision: 'rejected' as const,
        action_type: 'ctacte.anulate',
        action_id: 'mov-12345',
        decided_at: '2026-06-28T12:01:00.000Z',
      }
      apiFetchMock.mockResolvedValueOnce(response)

      const result = await recordApprovalDecision('abc123token', 'reject', 'Operación no procede')

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/approval/abc123token', {
        method: 'POST',
        body: { decision: 'reject', reason: 'Operación no procede' },
      })
      expect(result.decision).toBe('rejected')
    })

    it('returns the server-decided shape: decision + action_type + action_id + decided_at', async () => {
      apiFetchMock.mockResolvedValueOnce({
        decision: 'approved',
        action_type: 'ctacte.anulate',
        action_id: 'mov-99',
        decided_at: '2026-06-28T13:00:00.000Z',
      })

      const result = await recordApprovalDecision('tok', 'approve')

      expect(result.decision).toBe('approved')
      expect(result.action_type).toBe('ctacte.anulate')
      expect(result.action_id).toBe('mov-99')
      expect(result.decided_at).toBe('2026-06-28T13:00:00.000Z')
    })

    it('propagates ApiError(400) when rejecting without a reason (REASON_REQUIRED)', async () => {
      const reasonRequired = Object.assign(new Error('REASON_REQUIRED: A reason is required'), {
        status: 400,
        code: 'REASON_REQUIRED',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(reasonRequired)

      await expect(recordApprovalDecision('tok', 'reject')).rejects.toMatchObject({
        status: 400,
        code: 'REASON_REQUIRED',
      })
    })

    it('propagates ApiError(410) when the token has already been used', async () => {
      const gone = Object.assign(new Error('APPROVAL_TOKEN_GONE: token already used'), {
        status: 410,
        code: 'APPROVAL_TOKEN_GONE',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(gone)

      await expect(recordApprovalDecision('used', 'approve')).rejects.toMatchObject({
        status: 410,
      })
    })
  })
})
