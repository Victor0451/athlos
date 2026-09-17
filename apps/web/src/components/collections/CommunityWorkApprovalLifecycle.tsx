'use client'

import { useId, useRef, useState } from 'react'
import type { CommunityWorkApprovalLifecycle as Lifecycle } from '@/lib/api/community-work-approval'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import {
  collectionButtonClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR'
export type CommunityWorkApprovalStatus =
  | 'idle'
  | 'requesting'
  | 'requested'
  | 'replayed'
  | 'denied'
  | 'transactional_error'
export interface CommunityWorkRequestDraft {
  context: string
  reason: string
  evidence: string
  agreement_id?: string
}
type Props = {
  lifecycle: Lifecycle | null
  role: Role
  requestBusy?: boolean
  actionStatus?: CommunityWorkApprovalStatus
  onRequest?: (draft: CommunityWorkRequestDraft) => Promise<unknown>
  headingLevel?: 3 | 4
}

const stateCopy: Record<Lifecycle['state'], string> = {
  pending: 'Pendiente: la deuda no cambia.',
  rejected: 'Rechazada: la deuda no cambia.',
  expired: 'Vencida: la deuda no cambia.',
  approved_awaiting_execution: 'Aprobada, pero todavía no fue aplicada a la deuda.',
  executed: 'Ejecutada: la deuda autorizada se redujo según el registro confirmado.',
}
const stateBadge: Record<Lifecycle['state'], { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pendiente', variant: 'warning' },
  rejected: { label: 'Rechazada', variant: 'danger' },
  expired: { label: 'Vencida', variant: 'warning' },
  approved_awaiting_execution: { label: 'Aprobada: pendiente de ejecución', variant: 'info' },
  executed: { label: 'Ejecutada', variant: 'success' },
}
const actionCopy: Partial<Record<CommunityWorkApprovalStatus, string>> = {
  requested: 'Solicitud registrada: la deuda no cambia hasta que Tesorería apruebe y ejecute.',
  replayed: 'Se recuperó una solicitud ya registrada; no se envió por segunda vez.',
  denied: 'El servidor no te permite solicitar este trabajo comunitario. La deuda no cambió.',
  transactional_error: 'No se pudo registrar la solicitud. La deuda no cambió. Intentá nuevamente.',
}
const utcDateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  timeStyle: 'short',
  hourCycle: 'h23',
  timeZone: 'UTC',
})
const dateTime = (value: string) => utcDateTime.format(new Date(value))
const amount = (cents: number, currency: string) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .format(cents / 100)
    .replace(/\u00a0/g, ' ')

