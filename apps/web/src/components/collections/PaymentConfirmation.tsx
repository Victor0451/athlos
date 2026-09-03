import { useEffect, useRef, type ReactNode } from 'react'
import type { CashShift } from '@/lib/api/treasury'
import { Modal } from '@/components/ui/Modal'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
} from './CollectionPrimitives'
import { formatShiftOption } from './payment-presentation'

type Props = {
  open: boolean
  total: number
  shifts: CashShift[]
  shiftId: string
  shiftAvailability: 'loading' | 'ready' | 'unavailable'
  confirmationReason: string
  busy: boolean
  paymentConflict: boolean
  error: string
  children?: ReactNode
  onShiftChange: (shiftId: string) => void
  onCancel: () => void
  onConfirm: () => void
  onRefreshDebt: () => void
}

const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)
const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'

export function PaymentConfirmation({
  open,
  total,
  shifts,
  shiftId,
  shiftAvailability,
  confirmationReason,
  busy,
  paymentConflict,
  error,
  children,
  onShiftChange,
  onCancel,
  onConfirm,
  onRefreshDebt,
}: Props) {
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (error) statusRef.current?.focus()
  }, [error])

  return (
    <Modal
      open={open}
      title="Revisar pago"
      dataTestid="allocation-modal"
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
            disabled={
              busy ||
              paymentConflict ||
              shiftAvailability !== 'ready' ||
              !shifts.length ||
              Boolean(confirmationReason)
            }
            aria-describedby="payment-confirmation-reason"
            className={`${collectionButtonClass.primary} ${disabledClass}`}
          >
            Confirmar pago
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="font-body text-sm text-ink-700">
          Seleccioná obligaciones completas. El total se calcula para revisión y el servidor
          confirma los saldos.
        </p>
        {children}
        <div className="flex items-baseline justify-between gap-4 border-y border-ink-200 py-4">
          <span
            id="payment-total-label"
            className="font-display text-sm font-semibold text-ink-900"
          >
            Total a registrar
          </span>
          <output
            aria-labelledby="payment-total-label"
            className="font-display text-lg font-semibold tabular-nums text-ink-900"
          >
            {money(total)}
          </output>
        </div>
        <label className="block space-y-2 font-body text-sm font-medium text-ink-900">
          Turno de caja
          <select
            className={collectionFieldClass}
            value={shiftId}
            onChange={(event) => onShiftChange(event.target.value)}
            disabled={shiftAvailability !== 'ready'}
          >
            {shifts.map((shift, index) => (
              <option key={shift.id} value={shift.id}>
                {formatShiftOption(index + 1, shift.business_date)}
              </option>
            ))}
          </select>
        </label>
        <p className={collectionInlineStatusClass('neutral')}>
          El turno de caja abierto registra y audita el movimiento, incluso en pagos electrónicos.
        </p>
        {shiftAvailability === 'loading' && (
          <p role="status" className={collectionInlineStatusClass('neutral')}>
            Cargando turnos de caja abiertos.
          </p>
        )}
        {shiftAvailability === 'unavailable' && (
          <div role="alert" className={collectionInlineStatusClass('error')}>
            <p>No se pudo cargar los turnos de caja abiertos.</p>
            <button
              type="button"
              onClick={onRefreshDebt}
              disabled={busy}
              className={`${collectionButtonClass.secondary} ${disabledClass}`}
            >
              Reintentar
            </button>
          </div>
        )}
        <p
          id="payment-confirmation-reason"
          role={confirmationReason ? 'status' : undefined}
          className="font-body text-sm text-ink-700"
        >
          {confirmationReason}
        </p>
        {busy && (
          <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
            Registrando pago…
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
        {paymentConflict && (
          <button
            type="button"
            onClick={onRefreshDebt}
            disabled={busy}
            className={`${collectionButtonClass.secondary} ${disabledClass}`}
          >
            Actualizar deuda
          </button>
        )}
      </div>
    </Modal>
  )
}
