'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'

// prettier-ignore
export interface AgreementDraft { narrative:string; reason:string }
// prettier-ignore
type Props = { open:boolean; busy:boolean; error?:string; formId?:string; mode?:'create'|'revision'; onCancel:()=>void; onReview?:()=>Promise<void>|void; onSubmit:(draft:AgreementDraft)=>Promise<void>|void }
// prettier-ignore
export function AgreementForm({open,busy,error='',formId='agreement-form',mode='create',onCancel,onReview,onSubmit}: Props) {
  const [draft, setDraft] = useState<AgreementDraft>({ narrative: '', reason: '' })
   const revision = mode === 'revision'

  const [validationError, setValidationError] = useState('')
  const alertRef = useRef<HTMLParagraphElement>(null)
  const message = validationError || error

  useEffect(() => {
    if (message) alertRef.current?.focus()
  }, [message])

  if (!open) return null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const narrative = draft.narrative.trim()
    const reason = draft.reason.trim()
    if (!narrative || !reason) {
      setValidationError(
        revision
          ? 'La narrativa y el motivo de la revisión son obligatorios.'
          : 'La narrativa y el motivo del acuerdo son obligatorios.',
      )
      return
    }
    setValidationError('')
    await onSubmit({ narrative, reason })
  }

  return (
    <Modal
      open
      title={revision ? 'Revisar acuerdo' : 'Registrar acuerdo'}
      dataTestid="agreement-modal"
      descriptionId="agreement-guidance"
      footer={
        <>
          <button className={collectionButtonClass.secondary} type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className={collectionButtonClass.primary} type="submit" form={formId} disabled={busy}>
            {busy
              ? revision
                ? 'Actualizando acuerdo…'
                : 'Guardando acuerdo…'
              : revision
                ? 'Actualizar acuerdo'
                : 'Guardar acuerdo'}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-5">
        <p id="agreement-guidance" role="status" className="border-l-2 border-info bg-info-soft px-3 py-2 font-body text-sm text-ink-900">
          {revision
            ? 'Actualizar el acuerdo no reduce la deuda. La deuda cambia solo cuando se registra una cancelación válida.'
            : 'Guardar el acuerdo no reduce la deuda. La deuda cambia solo cuando se registra una cancelación válida.'}
        </p>
        {message && (
          <p ref={alertRef} role="alert" tabIndex={-1} aria-live="assertive" className={collectionInlineStatusClass('error')}>
            {message}
          </p>
        )}
        {onReview && (
          <button className={collectionButtonClass.secondary} type="button" onClick={() => void onReview()} disabled={busy}>
            Revisar acuerdo actualizado
          </button>
        )}
        <label className="grid gap-2 font-body text-sm font-medium text-ink-900">
          <span>Narrativa del acuerdo</span>
          <textarea
            className={`${collectionFieldClass} min-h-28 py-3`}
            required
            maxLength={4000}
            value={draft.narrative}
            aria-invalid={Boolean(validationError && !draft.narrative.trim())}
            onChange={(event) => setDraft({ ...draft, narrative: event.target.value })}
          />
        </label>
            <label className="grid gap-2 border-t border-ink-100 pt-4 font-body text-sm font-medium text-ink-900">
              <span>{revision ? 'Motivo de la revisión' : 'Motivo del acuerdo'}</span>
              <textarea
                className={`${collectionFieldClass} min-h-24 py-3`}
                required
                maxLength={500}
                value={draft.reason}
                aria-invalid={Boolean(validationError && !draft.reason.trim())}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            </label>
      </form>
    </Modal>
  )
}
