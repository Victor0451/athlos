'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApproval, recordApprovalDecision } from '@/lib/api/approvals'
import { useAuth } from '@/lib/use-auth'
import { ApprovalCard } from '@/components/admin/ApprovalCard'

/**
 * Approval detail page — `/admin/approvals/[token]` (TASK-036,
 * PR 8c.2).
 *
 * ADMIN's view of one approval token. Loads the context from
 * `GET /api/v1/approval/:token` via TanStack Query and renders
 * `<ApprovalCard>` with the Approve / Reject controls.
 *
 * CRITICAL UX — the approval executor is a backend STUB (see
 * `apps/api/src/routes/approval.ts:91-133`). When the user
 * clicks Approve, the API records the decision but does NOT
 * execute the underlying ctacte.anulate / payment_order action.
 * The page MUST show "Aprobación registrada — la ejecución real
 * queda pendiente" rather than "Anulación aplicada" or
 * "Aprobado" to keep operator trust honest. This is a TRUST
 * issue — the user MUST know what the system actually did.
 *
 * State management:
 *   - `useQuery(['approval', token])` is the source of truth
 *   - `useMutation` wraps `recordApprovalDecision` with
 *     `onSuccess` invalidating the query so the page refetches
 *     the updated token (status → approved/rejected)
 *   - The mutation's `onSuccess` toggles a local "decided" flag
 *     that switches the success copy from "Aprobación registrada"
 *     to "Rechazo registrado" based on the decision payload
 *   - The reject flow uses a local `rejectOpen` state to swap
 *     the action area with an inline form (reason textarea +
 *     Confirmar / Cancelar buttons)
 *
 * The page does NOT call the actual business action (ctacte.anulate
 * / payment_order) — that's the executor's job, which lands in
 * a follow-up slice. The decision is recorded against the token
 * only.
 */

type Decision = 'approve' | 'reject'

interface DecisionFeedback {
  decision: Decision
}

