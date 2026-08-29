'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DebtDetail } from '@/lib/api/dues'
import type { Socio } from '@/lib/api/socios'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

export type { DebtDetail } from '@/lib/api/dues'
// prettier-ignore
export type DebtPanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'not_found' | 'unavailable' | 'error'
type SocioOption = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>
// prettier-ignore
type Props = {
  socio: SocioOption | null
  socios?: SocioOption[]
  status: DebtPanelStatus
  debt: DebtDetail | null
  error: string
  onSearch: (term: string) => Promise<void> | void
  onSelectSocio: (socio: SocioOption) => Promise<void> | void
}
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
// prettier-ignore
const statusMessage = (status: DebtPanelStatus) => ({ loading: 'Cargando el detalle de deuda…', empty: 'No hay deuda registrada para este socio.', not_found: 'No se encontró el detalle de deuda de este socio.', unavailable: 'El detalle de deuda no está disponible.' } as Partial<Record<DebtPanelStatus, string>>)[status] ?? ''
const obligationStatus = (status: 'OPEN' | 'PAID') => (status === 'OPEN' ? 'Abierta' : 'Pagada')
const allocationKind = (kind: 'ALLOCATION' | 'COMPENSATION') =>
  kind === 'ALLOCATION' ? 'Asignación' : 'Compensación'

