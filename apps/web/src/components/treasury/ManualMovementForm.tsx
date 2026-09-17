'use client'

import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import type { AccountChartItem } from '@/lib/api/account-chart'
import { recordCashTender } from '@/lib/api/treasury'
import { EligibleAccountPicker } from './EligibleAccountPicker'
import { createCollectionsIdempotencyStore } from '@/lib/collections-idempotency'
import { parseCashAmount } from '@/lib/cash-amount'

const INCOME_TENDERS = ['CASH', 'DEBIT', 'CREDIT', 'TRANSFER']
const EXPENSE_TENDERS = ['CASH', 'DEBIT', 'CREDIT', 'TRANSFER', 'BANK_DEBIT']
// Payment-card DEBIT and expense-only BANK_DEBIT must stay visibly distinct; bank debit is a
// Caja record, never a bank-ledger integration.
const TENDER_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  DEBIT: 'Tarjeta de débito',
  CREDIT: 'Tarjeta de crédito',
  TRANSFER: 'Transferencia',
  BANK_DEBIT: 'Débito bancario',
}

interface ManualMovementFormProps {
  shiftId: string
  operatorId: string
  onRecorded: (message: string) => void
}

export function ManualMovementForm({ shiftId, operatorId, onRecorded }: ManualMovementFormProps) {
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>('INCOME')
  const [tender, setTender] = useState('CASH')
  const [amount, setAmount] = useState('0')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<AccountChartItem | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const keys = useRef<ReturnType<typeof createCollectionsIdempotencyStore> | null>(null)

  const tenders = direction === 'INCOME' ? INCOME_TENDERS : EXPENSE_TENDERS

  const changeDirection = (next: 'INCOME' | 'EXPENSE') => {
    setDirection(next)
    if (next === 'INCOME' && tender === 'BANK_DEBIT') setTender('CASH')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setError('')
    const cents = parseCashAmount(amount)
    if (cents === null || cents <= 0) {
      setError('Ingresá un importe válido mayor que cero.')
      return
    }
    if (!selected) {
      setError('Seleccioná una cuenta elegible.')
      return
    }
    const text = description.trim()
    if (!text) {
      setError('La descripción es obligatoria.')
      return
    }
    keys.current ??= createCollectionsIdempotencyStore()
    const input = {
      operatorId,
      action: 'cash:manual-tender',
      draftFingerprint: JSON.stringify({
        shiftId,
        direction,
        tender,
        cents,
        account: selected.code,
        description: text,
      }),
    }
    setPending(true)
    try {
      await recordCashTender(
        shiftId,
        {
          direction,
          tender,
          amount_cents: cents,
          source_type: 'MANUAL',
          account_code: selected.code,
          description: text,
        },
        keys.current.getOrCreate(input),
      )
      keys.current.complete(input)
      setAmount('0')
      setDescription('')
      setSelected(null)
      onRecorded('Movimiento manual registrado.')
    } catch (recordError) {
      // The key survives a failure so an immediate retry replays the same server-side intent.
      setError(
        recordError instanceof ApiError
          ? recordError.message
          : 'No se pudo registrar el movimiento.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Registrar movimiento manual"
      className="space-y-3 rounded-lg border border-ink-100 bg-surface p-4"
    >
      <h2 className="font-display text-lg">Movimiento manual</h2>
      <p className="text-sm text-ink-500">
        Cada movimiento manual requiere cuenta, descripción, importe y un único método de pago.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset className="flex gap-4">
        <legend className="text-sm">Tipo de movimiento</legend>
        <label>
          <input
            type="radio"
            name="movement-direction"
            checked={direction === 'INCOME'}
            onChange={() => changeDirection('INCOME')}
            disabled={pending}
          />
          Ingreso
        </label>
        <label>
          <input
            type="radio"
            name="movement-direction"
            checked={direction === 'EXPENSE'}
            onChange={() => changeDirection('EXPENSE')}
            disabled={pending}
          />
          Egreso
        </label>
      </fieldset>
      <label>
        Método de pago
        <select
          className="mt-1 block w-full rounded border p-2"
          value={tender}
          disabled={pending}
          onChange={(event) => setTender(event.target.value)}
        >
          {tenders.map((method) => (
            <option key={method} value={method}>
              {TENDER_LABELS[method]}
            </option>
          ))}
        </select>
      </label>
      {direction === 'EXPENSE' && (
        <p className="text-sm text-ink-500">
          Débito bancario registra un débito por banco en la Caja; no integra con el banco.
        </p>
      )}
      <label>
        Importe (pesos)
        <input
          className="mt-1 block w-full rounded border p-2"
          inputMode="decimal"
          maxLength={32}
          value={amount}
          disabled={pending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label>
        Descripción
        <input
          className="mt-1 block w-full rounded border p-2"
          value={description}
          disabled={pending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <EligibleAccountPicker selected={selected} onSelect={setSelected} disabled={pending} />
      <button
        type="submit"
        className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Registrando…' : 'Registrar movimiento'}
      </button>
    </form>
  )
}
