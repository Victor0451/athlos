export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD'
export type CardSubtype = 'DEBIT' | 'CREDIT'

type Props = {
  paymentMethod: PaymentMethod
  cardSubtype: CardSubtype | null
  onMethodChange: (method: PaymentMethod) => void
  onCardSubtypeChange: (subtype: CardSubtype | null) => void
}

export function PaymentMethodSelector({
  paymentMethod,
  cardSubtype,
  onMethodChange,
  onCardSubtypeChange,
}: Props) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-display text-sm font-semibold text-ink-900">Medio de pago</legend>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['CASH', 'Efectivo'],
            ['TRANSFER', 'Transferencia'],
            ['CARD', 'Tarjeta'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex min-h-11 items-center gap-2 border border-ink-300 bg-surface px-3 font-body text-sm text-ink-900"
          >
            <input
              type="radio"
              name="payment-method"
              checked={paymentMethod === value}
              onChange={() => {
                onMethodChange(value)
                if (value !== 'CARD') onCardSubtypeChange(null)
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {paymentMethod === 'CARD' && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Tipo de tarjeta">
          {(
            [
              ['DEBIT', 'Débito'],
              ['CREDIT', 'Crédito'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-2 border border-ink-300 bg-surface px-3 font-body text-sm text-ink-900"
            >
              <input
                type="radio"
                name="card-subtype"
                checked={cardSubtype === value}
                onChange={() => onCardSubtypeChange(value)}
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
