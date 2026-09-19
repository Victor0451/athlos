import { useEffect, useRef } from 'react'
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
  const masterRef = useRef<HTMLInputElement>(null)
  const eligibleIds = obligations.map(({ id }) => id)
  const selectedEligibleIds = eligibleIds.filter((id) => selectedIds.includes(id))
  const allSelected = eligibleIds.length > 0 && selectedEligibleIds.length === eligibleIds.length
  const partiallySelected = selectedEligibleIds.length > 0 && !allSelected

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = partiallySelected
  }, [partiallySelected])

  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <legend className="font-display text-sm font-semibold text-ink-900">
          Obligaciones a pagar
        </legend>
        <label className={`${collectionButtonClass.secondary} flex items-center gap-2`}>
          <input
            ref={masterRef}
            type="checkbox"
            checked={allSelected}
            disabled={!eligibleIds.length}
            onChange={() => onSelectedIdsChange(allSelected ? [] : eligibleIds)}
          />
          Seleccionar todas
        </label>
      </div>
      {obligations.map((obligation) => (
        <label
          key={obligation.id}
          className="flex items-start gap-3 border-b border-ink-100 py-3 font-body text-sm text-ink-900"
        >
          <input
            className="mt-0.5 min-h-4 min-w-4"
            type="checkbox"
            checked={selectedEligibleIds.includes(obligation.id)}
            onChange={() =>
              onSelectedIdsChange(
                selectedEligibleIds.includes(obligation.id)
                  ? selectedEligibleIds.filter((id) => id !== obligation.id)
                  : [...selectedEligibleIds, obligation.id],
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
