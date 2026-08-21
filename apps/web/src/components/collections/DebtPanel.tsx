'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DebtDetail } from '@/lib/api/dues'
import type { Socio } from '@/lib/api/socios'
import {
  SettlementActions,
  type AllocationRequest,
  type ReversalRequest,
} from './SettlementActions'

export type { DebtDetail } from '@/lib/api/dues'
// prettier-ignore
export type DebtPanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'not_found' | 'unavailable' | 'error'
type SocioOption = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>
// prettier-ignore
type Props = { socio: SocioOption | null; socios?: SocioOption[]; status: DebtPanelStatus; debt: DebtDetail | null; error: string; onSearch: (term: string) => Promise<void> | void; onSelectSocio: (socio: SocioOption) => Promise<void> | void; onAllocate?: (input: AllocationRequest) => Promise<{ replayed?: boolean } | void>; onReverse?: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void> }
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
// prettier-ignore
const statusMessage = (status: DebtPanelStatus) => ({ loading: 'Loading debt detail.', empty: 'No debt recorded for this socio.', not_found: 'Socio debt detail was not found.', unavailable: 'Debt detail is unavailable.' } as Partial<Record<DebtPanelStatus, string>>)[status] ?? ''

// prettier-ignore
export function DebtPanel({ socio, socios = [], status, debt, error, onSearch, onSelectSocio, onAllocate, onReverse }: Props) {
  const [term, setTerm] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alert = Boolean(error || status === 'error' || status === 'unavailable')
  const message = error || statusMessage(status)
  // prettier-ignore
  useEffect(() => { if (alert) statusRef.current?.focus() }, [alert, message])
  // prettier-ignore
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void Promise.resolve(onSearch(term.trim())) }
  // prettier-ignore
  return <section aria-labelledby="debt-title" className="space-y-4 rounded-lg border p-4">
    <h2 id="debt-title" className="text-lg font-semibold">Debt explanation</h2>
    <form role="search" aria-label="Select a socio for debt detail" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">Find socio<input aria-label="Find socio" type="search" value={term} onChange={(event) => setTerm(event.target.value)} /></label><button type="submit">Find socio</button>
    </form>
    {socios.length > 0 && <ul aria-label="Socio search results" className="space-y-2">{socios.map((option) => <li key={option.id}><button type="button" onClick={() => void onSelectSocio(option)}>{option.apellido}, {option.nombre} · No. {option.numero_socio}</button></li>)}</ul>}
    {message && <p ref={statusRef} role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'} tabIndex={alert ? -1 : undefined}>{message}</p>}
    {socio && debt?.status === 'ready' && <div aria-label={`Debt summary for ${socio.apellido}, ${socio.nombre}`} className="space-y-3">
      <p>Selected socio: {socio.apellido}, {socio.nombre} · No. {socio.numero_socio}</p><p>Total outstanding: {money(debt.total_debt_cents, debt.currency ?? 'ARS')}</p>
      <ul aria-label="Debt obligations" className="grid gap-3 md:grid-cols-2">{debt.obligations.map((obligation) => <li key={obligation.id} aria-label={`Debt obligation ${obligation.period_start}`} className="min-w-0 rounded border p-3">
        <h3>{obligation.period_start} to {obligation.period_end}</h3><dl><div><dt>Original</dt><dd>{money(obligation.original_amount_cents, obligation.currency)}</dd></div><div><dt>Outstanding</dt><dd>{money(obligation.outstanding_cents, obligation.currency)}</dd></div><div><dt>Status</dt><dd>{obligation.status}</dd></div></dl>
        <h4>Financial components</h4><ul aria-label={`Components for ${obligation.period_start}`}>{obligation.components.map((component) => <li key={component.id}>{component.component_key}: {money(component.amount_cents, obligation.currency)}</li>)}</ul>
        {obligation.benefits.length > 0 && <><h4>Applied benefits</h4><ul aria-label={`Benefits for ${obligation.period_start}`}>{obligation.benefits.map((benefit) => <li key={benefit.id}>{benefit.component_key}: {money(benefit.amount_cents, obligation.currency)}</li>)}</ul></>}
        <h4>Settlement history</h4>{obligation.allocations.length > 0 ? <ul aria-label={`Settlement history for ${obligation.period_start}`}>{obligation.allocations.map((allocation) => <li key={allocation.id}>Settlement {allocation.settlement_id}: {money(allocation.amount_cents, allocation.currency)} · {allocation.reversal_eligible ? 'Eligible for reversal' : 'Not eligible for reversal'}</li>)}</ul> : <p>No settlement history recorded.</p>}
      </li>)}</ul>
    </div>}
    {debt?.status === 'ready' && onAllocate && onReverse && <SettlementActions debt={debt} onAllocate={onAllocate} onReverse={onReverse} />}
  </section>
}
