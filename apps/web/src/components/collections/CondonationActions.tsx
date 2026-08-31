'use client'

import { useState, type FormEvent } from 'react'
import type {
  CondonationDecisionInput,
  CondonationLifecycle,
  CondonationRequest,
  CondonationRequestInput,
} from '@/lib/api/condonation'

type Obligation = { id: string; period_start: string; outstanding_cents: number; currency: string }
type Props = {
  memberId: string
  obligations: Obligation[]
  canDecide: boolean
  canExecute?: boolean
  lifecycle?: Pick<CondonationLifecycle, 'id' | 'state' | 'execution_id'>
  request?: CondonationRequest
  onRequest: (input: CondonationRequestInput) => Promise<CondonationRequest>
  onDecision?: (id: string, input: CondonationDecisionInput) => Promise<CondonationRequest>
  onExecute?: (id: string, executionId: string) => Promise<void>
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
  canExecute = false,
  lifecycle,
  request: initial,
  onRequest,
  onDecision,
  onExecute,
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
  if (!eligible.length) return null
  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
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
    }
  }
  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!request || !onDecision) return
    setError('')
    setMessage('')
    try {
      await onDecision(request.id, {
        decision,
        reason: decisionReason.trim(),
        evidence: decisionEvidence.trim(),
      })
      setMessage('Decisión registrada. No modifica la deuda ni ejecuta una condonación.')
    } catch (cause) {
      setError(failure(cause, true))
    }
  }
  const execute = async () => {
    if (!lifecycle || !onExecute) return
    setError('')
    setMessage('')
    try {
      await onExecute(lifecycle.id, lifecycle.execution_id!)
      setMessage('Ejecución confirmada al recargar el estado y la deuda.')
    } catch (cause) {
      setError(failure(cause, true))
    }
  }
  // prettier-ignore
  return <section aria-labelledby="condonation-title" className="space-y-4 rounded-lg border p-4">
    <h3 id="condonation-title" className="text-lg font-semibold">Solicitud de condonación</h3>
    <p>Incluye todas las obligaciones pendientes seleccionadas; esta solicitud no perdona ni modifica la deuda.</p>
    <ul aria-label="Obligaciones incluidas">{eligible.map(({ id, period_start }) => <li key={id}>Período {period_start}</li>)}</ul>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {error && <p role="alert" aria-live="assertive">{error}</p>}
    {!request && <form onSubmit={(event) => void submitRequest(event)} className="space-y-3">
      <label>Contexto de la solicitud<textarea value={context} onChange={(event) => setContext(event.target.value)} required /></label>
      <label>Motivo de la solicitud<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
      <label>Evidencia de la solicitud<textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} required /></label>
      <button type="submit">Enviar solicitud de condonación</button>
    </form>}
    {canDecide && request?.status === 'pending' && onDecision && <form onSubmit={(event) => void submitDecision(event)} className="space-y-3">
      <label>Decisión<select value={decision} onChange={(event) => setDecision(event.target.value as CondonationDecisionInput['decision'])}><option value="approved">Aprobar</option><option value="rejected">Rechazar</option></select></label>
      <label>Motivo de la decisión<textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} required /></label>
      <label>Evidencia de la decisión<textarea value={decisionEvidence} onChange={(event) => setDecisionEvidence(event.target.value)} required /></label>
      <button type="submit">Registrar decisión</button>
    </form>}
    {canExecute && lifecycle?.state === 'approved_awaiting_execution' && lifecycle.execution_id && onExecute && <button type="button" onClick={() => void execute()}>Ejecutar condonación</button>}
  </section>
}
