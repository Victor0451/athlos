'use client'

import { useState, type FormEvent } from 'react'
import type { DuesPrice, DuesPriceInput } from '@/lib/api/dues'

export type PricingPanelState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'unavailable'
  | 'error'
  | 'conflict'
  | 'success'

type Props = {
  prices: DuesPrice[]
  state?: PricingPanelState
  error?: string
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
type Field = 'disciplina_id' | 'amount_cents' | 'effective_from' | 'effective_to'
const fields: readonly [string, Field, 'text' | 'number' | 'date', boolean][] = [
  ['Discipline ID', 'disciplina_id', 'text', false],
  ['Amount (cents)', 'amount_cents', 'number', true],
  ['Effective from', 'effective_from', 'date', true],
  ['Effective to', 'effective_to', 'date', false],
]

export function PricingPanel({
  prices,
  state = prices.length ? 'ready' : 'empty',
  error,
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
  const message =
    error ||
    ({
      loading: 'Loading prices.',
      ready: '',
      empty: 'No prices configured.',
      unavailable: 'Pricing is unavailable.',
      success: 'Price saved.',
      error: 'Unable to load pricing.',
      conflict: error || 'Price conflict requires review.',
    }[state] ??
      '')
  const alert = Boolean(
    error || state === 'error' || state === 'conflict' || state === 'unavailable',
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void Promise.resolve(onCreate(draft))
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
        Pricing
      </h2>
      {message && (
        <p role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'}>
          {message}
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label>
          Price type
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value as DuesPrice['kind'] })
            }
          >
            <option value="BASE">Base</option>
            <option value="SPORT">Sport</option>
          </select>
        </label>
        {fields.map(([label, key, type, required]) => (
          <label key={key}>
            {label}
            <input
              type={type}
              min={type === 'number' ? 0 : undefined}
              required={key === 'disciplina_id' ? draft.kind === 'SPORT' : required}
              value={draft[key] ?? ''}
              onChange={(event) => update(key, event.target.value)}
            />
          </label>
        ))}
        <label>
          Assessment rule
          <select
            value={draft.rule}
            onChange={(event) =>
              setDraft({ ...draft, rule: event.target.value as DuesPrice['rule'] })
            }
          >
            <option value="FULL_MONTH">Full month</option>
            <option value="DAILY_PRORATED">Daily prorated</option>
            <option value="NEXT_PERIOD">Next period</option>
          </select>
        </label>
        <button type="submit" disabled={state === 'loading'}>
          Save price
        </button>
      </form>
      {prices.length > 0 && (
        <ul aria-label="Configured prices" className="space-y-2">
          {prices.map((price) => (
            <li key={price.id}>
              {price.kind} · {price.amount_cents} {price.currency} · {price.effective_from}
              {onRevoke && !price.revoked_at && (
                <button
                  type="button"
                  disabled={state === 'loading'}
                  onClick={() => revoke(price.id)}
                >
                  Revoke price
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onRevoke && prices.some((price) => !price.revoked_at) && (
        <label>
          Revocation reason
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      )}
    </section>
  )
}
