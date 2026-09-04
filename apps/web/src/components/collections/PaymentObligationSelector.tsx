import { collectionButtonClass } from './CollectionPrimitives'
import { formatObligationPeriod } from './payment-presentation'

export type PaymentObligation = {
  id: string
  period_start: string
  outstanding_cents: number
}

type Props = {
  obligations: PaymentObligation[]
  selectedIds: string[]
  onSelectedIdsChange: (selectedIds: string[]) => void
}

const money = (cents: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)

export function PaymentObligationSelector({
  obligations,
  selectedIds,
  onSelectedIdsChange,
}: Props) {
  const allSelected = selectedIds.length > 0

  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <legend className="font-display text-sm font-semibold text-ink-900">
          Obligaciones a pagar
        </legend>
        <button
          type="button"
          onClick={() => onSelectedIdsChange(allSelected ? [] : obligations.map(({ id }) => id))}
          className={collectionButtonClass.secondary}
        >
          {allSelected ? 'Quitar selección' : 'Seleccionar todas'}
        </button>
      </div>
      {obligations.map((obligation) => (
        <label
          key={obligation.id}
          className="flex items-start gap-3 border-b border-ink-100 py-3 font-body text-sm text-ink-900"
        >
          <input
            className="mt-0.5 min-h-4 min-w-4"
            type="checkbox"
            checked={selectedIds.includes(obligation.id)}
            onChange={() =>
              onSelectedIdsChange(
                selectedIds.includes(obligation.id)
                  ? selectedIds.filter((id) => id !== obligation.id)
                  : [...selectedIds, obligation.id],
              )
            }
          />
          <span>
            Período {formatObligationPeriod(obligation.period_start)}:{' '}
            <span className="font-medium tabular-nums">{money(obligation.outstanding_cents)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
