import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Auth API tests (TASK-038 prerequisite, PR 8c.2).
 *
 * Covers the `/api/v1/auth/me` + `/api/v1/auth/change-password`
 * contract from `apps/api/src/routes/auth.ts:65-87`:
 *
 *   - `getMe()`
 *       → `GET /api/v1/auth/me` (auth required)
 *       → `{ id, username, role, can_reprint, can_anulate, is_active,
 *             last_login_at, created_at }`
 *
 *   - `changePassword(currentPassword, newPassword)`
 *       → `POST /api/v1/auth/change-password` (auth required)
 *       body: `{ current_password, new_password }`
 *       → `{ message: 'Password changed' }`
 *
 * Used by `/admin/settings` to display the current operator profile
 * (TASK-039) and stub the change-password flow (TASK-038). The
 * change-password endpoint is real backend-side; the UI just wires
 * the form. For PR 8c.2 the settings page renders a disabled button
 * labeled "Próximamente" — the form lands in a follow-up slice.
 *
 * We mock the shared `apiFetch` so the test stays focused on the
 * wrapper contract (path + body + return shape).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { getMe, changePassword } = await import('./auth')

const SAMPLE_ME = {
  id: 'op-1',
  username: 'admin',
  role: 'ADMIN' as const,
  can_reprint: true,
  can_anulate: true,
  is_active: true,
  last_login_at: '2026-06-28T10:00:00.000Z',
  created_at: '2024-01-15T08:00:00.000Z',
}

describe('auth API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('getMe()', () => {
    it('calls GET /api/v1/auth/me (no params) and returns the operator profile', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_ME)

      const result = await getMe()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/me')
      expect(result).toEqual(SAMPLE_ME)
    })

    it('returns the wire shape: id, username, role, permissions, is_active, timestamps', async () => {
      apiFetchMock.mockResolvedValueOnce(SAMPLE_ME)

      const result = await getMe()

      expect(result.id).toBe('op-1')
      expect(result.username).toBe('admin')
      expect(result.role).toBe('ADMIN')
      expect(result.can_reprint).toBe(true)
      expect(result.can_anulate).toBe(true)
      expect(result.is_active).toBe(true)
      expect(result.last_login_at).toBe('2026-06-28T10:00:00.000Z')
      expect(result.created_at).toBe('2024-01-15T08:00:00.000Z')
    })

    it('handles null last_login_at for operators who have never logged in', async () => {
      apiFetchMock.mockResolvedValueOnce({ ...SAMPLE_ME, last_login_at: null })

      const result = await getMe()

      expect(result.last_login_at).toBeNull()
    })

    it('propagates ApiError(401) when the token is missing or expired', async () => {
      const unauthorized = Object.assign(new Error('UNAUTHORIZED: token expired'), {
        status: 401,
        code: 'UNAUTHORIZED',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(unauthorized)

      await expect(getMe()).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      })
    })
  })

  describe('changePassword(currentPassword, newPassword)', () => {
    it('POSTs to /api/v1/auth/change-password with { current_password, new_password }', async () => {
      apiFetchMock.mockResolvedValueOnce({ message: 'Password changed' })

      const result = await changePassword('OldP@ssw0rd', 'NewP@ssw0rd1')

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/auth/change-password', {
        method: 'POST',
        body: { current_password: 'OldP@ssw0rd', new_password: 'NewP@ssw0rd1' },
      })
      expect(result.message).toBe('Password changed')
    })

    it('propagates ApiError(401) when the current password is wrong (INVALID_CREDENTIALS)', async () => {
      const wrongPassword = Object.assign(new Error('INVALID_CREDENTIALS: incorrect'), {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(wrongPassword)

      await expect(changePassword('WrongPwd', 'NewP@ssw0rd1')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CREDENTIALS',
      })
    })

    it('propagates ApiError(400) when the new password is too short (server-side zod check)', async () => {
      const badRequest = Object.assign(new Error('VALIDATION_ERROR: too short'), {
        status: 400,
        code: 'VALIDATION_ERROR',
        name: 'ApiError',
      })
      apiFetchMock.mockRejectedValueOnce(badRequest)

      await expect(changePassword('OldP@ssw0rd', 'short')).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      })
    })
  })
})
