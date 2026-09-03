import { useEffect, useState } from 'react'
import { collectionFieldClass } from '@/components/collections/CollectionPrimitives'

const months = [
  ['01', 'enero'],
  ['02', 'febrero'],
  ['03', 'marzo'],
  ['04', 'abril'],
  ['05', 'mayo'],
  ['06', 'junio'],
  ['07', 'julio'],
  ['08', 'agosto'],
  ['09', 'septiembre'],
  ['10', 'octubre'],
  ['11', 'noviembre'],
  ['12', 'diciembre'],
] as const

type Props = {
  value: string
  onChange: (period: string) => void
  onValidityChange?: (valid: boolean) => void
}

const parsePeriod = (period: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  return match ? { year: match[1]!, month: match[2]! } : { year: '', month: '01' }
}

const validYear = (year: string) => /^\d{4}$/.test(year) && Number(year) > 0

export function GenerationPeriodField({ value, onChange, onValidityChange }: Props) {
  const initial = parsePeriod(value)
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [yearTouched, setYearTouched] = useState(false)
  const valid = validYear(year)
  const yearError = yearTouched && !valid ? 'Ingresá un año de cuatro dígitos.' : null

  useEffect(() => {
    const period = parsePeriod(value)
    setYear(period.year)
    setMonth(period.month)
    setYearTouched(false)
  }, [value])

  useEffect(() => {
    onValidityChange?.(valid)
  }, [onValidityChange, valid])

  const update = (nextYear: string, nextMonth: string) => {
    setYear(nextYear)
    setMonth(nextMonth)
    if (validYear(nextYear)) onChange(`${nextYear}-${nextMonth}`)
  }

  return (
    <fieldset className="grid gap-1 font-body text-sm font-medium text-ink-900">
      <legend>Período</legend>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1">
          Mes
          <select
            value={month}
            onChange={(event) => update(year, event.target.value)}
            className={collectionFieldClass}
          >
            {months.map(([number, name]) => (
              <option key={number} value={number}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Año
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{4}"
            value={year}
            onChange={(event) => {
              setYearTouched(true)
              update(event.target.value, month)
            }}
            aria-invalid={!valid}
            aria-describedby={yearError ? 'generation-period-year-error' : undefined}
            className={collectionFieldClass}
          />
        </label>
      </div>
      {yearError && (
        <p id="generation-period-year-error" role="alert" className="text-sm text-danger-700">
          {yearError}
        </p>
      )}
    </fieldset>
  )
}
