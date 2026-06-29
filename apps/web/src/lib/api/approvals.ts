import { apiFetch } from '@/lib/api'

/**
 * Approvals API wrappers (TASK-035, PR 8c.2).
 *
 * Wraps the public-by-token approval routes from
 * `apps/api/src/routes/approval.ts:78-136`:
 *
 *   - `GET  /api/v1/approval/:token` — returns the action context
 *     (no auth: the token IS the auth). Powers the admin detail
 *     page at `/admin/approvals/[token]`.
 *
 *   - `POST /api/v1/approval/:token` — records the decision
 *     (`approve` | `reject`, optional reason on reject). The
 *     executor is a backend STUB per the route's TODO — the
 *     response confirms the decision was recorded, NOT that
 *     the underlying ctacte.anulate / payment_order action
 *     was applied. The UI shows "Aprobación registrada — la
 *     ejecución real queda pendiente" rather than "Anulación
 *     aplicada" to keep operator trust honest.
 *
 * There is no `/api/v1/approvals` (plural) list endpoint in the
 * v0.5.x backend — the admin queue at `/admin/approvals` is a
 * "Próximamente" placeholder per design.md §8 (deferred to the
 * Phase 9 backend slice that lands a list-pending-tokens route).
 * When that endpoint ships, this file grows a `listPendingApprovals()`
 * function and the list page flips on the real data.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalContext {
  action_type: string
  action_id: string
  context_summary: string
  created_by: { operator_id: string }
  expires_at: string
  status: ApprovalStatus
}

export type ApprovalDecision = 'approved' | 'rejected'

export interface ApprovalDecisionResponse {
  decision: ApprovalDecision
  action_type: string
  action_id: string
  decided_at: string
}

/**
 * `getApproval(token)` — load the approval context for a single
 * token. Returns the action summary (what needs approval) +
 * expiry + status. The token in the URL is the authorization —
 * no bearer token is required by the route, but `apiFetch`
 * still sends the operator's bearer if one is in memory (the
 * route ignores it; only the URL token matters).
 *
 * Throws `ApiError(410 APPROVAL_TOKEN_GONE)` for expired or
 * already-used tokens — rendered as "Token vencido o ya
 * utilizado" on the detail page.
 */
export function getApproval(token: string): Promise<ApprovalContext> {
  return apiFetch<ApprovalContext>(`/api/v1/approval/${encodeURIComponent(token)}`)
}

/**
 * `recordApprovalDecision(token, decision, reason?)` — POST the
 * operator's decision to the backend. Body shape:
 *   `{ decision: 'approve' | 'reject', reason?: string }`
 *
 * The server requires a reason on reject (`REASON_REQUIRED` →
 * 400) — the detail page's reject form makes this explicit.
 *
 * **Important UX note**: the response confirms the DECISION was
 * recorded, not that the underlying action was executed. The
 * approval executor is a backend STUB — when an ADMIN approves
 * a `ctacte.anulate` request, the UI MUST show "Aprobación
 * registrada — ejecución real pendiente" rather than
 * "Anulación aplicada", to keep operator trust honest. The
 * detail page handles this copy.
 */
export function recordApprovalDecision(
  token: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<ApprovalDecisionResponse> {
  const body: { decision: 'approve' | 'reject'; reason?: string } = { decision }
  if (reason !== undefined) body.reason = reason
  return apiFetch<ApprovalDecisionResponse>(`/api/v1/approval/${encodeURIComponent(token)}`, {
    method: 'POST',
    body,
  })
}
