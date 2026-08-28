'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'

export interface CommunityWorkDraft {
  amountCents: number
  evidence: string
  reason: string
}

// prettier-ignore
type Props = { open: boolean; busy: boolean; error?: string; formId?: string; onCancel: () => void; onSubmit: (draft: CommunityWorkDraft) => Promise<void> | void }

export function CommunityWorkForm({
  open,
  busy,
  error = '',
  formId = 'community-work-form',
  onCancel,
  onSubmit,
}: Props) {
  // prettier-ignore
  const [draft, setDraft] = useState<{ amountCents: string; evidence: string; reason: string }>({ amountCents: '', evidence: '', reason: '' })
  // prettier-ignore
  const [validationError, setValidationError] = useState('');
  const alertRef = useRef<HTMLParagraphElement>(null)
  const message = validationError || error
  // prettier-ignore
  useEffect(() => { if (message) alertRef.current?.focus() }, [message])

  if (!open) return null

  // prettier-ignore
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const amountCents = Number(draft.amountCents); const evidence = draft.evidence.trim(); const reason = draft.reason.trim(); if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !evidence || !reason) { setValidationError('El valor aprobado, la evidencia y el motivo son obligatorios y válidos.'); return } setValidationError(''); await onSubmit({ amountCents, evidence, reason }) }

  return (
    <Modal
      open
      title="Registrar trabajo comunitario"
      descriptionId="community-work-guidance"
      footer={
        <>
          <button
            className={collectionButtonClass.secondary}
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className={collectionButtonClass.primary}
            type="submit"
            form={formId}
            disabled={busy}
          >
            {busy ? 'Confirmando trabajo comunitario…' : 'Confirmar trabajo comunitario'}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-5">
        <p
          id="community-work-guidance"
          role="status"
          className="border-l-2 border-info bg-info-soft px-3 py-2 font-body text-sm text-ink-900"
        >
          La deuda cambia solo después de confirmar el trabajo comunitario y validar la asignación.
        </p>
        {message && (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            aria-live="assertive"
            className={collectionInlineStatusClass('error')}
          >
            {message}
          </p>
        )}
        <div className="grid gap-5 border-t border-ink-100 pt-4 sm:grid-cols-2">
          <label className="grid gap-2 font-body text-sm font-medium text-ink-900">
            <span>Valor aprobado (centavos)</span>
            <input
              className={`${collectionFieldClass} font-mono tabular-nums`}
              required
              min={1}
              step={1}
              type="number"
              value={draft.amountCents}
              aria-invalid={Boolean(
                validationError && (!draft.amountCents || Number(draft.amountCents) <= 0),
              )}
              onChange={(event) => setDraft({ ...draft, amountCents: event.target.value })}
            />
          </label>
        </div>
        <label className="grid gap-2 border-t border-ink-100 pt-4 font-body text-sm font-medium text-ink-900">
          <span>Evidencia del trabajo aceptado</span>
          <textarea
            className={`${collectionFieldClass} min-h-28 py-3`}
            required
            maxLength={4000}
            value={draft.evidence}
            aria-invalid={Boolean(validationError && !draft.evidence.trim())}
            onChange={(event) => setDraft({ ...draft, evidence: event.target.value })}
          />
        </label>
        <label className="grid gap-2 border-t border-ink-100 pt-4 font-body text-sm font-medium text-ink-900">
          <span>Motivo de la aceptación</span>
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
