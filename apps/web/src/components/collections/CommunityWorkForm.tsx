'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'

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
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} disabled={busy}>
            {busy ? 'Confirmando trabajo comunitario…' : 'Confirmar trabajo comunitario'}
          </button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
        <p id="community-work-guidance" role="status">
          La deuda cambia solo después de confirmar el trabajo comunitario y validar la asignación.
        </p>
        {message && (
          <p ref={alertRef} role="alert" tabIndex={-1} aria-live="assertive">
            {message}
          </p>
        )}
        <label>
          Valor aprobado (centavos)
          <input
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
        <label>
          Evidencia del trabajo aceptado
          <textarea
            required
            maxLength={4000}
            value={draft.evidence}
            aria-invalid={Boolean(validationError && !draft.evidence.trim())}
            onChange={(event) => setDraft({ ...draft, evidence: event.target.value })}
          />
        </label>
        <label>
          Motivo de la aceptación
          <textarea
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
