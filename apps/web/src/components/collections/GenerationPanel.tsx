'use client'

import { useState, type FormEvent } from 'react'
import type { DuesGenerationResult } from '@/lib/api/dues'

export type GenerationPanelStatus =
  | 'idle'
  | 'loading'
  | 'created'
  | 'replayed'
  | 'zero'
  | 'conflict'
  | 'error'
type Props = {
  period?: string
  status?: GenerationPanelStatus
  result?: DuesGenerationResult | null
  error?: string
  onGenerate: (period: string) => Promise<unknown> | unknown
}
const outcome: Record<string, string> = {
  created: 'Se generaron las deudas del período.',
  replayed: 'El período ya estaba generado.',
  zero: 'No se generaron deudas.',
  conflict: 'La generación requiere revisión.',
}

export function GenerationPanel({
  period: initial = '',
  status = 'idle',
  result,
  error,
  onGenerate,
}: Props) {
  const [period, setPeriod] = useState(initial)
  const evidence =
    result && status === 'created'
      ? `Se generaron ${result.generated_obligation_count} obligaciones para ${result.period}.`
      : result && status === 'replayed'
        ? `El período ya estaba generado; se conservaron ${result.retained_existing_count} obligaciones.`
        : null
  const message =
    error ||
    evidence ||
    (status === 'loading'
      ? 'Generando deudas del período…'
      : status === 'error'
        ? 'No se pudieron generar las deudas del período.'
        : (outcome[status] ?? ''))
  const alert = Boolean(error || status === 'error' || status === 'conflict')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void Promise.resolve(onGenerate(period)).catch(() => undefined)
  }
  return (
    <section aria-labelledby="generation-title" className="space-y-4 rounded-lg border p-4">
      <h2 id="generation-title" className="text-lg font-semibold">
        Generación mensual
      </h2>
      {message && (
        <p role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'}>
          {message}
        </p>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label>
          Período
          <input
            type="month"
            required
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <button type="submit" disabled={status === 'loading'}>
          Generar deudas del período
        </button>
      </form>
      <a href="#debt-title">Ver detalle de deudas</a>
    </section>
  )
}
