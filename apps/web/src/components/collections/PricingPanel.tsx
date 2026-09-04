'use client'

import { useState } from 'react'
import type { DisciplinaOption } from '@/lib/api/padrones'
import type { DuesPrice, DuesPriceInput } from '@/lib/api/dues'
import {
  collectionButtonClass,
  collectionFieldClass,
  collectionInlineStatusClass,
  collectionSectionClass,
} from './CollectionPrimitives'
import { PricingForm } from './PricingForm'

export type PricingPanelState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'unavailable'
  | 'error'
  | 'conflict'
  | 'success'
export type DisciplinePanelState = 'loading' | 'ready' | 'empty' | 'error'

type Props = {
  prices: DuesPrice[]
  state?: PricingPanelState
  error?: string
  disciplines?: DisciplinaOption[]
  disciplineState?: DisciplinePanelState
  disciplineError?: string
  onCreate: (input: DuesPriceInput) => Promise<unknown> | unknown
  onRevoke?: (id: string, reason: string) => Promise<unknown> | unknown
}

const arsFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const dateLabel = (value: string) =>
  dateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
const effectivePeriodLabel = (price: DuesPrice) =>
  `Desde el ${dateLabel(price.effective_from)}${
    price.effective_to ? ` hasta el ${dateLabel(price.effective_to)}` : ''
  }`
const kindLabel = (kind: DuesPrice['kind']) =>
  kind === 'BASE' ? 'Cuota base' : 'Adicional por disciplina'
const ruleLabel = (rule: DuesPrice['rule']) =>
  ({
    FULL_MONTH: 'Mes completo',
    DAILY_PRORATED: 'Prorrateo diario',
    NEXT_PERIOD: 'Período siguiente',
  })[rule]

export function PricingPanel({
  prices,
  state = prices.length ? 'ready' : 'empty',
  error,
  disciplines = [],
  disciplineState = 'ready',
  disciplineError,
  onCreate,
  onRevoke,
}: Props) {
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState('')
  const pricingMessage =
    error ||
    ({
      loading: 'Cargando cuotas…',
      ready: '',
      empty: 'No hay cuotas configuradas.',
      unavailable: 'La configuración de cuotas no está disponible.',
      success: 'Cuota guardada.',
      error: 'No se pudieron cargar las cuotas.',
      conflict: 'El intervalo de vigencia se superpone. Revisá la cuota antes de continuar.',
    }[state] ??
      '')
  const disciplineMessage =
    disciplineError ||
    ({
      loading: 'Cargando disciplinas…',
      ready: '',
      empty: 'No hay disciplinas disponibles.',
      error: 'No se pudieron cargar las disciplinas.',
    }[disciplineState] ??
      '')
  const alert = Boolean(
    formError || error || state === 'error' || state === 'conflict' || state === 'unavailable',
  )
  const message = formError || pricingMessage
  const revoke = (id: string) => {
    setFormError('')
    if (!reason.trim()) {
      setFormError('El motivo de baja es obligatorio para dar de baja una cuota.')
      return
    }
    if (!onRevoke) return
    void Promise.resolve(onRevoke(id, reason.trim()))
      .then(() => setReason(''))
      .catch(() => undefined)
  }

  return (
    <section aria-labelledby="pricing-title" className={collectionSectionClass}>
      <h2 id="pricing-title" className="font-display text-lg font-semibold text-ink-900">
        Cuota base y adicionales
      </h2>
      {message && (
        <p
          role={alert ? 'alert' : 'status'}
          aria-live={alert ? 'assertive' : 'polite'}
          className={collectionInlineStatusClass(alert ? 'error' : 'neutral')}
        >
          {message}
        </p>
      )}
      {disciplineMessage && (
        <p role="status" aria-live="polite" className={collectionInlineStatusClass('neutral')}>
          {disciplineMessage}
        </p>
      )}
      <PricingForm
        disciplines={disciplines}
        disciplineState={disciplineState}
        busy={state === 'loading'}
        onCreate={onCreate}
      />
      {prices.length > 0 && (
        <ul
          aria-label="Cuotas configuradas"
          className="divide-y divide-ink-200 border-y border-ink-200"
        >
          {prices.map((price) => (
            <li
              key={price.id}
              className="flex flex-wrap items-center gap-2 py-3 font-body text-sm text-ink-900"
            >
              {kindLabel(price.kind)} · {arsFormatter.format(price.amount_cents / 100)} ·{' '}
              {effectivePeriodLabel(price)} · {ruleLabel(price.rule)}
              {price.kind === 'SPORT' && (
                <>
                  {' '}
                  ·{' '}
                  {disciplines.find(({ id }) => id === price.disciplina_id)?.nombre ??
                    'Disciplina no disponible'}
                </>
              )}
              {onRevoke && !price.revoked_at && (
                <button
                  type="button"
                  disabled={state === 'loading'}
                  className={collectionButtonClass.secondary}
                  onClick={() => revoke(price.id)}
                >
                  Dar de baja cuota
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onRevoke && prices.some((price) => !price.revoked_at) && (
        <label className="space-y-1 font-body text-sm font-medium text-ink-700">
          Motivo de baja
          <input
            className={collectionFieldClass}
            value={reason}
            onChange={(event) => {
              setFormError('')
              setReason(event.target.value)
            }}
          />
        </label>
      )}
    </section>
  )
}
