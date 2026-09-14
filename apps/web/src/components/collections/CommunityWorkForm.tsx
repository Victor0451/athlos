'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { PesoAmountInput } from '@/components/ui/PesoAmountInput'
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
type Props = { open: boolean; busy: boolean; locked?: boolean; reconciling?: boolean; error?: string; formId?: string; currency?: string; outstandingCents?: number | undefined; onCancel: () => void; onReconcile?: () => Promise<void> | void; onSubmit: (draft: CommunityWorkDraft) => Promise<void> | void }

const parsePesoToCents = (value: string): number | null => {
  const match = /^(0|[1-9]\d*)(?:[,.](\d{1,2}))?$/.exec(value)
  if (!match) return null
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}

const formatAmount = (amountCents: number, currency: string) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(amountCents / 100)

export function CommunityWorkForm({
  open,
  busy,
  locked = false,
  reconciling = false,
  error = '',
  formId = 'community-work-form',
  currency = 'ARS',
  outstandingCents,
  onCancel,
  onReconcile,
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
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (locked) return; const amountCents = parsePesoToCents(draft.amountCents); const evidence = draft.evidence.trim(); const reason = draft.reason.trim(); if (amountCents === null || !evidence || !reason) { setValidationError('El valor aprobado, la evidencia y el motivo son obligatorios y válidos.'); return } setValidationError(''); await onSubmit({ amountCents, evidence, reason }) }

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
          {locked && onReconcile && (
            <button
              className={collectionButtonClass.secondary}
              type="button"
              onClick={() => void onReconcile()}
              disabled={busy || reconciling}
            >
              {reconciling ? 'Actualizando saldo…' : 'Actualizar saldo'}
            </button>
          )}
          <button
            className={collectionButtonClass.primary}
            type="submit"
            form={formId}
            disabled={busy || locked}
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
            <span>Valor aprobado ({currency})</span>
            <PesoAmountInput
              className={`${collectionFieldClass} font-mono tabular-nums`}
              required
              value={draft.amountCents}
              parseCents={parsePesoToCents}
              aria-invalid={Boolean(
                validationError && parsePesoToCents(draft.amountCents) === null,
              )}
              onChange={(event) => setDraft({ ...draft, amountCents: event.target.value })}
            />
          </label>
          <p className="font-body text-xs text-ink-700">
            Ingresá pesos sin separadores de miles, por ejemplo 15600. Para centavos opcionales, usá
            coma o punto decimal. El formato se aplica al salir del campo.
          </p>
          {outstandingCents !== undefined && (
            <p className="font-body text-sm text-ink-700">
              Saldo actual de la obligación: {formatAmount(outstandingCents, currency)}
            </p>
          )}
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
