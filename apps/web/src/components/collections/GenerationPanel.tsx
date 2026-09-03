'use client'

import { useEffect, useState, type FormEvent } from 'react'
import {
  collectionButtonClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from '@/components/collections/CollectionPrimitives'
import type { DuesGenerationPlan, DuesGenerationResult } from '@/lib/api/dues'
import { GenerationPeriodField } from './GenerationPeriodField'
import { GenerationPlanReview } from './GenerationPlanReview'

export type GenerationPanelStatus =
  | 'idle'
  | 'planning'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'generating'
  | 'generated'
  | 'error'

export type GenerationRequest = { period: string; plan_fingerprint: string }
type Props = {
  period?: string
  plan?: DuesGenerationPlan | null
  result?: DuesGenerationResult | null
  status?: GenerationPanelStatus
  error?: string
  onPlan: (period: string) => Promise<unknown> | unknown
  onGenerate: (request: GenerationRequest) => Promise<unknown> | unknown
  onGoToCollections: () => void
}

const money = (cents: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(cents / 100)}`

export function GenerationPanel({
  period: initial = '',
  plan,
  result,
  status = 'idle',
  error,
  onPlan,
  onGenerate,
  onGoToCollections,
}: Props) {
  const [period, setPeriod] = useState(initial)
  const [periodValid, setPeriodValid] = useState(() => /^\d{4}-(0[1-9]|1[0-2])$/.test(initial))
  const reviewing = status === 'planning' || status === 'loading'

  useEffect(() => {
    setPeriod(initial)
  }, [initial])
  const message =
    error ||
    (status === 'planning' || status === 'loading'
      ? 'Revisando la generación del período…'
      : status === 'generating'
        ? 'Generando deudas del período…'
        : status === 'stale'
          ? 'Los datos cambiaron. Revisá el plan actualizado antes de confirmar.'
          : status === 'error'
            ? 'No se pudo revisar la generación del período.'
            : null)
  const alert = Boolean(error || status === 'error' || status === 'stale')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void onPlan(period)
  }

  return (
    <section aria-labelledby="generation-title" className={collectionSectionClass}>
      <div className="space-y-1">
        <h2 id="generation-title" className="font-display text-xl font-semibold text-ink-900">
          Generación mensual
        </h2>
        <p className="font-body text-sm text-ink-500">Revisá las cuotas antes de generar deudas.</p>
      </div>
      {message && (
        <p
          role={alert ? 'alert' : 'status'}
          aria-live={alert ? 'assertive' : 'polite'}
          className={collectionInlineStatusClass(alert ? 'error' : 'neutral')}
        >
          {message}
        </p>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <GenerationPeriodField
          value={period}
          onChange={setPeriod}
          onValidityChange={setPeriodValid}
        />
        <button
          type="submit"
          disabled={!periodValid || reviewing || status === 'generating'}
          className={collectionButtonClass.primary}
        >
          Revisar generación
        </button>
      </form>
      {plan && (
        <GenerationPlanReview
          plan={plan}
          isGenerating={status === 'generating'}
          onConfirm={() =>
            void onGenerate({ period: plan.period, plan_fingerprint: plan.plan_fingerprint })
          }
        />
      )}
      {status === 'generated' && result && (
        <div role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
          Se generaron {result.generated_obligation_count} deudas; {result.retained_existing_count}{' '}
          existentes y {result.review_count} para revisar. Total:{' '}
          {money(result.generated_total_cents, 'ARS')}
          <button
            type="button"
            onClick={onGoToCollections}
            className={`ml-3 ${collectionButtonClass.secondary}`}
          >
            Ir a cobranza
          </button>
        </div>
      )}
    </section>
  )
}
