'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  DebtDetail,
  FullSelectionPaymentInput,
  FullSelectionPaymentResult,
} from '@/lib/api/dues'
import type { CashShift } from '@/lib/api/treasury'
import type { Socio } from '@/lib/api/socios'
import { AgreementActions, type AgreementViewState } from './AgreementActions'
import type { CommunityWorkDraft } from './CommunityWorkForm'
import type { AgreementDraft } from './AgreementForm'
import { SettlementActions, type ReversalRequest } from './SettlementActions'

export type { DebtDetail } from '@/lib/api/dues'
// prettier-ignore
export type DebtPanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'not_found' | 'unavailable' | 'error'
type SocioOption = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>
// prettier-ignore
export type FullSelectionPaymentDraft = Omit<FullSelectionPaymentInput, 'socio_id'>
type Props = {
  socio: SocioOption | null
  socios?: SocioOption[]
  status: DebtPanelStatus
  debt: DebtDetail | null
  error: string
  onSearch: (term: string) => Promise<void> | void
  onSelectSocio: (socio: SocioOption) => Promise<void> | void
  openShifts?: CashShift[]
  onPayment?: (
    input: FullSelectionPaymentDraft,
  ) => Promise<FullSelectionPaymentResult & { replayed?: boolean }>
  onReverse?: (input: ReversalRequest) => Promise<{ replayed?: boolean } | void>
  agreementsEnabled?: boolean
  agreementStates?: Record<string, AgreementViewState>
  onCreateAgreement?: (
    obligationId: string,
    draft: AgreementDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onReviseAgreement?: (
    obligationId: string,
    agreementId: string,
    draft: AgreementDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onRecordCommunityWork?: (
    obligationId: string,
    agreementId: string,
    draft: CommunityWorkDraft,
  ) => Promise<{ replayed?: boolean } | void>
  onRefreshAgreement?: (obligationId: string) => Promise<void> | void
}
const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`
// prettier-ignore
const statusMessage = (status: DebtPanelStatus) => ({ loading: 'Cargando el detalle de deuda…', empty: 'No hay deuda registrada para este socio.', not_found: 'No se encontró el detalle de deuda de este socio.', unavailable: 'El detalle de deuda no está disponible.' } as Partial<Record<DebtPanelStatus, string>>)[status] ?? ''
const obligationStatus = (status: 'OPEN' | 'PAID') => (status === 'OPEN' ? 'Abierta' : 'Pagada')
const allocationKind = (kind: 'ALLOCATION' | 'COMPENSATION') =>
  kind === 'ALLOCATION' ? 'Asignación' : 'Compensación'

// prettier-ignore
export function DebtPanel({ socio, socios = [], status, debt, error, onSearch, onSelectSocio, openShifts = [], onPayment, onReverse, agreementsEnabled = false, agreementStates = {}, onCreateAgreement, onReviseAgreement, onRecordCommunityWork, onRefreshAgreement }: Props) {
  const [term, setTerm] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alert = Boolean(error || status === 'error' || status === 'unavailable')
  const message = error || statusMessage(status)
  // prettier-ignore
  useEffect(() => { if (alert) statusRef.current?.focus() }, [alert, message])
  // prettier-ignore
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void Promise.resolve(onSearch(term.trim())) }
  // prettier-ignore
  return <section id="debt-title" aria-labelledby="debt-heading" className="space-y-4 rounded-lg border p-4">
    <h2 id="debt-heading" className="text-lg font-semibold">Detalle de deuda</h2>
    <form role="search" aria-label="Buscar un socio para consultar su deuda" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">Buscar socio<input aria-label="Buscar socio" type="search" value={term} onChange={(event) => setTerm(event.target.value)} /></label><button type="submit">Buscar socio</button>
    </form>
    {socios.length > 0 && <ul aria-label="Resultados de búsqueda de socios" className="space-y-2">{socios.map((option) => <li key={option.id}><button type="button" onClick={() => void onSelectSocio(option)}>{option.apellido}, {option.nombre} · N.° {option.numero_socio}</button></li>)}</ul>}
    {message && <p ref={statusRef} role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'} tabIndex={alert ? -1 : undefined}>{message}</p>}
    {socio && debt?.status === 'ready' && <div aria-label={`Resumen de deuda de ${socio.apellido}, ${socio.nombre}`} className="space-y-3">
      <p>Socio seleccionado: {socio.apellido}, {socio.nombre} · N.° {socio.numero_socio}</p><p>Deuda total pendiente: {money(debt.total_debt_cents, debt.currency ?? 'ARS')}</p>
      <ul aria-label="Obligaciones de deuda" className="grid gap-3 md:grid-cols-2">{debt.obligations.map((obligation) => <li key={obligation.id} aria-label={`Obligación del período ${obligation.period_start}`} className="min-w-0 rounded border p-3">
        <h3>{obligation.period_start} a {obligation.period_end}</h3><dl><div><dt>Importe original</dt><dd>{money(obligation.original_amount_cents, obligation.currency)}</dd></div><div><dt>Importe pendiente</dt><dd>{money(obligation.outstanding_cents, obligation.currency)}</dd></div><div><dt>Estado</dt><dd>{obligationStatus(obligation.status)}</dd></div></dl>
        <h4>Componentes financieros</h4>{obligation.components.length ? <ul aria-label={`Componentes del período ${obligation.period_start}`}>{obligation.components.map((component) => <li key={component.id}>{component.component_key}: {money(component.amount_cents, obligation.currency)}</li>)}</ul> : <p>Sin componentes financieros.</p>}
        <h4>Beneficios aplicados</h4>{obligation.benefits.length ? <ul aria-label={`Beneficios del período ${obligation.period_start}`}>{obligation.benefits.map((benefit) => <li key={benefit.id}>{benefit.component_key}: {money(benefit.amount_cents, obligation.currency)}</li>)}</ul> : <p>Sin beneficios aplicados.</p>}
        <h4>Historial de liquidaciones</h4>{obligation.allocations.length ? <ul aria-label={`Historial de liquidaciones del período ${obligation.period_start}`}>{obligation.allocations.map((allocation) => <li key={allocation.id}><dl><div><dt>Liquidación</dt><dd>{allocation.settlement_id} · {allocation.settlement_kind}: {money(allocation.settlement_amount_cents, allocation.currency)}</dd></div><div><dt>{allocationKind(allocation.kind)}</dt><dd>{money(allocation.amount_cents, allocation.currency)}</dd></div>{allocation.compensates_allocation_id && <div><dt>Compensación</dt><dd>Compensa la asignación {allocation.compensates_allocation_id}</dd></div>}<div><dt>Reversión</dt><dd>{allocation.reversal_eligible ? 'Se puede revertir' : 'No se puede revertir'}</dd></div></dl></li>)}</ul> : <p>No hay liquidaciones registradas.</p>}
        {agreementsEnabled && onCreateAgreement && onRefreshAgreement && <AgreementActions obligation={obligation} state={agreementStates[obligation.id] ?? { status: 'idle', active: null }} onCreate={(draft) => onCreateAgreement(obligation.id, draft)} {...(onReviseAgreement ? { onRevise: (agreementId: string, draft: AgreementDraft) => onReviseAgreement(obligation.id, agreementId, draft) } : {})} {...(onRecordCommunityWork ? { onRecordCommunityWork: (agreementId: string, draft: CommunityWorkDraft) => onRecordCommunityWork(obligation.id, agreementId, draft) } : {})} onRefresh={() => onRefreshAgreement(obligation.id)} />}
      </li>)}</ul>{debt.obligations.length === 0 && <p role="status">No hay obligaciones para detallar.</p>}
    </div>}
    {debt?.status === 'ready' && onPayment && onReverse && <SettlementActions debt={debt} shifts={openShifts} onPayment={onPayment} onReverse={onReverse} />}
  </section>
}
