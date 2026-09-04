'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { DuesOperationError, type DebtDetail, type FullSelectionPaymentInput } from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import { collectionButtonClass, collectionInlineStatusClass } from './CollectionPrimitives'
import { PaymentConfirmation } from './PaymentConfirmation'
import {
  PaymentMethodSelector,
  type CardSubtype,
  type PaymentMethod,
} from './PaymentMethodSelector'
import { PaymentObligationSelector } from './PaymentObligationSelector'

type Props = {
  open: boolean
  debt: DebtDetail
  shifts: CashShift[]
  shiftAvailability: 'loading' | 'ready' | 'unavailable'
  onPayment: (
    input: Omit<FullSelectionPaymentInput, 'socio_id'>,
  ) => Promise<{ replayed?: boolean } | void>
  onRefreshDebt: () => Promise<void>
  onClose: () => void
}

const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'
const staleBalanceMessage =
  'El saldo cambió. Revisá la deuda actualizada antes de volver a confirmar.'

export function PaymentDialog({
  open,
  debt,
  shifts,
  shiftAvailability,
  onPayment,
  onRefreshDebt,
  onClose,
}: Props) {
  const eligible = debt.obligations.filter(({ outstanding_cents }) => outstanding_cents > 0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftId, setShiftId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [cardSubtype, setCardSubtype] = useState<CardSubtype | null>(null)
  const [busy, setBusy] = useState(false)
  const [paymentConflict, setPaymentConflict] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const selected = eligible.filter(({ id }) => selectedIds.includes(id))
  const total = selected.reduce((sum, obligation) => sum + obligation.outstanding_cents, 0)
  const tender = paymentMethod === 'CARD' ? cardSubtype : paymentMethod
  const confirmationReason =
    shiftAvailability === 'loading'
      ? 'Esperá a que se carguen los turnos de caja abiertos.'
      : shiftAvailability === 'unavailable'
        ? 'No se puede confirmar el pago hasta cargar los turnos de caja abiertos.'
        : !shifts.length
          ? 'No hay turnos de caja abiertos para registrar el pago.'
          : !selected.length
            ? 'Seleccioná al menos una obligación completa.'
            : !shiftId
              ? 'Seleccioná un turno de caja abierto.'
              : paymentMethod === 'CARD' && !cardSubtype
                ? 'Elegí Débito o Crédito para la tarjeta.'
                : ''

  useEffect(() => {
    if (!open) return
    setSelectedIds(eligible.map(({ id }) => id))
    setShiftId(shifts[0]?.id ?? '')
    setPaymentMethod('CASH')
    setCardSubtype(null)
    setPaymentConflict(false)
    setError('')
    setStatus('')
  }, [open])
  useEffect(() => {
    if (error || status) statusRef.current?.focus()
  }, [error, status])

  const refreshDebt = async () => {
    setBusy(true)
    setError('')
    try {
      await onRefreshDebt()
      setPaymentConflict(false)
    } catch {
      setError('No se pudo actualizar la deuda. Intentá nuevamente.')
    } finally {
      setBusy(false)
    }
  }
  const submitPayment = async () => {
    if (confirmationReason || paymentConflict || !tender) return
    setBusy(true)
    setError('')
    try {
      const allocations = [...selected]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id, outstanding_cents }) => ({ obligationId: id, amountCents: outstanding_cents }))
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({ socioId: debt.socio_id, currency: selected[0]!.currency, allocations }),
        ),
      )
      const selection_fingerprint = [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      const result = await onPayment({
        obligation_ids: allocations.map(({ obligationId }) => obligationId),
        shift_id: shiftId,
        tender,
        selection_fingerprint,
      })
      setSelectedIds([])
      setStatus(result?.replayed ? 'Pago repetido.' : 'Pago registrado.')
      onClose()
    } catch (cause) {
      if (
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof DuesOperationError && cause.kind === 'conflict')
      ) {
        setPaymentConflict(true)
        setError(staleBalanceMessage)
      } else setError('No se pudo registrar el pago.')
    } finally {
      setBusy(false)
    }
  }
  const inlineStatus = (message: string, isError = false) => (
    <p
      ref={statusRef}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      tabIndex={-1}
      className={collectionInlineStatusClass(isError ? 'error' : 'neutral')}
    >
      {message}
    </p>
  )

  return (
    <>
      {status && inlineStatus(status)}
      {shiftAvailability === 'loading' &&
        eligible.length > 0 &&
        inlineStatus('Cargando turnos de caja abiertos.')}
      {shiftAvailability === 'ready' &&
        !shifts.length &&
        eligible.length > 0 &&
        inlineStatus('No hay turnos de caja abiertos para registrar el pago.')}
      {shiftAvailability === 'unavailable' && eligible.length > 0 && (
        <div role="alert" className={collectionInlineStatusClass('error')}>
          <p>No se pudo cargar los turnos de caja abiertos.</p>
          <button
            type="button"
            onClick={() => void refreshDebt()}
            disabled={busy}
            className={`${collectionButtonClass.secondary} ${disabledClass}`}
          >
            Reintentar
          </button>
        </div>
      )}
      <PaymentConfirmation
        open={open}
        total={total}
        shifts={shifts}
        shiftId={shiftId}
        shiftAvailability={shiftAvailability}
        confirmationReason={confirmationReason}
        busy={busy}
        paymentConflict={paymentConflict}
        error={error}
        onShiftChange={setShiftId}
        onCancel={() => {
          if (!busy) onClose()
        }}
        onConfirm={() => void submitPayment()}
        onRefreshDebt={() => void refreshDebt()}
      >
        <PaymentObligationSelector
          obligations={eligible}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
        />
        <PaymentMethodSelector
          paymentMethod={paymentMethod}
          cardSubtype={cardSubtype}
          onMethodChange={setPaymentMethod}
          onCardSubtypeChange={setCardSubtype}
        />
      </PaymentConfirmation>
    </>
  )
}
