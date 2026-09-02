type Props = {
  value: string
  onChange: (value: string) => void
  className: string
  required?: boolean
  error?: string | undefined
  id: string
}

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const spanishDatePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/

const isCalendarDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export const parseSpanishDate = (value: string) => {
  const match = value.match(spanishDatePattern)
  if (!match) return null
  const [, day, month, year] = match
  const numericDay = Number(day)
  const numericMonth = Number(month)
  const numericYear = Number(year)
  if (!isCalendarDate(numericYear, numericMonth, numericDay)) return null
  return `${year}-${month}-${day}`
}

export const formatSpanishDate = (value: string) => {
  const match = value.match(isoDatePattern)
  if (!match) return ''
  const [, year, month, day] = match
  return isCalendarDate(Number(year), Number(month), Number(day)) ? `${day}/${month}/${year}` : ''
}

export function SpanishDateInput({ value, onChange, className, required, error, id }: Props) {
  const helperId = `${id}-format`
  const errorId = `${id}-error`
  return (
    <>
      <input
        id={id}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/AAAA"
        aria-describedby={error ? `${helperId} ${errorId}` : helperId}
        aria-invalid={Boolean(error)}
        aria-required={required || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={helperId} className="block font-body text-xs font-normal text-ink-600">
        Formato: DD/MM/AAAA
      </span>
      {error && (
        <span
          id={errorId}
          role="alert"
          className="block font-body text-xs font-normal text-red-700"
        >
          {error}
        </span>
      )}
    </>
  )
}
