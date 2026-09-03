'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { DuesOperationError, type DebtDetail, type FullSelectionPaymentInput } from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import { Badge } from '@/components/ui/Badge'
import {
  collectionButtonClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'
import { PaymentDialog } from './PaymentDialog'
import {
  ReversalConfirmation,
  type ReversalSettlement as ReversalConfirmationSettlement,
} from './ReversalConfirmation'
import { formatObligationPeriod } from './payment-presentation'

export type ReversalRequest = { settlement_id: string; reason: string }
type Props = {
  debt: DebtDetail
  shifts: CashShift[]
  shiftAvailability: 'loading' | 'ready' | 'unavailable'
  onPayment: (
    input: Omit<FullSelectionPaymentInput, 'socio_id'>,
  ) => Promise<{ replayed?: boolean } | void>
  onRefreshDebt: () => Promise<void>
  onReverse: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
  headingLevel?: 3 | 4
}
type ReversalSettlement = ReversalConfirmationSettlement & {
  currency: string
  eligible: boolean
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(cents / 100)

export function SettlementActions({
  debt,
  shifts,
  shiftAvailability,
  onPayment,
  onRefreshDebt,
  onReverse,
  headingLevel = 3,
}: Props) {
  const eligible = debt.obligations.filter(({ outstanding_cents }) => outstanding_cents > 0)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [reversal, setReversal] = useState<ReversalSettlement | null>(null)
  const [reason, setReason] = useState('')
  const [reversalBusy, setReversalBusy] = useState(false)
  const [reversalError, setReversalError] = useState('')
  const [reversalStatus, setReversalStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const reversalTriggerRef = useRef<HTMLButtonElement>(null)
  const reversible = Array.from(
    debt.obligations
      .flatMap(({ period_start, allocations }) =>
        allocations.map((allocation) => ({ ...allocation, period_start })),
      )
      .reduce((settlements, allocation) => {
        const current = settlements.get(allocation.settlement_id) ?? {
          id: allocation.settlement_id,
          amount_cents: allocation.settlement_amount_cents,
          currency: allocation.currency,
          allocations: [],
          eligible: true,
        }
        current.allocations.push(allocation)
        current.eligible &&=
          allocation.reversal_eligible && allocation.settlement_kind === 'MONETARY'
        settlements.set(current.id, current)
        return settlements
      }, new Map<string, ReversalSettlement>())
      .values(),
  ).filter(({ eligible: isEligible }) => isEligible)

  useEffect(() => {
    if (reversalError || reversalStatus) statusRef.current?.focus()
  }, [reversalError, reversalStatus])

  const openReversal = (settlement: ReversalSettlement, trigger: HTMLButtonElement) => {
    reversalTriggerRef.current = trigger
    setReversal(settlement)
    setReason('')
    setReversalError('')
    setReversalStatus('')
  }
  const submitReversal = async () => {
    if (!reversal || !reason.trim()) return
    setReversalBusy(true)
    setReversalError('')
    try {
      await onReverse({ settlement_id: reversal.id, reason: reason.trim() })
      setReversal(null)
      setReason('')
      setReversalStatus('Reversión registrada como compensación.')
    } catch (cause) {
      if (
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof DuesOperationError && cause.kind === 'conflict')
      )
        setReversalError(
          'El historial cambió. Revisá el historial actualizado antes de confirmar nuevamente.',
        )
      else if (cause instanceof DuesOperationError && cause.kind === 'not_found')
        setReversalError('No se encontró la liquidación. Actualizá el detalle antes de reintentar.')
      else setReversalError('No se pudo registrar la reversión.')
    } finally {
      setReversalBusy(false)
    }
  }
  const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'
  const Heading = headingLevel === 3 ? 'h3' : 'h4'

  return (
    <section
      aria-labelledby="settlement-actions-title"
      className={`${collectionSectionClass} min-w-0 bg-surface-sunken`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading
          id="settlement-actions-title"
          className="font-display text-lg font-semibold text-ink-900"
        >
          Acciones de pago
        </Heading>
        <Badge>Pagos y reversión</Badge>
      </div>
      {reversalStatus && (
        <p
          ref={statusRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className={collectionInlineStatusClass('neutral')}
        >
          {reversalStatus}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setPaymentOpen(true)}
          disabled={!eligible.length || shiftAvailability !== 'ready' || !shifts.length}
          className={`${collectionButtonClass.primary} ${disabledClass}`}
        >
          Registrar pago
        </button>
        {reversible.map((settlement, index) => (
          <button
            key={settlement.id}
            type="button"
            onClick={(event) => openReversal(settlement, event.currentTarget)}
            className={collectionButtonClass.danger}
          >
            Revertir pago {index + 1} ·{' '}
            {formatObligationPeriod(settlement.allocations[0]!.period_start)} ·{' '}
            {money(settlement.amount_cents, settlement.currency)}
          </button>
        ))}
      </div>
      <PaymentDialog
        open={paymentOpen}
        debt={debt}
        shifts={shifts}
        shiftAvailability={shiftAvailability}
        onPayment={onPayment}
        onRefreshDebt={onRefreshDebt}
        onClose={() => setPaymentOpen(false)}
      />
      <ReversalConfirmation
        settlement={reversal}
        reason={reason}
        busy={reversalBusy}
        error={reversalError}
        onReasonChange={setReason}
        onCancel={() => {
          if (!reversalBusy) {
            setReversal(null)
            reversalTriggerRef.current?.focus()
          }
        }}
        onConfirm={() => void submitReversal()}
      />
    </section>
  )
}
