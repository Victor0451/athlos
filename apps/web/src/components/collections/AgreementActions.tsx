'use client'

import { useState } from 'react'
import { DuesOperationError, type DebtDetail, type DuesAgreement } from '@/lib/api/dues'
import { CommunityWorkForm, type CommunityWorkDraft } from './CommunityWorkForm'
import { AgreementForm, type AgreementDraft } from './AgreementForm'

// prettier-ignore
export type AgreementViewStatus = 'idle'|'loading'|'ready'|'permission'|'conflict'|'success'|'updated'|'replayed'|'partial_data'|'unavailable'|'error'
// prettier-ignore
export interface AgreementViewState { status: AgreementViewStatus; active: DuesAgreement|null; revisions?: DuesAgreement[]; message?: string }
// prettier-ignore
export type AgreementObligation = Pick<DebtDetail['obligations'][number], 'id'|'period_start'|'period_end'|'status'>
// prettier-ignore
type Props = { obligation: AgreementObligation; enabled?: boolean; state: AgreementViewState; onCreate: (draft:AgreementDraft) => Promise<{ replayed?: boolean }|void>; onRevise?: (agreementId:string,draft:AgreementDraft) => Promise<{ replayed?: boolean }|void>; onRecordCommunityWork?: (agreementId:string,draft:CommunityWorkDraft) => Promise<{ replayed?: boolean }|void>; onRefresh: () => Promise<void>|void }
// prettier-ignore
const errorStatuses = new Set<AgreementViewStatus>(['permission','conflict','partial_data','unavailable','error'])

// prettier-ignore
const stateMessage = (state: AgreementViewState): string =>
  state.message ??
  ({
    loading: 'Cargando el acuerdo…',
    permission: 'No tenés permiso para registrar o modificar acuerdos.',
    conflict: 'El acuerdo cambió. Revisá el acuerdo actualizado antes de volver a enviarlo.',
    success: 'Acuerdo registrado. La deuda continúa abierta hasta que se registre una cancelación válida.',
    updated: 'Acuerdo actualizado. La deuda continúa abierta hasta que se registre una cancelación válida.',
    replayed: 'Este acuerdo ya había sido registrado. La deuda continúa abierta.',
    partial_data: 'El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.',
    unavailable: 'No se pudo cargar el acuerdo. Intentá nuevamente.',
    error: 'No se pudo cargar el acuerdo. Intentá nuevamente.',
  } as Partial<Record<AgreementViewStatus, string>>)[state.status] ?? ''

// prettier-ignore
const mutationError = (error: unknown, community = false): {status: AgreementViewStatus; message:string} => { if (!(error instanceof DuesOperationError)) return {status:'error',message:community ? 'No se pudo registrar el trabajo comunitario. Intentá nuevamente.' : 'No se pudo guardar el acuerdo. Intentá nuevamente.'}; const messages: Record<DuesOperationError['kind'],[AgreementViewStatus,string]> = {validation:['error',community ? 'El valor aprobado, la evidencia y el motivo son obligatorios y válidos.' : 'Los datos del acuerdo no son válidos. Revisá la narrativa y el motivo.'],permission:[community ? 'error' : 'permission',community ? 'No tenés permiso para registrar trabajo comunitario.' : 'No tenés permiso para registrar o modificar acuerdos.'],conflict:['conflict',community ? 'El saldo cambió. Revisá la deuda antes de reintentar.' : 'El acuerdo cambió. Revisá el acuerdo actualizado antes de volver a enviarlo.'],not_found:['error','No se encontró la obligación. Actualizá el detalle e intentá nuevamente.'],partial_data:['partial_data',community ? 'Los datos del trabajo comunitario están incompletos.' : 'El acuerdo tiene datos incompletos y no puede mostrarse como confirmado.'],unavailable:[community ? 'error' : 'unavailable',community ? 'No se pudo registrar el trabajo comunitario. Intentá nuevamente.' : 'No se pudo guardar el acuerdo. Intentá nuevamente.']}; const [status,message] = messages[error.kind]; return {status,message} }

