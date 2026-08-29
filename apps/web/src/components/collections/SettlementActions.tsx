'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { DuesOperationError, type DebtDetail, type FullSelectionPaymentInput } from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

// prettier-ignore
export type ReversalRequest={settlement_id:string;reason:string}
type Props = {
  debt: DebtDetail
  shifts: CashShift[]
  onPayment: (
    input: Omit<FullSelectionPaymentInput, 'socio_id'>,
  ) => Promise<{ replayed?: boolean } | void>
  onReverse: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
  headingLevel?: 3 | 4
}
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
type Allocation = DebtDetail['obligations'][number]['allocations'][number]
type ReversalSettlement = {
  id: string
  amount_cents: number
  currency: string
  allocations: Array<Allocation & { period_start: string }>
  eligible: boolean
}
const tenderLabel = {
  CASH: 'Efectivo',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  TRANSFER: 'Transferencia',
}

export function SettlementActions({ debt, shifts, onPayment, onReverse, headingLevel = 3 }: Props) {
  const eligible = debt.obligations.filter(({ outstanding_cents }) => outstanding_cents > 0)
  const [allocationOpen, setAllocationOpen] = useState(false),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [shiftId, setShiftId] = useState(shifts[0]?.id ?? ''),
    [tender, setTender] = useState<FullSelectionPaymentInput['tender']>('CASH'),
    [reversal, setReversal] = useState<ReversalSettlement | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewRequired, setReviewRequired] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null),
    reasonRef = useRef<HTMLTextAreaElement>(null),
    reversalTriggerRef = useRef<HTMLButtonElement>(null),
    selected = eligible.filter(({ id }) => selectedIds.includes(id)),
    total = selected.reduce((sum, obligation) => sum + obligation.outstanding_cents, 0)
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
    if (error || status) statusRef.current?.focus()
  }, [error, status])
  useEffect(() => {
    if (reversal) reasonRef.current?.focus()
  }, [reversal])
  const openAllocation = () => {
    setSelectedIds([])
    setShiftId(shifts[0]?.id ?? '')
    setError('')
    setStatus('')
    setReviewRequired(false)
    setAllocationOpen(true)
  }
  const conflict = (message: string) => {
    setError(message)
    setReviewRequired(true)
  }
  const submitAllocation = async () => {
    if (!selected.length || !shiftId) {
      setError('Seleccioná obligaciones completas y un turno de caja abierto.')
      return
    }
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
      setAllocationOpen(false)
      setSelectedIds([])
      setStatus(result?.replayed ? 'Pago repetido.' : 'Pago registrado.')
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409)
        conflict('El saldo cambió. Revisá el importe conservado antes de confirmar nuevamente.')
      else setError('No se pudo registrar el pago.')
    } finally {
      setBusy(false)
    }
  }
  const openReversal = (settlement: ReversalSettlement, trigger: HTMLButtonElement) => {
    reversalTriggerRef.current = trigger
    setReversal(settlement)
    setReason('')
    setError('')
    setStatus('')
    setReviewRequired(false)
  }
  const submitReversal = async () => {
    if (!reversal || !reason.trim()) return
    setBusy(true)
    setError('')
    try {
      await onReverse({
        settlement_id: reversal.id,
        reason: reason.trim(),
      })
      setReversal(null)
      setReason('')
      setStatus('Reversión registrada como compensación.')
    } catch (cause) {
      if (
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof DuesOperationError && cause.kind === 'conflict')
      )
        conflict(
          'El historial cambió. Revisá el historial actualizado antes de confirmar nuevamente.',
        )
      else if (cause instanceof DuesOperationError && cause.kind === 'not_found')
        setError('No se encontró la liquidación. Actualizá el detalle antes de reintentar.')
      else setError('No se pudo registrar la reversión.')
    } finally {
      setBusy(false)
    }
  }
  const review = () => {
    setReviewRequired(false)
    setError('')
  }
  const closeReversal = () => {
    setReversal(null)
    reversalTriggerRef.current?.focus()
  }
  const disabledClass = 'disabled:cursor-not-allowed disabled:opacity-60'
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  // prettier-ignore
  const statusMessage = (message: string, error = false) => (
    <p ref={statusRef} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} tabIndex={-1} className={collectionInlineStatusClass(error ? 'error' : 'neutral')}>{message}</p>
  )
  // prettier-ignore
  return <section aria-labelledby="settlement-actions-title" className={`${collectionSectionClass} min-w-0 bg-surface-sunken`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Heading id="settlement-actions-title" className="font-display text-lg font-semibold text-ink-900">Acciones de pago</Heading><Badge>Revisión requerida</Badge></div>
    {status && statusMessage(status)}
    <div className="flex flex-wrap gap-3"><button type="button" onClick={openAllocation} disabled={!eligible.length||!shifts.length} className={`${collectionButtonClass.primary} ${disabledClass}`}>Registrar pago</button>{reversible.map((settlement)=><button key={settlement.id} type="button" onClick={(event)=>openReversal(settlement,event.currentTarget)} className={collectionButtonClass.danger}>Revertir liquidación {settlement.id}</button>)}</div>
    {!shifts.length&&eligible.length>0&&<p role="status" className={collectionInlineStatusClass('neutral')}>No hay turnos de caja abiertos para registrar el pago.</p>}
    <Modal open={allocationOpen} title="Revisar pago" dataTestid="allocation-modal" footer={<><button type="button" onClick={()=>setAllocationOpen(false)} disabled={busy} className={`${collectionButtonClass.secondary} ${disabledClass}`}>Cancelar</button><button type="button" onClick={()=>void submitAllocation()} disabled={busy||reviewRequired||!selected.length||!shiftId} className={`${collectionButtonClass.primary} ${disabledClass}`}>Confirmar pago</button></>}><div className="space-y-5"><p className="font-body text-sm text-ink-700">Seleccioná obligaciones completas. El total se calcula para revisión y el servidor confirma los saldos.</p><fieldset className="space-y-2"><legend className="font-display text-sm font-semibold text-ink-900">Obligaciones a pagar</legend>{eligible.map((obligation)=><label key={obligation.id} className="flex items-start gap-3 border-b border-ink-100 py-3 font-body text-sm text-ink-900"><input className="mt-0.5 min-h-4 min-w-4" type="checkbox" checked={selectedIds.includes(obligation.id)} onChange={()=>setSelectedIds((current)=>current.includes(obligation.id)?current.filter((id)=>id!==obligation.id):[...current,obligation.id])}/><span>Período {obligation.period_start}: <span className="font-medium tabular-nums">{money(obligation.outstanding_cents,obligation.currency)}</span></span></label>)}</fieldset><div className="flex items-baseline justify-between gap-4 border-y border-ink-200 py-4"><span id="payment-total-label" className="font-display text-sm font-semibold text-ink-900">Total a registrar</span><output aria-labelledby="payment-total-label" className="font-display text-lg font-semibold tabular-nums text-ink-900">{money(total,debt.currency??'ARS')}</output></div><label className="block space-y-2 font-body text-sm font-medium text-ink-900">Turno de caja<select className={collectionFieldClass} value={shiftId} onChange={(event)=>setShiftId(event.target.value)}>{shifts.map((shift)=><option key={shift.id} value={shift.id}>{shift.desk_id} · {shift.business_date}</option>)}</select></label><fieldset className="space-y-2"><legend className="font-display text-sm font-semibold text-ink-900">Medio de pago</legend><div className="flex flex-wrap gap-2">{(Object.keys(tenderLabel) as Array<FullSelectionPaymentInput['tender']>).map((value)=><label key={value} className="flex min-h-11 items-center gap-2 border border-ink-300 bg-surface px-3 font-body text-sm text-ink-900"><input type="radio" name="payment-tender" value={value} checked={tender===value} onChange={()=>setTender(value)}/>{tenderLabel[value]}</label>)}</div></fieldset>{busy&&<p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>Registrando pago…</p>}{error&&statusMessage(error,true)}{reviewRequired&&<button type="button" onClick={review} className={collectionButtonClass.secondary}>Revisar saldos actualizados</button>}</div></Modal>
    <Modal open={Boolean(reversal)} title="Revisar reversión" role="alertdialog" descriptionId="reversal-description" dataTestid="reversal-modal" footer={<><button type="button" onClick={closeReversal} disabled={busy} className={`${collectionButtonClass.secondary} ${disabledClass}`}>Cancelar</button><button type="button" onClick={()=>void submitReversal()} disabled={busy||reviewRequired||!reason.trim()} className={`${collectionButtonClass.danger} ${disabledClass}`}>Confirmar reversión</button></>}>
      {reversal&&<div className="space-y-5"><p id="reversal-description" className="border-l-4 border-danger bg-danger-soft px-4 py-3 font-body text-sm text-ink-900">Esta reversión crea una compensación para toda la liquidación.</p><dl className="grid gap-3 sm:grid-cols-2"><div className="border border-ink-200 bg-surface-sunken p-3"><dt className="font-body text-xs font-medium uppercase tracking-wide text-ink-700">Liquidación</dt><dd className="mt-1 break-all font-body text-sm text-ink-900">{reversal.id}</dd></div><div className="border border-ink-200 bg-surface-sunken p-3"><dt className="font-body text-xs font-medium uppercase tracking-wide text-ink-700">Importe</dt><dd className="mt-1 font-display text-lg font-semibold tabular-nums text-ink-900">{money(reversal.amount_cents,reversal.currency)}</dd></div></dl><div><h3 className="font-display text-sm font-semibold text-ink-900">Asignaciones afectadas</h3><ul aria-label="Asignaciones afectadas" className="mt-2 space-y-2 font-body text-sm text-ink-700">{reversal.allocations.map((allocation)=><li key={allocation.id} className="border-l-2 border-ink-300 pl-3">Asignación {allocation.id} · Obligación {allocation.period_start}: <span className="font-medium tabular-nums text-ink-900">{money(allocation.amount_cents,allocation.currency)}</span></li>)}</ul></div><p className={collectionInlineStatusClass('neutral')}>Estado actual: {reversal.eligible?'Apta para reversión.':'No apta para reversión.'}</p><label className="block space-y-2 font-body text-sm font-medium text-ink-900">Motivo de reversión<textarea ref={reasonRef} aria-label="Motivo de reversión" className={`${collectionFieldClass} min-h-24 py-3`} value={reason} onChange={(event)=>setReason(event.target.value)}/></label>{busy&&<p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>Registrando reversión…</p>}{error&&statusMessage(error,true)}{reviewRequired&&<button type="button" onClick={review} className={collectionButtonClass.secondary}>Revisar historial actualizado</button>}</div>}
    </Modal></section>
}