export function CommunityWorkApprovalLifecycle({
  lifecycle,
  role,
  requestBusy = false,
  actionStatus = 'idle',
  onRequest,
  headingLevel = 3,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState({ context: '', reason: '', evidence: '', agreement_id: '' })
  const formOpenRef = useRef(false)
  const inFlight = useRef(false)
  const section = useRef<HTMLElement>(null)
  const titleId = `${useId()}-community-work-approval-title`
  const feedback = actionCopy[actionStatus]
  formOpenRef.current = formOpen

  const canRequest =
    Boolean(onRequest) && (role === 'OPERADOR' || role === 'ADMIN' || role === 'TESORERO')
  const requestDisabled = requestBusy || actionStatus === 'requesting'

  const submit = async () => {
    if (!onRequest || inFlight.current) return
    inFlight.current = true
    try {
      await onRequest({
        context: draft.context.trim(),
        reason: draft.reason.trim(),
        evidence: draft.evidence.trim(),
        ...(draft.agreement_id.trim() ? { agreement_id: draft.agreement_id.trim() } : {}),
      })
    } finally {
      inFlight.current = false
    }
  }

  if (!lifecycle && !canRequest) return null
  const heading = (
    <h3 id={titleId} className="font-display text-lg font-semibold text-ink-900">
      Trabajo comunitario con aprobación
    </h3>
  )
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={collectionSectionClass}
    >
      {headingLevel === 3 ? heading : <h4 id={titleId}>{heading.props.children}</h4>}
      {lifecycle ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={stateBadge[lifecycle.state].variant}>
              {stateBadge[lifecycle.state].label}
            </Badge>
            {lifecycle.execution_status === 'recoverable' && (
              <Badge variant="warning">Recuperación requerida</Badge>
            )}
          </div>
          <p className="font-body text-sm text-ink-700">{stateCopy[lifecycle.state]}</p>
          <dl className="grid gap-px border border-ink-200 bg-ink-200 sm:grid-cols-2">
            <div className="bg-surface px-3 py-2">
              <dt>Vence</dt>
              <dd className="mt-1 font-mono text-xs text-ink-700">
                {dateTime(lifecycle.expires_at)}
              </dd>
            </div>
            {lifecycle.decided_at && (
              <div className="bg-surface px-3 py-2">
                <dt>Decidida el</dt>
                <dd className="mt-1 font-mono text-xs text-ink-700">
                  {dateTime(lifecycle.decided_at)}
                </dd>
              </div>
            )}
          </dl>
          <ul aria-label="Obligaciones solicitadas" className="border-t border-ink-200 pt-4">
            {lifecycle.snapshot.obligations.map((obligation) => (
              <li
                key={obligation.obligation_id}
                className="flex flex-wrap items-center justify-between gap-2 bg-surface-sunken px-3 py-2 font-body text-sm"
              >
                <span>Importe al solicitar</span>
                <span className="font-mono tabular-nums text-ink-900">
                  {amount(obligation.outstanding_amount_cents, obligation.currency)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-body text-sm text-ink-700">
          Todavía no hay una solicitud de trabajo comunitario con aprobación para esta obligación.
        </p>
      )}
      {feedback && (
        <p
          role={actionStatus === 'requested' || actionStatus === 'replayed' ? 'status' : 'alert'}
          aria-live={
            actionStatus === 'requested' || actionStatus === 'replayed' ? 'polite' : 'assertive'
          }
          className={collectionInlineStatusClass(
            actionStatus === 'requested' || actionStatus === 'replayed' ? 'neutral' : 'error',
          )}
        >
          {feedback}
        </p>
      )}
      {!lifecycle && canRequest && !formOpen && (
        <button
          type="button"
          className={collectionButtonClass.primary}
          disabled={requestDisabled}
          onClick={() => setFormOpen(true)}
        >
          Solicitar trabajo comunitario (aprobación)
        </button>
      )}
      {!lifecycle && canRequest && formOpen && (
        <form
          aria-label="Solicitud de trabajo comunitario con aprobación"
          className="space-y-3 border border-ink-200 bg-surface-sunken p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit().catch(() => undefined)
          }}
        >
          <div>
            <label
              htmlFor={`${titleId}-context`}
              className="font-body text-sm font-medium text-ink-900"
            >
              Contexto
            </label>
            <input
              id={`${titleId}-context`}
              value={draft.context}
              maxLength={1000}
              required
              onChange={(event) => setDraft({ ...draft, context: event.target.value })}
              className="mt-1 w-full border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900"
            />
          </div>
          <div>
            <label
              htmlFor={`${titleId}-reason`}
              className="font-body text-sm font-medium text-ink-900"
            >
              Motivo
            </label>
            <input
              id={`${titleId}-reason`}
              value={draft.reason}
              maxLength={500}
              required
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              className="mt-1 w-full border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900"
            />
          </div>
          <div>
            <label
              htmlFor={`${titleId}-evidence`}
              className="font-body text-sm font-medium text-ink-900"
            >
              Evidencia
            </label>
            <input
              id={`${titleId}-evidence`}
              value={draft.evidence}
              maxLength={1000}
              required
              onChange={(event) => setDraft({ ...draft, evidence: event.target.value })}
              className="mt-1 w-full border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900"
            />
          </div>
          <div>
            <label
              htmlFor={`${titleId}-agreement`}
              className="font-body text-sm font-medium text-ink-900"
            >
              Acuerdo (opcional)
            </label>
            <input
              id={`${titleId}-agreement`}
              value={draft.agreement_id}
              onChange={(event) => setDraft({ ...draft, agreement_id: event.target.value })}
              className="mt-1 w-full border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={requestDisabled}
              className={`${collectionButtonClass.primary} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Enviar solicitud
            </button>
            <button
              type="button"
              className={collectionButtonClass.secondary}
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
