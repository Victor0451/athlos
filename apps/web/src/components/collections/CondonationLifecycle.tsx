'use client'

import { useEffect, useRef } from 'react'
import type { CondonationLifecycle as Lifecycle } from '@/lib/api/condonation'

type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR'
type ActionStatus =
  | 'idle'
  | 'executing'
  | 'replayed'
  | 'recoverable_error'
  | 'denied'
  | 'transactional_error'
type Props = {
  lifecycle: Lifecycle
  role: Role
  actionStatus?: ActionStatus
  onExecute?: () => Promise<unknown>
}

const stateCopy: Record<Lifecycle['state'], string> = {
  pending: 'Pendiente: la deuda no cambia.',
  rejected: 'Rechazada: la deuda no cambia.',
  expired: 'Vencida: la deuda no cambia.',
  approved_awaiting_execution: 'Aprobada, pero todavía no fue aplicada a la deuda.',
  executed: 'Ejecutada: la deuda autorizada se redujo según el registro confirmado.',
}
const actionCopy: Partial<Record<ActionStatus, string>> = {
  replayed: 'Se recuperó un resultado ya confirmado; no se trató por segunda vez.',
  recoverable_error:
    'La ejecución quedó desactualizada o requiere recuperación. La deuda no cambió.',
  denied: 'El servidor denegó la ejecución. La deuda no cambió.',
  transactional_error: 'No se confirmó la ejecución; la deuda no cambió.',
}
const amount = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`

export function CondonationLifecycle({ lifecycle, role, actionStatus = 'idle', onExecute }: Props) {
  const action = useRef<HTMLButtonElement>(null)
  const section = useRef<HTMLElement>(null)
  const executable =
    (role === 'ADMIN' || role === 'TESORERO') &&
    lifecycle.state === 'approved_awaiting_execution' &&
    lifecycle.execution_id !== null &&
    lifecycle.execution_status !== 'unavailable' &&
    onExecute
  const feedback = actionCopy[actionStatus]
  useEffect(() => {
    if (feedback) (action.current ?? section.current)?.focus()
  }, [feedback])

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={`condonation-lifecycle-${lifecycle.id}`}
      className="space-y-3 rounded-lg border p-4"
    >
      <h3 id={`condonation-lifecycle-${lifecycle.id}`} className="text-lg font-semibold">
        Estado de la condonación
      </h3>
      <p>{stateCopy[lifecycle.state]}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt>Solicitó</dt>
          <dd>{lifecycle.requester.operator_id}</dd>
        </div>
        {lifecycle.approver && (
          <div>
            <dt>Aprobó</dt>
            <dd>{lifecycle.approver.operator_id}</dd>
          </div>
        )}
        <div>
          <dt>Vence</dt>
          <dd>{lifecycle.expires_at}</dd>
        </div>
        {lifecycle.decided_at && (
          <div>
            <dt>Decidida el</dt>
            <dd>{lifecycle.decided_at}</dd>
          </div>
        )}
        {lifecycle.used_at && (
          <div>
            <dt>Ejecutada el</dt>
            <dd>{lifecycle.used_at}</dd>
          </div>
        )}
      </dl>
      <dl>
        {lifecycle.reason && (
          <>
            <dt>Motivo de la solicitud</dt>
            <dd>{lifecycle.reason}</dd>
          </>
        )}
        {lifecycle.evidence && (
          <>
            <dt>Evidencia de la solicitud</dt>
            <dd>{lifecycle.evidence}</dd>
          </>
        )}
        {lifecycle.decision?.reason && (
          <>
            <dt>Motivo de la decisión</dt>
            <dd>{lifecycle.decision.reason}</dd>
          </>
        )}
        {lifecycle.decision?.evidence && (
          <>
            <dt>Evidencia de la decisión</dt>
            <dd>{lifecycle.decision.evidence}</dd>
          </>
        )}
      </dl>
      <ul aria-label="Obligaciones seleccionadas">
        {lifecycle.snapshot.obligations.map((obligation) => (
          <li key={obligation.obligation_id}>
            Obligación {obligation.obligation_id}: importe al solicitar{' '}
            {amount(obligation.outstanding_amount_cents, obligation.currency)}
          </li>
        ))}
      </ul>
      {actionStatus === 'replayed' && (
        <p role="status" aria-live="polite">
          {feedback}
        </p>
      )}
      {feedback && actionStatus !== 'replayed' && (
        <p role="alert" aria-live="assertive">
          {feedback}
        </p>
      )}
      {executable && (
        <button
          ref={action}
          type="button"
          disabled={actionStatus === 'executing'}
          onClick={() => void onExecute().catch(() => undefined)}
        >
          {lifecycle.execution_status === 'recoverable'
            ? 'Recuperar y ejecutar condonación'
            : 'Ejecutar condonación'}
        </button>
      )}
    </section>
  )
}
