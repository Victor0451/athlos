'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { DebtDetail } from '@/lib/api/dues'
import { Modal } from '@/components/ui/Modal'

// prettier-ignore
export type AllocationRequest={amount_cents:number;allocations:Array<{obligation_id:string;amount_cents:number}>}
// prettier-ignore
export type ReversalRequest={settlement_id:string;allocation_id:string;reason:string}
type Props = {
  debt: DebtDetail
  onAllocate: (input: AllocationRequest) => Promise<{ replayed?: boolean } | void>
  onReverse: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
}
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
type Allocation = DebtDetail['obligations'][number]['allocations'][number]

export function SettlementActions({ debt, onAllocate, onReverse }: Props) {
  const eligible = debt.obligations.filter(({ outstanding_cents }) => outstanding_cents > 0)
  const [allocationOpen, setAllocationOpen] = useState(false),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [reversal, setReversal] = useState<Allocation | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewRequired, setReviewRequired] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null),
    total = Object.values(draft).reduce((sum, value) => sum + (Number(value) || 0), 0)
  const selected = eligible.flatMap((obligation) => {
    const amount = Number(draft[obligation.id]) || 0
    return amount > 0 ? [{ obligation_id: obligation.id, amount_cents: amount }] : []
  })
  useEffect(() => {
    if (error) statusRef.current?.focus()
  }, [error])
  const openAllocation = () => {
    setDraft({})
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
    if (
      !selected.length ||
      selected.some(({ amount_cents }) => !Number.isSafeInteger(amount_cents)) ||
      total <= 0
    ) {
      setError('Ingresá un importe positivo para al menos una obligación.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await onAllocate({ amount_cents: total, allocations: selected })
      setAllocationOpen(false)
      setDraft({})
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
        allocation_id: reversal.id,
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
  return <section aria-labelledby="settlement-actions-title" className="space-y-4 rounded-lg border p-4"><h3 id="settlement-actions-title" className="text-lg font-semibold">Acciones de pago</h3>{status&&<p role="status" aria-live="polite">{status}</p>}<button type="button" onClick={openAllocation} disabled={!eligible.length}>Registrar pago</button>{debt.obligations.flatMap(({allocations})=>allocations.filter(({reversal_eligible})=>reversal_eligible)).map((allocation)=><button key={allocation.id} type="button" onClick={()=>openReversal(allocation)}>Revertir {allocation.id}</button>)}
    <Modal open={allocationOpen} title="Revisar pago" dataTestid="allocation-modal" footer={<><button type="button" onClick={()=>setAllocationOpen(false)} disabled={busy}>Cancelar</button><button type="button" onClick={()=>void submitAllocation()} disabled={busy||reviewRequired||!total}>Confirmar pago</button></>}><p>Cada importe se asigna de forma explícita. Total: {money(total,debt.currency??'ARS')}.</p>{error&&<p ref={statusRef} role="alert" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Revisar saldos actualizados</button>}{eligible.map((obligation)=><label key={obligation.id}>Importe del período {obligation.period_start}<input aria-label={`Importe del período ${obligation.period_start}`} type="number" min="0" inputMode="numeric" value={draft[obligation.id]??''} onChange={(event)=>setDraft({...draft,[obligation.id]:event.target.value})}/></label>)}</Modal>
    <Modal open={Boolean(reversal)} title="Revisar reversión" dataTestid="reversal-modal" footer={<><button type="button" onClick={()=>setReversal(null)} disabled={busy}>Cancelar</button><button type="button" onClick={()=>void submitReversal()} disabled={busy||reviewRequired||!reason.trim()}>Confirmar reversión</button></>}>
      {reversal&&<><p>Pago {reversal.id}: {money(reversal.amount_cents,reversal.currency)}.</p><label>Motivo de reversión<textarea aria-label="Motivo de reversión" value={reason} onChange={(event)=>setReason(event.target.value)}/></label>{error&&<p ref={statusRef} role="alert" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Revisar historial actualizado</button>}</>}
    </Modal></section>
}
