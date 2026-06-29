import { apiFetch } from '@/lib/api'

/**
 * Auth API wrappers (TASK-038, PR 8c.2).
 *
 * Two endpoints from `apps/api/src/routes/auth.ts:65-87`:
 *
 *   - `GET  /api/v1/auth/me`
 *       Returns the caller's operator profile (no password hash).
 *       Powers the `/admin/settings` page (TASK-038).
 *
 *   - `POST /api/v1/auth/change-password`
 *       Verifies the current password + zod-validates the new one
 *       (≥8 chars), then updates. Returns `{ message: 'Password changed' }`.
 *       The settings page renders a disabled "Próximamente" button
 *       for this in PR 8c.2; the form lands in a follow-up slice.
 *
 * Both endpoints require auth (`requireAuth()` server-side). The
 * shared `apiFetch` wrapper sends the bearer token + retries on
 * 401 (see `lib/api.ts` for the single-flight refresh logic).
 */

export type OperatorRole = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'

/** Shape of `GET /api/v1/auth/me` — mirrors `OperatorDTO` in
 *  `apps/api/src/services/auth.ts:27-36`. The `last_login_at`
 *  field is nullable for operators who have never logged in. */
export interface OperatorProfile {
  id: string
  username: string
  role: OperatorRole
  can_reprint: boolean
  can_anulate: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

export interface ChangePasswordResponse {
  message: string
}

/**
 * `getMe()` — fetch the current operator's profile. Used by
 * `/admin/settings` to render username + role + last login.
 * Returns 401 if the caller's token is expired/revoked — the
 * shared wrapper handles refresh + redirect.
 */
export function getMe(): Promise<OperatorProfile> {
  return apiFetch<OperatorProfile>('/api/v1/auth/me')
}

/**
 * `changePassword(currentPassword, newPassword)` — change the
 * caller's password. The server verifies `current_password`
 * against the bcrypt hash (returns 401 `INVALID_CREDENTIALS`
 * on mismatch) and zod-validates the new password (≥8 chars,
 * returns 400 `VALIDATION_ERROR` on too-short).
 *
 * **PR 8c.2 note**: not wired to a form yet. The settings page
 * renders a disabled "Próximamente" placeholder until a
 * follow-up slice ships the full form.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  return apiFetch<ChangePasswordResponse>('/api/v1/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })
}
