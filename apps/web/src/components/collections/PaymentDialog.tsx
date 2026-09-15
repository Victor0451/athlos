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
  onRefreshDebt: () => Promise<boolean | void>
  onClose: () => void
  initialSelection?: string[] | undefined
  onGoToCash?: ((memberId: string, obligationIds: string[]) => void) | undefined
}

const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'
const staleBalanceMessage =
  'El saldo cambió. Revisá la deuda actualizada antes de volver a confirmar.'
const permissionMessage =
  'No tenés permiso para registrar este pago. Actualizá la deuda y los turnos antes de volver a confirmar.'

export function PaymentDialog({
  open,
  debt,
  shifts,
  shiftAvailability,
  onPayment,
  onRefreshDebt,
  onClose,
  initialSelection,
  onGoToCash,
}: Props) {
  const eligible = debt.obligations.filter(
    ({ outstanding_cents, status }) => outstanding_cents > 0 && status === 'OPEN',
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftId, setShiftId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [cardSubtype, setCardSubtype] = useState<CardSubtype | null>(null)
  const [busy, setBusy] = useState(false)
  const [paymentConflict, setPaymentConflict] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const mountedRef = useRef(true)
  const openRef = useRef(open)
  const debtRef = useRef(debt)
  const submissionInFlight = useRef(false)
  const lifecycleIdRef = useRef(0)
  const requestIdRef = useRef(0)
  const activeRequestIdRef = useRef<number | null>(null)
  openRef.current = open
  debtRef.current = debt
  const selected = eligible.filter(({ id }) => selectedIds.includes(id))
  const total = selected.reduce((sum, obligation) => sum + obligation.outstanding_cents, 0)
  const tender = paymentMethod === 'CARD' ? cardSubtype : paymentMethod
  const selectionUnavailable =
    initialSelection !== undefined && initialSelection.length > 0 && !selected.length
  const confirmationReason =
    shiftAvailability === 'loading'
      ? 'Esperá a que se carguen los turnos de caja abiertos.'
      : shiftAvailability === 'unavailable'
        ? 'No se puede confirmar el pago hasta cargar los turnos de caja abiertos.'
        : !shifts.length
          ? 'No hay turnos de caja abiertos para registrar el pago.'
          : !selected.length
            ? selectionUnavailable
              ? 'Las obligaciones elegidas ya no tienen saldo pendiente.'
              : 'Seleccioná al menos una obligación completa.'
            : !shiftId
              ? 'Seleccioná un turno de caja abierto.'
              : paymentMethod === 'CARD' && !cardSubtype
                ? 'Elegí Débito o Crédito para la tarjeta.'
                : ''

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      lifecycleIdRef.current += 1
      activeRequestIdRef.current = null
      submissionInFlight.current = false
    }
  }, [])
  useEffect(() => {
    lifecycleIdRef.current += 1
    activeRequestIdRef.current = null
    submissionInFlight.current = false
    setBusy(false)
  }, [debt.socio_id])
  useEffect(() => {
    lifecycleIdRef.current += 1
    activeRequestIdRef.current = null
    submissionInFlight.current = false
    if (!open) {
      setBusy(false)
      return
    }
    setSelectedIds(
      initialSelection === undefined
        ? eligible.map(({ id }) => id)
        : initialSelection.filter((id) => eligible.some((obligation) => obligation.id === id)),
    )
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
      if ((await onRefreshDebt()) === false) throw new Error('Payment context unavailable')
      setPaymentConflict(false)
    } catch {
      setError('No se pudo actualizar la deuda. Intentá nuevamente.')
    } finally {
      setBusy(false)
    }
  }
  const submitPayment = async () => {
    if (submissionInFlight.current || confirmationReason || paymentConflict || !tender) return
    submissionInFlight.current = true
    const lifecycleId = lifecycleIdRef.current
    const requestId = ++requestIdRef.current
    activeRequestIdRef.current = requestId
    setBusy(true)
    setError('')
    const paymentSocioId = debt.socio_id
    const isActiveRequest = () =>
      mountedRef.current &&
      openRef.current &&
      debtRef.current.socio_id === paymentSocioId &&
      lifecycleIdRef.current === lifecycleId &&
      activeRequestIdRef.current === requestId
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
      if (!isActiveRequest()) return
      await onPayment({
        obligation_ids: allocations.map(({ obligationId }) => obligationId),
        shift_id: shiftId,
        tender,
        selection_fingerprint,
      })
      if (!isActiveRequest()) return
      setSelectedIds([])
      setStatus('Pago registrado.')
      onClose()
    } catch (cause) {
      if (!isActiveRequest()) return
      if (
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof DuesOperationError && cause.kind === 'conflict')
      ) {
        setPaymentConflict(true)
        setError(staleBalanceMessage)
      } else if (
        (cause instanceof ApiError && cause.status === 403) ||
        (cause instanceof DuesOperationError && cause.kind === 'permission')
      ) {
        setPaymentConflict(true)
        setError(permissionMessage)
      } else setError('No se pudo registrar el pago.')
    } finally {
      if (activeRequestIdRef.current !== requestId) return
      activeRequestIdRef.current = null
      submissionInFlight.current = false
      if (mountedRef.current) setBusy(false)
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
      {selectionUnavailable &&
        inlineStatus('Las obligaciones elegidas ya no tienen saldo pendiente.')}
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
        {onGoToCash && (
          <button
            type="button"
            onClick={() => {
              if (submissionInFlight.current || !selected.length) return
              onGoToCash(
                debt.socio_id,
                selected.map(({ id }) => id),
              )
            }}
            disabled={busy || !selected.length}
            className={`${collectionButtonClass.secondary} ${disabledClass}`}
          >
            Ir a caja
          </button>
        )}
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
