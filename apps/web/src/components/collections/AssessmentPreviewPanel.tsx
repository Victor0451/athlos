'use client'

import { useState, type FormEvent } from 'react'
import type { AssessmentPreview, AssessmentPreviewInput } from '@/lib/api/dues'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'

type Socio = { id: string; apellido: string; nombre: string; numero_socio: string }
type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'blocked' | 'error'
type Props = {
  socio: Socio | null
  preview: AssessmentPreview | null
  status: Status
  error?: string
  onPreview: (input: AssessmentPreviewInput) => void | Promise<void>
}
const money = (cents: number, currency: string | null) =>
  `${(cents / 100).toFixed(2)} ${currency ?? 'ARS'}`
const componentName = (key: string, kind: string) =>
  key === 'base'
    ? 'Cuota base'
    : kind === 'SPORT'
      ? `Disciplina: ${key.replace('sport:', '')}`
      : key

// prettier-ignore
export function AssessmentPreviewPanel({ socio, preview, status, error, onPreview }: Props) {
  const [from, setFrom] = useState(''), [through, setThrough] = useState('')
  const blocked = status === 'blocked' || preview?.executable === false
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (socio) void onPreview({ socio_id: socio.id, from_period: from, through_period: through }) }
  return <section aria-labelledby="assessment-preview-title" className={collectionSectionClass}>
    <h2 id="assessment-preview-title" className="font-display text-lg font-semibold text-ink-900">Vista previa de evaluación</h2>
    {socio ? <p className="border border-ink-200 bg-surface-sunken px-4 py-3 font-body text-sm text-ink-700">Socio seleccionado: {socio.apellido}, {socio.nombre} · N.° {socio.numero_socio}</p> : <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>Buscá y seleccioná un socio en el detalle de deuda para consultar su evaluación.</p>}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 font-body text-sm font-medium text-ink-700">Desde<input type="month" required value={from} onChange={(event) => setFrom(event.target.value)} className={collectionFieldClass} /></label>
      <label className="space-y-1 font-body text-sm font-medium text-ink-700">Hasta<input type="month" required value={through} onChange={(event) => setThrough(event.target.value)} className={collectionFieldClass} /></label>
      <button type="submit" disabled={!socio || status === 'loading'} className={collectionButtonClass.primary}>Consultar vista previa</button>
    </form>
    {status === 'loading' && <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>Cargando la vista previa de evaluación…</p>}
    {error && <p role="alert" aria-live="assertive" className={collectionInlineStatusClass('error')}>{error}</p>}
    {status === 'empty' && <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>No hay períodos para mostrar en la vista previa.</p>}
    {preview && <div className="space-y-4">
      <dl className="grid gap-px overflow-hidden border border-ink-200 bg-ink-200 sm:grid-cols-2"><div className="bg-surface p-3"><dt className="font-body text-sm text-ink-700">Rango solicitado</dt><dd className="font-semibold text-ink-900">{preview.from_period} a {preview.through_period}</dd></div><div className="bg-surface p-3"><dt className="font-body text-sm text-ink-700">Estado</dt><dd><span className="inline-block border border-info bg-info-soft px-2 py-1 text-sm font-semibold text-ink-900">{preview.executable ? 'Ejecutable' : 'Bloqueada: requiere revisión'}</span></dd></div><div className="min-w-0 bg-surface p-3 sm:col-span-2"><dt className="font-body text-sm text-ink-700">Huella de la vista previa</dt><dd className="break-all font-mono text-xs text-ink-900">{preview.fingerprint}</dd></div></dl>
      {blocked && <div role="alert" aria-live="assertive" className={`${collectionInlineStatusClass('error')} space-y-2`}><p>La evaluación no es ejecutable.</p>{preview.issues.length > 0 && <ul aria-label="Problemas de la evaluación" className="list-inside list-disc space-y-1">{preview.issues.map((issue) => <li key={`${issue.period}-${issue.componentKey}-${issue.code}`} className="break-words font-mono text-xs">{issue.period}: {issue.code} en {issue.componentKey} ({issue.from} a {issue.to})</li>)}</ul>}</div>}
      {preview.periods.map((period) => <article key={period.period} className="min-w-0 space-y-3 border border-ink-200 bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-display font-semibold text-ink-900">Período {period.period}</h3><p className="font-body text-sm text-ink-700">{period.calendarDays} días calendario · {period.existingObligationId ? `Obligación existente: ${period.existingObligationId}` : 'Sin obligación existente'}</p></div>
        <div className="space-y-2 border-y border-ink-200 py-3"><h4 className="font-display text-sm font-semibold text-ink-900">Componentes</h4><ul aria-label={`Componentes del período ${period.period}`} className="divide-y divide-ink-200 text-sm">{period.components.map((component) => <li key={component.componentKey} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"><span className="min-w-0 break-words text-ink-900">{componentName(component.componentKey, component.kind)}</span><span className="font-semibold text-ink-900">{money(component.amountCents, preview.currency)}</span><span className="font-mono text-xs text-ink-700 sm:col-span-2">{component.status} · {component.eligibleDays}/{component.calendarDays} días</span></li>)}</ul></div>
        <div className="space-y-2"><h4 className="font-display text-sm font-semibold text-ink-900">Beneficios aplicados</h4><ul aria-label={`Beneficios del período ${period.period}`} className="text-sm text-ink-700"><li>No se informaron beneficios para este período.</li></ul></div>
        <p className="border-t border-ink-200 pt-3 text-right font-display font-semibold text-ink-900">Total del período: {money(period.pendingAmountCents ?? 0, preview.currency)}</p>
      </article>)}
      {preview.periods.length > 0 && <p className="border border-ink-200 bg-surface-sunken p-4 text-right font-display text-lg font-semibold text-ink-900">Total del rango: {money(preview.periods.reduce((total, period) => total + (period.pendingAmountCents ?? 0), 0), preview.currency)}</p>}
    </div>}
  </section>
}
