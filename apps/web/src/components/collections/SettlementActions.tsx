'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { DebtDetail, FullSelectionPaymentInput } from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import { Modal } from '@/components/ui/Modal'

// prettier-ignore
export type ReversalRequest={settlement_id:string;reason:string}
type Props = {
  debt: DebtDetail
  shifts: CashShift[]
  onPayment: (
    input: Omit<FullSelectionPaymentInput, 'socio_id'>,
  ) => Promise<{ replayed?: boolean } | void>
  onReverse: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
}
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
type Allocation = DebtDetail['obligations'][number]['allocations'][number]
const tenderLabel = {
  CASH: 'Efectivo',
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
  TRANSFER: 'Transferencia',
}

export function SettlementActions({ debt, shifts, onPayment, onReverse }: Props) {
  const eligible = debt.obligations.filter(({ outstanding_cents }) => outstanding_cents > 0)
  const [allocationOpen, setAllocationOpen] = useState(false),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [shiftId, setShiftId] = useState(shifts[0]?.id ?? ''),
    [tender, setTender] = useState<FullSelectionPaymentInput['tender']>('CASH'),
    [reversal, setReversal] = useState<Allocation | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewRequired, setReviewRequired] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null),
    selected = eligible.filter(({ id }) => selectedIds.includes(id)),
    total = selected.reduce((sum, obligation) => sum + obligation.outstanding_cents, 0)
  const reversible = [
    ...new Map(
      debt.obligations
        .flatMap(({ allocations }) =>
          allocations.filter(({ reversal_eligible }) => reversal_eligible),
        )
        .map((allocation) => [allocation.settlement_id, allocation]),
    ).values(),
  ]
  useEffect(() => {
    if (error) statusRef.current?.focus()
  }, [error])
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
  const openReversal = (allocation: Allocation) => {
    setReversal(allocation)
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
      const result = await onReverse({
        settlement_id: reversal.settlement_id,
        reason: reason.trim(),
      })
      setReversal(null)
      setReason('')
      setStatus(
        result?.replayed
          ? 'Reversión repetida como compensación.'
          : 'Reversión registrada como compensación.',
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409)
        conflict(
          'El historial cambió. Revisá el historial actualizado antes de confirmar nuevamente.',
        )
      else setError('No se pudo registrar la reversión.')
    } finally {
      setBusy(false)
    }
  }
  const review = () => {
    setReviewRequired(false)
    setError('')
  }
  // prettier-ignore
  return <section aria-labelledby="settlement-actions-title" className="space-y-4 rounded-lg border p-4"><h3 id="settlement-actions-title" className="text-lg font-semibold">Acciones de pago</h3>{status&&<p role="status" aria-live="polite">{status}</p>}<button type="button" onClick={openAllocation} disabled={!eligible.length||!shifts.length}>Registrar pago</button>{!shifts.length&&eligible.length>0&&<p role="status">No hay turnos de caja abiertos para registrar el pago.</p>}{reversible.map((allocation)=><button key={allocation.settlement_id} type="button" onClick={()=>openReversal(allocation)}>Revertir pago {allocation.settlement_id}</button>)}
    <Modal open={allocationOpen} title="Revisar pago" dataTestid="allocation-modal" footer={<><button type="button" onClick={()=>setAllocationOpen(false)} disabled={busy}>Cancelar</button><button type="button" onClick={()=>void submitAllocation()} disabled={busy||reviewRequired||!selected.length||!shiftId}>Confirmar pago</button></>}><div className="space-y-4"><p>Seleccioná obligaciones completas. El total se calcula para revisión y el servidor confirma los saldos.</p><fieldset><legend>Obligaciones a pagar</legend>{eligible.map((obligation)=><label key={obligation.id} className="flex gap-2"><input type="checkbox" checked={selectedIds.includes(obligation.id)} onChange={()=>setSelectedIds((current)=>current.includes(obligation.id)?current.filter((id)=>id!==obligation.id):[...current,obligation.id])}/><span>Período {obligation.period_start}: {money(obligation.outstanding_cents,obligation.currency)}</span></label>)}</fieldset><p className="font-semibold">Total a registrar: {money(total,debt.currency??'ARS')}</p><label>Turno de caja<select value={shiftId} onChange={(event)=>setShiftId(event.target.value)}>{shifts.map((shift)=><option key={shift.id} value={shift.id}>{shift.desk_id} · {shift.business_date}</option>)}</select></label><fieldset><legend>Medio de pago</legend>{(Object.keys(tenderLabel) as Array<FullSelectionPaymentInput['tender']>).map((value)=><label key={value} className="mr-3"><input type="radio" name="payment-tender" value={value} checked={tender===value} onChange={()=>setTender(value)}/>{tenderLabel[value]}</label>)}</fieldset>{busy&&<p role="status" aria-live="polite">Registrando pago…</p>}{error&&<p ref={statusRef} role="alert" aria-live="assertive" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Revisar saldos actualizados</button>}</div></Modal>
    <Modal open={Boolean(reversal)} title="Revisar reversión" dataTestid="reversal-modal" footer={<><button type="button" onClick={()=>setReversal(null)} disabled={busy}>Cancelar</button><button type="button" onClick={()=>void submitReversal()} disabled={busy||reviewRequired||!reason.trim()}>Confirmar reversión</button></>}>
      {reversal&&<><p>Pago {reversal.settlement_id}: {money(reversal.settlement_amount_cents,reversal.currency)}.</p><label>Motivo de reversión<textarea aria-label="Motivo de reversión" value={reason} onChange={(event)=>setReason(event.target.value)}/></label>{error&&<p ref={statusRef} role="alert" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Revisar historial actualizado</button>}</>}
    </Modal></section>
}