// prettier-ignore
export function DebtPanel({ socio, socios = [], status, debt, error, onSearch, onSelectSocio }: Props) {
  const [term, setTerm] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alert = Boolean(error || status === 'error' || status === 'unavailable')
  const message = error || statusMessage(status)
  // prettier-ignore
  useEffect(() => { if (alert) statusRef.current?.focus() }, [alert, message])
  // prettier-ignore
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void Promise.resolve(onSearch(term.trim())) }
  // prettier-ignore
  return <section id="debt-title" aria-labelledby="debt-heading" className={collectionSectionClass}>
    <h2 id="debt-heading" className="font-display text-lg font-semibold text-ink-900">Detalle de deuda</h2>
    <form role="search" aria-label="Buscar un socio para consultar su deuda" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 space-y-1 font-body text-sm font-medium text-ink-700">Buscar socio<input aria-label="Buscar socio" type="search" value={term} onChange={(event) => setTerm(event.target.value)} className={collectionFieldClass} /></label><button type="submit" className={collectionButtonClass.primary}>Buscar socio</button>
    </form>
    {socios.length > 0 && <ul aria-label="Resultados de búsqueda de socios" className="divide-y divide-ink-200 border border-ink-200">{socios.map((option) => <li key={option.id}><button type="button" onClick={() => void onSelectSocio(option)} className={`min-h-11 w-full px-3 py-2 text-left font-body text-sm text-ink-900 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${socio?.id === option.id ? 'bg-info-soft font-semibold' : ''}`}><span className="block">{option.apellido}, {option.nombre}</span><span className="block font-mono text-xs text-ink-700">N.° {option.numero_socio}</span></button></li>)}</ul>}
    {message && <p ref={statusRef} role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'} tabIndex={alert ? -1 : undefined} className={collectionInlineStatusClass(alert ? 'error' : 'neutral')}>{message}</p>}
    {socio && debt?.status === 'ready' && <div aria-label={`Resumen de deuda de ${socio.apellido}, ${socio.nombre}`} className="space-y-3">
      <div className="min-w-0 border border-ink-200 bg-surface-sunken p-4"><p className="font-body text-sm text-ink-700">Socio seleccionado: {socio.apellido}, {socio.nombre} · N.° {socio.numero_socio}</p><p className="mt-2 font-display text-xl font-semibold text-ink-900">Deuda total pendiente: {money(debt.total_debt_cents, debt.currency ?? 'ARS')}</p></div>
      <ul aria-label="Obligaciones de deuda" className="grid min-w-0 gap-3 md:grid-cols-2">{debt.obligations.map((obligation) => <li key={obligation.id} aria-label={`Obligación del período ${obligation.period_start}`} className="min-w-0 space-y-4 border border-ink-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-display font-semibold text-ink-900">{obligation.period_start} a {obligation.period_end}</h3><span className="border border-info bg-info-soft px-2 py-1 font-body text-xs font-semibold text-ink-900">{obligationStatus(obligation.status)}</span></div><dl className="grid gap-x-4 gap-y-2 border-y border-ink-200 py-3 text-sm sm:grid-cols-2"><div><dt className="font-body text-ink-700">Importe original</dt><dd className="font-semibold text-ink-900">{money(obligation.original_amount_cents, obligation.currency)}</dd></div><div><dt className="font-body text-ink-700">Importe pendiente</dt><dd className="font-semibold text-ink-900">{money(obligation.outstanding_cents, obligation.currency)}</dd></div></dl>
        <div className="space-y-2"><h4 className="font-display text-sm font-semibold text-ink-900">Componentes financieros</h4>{obligation.components.length ? <ul aria-label={`Componentes del período ${obligation.period_start}`} className="divide-y divide-ink-200 border-y border-ink-200 text-sm">{obligation.components.map((component) => <li key={component.id} className="flex min-w-0 justify-between gap-3 py-2"><span className="min-w-0 break-words font-mono text-xs text-ink-700">{component.component_key}</span><span className="shrink-0 font-semibold text-ink-900">{money(component.amount_cents, obligation.currency)}</span></li>)}</ul> : <p className="text-sm text-ink-700">Sin componentes financieros.</p>}</div>
        <div className="space-y-2"><h4 className="font-display text-sm font-semibold text-ink-900">Beneficios aplicados</h4>{obligation.benefits.length ? <ul aria-label={`Beneficios del período ${obligation.period_start}`} className="divide-y divide-ink-200 border-y border-ink-200 text-sm">{obligation.benefits.map((benefit) => <li key={benefit.id} className="flex min-w-0 justify-between gap-3 py-2"><span className="min-w-0 break-words font-mono text-xs text-ink-700">{benefit.component_key}</span><span className="shrink-0 font-semibold text-ink-900">{money(benefit.amount_cents, obligation.currency)}</span></li>)}</ul> : <p className="text-sm text-ink-700">Sin beneficios aplicados.</p>}</div>
        <div className="space-y-2"><h4 className="font-display text-sm font-semibold text-ink-900">Historial de liquidaciones</h4>{obligation.allocations.length ? <ul aria-label={`Historial de liquidaciones del período ${obligation.period_start}`} className="space-y-2">{obligation.allocations.map((allocation) => <li key={allocation.id} className="min-w-0 border-l-2 border-ink-300 pl-3"><dl className="space-y-1 text-sm"><div><dt className="font-body text-ink-700">Liquidación</dt><dd className="break-words font-mono text-xs text-ink-900">{allocation.settlement_id} · {allocation.settlement_kind}: {money(allocation.settlement_amount_cents, allocation.currency)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="font-body text-ink-700">{allocationKind(allocation.kind)}</dt><dd className="font-semibold text-ink-900">{money(allocation.amount_cents, allocation.currency)}</dd></div>{allocation.compensates_allocation_id && <div><dt className="font-body text-ink-700">Compensación</dt><dd className="break-all font-mono text-xs text-ink-900">Compensa la asignación {allocation.compensates_allocation_id}</dd></div>}<div><dt className="font-body text-ink-700">Reversión</dt><dd className="text-ink-900">{allocation.reversal_eligible ? 'Se puede revertir' : 'No se puede revertir'}</dd></div></dl></li>)}</ul> : <p className="text-sm text-ink-700">No hay liquidaciones registradas.</p>}</div>
      </li>)}</ul>{debt.obligations.length === 0 && <p role="status">No hay obligaciones para detallar.</p>}
    </div>}
  </section>
}
