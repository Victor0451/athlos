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
      setError('Enter a positive amount for at least one obligation.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await onAllocate({ amount_cents: total, allocations: selected })
      setAllocationOpen(false)
      setDraft({})
      setStatus(result?.replayed ? 'Settlement replayed.' : 'Native settlement recorded.')
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409)
        conflict('Balance changed. Review the retained draft before confirming with a new key.')
      else setError(cause instanceof Error ? cause.message : 'Settlement could not be recorded.')
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
          ? 'Reversal replayed as compensation.'
          : 'Reversal appended as compensation.',
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409)
        conflict('History changed. Review the refreshed history before confirming with a new key.')
      else setError(cause instanceof Error ? cause.message : 'Reversal could not be recorded.')
    } finally {
      setBusy(false)
    }
  }
  const review = () => {
    setReviewRequired(false)
    setError('')
  }
  // prettier-ignore
  return <section aria-labelledby="settlement-actions-title" className="space-y-4 rounded-lg border p-4"><h3 id="settlement-actions-title" className="text-lg font-semibold">Native settlement actions</h3>{status&&<p role="status" aria-live="polite">{status}</p>}<button type="button" onClick={openAllocation} disabled={!eligible.length}>Record native settlement</button>{debt.obligations.flatMap(({allocations})=>allocations.filter(({reversal_eligible})=>reversal_eligible)).map((allocation)=><button key={allocation.id} type="button" onClick={()=>openReversal(allocation)}>Reverse {allocation.id}</button>)}
    <Modal open={allocationOpen} title="Review native settlement" dataTestid="allocation-modal" footer={<><button type="button" onClick={()=>setAllocationOpen(false)} disabled={busy}>Cancel</button><button type="button" onClick={()=>void submitAllocation()} disabled={busy||reviewRequired||!total}>Confirm native settlement</button></>}><p>Every amount is an explicit allocation. Total: {money(total,debt.currency??'ARS')}.</p>{error&&<p ref={statusRef} role="alert" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Review refreshed balances</button>}{eligible.map((obligation)=><label key={obligation.id}>Amount for {obligation.period_start}<input aria-label={`Amount for ${obligation.period_start}`} type="number" min="0" inputMode="numeric" value={draft[obligation.id]??''} onChange={(event)=>setDraft({...draft,[obligation.id]:event.target.value})}/></label>)}</Modal>
    <Modal open={Boolean(reversal)} title="Review allocation reversal" dataTestid="reversal-modal" footer={<><button type="button" onClick={()=>setReversal(null)} disabled={busy}>Cancel</button><button type="button" onClick={()=>void submitReversal()} disabled={busy||reviewRequired||!reason.trim()}>Confirm reversal</button></>}>
      {reversal&&<><p>Allocation {reversal.id}: {money(reversal.amount_cents,reversal.currency)}.</p><label>Reversal reason<textarea aria-label="Reversal reason" value={reason} onChange={(event)=>setReason(event.target.value)}/></label>{error&&<p ref={statusRef} role="alert" tabIndex={-1}>{error}</p>}{reviewRequired&&<button type="button" onClick={review}>Review refreshed history</button>}</>}
    </Modal></section>
}
