'use client'

import { useState, type FormEvent } from 'react'
import type {
  CondonationDecisionInput,
  CondonationRequest,
  CondonationRequestInput,
} from '@/lib/api/condonation'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

type Obligation = { id: string; period_start: string; outstanding_cents: number; currency: string }
type Props = {
  memberId: string
  obligations: Obligation[]
  canDecide: boolean
  request?: CondonationRequest
  onRequest: (input: CondonationRequestInput) => Promise<CondonationRequest>
  onDecision?: (id: string, input: CondonationDecisionInput) => Promise<CondonationRequest>
  headingLevel?: 3 | 4
}
const failure = (cause: unknown, decision = false) => {
  const kind = (cause as { kind?: unknown })?.kind
  if (kind === 'permission') return 'El servidor no te permite realizar esta acción.'
  if (kind === 'conflict')
    return decision
      ? 'El servidor no permite decidir esta solicitud.'
      : 'La solicitud cambió. Revisá antes de reenviarla.'
  return decision
    ? 'No se pudo registrar la decisión. La deuda no cambió.'
    : 'No se pudo enviar la solicitud. La deuda no cambió.'
}

export function CondonationActions({
  memberId,
  obligations,
  canDecide,
  request: initial,
  onRequest,
  onDecision,
  headingLevel = 3,
}: Props) {
  const eligible = obligations
    .filter(({ outstanding_cents }) => outstanding_cents > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
  const request = initial
  const [context, setContext] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [decision, setDecision] = useState<CondonationDecisionInput['decision']>('approved')
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionEvidence, setDecisionEvidence] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  if (!eligible.length) return null
  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsSubmitting(true)
    try {
      await onRequest({
        member_id: memberId,
        obligation_ids: eligible.map(({ id }) => id),
        context: context.trim(),
        reason: reason.trim(),
        evidence: evidence.trim(),
      })
      setMessage('Solicitud pendiente. No modifica la deuda ni ejecuta una condonación.')
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setIsSubmitting(false)
    }
  }
  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!request || !onDecision) return
    setError('')
    setMessage('')
    setIsSubmitting(true)
    try {
      await onDecision(request.id, {
        decision,
        reason: decisionReason.trim(),
        evidence: decisionEvidence.trim(),
      })
      setMessage('Decisión registrada. No modifica la deuda ni ejecuta una condonación.')
    } catch (cause) {
      setError(failure(cause, true))
    } finally {
      setIsSubmitting(false)
    }
  }
  const fieldClass = `${collectionFieldClass} mt-1 block resize-y disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-500`
  return (
    <section
      aria-labelledby="condonation-title"
      aria-busy={isSubmitting}
      className={collectionSectionClass}
    >
      {headingLevel === 3 ? (
        <h3 id="condonation-title" className="font-display text-lg font-semibold text-ink-900">
          Solicitud de condonación
        </h3>
      ) : (
        <h4 id="condonation-title" className="font-display text-lg font-semibold text-ink-900">
          Solicitud de condonación
        </h4>
      )}
      <p className="font-body text-sm text-ink-700">
        Incluye todas las obligaciones pendientes seleccionadas; esta solicitud no perdona ni
        modifica la deuda.
      </p>
      <ul
        aria-label="Obligaciones incluidas"
        className="grid gap-2 border-y border-ink-200 py-3 font-body text-sm text-ink-700 sm:grid-cols-2"
      >
        {eligible.map(({ id, period_start }) => (
          <li key={id} className="bg-surface-sunken px-3 py-2">
            Período {period_start}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" aria-live="assertive" className={collectionInlineStatusClass('error')}>
          {error}
        </p>
      )}
      {!request && (
        <form onSubmit={(event) => void submitRequest(event)} className="grid gap-4 sm:grid-cols-2">
          <label className="font-body text-sm font-medium text-ink-900">
            Contexto de la solicitud
            <textarea
              className={`${fieldClass} min-h-24`}
              value={context}
              onChange={(event) => setContext(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <label className="font-body text-sm font-medium text-ink-900">
            Motivo de la solicitud
            <textarea
              className={`${fieldClass} min-h-24`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <label className="font-body text-sm font-medium text-ink-900 sm:col-span-2">
            Evidencia de la solicitud
            <textarea
              className={`${fieldClass} min-h-24`}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${collectionButtonClass.primary} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {isSubmitting ? 'Enviando solicitud…' : 'Enviar solicitud de condonación'}
            </button>
          </div>
        </form>
      )}
      {canDecide && request?.status === 'pending' && onDecision && (
        <form
          onSubmit={(event) => void submitDecision(event)}
          className="grid gap-4 border-t border-ink-200 pt-4 sm:grid-cols-2"
        >
          <label className="font-body text-sm font-medium text-ink-900">
            Decisión
            <select
              className={fieldClass}
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as CondonationDecisionInput['decision'])
              }
              disabled={isSubmitting}
            >
              <option value="approved">Aprobar</option>
              <option value="rejected">Rechazar</option>
            </select>
          </label>
          <label className="font-body text-sm font-medium text-ink-900">
            Motivo de la decisión
            <textarea
              className={`${fieldClass} min-h-24`}
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <label className="font-body text-sm font-medium text-ink-900 sm:col-span-2">
            Evidencia de la decisión
            <textarea
              className={`${fieldClass} min-h-24`}
              value={decisionEvidence}
              onChange={(event) => setDecisionEvidence(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${collectionButtonClass.primary} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {isSubmitting ? 'Registrando decisión…' : 'Registrar decisión'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
