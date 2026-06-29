import type { ApprovalContext } from '@/lib/api/approvals'

/**
 * ApprovalCard — context card for a single approval token
 * (TASK-037, PR 8c.2).
 *
 * Renders the action_type + action_id + context_summary + expiry
 * + status of one approval token, plus optional Approve / Reject
 * buttons when the status is `pending`. Used by the detail page
 * at `/admin/approvals/[token]` (TASK-036).
 *
 * Visual contract (Gorriti Premium tokens):
 *   - Container: white surface, ink-100 border, rounded-lg
 *   - action_type: translated to a human-readable Spanish label
 *     (`ctacte.anulate` → "Anulación en cuenta corriente") and
 *     rendered as the primary heading
 *   - action_id: mono font, small, ink-500
 *   - context_summary: body text, ink-700
 *   - expires_at: mono, xs, ink-500, es-AR locale
 *   - StatusBadge: status → StatusBadgeKind map (pending → unknown
 *     tint; approved → healthy; rejected → down; expired → disabled)
 *   - Action buttons: hidden when status !== 'pending' (already
 *     decided tokens render read-only)
 *
 * The component is pure presentation — the parent page owns the
 * mutation lifecycle (TanStack Query) and passes `pending` to
 * disable the buttons during in-flight calls.
 *
 * NOTE on the executor STUB: when the user clicks Approve, the
 * backend records the decision but does NOT execute the underlying
 * ctacte.anulate / payment_order action — that's a STUB until the
 * approval executor lands. The detail page renders
 * "Aprobación registrada — la ejecución real queda pendiente"
 * after a successful POST rather than "Anulación aplicada" to
 * keep operator trust honest. This component does NOT show that
 * copy (it shows the buttons or the result badge).
 */

const DATETIME_FMT = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return DATETIME_FMT.format(d)
}

/**
 * Map the API's action_type codes to Spanish display labels. New
 * codes can be added as the executor lands — keep the fallback
 * generic so an unknown code renders the raw value rather than
 * breaking the UI.
 */
const ACTION_TYPE_LABELS: Record<string, string> = {
  'ctacte.anulate': 'Anulación en cuenta corriente',
  payment_order: 'Orden de pago',
}

function actionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] ?? actionType
}

const STATUS_LABEL: Record<ApprovalContext['status'], string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  expired: 'Vencida',
}

/** Tailwind tint per status — used for the custom status pill.
 *  Keeps the approval vocabulary distinct from the scheduler's
 *  StatusBadge (Operativo/Caído/Deshabilitado). */
const STATUS_PILL_CLASSES: Record<ApprovalContext['status'], string> = {
  pending: 'bg-warning text-ink-900',
  approved: 'bg-success text-white',
  rejected: 'bg-danger text-white',
  expired: 'bg-surface-sunken text-ink-500',
}

export interface ApprovalCardProps {
  token: string
  approval: ApprovalContext
  onApprove: (token: string) => void
  onReject: (token: string) => void
  /** True while the decision POST is in-flight; disables buttons. */
  pending?: boolean
}

export function ApprovalCard({
  token,
  approval,
  onApprove,
  onReject,
  pending = false,
}: ApprovalCardProps) {
  const isPending = approval.status === 'pending'
  const statusLabel = STATUS_LABEL[approval.status]
  const statusClasses = STATUS_PILL_CLASSES[approval.status]

  return (
    <section
      role="region"
      aria-label="Token de aprobación"
      data-testid="approval-card"
      className="rounded-lg border border-ink-100 bg-surface p-6"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            {actionTypeLabel(approval.action_type)}
          </h2>
          <span className="font-mono text-xs text-ink-500" data-testid="approval-action-id">
            {approval.action_id}
          </span>
        </div>
        <span
          role="status"
          aria-label={statusLabel}
          data-testid="approval-status-pill"
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-widest ${statusClasses}`}
        >
          {statusLabel}
        </span>
      </header>

      <p className="mt-3 font-body text-sm text-ink-700">{approval.context_summary}</p>

      <p className="mt-4 font-mono text-xs text-ink-500">
        <span className="uppercase tracking-widest">Vence</span>{' '}
        <span data-testid="approval-expires-at">{formatTimestamp(approval.expires_at)}</span>
        <span aria-hidden="true"> · </span>
        <span className="uppercase tracking-widest">Solicitado por</span>{' '}
        <span data-testid="approval-created-by">{approval.created_by.operator_id}</span>
      </p>

      {isPending ? (
        <div className="mt-5 flex flex-wrap items-center gap-3" data-testid="approval-actions">
          <button
            type="button"
            onClick={() => onApprove(token)}
            disabled={pending}
            data-testid="approval-approve"
            className="rounded-md bg-success px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aprobar
          </button>
          <button
            type="button"
            onClick={() => onReject(token)}
            disabled={pending}
            data-testid="approval-reject"
            className="rounded-md border border-danger px-4 py-2 font-display text-sm font-semibold text-danger transition-colors duration-fast hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rechazar
          </button>
          {pending ? (
            <span className="font-body text-sm text-ink-500" aria-live="polite">
              Registrando decisión…
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
