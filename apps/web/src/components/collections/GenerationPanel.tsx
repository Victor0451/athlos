'use client'

import { useState, type FormEvent } from 'react'

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
  error?: string
  onGenerate: (period: string) => Promise<unknown> | unknown
}
const outcome: Record<string, string> = {
  created: 'Generation completed.',
  replayed: 'Generation replayed.',
  zero: 'No obligations were generated.',
  conflict: 'Generation needs review.',
}

export function GenerationPanel({
  period: initial = '',
  status = 'idle',
  error,
  onGenerate,
}: Props) {
  const [period, setPeriod] = useState(initial)
  const message =
    error ||
    (status === 'loading'
      ? 'Generating obligations.'
      : status === 'error'
        ? 'Unable to generate obligations.'
        : (outcome[status] ?? ''))
  const alert = Boolean(error || status === 'error' || status === 'conflict')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void Promise.resolve(onGenerate(period)).catch(() => undefined)
  }
  return (
    <section aria-labelledby="generation-title" className="space-y-4 rounded-lg border p-4">
      <h2 id="generation-title" className="text-lg font-semibold">
        Monthly generation
      </h2>
      {message && (
        <p role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'}>
          {message}
        </p>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label>
          Period
          <input
            type="month"
            required
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <button type="submit" disabled={status === 'loading'}>
          Generate obligations
        </button>
      </form>
    </section>
  )
}