// prettier-ignore
export function AgreementActions({obligation, enabled = true, state, onCreate, onRevise, onRecordCommunityWork, onRefresh}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'revision' | 'community'>('create')
  const [busy, setBusy] = useState(false)
  const [localStatus, setLocalStatus] = useState<AgreementViewStatus | null>(null)
  const [localError, setLocalError] = useState('')

  if (!enabled || obligation.status !== 'OPEN') return null

  const displayStatus = localStatus ?? state.status
  const message = localError || stateMessage({ ...state, status: displayStatus })
      const active =
        state.active && (formMode === 'community' || !['conflict', 'partial_data'].includes(displayStatus))
          ? state.active
          : null
  const inlineError = formOpen && errorStatuses.has(displayStatus) ? message : ''
  const showStatus = Boolean(message) && !inlineError
  const statusRole = ['loading', 'success', 'updated', 'replayed'].includes(displayStatus)
    ? 'status'
    : 'alert'
  const revisions = [...(state.revisions ?? [])].sort(
    (left, right) => left.revision_number - right.revision_number,
  )
  const canRevise = Boolean(
    active && active.kind === 'NEGOTIATED' && active.terms_version === 1 && onRevise,
  )
  const openForm = () => {
    setFormMode('create')
    setLocalStatus(null)
    setLocalError('')
    setFormOpen(true)
  }
  const openRevision = () => {
    setFormMode('revision')
    setLocalStatus(null)
    setLocalError('')
    setFormOpen(true)
  }
  // prettier-ignore
  const openCommunityWork = () => { setFormMode('community'); setLocalStatus(null); setLocalError(''); setFormOpen(true) }

  const submit = async (draft: AgreementDraft | CommunityWorkDraft) => {
    setBusy(true)
    setLocalStatus(null)
    setLocalError('')
    try {
      const result =
        formMode === 'community' && active && onRecordCommunityWork
          ? await onRecordCommunityWork(active.id, draft as CommunityWorkDraft)
          : formMode === 'revision' && active && onRevise
            ? await onRevise(active.id, draft as AgreementDraft)
            : await onCreate(draft as AgreementDraft)
          const replayed = Boolean(result?.replayed)
          setFormOpen(false)
          setLocalStatus(replayed ? 'replayed' : formMode === 'revision' ? 'updated' : 'success')
          setLocalError(
            formMode === 'community'
              ? replayed
                ? 'Este trabajo comunitario ya había sido registrado. La deuda se actualizó.'
                : 'Trabajo comunitario confirmado. La deuda se actualizó.'
              : '',
          )
    } catch (error) {
      const failure = mutationError(error, formMode === 'community')
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
          {canRevise && (
            <button type="button" onClick={openRevision} disabled={busy}>
              Revisar acuerdo activo
            </button>
          )}
          // prettier-ignore
          {active && active.kind === 'NEGOTIATED' && active.terms_version === 1 && onRecordCommunityWork && <button type="button" onClick={openCommunityWork} disabled={busy}>Registrar trabajo comunitario</button>}
        </div>
      )}
      {active && (
        <section>
          <h5>Historial de revisiones</h5>
          {revisions.length ? (
            <ol aria-label="Historial de revisiones">
              {revisions.map((revision) => {
                const current = revision.id === active.id || revision.status === 'ACTIVE'
                return (
                  <li key={revision.id}>
                    <p>
                      Revisión {revision.revision_number} · {current ? 'Actual' : 'Anterior'}
                    </p>
                    {revision.kind === 'NEGOTIATED' &&
                      revision.terms_version === 1 &&
                      'narrative' in revision.terms && <p>Narrativa: {revision.terms.narrative}</p>}
                    <p>Motivo: {revision.reason}</p>
                    {revision.revision_reason && (
                      <p>Motivo de la revisión: {revision.revision_reason}</p>
                    )}
                  </li>
                )
              })}
            </ol>
          ) : (
            <p>No hay revisiones anteriores.</p>
          )}
        </section>
      )}
      {!active && ['idle', 'ready'].includes(displayStatus) && (
        <button type="button" onClick={openForm} disabled={busy}>
          Registrar acuerdo
        </button>
      )}
      {formOpen && formMode !== 'community' && (
        <AgreementForm
          open
          busy={busy}
          error={inlineError}
          formId={`agreement-form-${obligation.id}`}
          onCancel={() => setFormOpen(false)}
          {...(displayStatus === 'conflict' ? { onReview: review } : {})}
          mode={formMode}
          onSubmit={submit}
        />
      )}
      {formOpen && formMode === 'community' && (
        <CommunityWorkForm
          open
          busy={busy}
          error={inlineError}
          formId={`community-work-form-${obligation.id}`}
          onCancel={() => setFormOpen(false)}
          onSubmit={(draft) => submit(draft)}
        />
      )}
    </section>
  )
}
