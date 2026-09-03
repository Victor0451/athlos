import { useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'
import { formatObligationPeriod } from './payment-presentation'

export type ReversalSettlement = {
  id: string
  amount_cents: number
  allocations: Array<{ id: string; period_start: string; amount_cents: number }>
}

type Props = {
  settlement: ReversalSettlement | null
  reason: string
  busy: boolean
  error: string
  onReasonChange: (reason: string) => void
  onCancel: () => void
  onConfirm: () => void
}

const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)
const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'

export function ReversalConfirmation({
  settlement,
  reason,
  busy,
  error,
  onReasonChange,
  onCancel,
  onConfirm,
}: Props) {
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (settlement) reasonRef.current?.focus()
  }, [settlement])
  useEffect(() => {
    if (error) statusRef.current?.focus()
  }, [error])

  return (
    <Modal
      open={Boolean(settlement)}
      title="Revisar reversión"
      role="alertdialog"
      descriptionId="reversal-description"
      dataTestid="reversal-modal"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${collectionButtonClass.secondary} ${disabledClass}`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !reason.trim()}
            className={`${collectionButtonClass.danger} ${disabledClass}`}
          >
            Confirmar reversión
          </button>
        </>
      }
    >
      {settlement && (
        <div className="space-y-5">
          <p
            id="reversal-description"
            className="border-l-4 border-danger bg-danger-soft px-4 py-3 font-body text-sm text-ink-900"
          >
            Esta reversión crea una compensación para toda la liquidación.
          </p>
          <dl>
            <div className="border border-ink-200 bg-surface-sunken p-3">
              <dt className="font-body text-xs font-medium uppercase tracking-wide text-ink-700">
                Importe
              </dt>
              <dd className="mt-1 font-display text-lg font-semibold tabular-nums text-ink-900">
                {money(settlement.amount_cents)}
              </dd>
            </div>
          </dl>
          <div>
            <h3 className="font-display text-sm font-semibold text-ink-900">
              Asignaciones afectadas
            </h3>
            <ul
              aria-label="Asignaciones afectadas"
              className="mt-2 space-y-2 font-body text-sm text-ink-700"
            >
              {settlement.allocations.map((allocation) => (
                <li key={allocation.id} className="border-l-2 border-ink-300 pl-3">
                  Obligación {formatObligationPeriod(allocation.period_start)}:{' '}
                  <span className="font-medium tabular-nums text-ink-900">
                    {money(allocation.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <label className="block space-y-2 font-body text-sm font-medium text-ink-900">
            Motivo de reversión
            <textarea
              ref={reasonRef}
              aria-label="Motivo de reversión"
              className={`${collectionFieldClass} min-h-24 py-3`}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </label>
          {busy && (
            <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
              Registrando reversión…
            </p>
          )}
          {error && (
            <p
              ref={statusRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className={collectionInlineStatusClass('error')}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
