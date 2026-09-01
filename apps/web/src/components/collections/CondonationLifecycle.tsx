'use client'

import { useEffect, useRef } from 'react'
import type { CondonationLifecycle as Lifecycle } from '@/lib/api/condonation'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import {
  collectionButtonClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

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
const actionCopy: Partial<Record<ActionStatus, string>> = {
  replayed: 'Se recuperó un resultado ya confirmado; no se trató por segunda vez.',
  recoverable_error:
    'La ejecución quedó desactualizada o requiere recuperación. La deuda no cambió.',
  denied: 'El servidor denegó la ejecución. La deuda no cambió.',
  transactional_error: 'No se confirmó la ejecución; la deuda no cambió.',
}
const amount = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`

export function CondonationLifecycle({
  lifecycle,
  role,
  actionStatus = 'idle',
  onExecute,
  headingLevel = 3,
}: Props) {
  const action = useRef<HTMLButtonElement>(null)
  const section = useRef<HTMLElement>(null)
  const executable =
    (role === 'ADMIN' || role === 'TESORERO') &&
    lifecycle.state === 'approved_awaiting_execution' &&
    lifecycle.execution_id !== null &&
    lifecycle.execution_status !== 'unavailable' &&
    onExecute
  const feedback = actionCopy[actionStatus]
  const executionBadge =
    actionStatus === 'replayed'
      ? 'Resultado recuperado'
      : lifecycle.execution_status === 'recoverable'
        ? 'Recuperación requerida'
        : null
  useEffect(() => {
    if (feedback) (action.current ?? section.current)?.focus()
  }, [feedback])

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby={`condonation-lifecycle-${lifecycle.id}`}
      className={collectionSectionClass}
    >
      {headingLevel === 3 ? (
        <h3
          id={`condonation-lifecycle-${lifecycle.id}`}
          className="font-display text-lg font-semibold text-ink-900"
        >
          Estado de la condonación
        </h3>
      ) : (
        <h4
          id={`condonation-lifecycle-${lifecycle.id}`}
          className="font-display text-lg font-semibold text-ink-900"
        >
          Estado de la condonación
        </h4>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={stateBadge[lifecycle.state].variant}>
          {stateBadge[lifecycle.state].label}
        </Badge>
        {executionBadge && (
          <Badge variant={actionStatus === 'replayed' ? 'success' : 'warning'}>
            {executionBadge}
          </Badge>
        )}
      </div>
      <p className="font-body text-sm text-ink-700">{stateCopy[lifecycle.state]}</p>
      <dl className="grid gap-px border border-ink-200 bg-ink-200 sm:grid-cols-2">
        <div className="bg-surface px-3 py-2">
          <dt>Vence</dt>
          <dd className="mt-1 font-mono text-xs text-ink-700">{lifecycle.expires_at}</dd>
        </div>
        {lifecycle.decided_at && (
          <div className="bg-surface px-3 py-2">
            <dt>Decidida el</dt>
            <dd className="mt-1 font-mono text-xs text-ink-700">{lifecycle.decided_at}</dd>
          </div>
        )}
      </dl>
      <ul
        aria-label="Obligaciones seleccionadas"
        className="grid gap-2 border-t border-ink-200 pt-4"
      >
        {lifecycle.snapshot.obligations.map((obligation) => (
          <li
            key={obligation.obligation_id}
            className="grid gap-1 bg-surface-sunken px-3 py-2 font-body text-sm sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <span>
              Obligación <span className="font-mono text-xs">{obligation.obligation_id}</span>
            </span>
            <span className="font-mono tabular-nums text-ink-900">
              {amount(obligation.outstanding_amount_cents, obligation.currency)}
            </span>
          </li>
        ))}
      </ul>
      {actionStatus === 'replayed' && (
        <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
          {feedback}
        </p>
      )}
      {feedback && actionStatus !== 'replayed' && (
        <p role="alert" aria-live="assertive" className={collectionInlineStatusClass('error')}>
          {feedback}
        </p>
      )}
      {executable && (
        <button
          ref={action}
          type="button"
          disabled={actionStatus === 'executing'}
          onClick={() => void onExecute().catch(() => undefined)}
          className={`${collectionButtonClass.primary} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {lifecycle.execution_status === 'recoverable'
            ? 'Recuperar y ejecutar condonación'
            : 'Ejecutar condonación'}
        </button>
      )}
    </section>
  )
}