export default function ApprovalDetailPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const approvalQuery = useQuery({
    queryKey: ['approval', token],
    queryFn: () => getApproval(token),
    enabled: isAdmin && token.length > 0,
    retry: 0,
  })

  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState<DecisionFeedback | null>(null)

  const decideMutation = useMutation({
    mutationFn: (vars: { decision: Decision; reason?: string }) =>
      recordApprovalDecision(token, vars.decision, vars.reason),
    onSuccess: (data) => {
      setFeedback({ decision: data.decision === 'approved' ? 'approve' : 'reject' })
      void queryClient.invalidateQueries({ queryKey: ['approval', token] })
    },
  })

  // Role gate first (no fetch fires if not ADMIN).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Administración</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
          <p className="mt-1 text-sm text-ink-500">
            Revisión y seguimiento de una decisión operativa.
          </p>
        </header>
        <div
          role="alert"
          data-testid="approval-detail-no-permission"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-1 text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
          <Link
            href="/admin/approvals"
            className="mt-4 inline-block font-body text-sm text-accent hover:text-accent-hover"
          >
            Volver al listado
          </Link>
        </div>
      </div>
    )
  }

  if (approvalQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Cargando"
        data-testid="approval-detail-loading"
        className="space-y-4"
      >
        <div aria-hidden="true" className="h-8 w-64 animate-pulse rounded bg-surface-sunken" />
        <div aria-hidden="true" className="h-48 animate-pulse rounded bg-surface-sunken" />
        <span className="sr-only">Cargando…</span>
      </div>
    )
  }

  if (approvalQuery.isError) {
    // Duck-typed status check (works for both real ApiError and the
    // test's Object.assign mocks). 410 → "Token vencido o ya
    // utilizado", any other failure → generic error copy.
    const status = (approvalQuery.error as { status?: number } | null)?.status
    const isGone = status === 410
    return (
      <div className="space-y-6">
        <header>
          <Link
            href="/admin/approvals"
            data-testid="approval-back-link"
            className="font-body text-sm text-accent hover:text-accent-hover"
          >
            ← Volver al listado
          </Link>
          <p className="mt-2 font-mono text-xs uppercase tracking-widest text-accent">
            Administración
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink-900">
            {isGone ? 'Token vencido o ya utilizado' : 'No se pudo cargar el token'}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Revisión y seguimiento de una decisión operativa.
          </p>
        </header>
        <div
          role="alert"
          data-testid={isGone ? 'approval-detail-gone' : 'approval-detail-error'}
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">
            {isGone ? 'Token vencido o ya utilizado' : 'No se pudo cargar el token'}
          </p>
          <p className="mt-1 text-ink-500">
            {isGone
              ? `El token "${token}" ya fue consumido o expiró. Solicite al solicitante un nuevo enlace.`
              : 'Verifique la conectividad con el API o intente nuevamente más tarde.'}
          </p>
        </div>
      </div>
    )
  }

  const approval = approvalQuery.data!

  function onApprove(_tokenValue: string) {
    decideMutation.mutate({ decision: 'approve' })
  }

  function onReject(_tokenValue: string) {
    setRejectOpen(true)
    setReason('')
  }

  function onConfirmReject() {
    const trimmed = reason.trim()
    if (trimmed.length === 0) return
    decideMutation.mutate({ decision: 'reject', reason: trimmed })
  }

  function onCancelReject() {
    setRejectOpen(false)
    setReason('')
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/approvals"
          data-testid="approval-back-link"
          className="font-body text-sm text-accent hover:text-accent-hover"
        >
          ← Volver al listado
        </Link>
        <p className="mt-2 font-mono text-xs uppercase tracking-widest text-accent">
          Administración
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
        <p className="mt-1 text-sm text-ink-500">
          Revisión y seguimiento de una decisión operativa.
        </p>
      </header>

      {feedback ? (
        <div
          role="status"
          data-testid="approval-feedback"
          className="rounded-lg border border-warning bg-warning/10 p-4 shadow-sm"
        >
          <p className="font-display text-base font-semibold text-ink-900">
            {feedback.decision === 'approve'
              ? 'Aprobación registrada — la ejecución real queda pendiente'
              : 'Rechazo registrado — la ejecución real queda pendiente'}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            El ejecutor de aprobaciones se habilita en una próxima versión. Por ahora la decisión
            quedó asentada pero la acción subyacente (anulación u orden de pago) aún no se aplicó.
          </p>
        </div>
      ) : null}

      {rejectOpen ? (
        <section
          aria-label="Confirmar rechazo"
          data-testid="approval-reject-form"
          className="rounded-lg border border-danger bg-surface p-4 shadow-sm"
        >
          <h2 className="font-display text-base font-semibold text-ink-900">Confirmar rechazo</h2>
          <p className="mt-1 font-body text-sm text-ink-500">
            Indique el motivo del rechazo. El solicitante recibirá esta justificación.
          </p>
          <label htmlFor="approval-reject-reason" className="sr-only">
            Motivo del rechazo
          </label>
          <textarea
            id="approval-reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="approval-reject-reason"
            className="mt-3 min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-900 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="Motivo del rechazo…"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onConfirmReject}
              disabled={reason.trim().length === 0 || decideMutation.isPending}
              data-testid="approval-reject-confirm"
              className="min-h-11 rounded-md bg-danger px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {decideMutation.isPending ? 'Registrando…' : 'Confirmar rechazo'}
            </button>
            <button
              type="button"
              onClick={onCancelReject}
              disabled={decideMutation.isPending}
              data-testid="approval-reject-cancel"
              className="min-h-11 rounded-md border border-ink-200 bg-surface px-4 py-2 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      <ApprovalCard
        token={token}
        approval={approval}
        pending={decideMutation.isPending}
        onApprove={onApprove}
        onReject={onReject}
      />

      {decideMutation.isError ? (
        <div
          role="alert"
          data-testid="approval-decide-error"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">
            No se pudo registrar la decisión
          </p>
          <p className="mt-1 text-ink-700">
            Verifique la conectividad con el API o intente nuevamente más tarde.
          </p>
        </div>
      ) : null}
    </div>
  )
}
