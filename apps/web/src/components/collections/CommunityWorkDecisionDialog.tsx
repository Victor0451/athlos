'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  CommunityWorkOperationError,
  decideCommunityWorkRequest,
  executeCommunityWorkRequest,
  listCommunityWorkLifecycle,
  type CommunityWorkDecisionInput,
  type CommunityWorkApprovalLifecycle as Lifecycle,
  type CommunityWorkQueueItem,
  type CommunityWorkRequest,
} from '@/lib/api/community-work-approval'
import { createCollectionsIdempotencyStore } from '@/lib/collections-idempotency'
import { CommunityWorkApprovalLifecycle } from './CommunityWorkApprovalLifecycle'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'

type Props = {
  request: CommunityWorkQueueItem
  operatorId: string
  role: 'ADMIN' | 'TESORERO'
  onRefresh: () => void
  onClose: () => void
}

/** Retain the selected snapshot and draft independently of the pending queue. */
export function CommunityWorkDecisionDialog({
  request,
  operatorId,
  role,
  onRefresh,
  onClose,
}: Props) {
  const formId = useId()
  const [store] = useState(() => createCollectionsIdempotencyStore())
  const [decision, setDecision] = useState<CommunityWorkDecisionInput['decision']>('approved')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [pending, setPending] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CommunityWorkRequest | null>(null)
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(
    request.state === 'approved_awaiting_execution' ? request : null,
  )
  const [applied, setApplied] = useState(false)
  const busy = useRef(false)
  const active = useRef(false)
  const activeOperatorId = useRef(operatorId)
  activeOperatorId.current = operatorId
  const feedback = useRef<HTMLParagraphElement>(null)
  const selfRequested = request.requester.id.toLowerCase() === operatorId.toLowerCase()
  const reviewing = request.state === 'pending' && result === null
  const blocked = locked || selfRequested || !reviewing

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    if (error || result) feedback.current?.focus()
  }, [error, result])

  const refreshLifecycle = async (requiredState: Lifecycle['state']) => {
    const page = await listCommunityWorkLifecycle(request.snapshot.member_id)
    const current = page.items.find((item) => item.id.toLowerCase() === request.id.toLowerCase())
    if (
      !current ||
      current.state !== requiredState ||
      current.snapshot.member_id.toLowerCase() !== request.snapshot.member_id.toLowerCase()
    )
      throw new CommunityWorkOperationError('partial_data')
    setLifecycle(current)
    return current
  }

  const apply = async (current: Lifecycle) => {
    if (!active.current || activeOperatorId.current !== operatorId) return
    if (!current.execution_id || current.execution_status === 'unavailable')
      throw new CommunityWorkOperationError('partial_data')
    const obligation = request.snapshot.obligations[0]
    if (!obligation) throw new CommunityWorkOperationError('partial_data')
    const descriptor = {
      operatorId,
      action: `community-work-application:${request.id}:${current.execution_id}`,
      draftFingerprint: current.execution_id,
    }
    const response = await executeCommunityWorkRequest(
      request.id,
      current.execution_id,
      store.getOrCreate(descriptor),
    )
    if (
      response.request_id.toLowerCase() !== request.id.toLowerCase() ||
      response.execution_id.toLowerCase() !== current.execution_id.toLowerCase() ||
      response.socio_id.toLowerCase() !== request.snapshot.member_id.toLowerCase() ||
      response.obligation_id.toLowerCase() !== obligation.obligation_id.toLowerCase() ||
      response.currency !== obligation.currency ||
      response.amount_cents !== obligation.outstanding_amount_cents
    )
      throw new CommunityWorkOperationError('partial_data')
    const confirmed = await refreshLifecycle('executed')
    if (confirmed.execution_id?.toLowerCase() !== current.execution_id.toLowerCase())
      throw new CommunityWorkOperationError('partial_data')
    store.complete(descriptor)
    setApplied(true)
    onRefresh()
  }

  const runApplication = async (current: Lifecycle) => {
    busy.current = true
    setPending(true)
    setError('')
    try {
      await apply(current)
    } catch {
      if (active.current)
        setError(
          'Aprobada pendiente de ejecución. Reintentá la ejecución sin volver a aprobar; la deuda no cambió.',
        )
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy.current || blocked || !reason.trim() || !evidence.trim()) return
    if (Date.parse(request.expires_at) <= Date.now()) {
      setLocked(true)
      setError('La solicitud venció. Cerrá esta revisión y actualizá la bandeja.')
      onRefresh()
      return
    }
    const input = { decision, reason: reason.trim(), evidence: evidence.trim() }
    const descriptor = {
      operatorId,
      action: `community-work-decision:${request.id}`,
      draftFingerprint: JSON.stringify(input),
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const response = await decideCommunityWorkRequest(
        request.id,
        input,
        store.getOrCreate(descriptor),
      )
      if (!active.current) return
      if (
        response.id.toLowerCase() !== request.id.toLowerCase() ||
        response.status !== decision ||
        !response.decided_at ||
        Number.isNaN(Date.parse(response.decided_at))
      )
        throw new CommunityWorkOperationError('partial_data')
      store.complete(descriptor)
      setResult(response)
      if (response.status === 'approved') {
        await runApplication(await refreshLifecycle('approved_awaiting_execution'))
      } else onRefresh()
    } catch (cause) {
      if (!active.current) return
      const kind = cause instanceof CommunityWorkOperationError ? cause.kind : 'unavailable'
      if (kind === 'conflict') {
        store.abandon(descriptor)
        setLocked(true)
        setError(
          'La solicitud cambió. Cerrá esta revisión y revisá la bandeja actualizada antes de volver a decidir.',
        )
        onRefresh()
      } else {
        setError(
          kind === 'permission'
            ? 'El servidor no te permite decidir esta solicitud. Los datos de tu intento se conservaron.'
            : 'No se pudo confirmar la decisión. Reintentá con los mismos datos para recuperar el resultado; no se ejecutó ningún trabajo comunitario desde esta pantalla.',
        )
      }
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }

  return (
    <Modal
      open
      title="Decidir trabajo comunitario"
      footer={
        <>
          <button
            type="button"
            className={`${collectionButtonClass.secondary} disabled:opacity-50`}
            disabled={pending}
            onClick={() => {
              if (!busy.current) onClose()
            }}
          >
            Cerrar
          </button>
          {reviewing && !selfRequested && (
            <button
              type="submit"
              form={formId}
              className={`${collectionButtonClass.primary} disabled:opacity-50`}
              disabled={pending || blocked || !reason.trim() || !evidence.trim()}
            >
              {pending
                ? 'Registrando decisión…'
                : decision === 'approved'
                  ? 'Aprobar y ejecutar trabajo comunitario'
                  : 'Registrar decisión'}
            </button>
          )}
          {lifecycle?.state === 'approved_awaiting_execution' && !applied && (
            <button
              type="button"
              className={`${collectionButtonClass.primary} disabled:opacity-50`}
              disabled={pending || locked}
              onClick={() => void runApplication(lifecycle)}
            >
              {pending ? 'Ejecutando…' : 'Reintentar ejecución'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4 [overflow-wrap:anywhere]">
        <h3 className="font-display text-lg font-semibold text-ink-900">
          {request.current_member.nombre} {request.current_member.apellido} · N.º{' '}
          {request.current_member.numero_socio}
        </h3>
        <p className="text-sm text-ink-500">
          Datos del socio y de la solicitud al abrir esta revisión.
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ['Solicitó', request.requester.username],
            ['Contexto', request.context],
            ['Motivo original', request.reason],
            ['Evidencia original', request.evidence],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="font-semibold">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink-700">
          Aprobar autoriza la ejecución; la deuda solo cambia cuando la ejecución confirmada se
          aplica. Requiere acciones explícitas.
        </p>
        {result || lifecycle ? (
          <>
            {lifecycle && (
              <CommunityWorkApprovalLifecycle lifecycle={lifecycle} role={role} headingLevel={4} />
            )}
            <p
              role="status"
              tabIndex={-1}
              ref={feedback}
              className={collectionInlineStatusClass('neutral')}
            >
              {applied
                ? 'Ejecución confirmada.'
                : result?.status === 'rejected'
                  ? 'Rechazo registrado.'
                  : 'Aprobada pendiente de ejecución.'}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-500">
              Estado al abrir la revisión; no representa cambios posteriores.
            </p>
            <CommunityWorkApprovalLifecycle lifecycle={request} role={role} headingLevel={4} />
            {selfRequested ? (
              <p>Otro ADMIN o TESORERO debe decidir esta solicitud que enviaste vos.</p>
            ) : (
              <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-4">
                <label className="text-sm font-medium">
                  Decisión
                  <select
                    className={collectionFieldClass}
                    value={decision}
                    disabled={pending || blocked}
                    onChange={(event) =>
                      setDecision(event.target.value as CommunityWorkDecisionInput['decision'])
                    }
                  >
                    <option value="approved">Aprobar</option>
                    <option value="rejected">Rechazar</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Motivo de la decisión
                  <textarea
                    className={`${collectionFieldClass} min-h-24`}
                    required
                    disabled={pending || blocked}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <label className="text-sm font-medium">
                  Evidencia de la decisión
                  <textarea
                    className={`${collectionFieldClass} min-h-24`}
                    required
                    disabled={pending || blocked}
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                  />
                </label>
              </form>
            )}
          </>
        )}
        {error && (
          <p
            role="alert"
            tabIndex={-1}
            ref={feedback}
            className={collectionInlineStatusClass('error')}
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
