'use client'

import { useState, type ComponentPropsWithoutRef } from 'react'

type Props = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'value'> & {
  value: string
  parseCents: (raw: string) => number | null
}

function formatPesos(cents: number) {
  const exact = BigInt(cents)
  const pesos = (exact / 100n).toLocaleString('es-AR')
  const decimal = (exact % 100n).toString().padStart(2, '0')
  return `${pesos},${decimal}`
}

export function PesoAmountInput({ value, parseCents, onFocus, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false)
  const cents = parseCents(value)

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={focused || cents === null ? value : formatPesos(cents)}
      onFocus={(event) => {
        const input = event.currentTarget
        // Native select() can focus before completing selection. Wait for that operation.
        queueMicrotask(() => {
          if (input.ownerDocument.activeElement !== input) return
          const selectedAll =
            input.selectionStart === 0 && input.selectionEnd === input.value.length
          input.value = value
          if (selectedAll) input.setSelectionRange(0, value.length)
          setFocused(true)
        })
        onFocus?.(event)
      }}
      onBlur={(event) => {
        event.currentTarget.value = cents === null ? value : formatPesos(cents)
        setFocused(false)
        onBlur?.(event)
      }}
    />
  )
}
