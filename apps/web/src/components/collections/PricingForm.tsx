'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { DisciplinaOption } from '@/lib/api/padrones'
import type { DuesPrice, DuesPriceInput } from '@/lib/api/dues'
import { collectionButtonClass, collectionFieldClass } from './CollectionPrimitives'
import { parseSpanishDate, SpanishDateInput } from './SpanishDateInput'

export type PricingRepairContext =
  | {
      kind: 'SPORT'
      disciplinaId: string
      effectiveFrom: string
      effectiveTo: string
    }
  | { kind: 'unresolved'; message: string }

type Props = {
  disciplines: DisciplinaOption[]
  disciplineState?: 'loading' | 'ready' | 'empty' | 'error'
  busy?: boolean
  repairContext?: PricingRepairContext
  onCreate: (input: DuesPriceInput) => Promise<unknown> | unknown
}

type DateField = 'effective_from' | 'effective_to'

const blank: DuesPriceInput = {
  kind: 'BASE',
  disciplina_id: null,
  amount_cents: 0,
  currency: 'ARS',
  effective_from: '',
  effective_to: null,
  rule: 'FULL_MONTH',
}
const fields: readonly [string, DateField, boolean][] = [
  ['Vigente desde', 'effective_from', true],
  ['Vigente hasta', 'effective_to', false],
]

const parseArsToCents = (value: string) => {
  const match = value
    .trim()
    .replace(',', '.')
    .match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  const major = match[1]
  const decimal = match[2] ?? ''
  if (!major) return null
  const cents = BigInt(major) * 100n + BigInt(decimal.padEnd(2, '0'))
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(cents)
}

export function PricingForm({
  disciplines,
  disciplineState = 'ready',
  busy,
  repairContext,
  onCreate,
}: Props) {
  const [draft, setDraft] = useState(blank)
  const [dates, setDates] = useState<Record<DateField, string>>({
    effective_from: '',
    effective_to: '',
  })
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [dateError, setDateError] = useState<Partial<Record<DateField, string>>>({})

  useEffect(() => {
    if (repairContext?.kind !== 'SPORT') return
    setDraft({ ...blank, kind: 'SPORT', disciplina_id: repairContext.disciplinaId })
    setDates({
      effective_from: repairContext.effectiveFrom.split('-').reverse().join('/'),
      effective_to: repairContext.effectiveTo.split('-').reverse().join('/'),
    })
    setAmount('')
    setAmountError('')
    setDateError({})
  }, [repairContext])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amountCents = parseArsToCents(amount)
    if (amountCents === null) {
      setAmountError('Ingresá un importe positivo con hasta dos decimales.')
      return
    }
    const effectiveFrom = parseSpanishDate(dates.effective_from)
    const effectiveTo = dates.effective_to ? parseSpanishDate(dates.effective_to) : null
    if (!effectiveFrom) {
      setDateError({ effective_from: 'Ingresá una fecha válida con el formato DD/MM/AAAA.' })
      return
    }
    if (dates.effective_to && !effectiveTo) {
      setDateError({ effective_to: 'Ingresá una fecha válida con el formato DD/MM/AAAA.' })
      return
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      setDateError({ effective_to: 'La vigencia hasta no puede ser anterior a la vigencia desde.' })
      return
    }
    const input: DuesPriceInput = {
      ...draft,
      amount_cents: amountCents,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      disciplina_id: draft.kind === 'BASE' ? null : (draft.disciplina_id ?? null),
    }
    void Promise.resolve(onCreate(input))
      .then(() => {
        setDraft(blank)
        setDates({ effective_from: '', effective_to: '' })
        setAmount('')
        setAmountError('')
        setDateError({})
      })
      .catch(() => undefined)
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      {repairContext?.kind === 'unresolved' && <p role="alert">{repairContext.message}</p>}
      {repairContext?.kind === 'SPORT' && (
        <p className="sm:col-span-2">La vigencia hasta indicada no incluye ese día.</p>
      )}
      <label className="space-y-1 font-body text-sm font-medium text-ink-700">
        Tipo de cuota
        <select
          className={collectionFieldClass}
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
        <label className="space-y-1 font-body text-sm font-medium text-ink-700">
          Disciplina
          <select
            className={collectionFieldClass}
            required
            value={draft.disciplina_id ?? ''}
            disabled={disciplineState !== 'ready'}
            onChange={(event) =>
              setDraft((current) => ({ ...current, disciplina_id: event.target.value || null }))
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
      <label className="space-y-1 font-body text-sm font-medium text-ink-700">
        Importe mensual (ARS)
        <input
          className={collectionFieldClass}
          type="text"
          inputMode="decimal"
          required
          aria-describedby={amountError ? 'pricing-amount-error' : undefined}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            if (amountError) setAmountError('')
          }}
        />
      </label>
      {amountError && (
        <p id="pricing-amount-error" role="alert">
          {amountError}
        </p>
      )}
      {fields.map(([label, key, required]) => (
        <div key={key} className="space-y-1 font-body text-sm font-medium text-ink-700">
          <label htmlFor={`pricing-${key}`}>{label}</label>
          <SpanishDateInput
            id={`pricing-${key}`}
            className={collectionFieldClass}
            required={required}
            error={dateError[key]}
            value={dates[key]}
            onChange={(value) => {
              setDates((current) => ({ ...current, [key]: value }))
              if (dateError[key]) setDateError((current) => ({ ...current, [key]: undefined }))
            }}
          />
        </div>
      ))}
      <label className="space-y-1 font-body text-sm font-medium text-ink-700">
        Regla de cálculo
        <select
          className={collectionFieldClass}
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
      <button
        type="submit"
        disabled={busy || repairContext?.kind === 'unresolved'}
        className={collectionButtonClass.primary}
      >
        Guardar cuota
      </button>
    </form>
  )
}
