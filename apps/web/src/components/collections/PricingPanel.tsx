'use client'

import { useState, type FormEvent } from 'react'
import type { DisciplinaOption } from '@/lib/api/padrones'
import type { DuesPrice, DuesPriceInput } from '@/lib/api/dues'

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

const blank: DuesPriceInput = {
  kind: 'BASE',
  disciplina_id: null,
  amount_cents: 0,
  currency: 'ARS',
  effective_from: '',
  effective_to: null,
  rule: 'FULL_MONTH',
}
type Field = 'amount_cents' | 'effective_from' | 'effective_to'
const fields: readonly [string, Field, 'number' | 'date', boolean][] = [
  ['Importe (centavos)', 'amount_cents', 'number', true],
  ['Vigente desde', 'effective_from', 'date', true],
  ['Vigente hasta', 'effective_to', 'date', false],
]
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
  const [draft, setDraft] = useState(blank)
  const [reason, setReason] = useState('')
  const update = (key: Field, value: string) =>
    setDraft((current) => ({
      ...current,
      [key]: key === 'amount_cents' ? Number(value) : value || null,
    }))
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
    error || state === 'error' || state === 'conflict' || state === 'unavailable',
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = draft.kind === 'BASE' ? { ...draft, disciplina_id: null } : draft
    void Promise.resolve(onCreate(input))
      .then(() => setDraft(blank))
      .catch(() => undefined)
  }
  const revoke = (id: string) => {
    if (!onRevoke || !reason.trim()) return
    void Promise.resolve(onRevoke(id, reason.trim()))
      .then(() => setReason(''))
      .catch(() => undefined)
  }
  return (
    <section aria-labelledby="pricing-title" className="space-y-4 rounded-lg border p-4">
      <h2 id="pricing-title" className="text-lg font-semibold">
        Configuración de cuotas
      </h2>
      {pricingMessage && (
        <p role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'}>
          {pricingMessage}
        </p>
      )}
      {disciplineMessage && (
        <p role="status" aria-live="polite">
          {disciplineMessage}
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label>
          Tipo de cuota
          <select
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as DuesPrice['kind']
              setDraft((current) => ({
                ...current,
                kind,
                disciplina_id: kind === 'BASE' ? null : (current.disciplina_id ?? null),
              }))
            }}
          >
            <option value="BASE">Cuota base</option>
            <option value="SPORT">Adicional por disciplina</option>
          </select>
        </label>
        {draft.kind === 'SPORT' && (
          <label>
            Disciplina
            <select
              required
              value={draft.disciplina_id ?? ''}
              disabled={disciplineState !== 'ready'}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  disciplina_id: event.target.value || null,
                }))
              }
            >
              <option value="">Seleccioná una disciplina…</option>
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        {fields.map(([label, key, type, required]) => (
          <label key={key}>
            {label}
            <input
              type={type}
              min={type === 'number' ? 0 : undefined}
              required={required}
              value={draft[key] ?? ''}
              onChange={(event) => update(key, event.target.value)}
            />
          </label>
        ))}
        <label>
          Regla de cálculo
          <select
            value={draft.rule}
            onChange={(event) =>
              setDraft({ ...draft, rule: event.target.value as DuesPrice['rule'] })
            }
          >
            <option value="FULL_MONTH">Mes completo</option>
            <option value="DAILY_PRORATED">Prorrateo diario</option>
            <option value="NEXT_PERIOD">Período siguiente</option>
          </select>
        </label>
        <button type="submit" disabled={state === 'loading'}>
          Guardar cuota
        </button>
      </form>
      {prices.length > 0 && (
        <ul aria-label="Cuotas configuradas" className="space-y-2">
          {prices.map((price) => (
            <li key={price.id}>
              {kindLabel(price.kind)} · {price.amount_cents} {price.currency} ·{' '}
              {price.effective_from} · {ruleLabel(price.rule)}
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
        <label>
          Motivo de baja
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      )}
    </section>
  )
}
