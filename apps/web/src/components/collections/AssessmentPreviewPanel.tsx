'use client'

import { useState, type FormEvent } from 'react'
import type { AssessmentPreview, AssessmentPreviewInput } from '@/lib/api/dues'

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
  return <section aria-labelledby="assessment-preview-title" className="space-y-4 rounded-lg border p-4">
    <h2 id="assessment-preview-title" className="text-lg font-semibold">Vista previa de evaluación</h2>
    {socio ? <p>Socio seleccionado: {socio.apellido}, {socio.nombre} · N.° {socio.numero_socio}</p> : <p role="status" aria-live="polite">Buscá y seleccioná un socio en el detalle de deuda para consultar su evaluación.</p>}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label>Desde<input type="month" required value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Hasta<input type="month" required value={through} onChange={(event) => setThrough(event.target.value)} /></label>
      <button type="submit" disabled={!socio || status === 'loading'}>Consultar vista previa</button>
    </form>
    {status === 'loading' && <p role="status" aria-live="polite">Cargando la vista previa de evaluación…</p>}
    {error && <p role="alert" aria-live="assertive">{error}</p>}
    {status === 'empty' && <p role="status" aria-live="polite">No hay períodos para mostrar en la vista previa.</p>}
    {preview && <div className="space-y-4">
      <dl className="grid gap-2 sm:grid-cols-2"><div><dt>Rango solicitado</dt><dd>{preview.from_period} a {preview.through_period}</dd></div><div><dt>Estado</dt><dd>{preview.executable ? 'Ejecutable' : 'Bloqueada: requiere revisión'}</dd></div><div><dt>Huella de la vista previa</dt><dd className="break-all font-mono text-xs">{preview.fingerprint}</dd></div></dl>
      {blocked && <div role="alert" aria-live="assertive"><p>La evaluación no es ejecutable.</p>{preview.issues.length > 0 && <ul aria-label="Problemas de la evaluación">{preview.issues.map((issue) => <li key={`${issue.period}-${issue.componentKey}-${issue.code}`}>{issue.period}: {issue.code} en {issue.componentKey} ({issue.from} a {issue.to})</li>)}</ul>}</div>}
      {preview.periods.map((period) => <article key={period.period} className="min-w-0 rounded border p-3">
        <h3>Período {period.period}</h3><p>{period.calendarDays} días calendario · {period.existingObligationId ? `Obligación existente: ${period.existingObligationId}` : 'Sin obligación existente'}</p>
        <h4>Componentes</h4><ul aria-label={`Componentes del período ${period.period}`} className="space-y-1">{period.components.map((component) => <li key={component.componentKey}>{componentName(component.componentKey, component.kind)}: {money(component.amountCents, preview.currency)} · {component.status} · {component.eligibleDays}/{component.calendarDays} días</li>)}</ul>
        <h4>Beneficios aplicados</h4><ul aria-label={`Beneficios del período ${period.period}`}><li>No se informaron beneficios para este período.</li></ul>
        <p className="font-semibold">Total del período: {money(period.pendingAmountCents ?? 0, preview.currency)}</p>
      </article>)}
      {preview.periods.length > 0 && <p className="font-semibold">Total del rango: {money(preview.periods.reduce((total, period) => total + (period.pendingAmountCents ?? 0), 0), preview.currency)}</p>}
    </div>}
  </section>
}
