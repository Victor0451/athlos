'use client'

import { useState } from 'react'
import { DuesOperationError, type DebtDetail, type DuesAgreement } from '@/lib/api/dues'
import { AgreementForm, type AgreementDraft } from './AgreementForm'

// prettier-ignore
export type AgreementViewStatus = 'idle'|'loading'|'ready'|'permission'|'conflict'|'success'|'replayed'|'partial_data'|'unavailable'|'error'
// prettier-ignore
export interface AgreementViewState { status: AgreementViewStatus; active: DuesAgreement|null; message?: string }
// prettier-ignore
export type AgreementObligation = Pick<DebtDetail['obligations'][number], 'id'|'period_start'|'period_end'|'status'>
// prettier-ignore
type Props = { obligation: AgreementObligation; enabled?: boolean; state: AgreementViewState; onCreate: (draft: AgreementDraft) => Promise<{ replayed?: boolean }|void>; onRefresh: () => Promise<void>|void }
// prettier-ignore
const errorStatuses = new Set<AgreementViewStatus>(['permission','conflict','partial_data','unavailable','error'])

// prettier-ignore
const stateMessage = (state: AgreementViewState): string => state.message ?? ({ loading:'Cargando el acuerdo…', permission:'No tenés permiso para registrar o modificar acuerdos.', conflict:'El acuerdo cambió. Revisá el acuerdo actualizado antes de volver a enviarlo.', success:'Acuerdo registrado. La deuda continúa abierta hasta que se registre una cancelación válida.', replayed:'Este acuerdo ya había sido registrado. La deuda continúa abierta.', partial_data:'El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.', unavailable:'No se pudo cargar el acuerdo. Intentá nuevamente.', error:'No se pudo cargar el acuerdo. Intentá nuevamente.' } as Partial<Record<AgreementViewStatus,string>>)[state.status] ?? ''

// prettier-ignore
const mutationError = (error: unknown): {status: AgreementViewStatus; message:string} => { if (!(error instanceof DuesOperationError)) return {status:'error',message:'No se pudo guardar el acuerdo. Intentá nuevamente.'}; const messages: Record<DuesOperationError['kind'],[AgreementViewStatus,string]> = {validation:['error','Los datos del acuerdo no son válidos. Revisá la narrativa y el motivo.'],permission:['permission','No tenés permiso para registrar o modificar acuerdos.'],conflict:['conflict','El acuerdo cambió. Revisá el acuerdo actualizado antes de volver a enviarlo.'],not_found:['error','No se encontró la obligación. Actualizá el detalle e intentá nuevamente.'],partial_data:['partial_data','El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.'],unavailable:['unavailable','No se pudo guardar el acuerdo. Intentá nuevamente.']}; const [status,message] = messages[error.kind]; return {status,message} }

// prettier-ignore
export function AgreementActions({obligation, enabled = true, state, onCreate, onRefresh}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState<AgreementViewStatus | null>(null)
  const [localError, setLocalError] = useState('')

  if (!enabled || obligation.status !== 'OPEN') return null

  const displayStatus = localStatus ?? state.status
  const message = localError || stateMessage({ ...state, status: displayStatus })
  const active =
    state.active && !['conflict', 'partial_data'].includes(displayStatus) ? state.active : null
  const inlineError = formOpen && errorStatuses.has(displayStatus) ? message : ''
  const showStatus = Boolean(message) && !inlineError
  const statusRole = ['loading', 'success', 'replayed'].includes(displayStatus) ? 'status' : 'alert'

  const openForm = () => {
    setLocalStatus(null)
    setLocalError('')
    setFormOpen(true)
  }

  const create = async (draft: AgreementDraft) => {
    setBusy(true)
    setLocalStatus(null)
    setLocalError('')
    try {
      const result = await onCreate(draft)
      setFormOpen(false)
      setLocalStatus(result?.replayed ? 'replayed' : 'success')
    } catch (error) {
      const failure = mutationError(error)
      setLocalStatus(failure.status)
      setLocalError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const review = async () => {
    setBusy(true)
    try {
      await onRefresh()
      setLocalStatus('ready')
      setLocalError('')
    } catch {
      setLocalStatus('unavailable')
      setLocalError('No se pudo actualizar el acuerdo. Intentá nuevamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby={`agreement-title-${obligation.id}`}
      className="space-y-3 rounded border p-3"
    >
      <h4 id={`agreement-title-${obligation.id}`}>Acuerdo de la obligación</h4>
      {showStatus && (
        <p role={statusRole} aria-live={statusRole === 'alert' ? 'assertive' : 'polite'}>
          {message}
        </p>
      )}
      {displayStatus === 'conflict' && !formOpen && (
        <button type="button" onClick={() => void review()} disabled={busy}>
          Revisar acuerdo actualizado
        </button>
      )}
      {active && (
        <div aria-label="Resumen del acuerdo activo" className="space-y-2">
          <p>Acuerdo activo · revisión {active.revision_number}</p>
          {active.kind === 'NEGOTIATED' &&
            active.terms_version === 1 &&
            'narrative' in active.terms && <p>Narrativa: {active.terms.narrative}</p>}
          <p>Motivo: {active.reason}</p>
          <p>La deuda continúa abierta hasta que se registre una cancelación válida.</p>
        </div>
      )}
      {!active && ['idle', 'ready'].includes(displayStatus) && (
        <button type="button" onClick={openForm} disabled={busy}>
          Registrar acuerdo
        </button>
      )}
      {formOpen && (
        <AgreementForm
          open
          busy={busy}
          error={inlineError}
          formId={`agreement-form-${obligation.id}`}
          onCancel={() => setFormOpen(false)}
          {...(displayStatus === 'conflict' ? { onReview: review } : {})}
          onSubmit={create}
        />
      )}
    </section>
  )
}
