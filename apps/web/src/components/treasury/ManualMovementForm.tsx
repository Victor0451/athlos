'use client'

import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/api'
import type { AccountChartItem } from '@/lib/api/account-chart'
import { recordCashTender } from '@/lib/api/treasury'
import { Alert } from '@/components/ui/Alert'
import { AccountCombobox } from './AccountCombobox'
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
  /** Called after a confirmed record, so the host can close its modal. */
  onDone?: (() => void) | undefined
  /** id for the inner form so a modal footer button can submit it remotely. */
  formId?: string | undefined
  initialDirection?: 'INCOME' | 'EXPENSE' | undefined
  /** Edit flow prefill. */
  initialAmount?: string | undefined
  initialDescription?: string | undefined
  initialAccount?: AccountChartItem | null | undefined
  /** Runs once before the first record attempt (e.g. reverse the edited original). */
  onBeforeRecord?: (() => Promise<void>) | undefined
}

export function ManualMovementForm({
  shiftId,
  operatorId,
  onRecorded,
  onDone,
  formId = 'manual-movement-form',
  initialDirection = 'INCOME',
  initialAmount,
  initialDescription,
  initialAccount,
  onBeforeRecord,
}: ManualMovementFormProps) {
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>(initialDirection)
  const [tender, setTender] = useState('CASH')
  const [amount, setAmount] = useState(initialAmount ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [selected, setSelected] = useState<AccountChartItem | null>(initialAccount ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const keys = useRef<ReturnType<typeof createCollectionsIdempotencyStore> | null>(null)
  // The before-record hook (reversal of the edited original) must run exactly once per modal
  // open, even if the record attempt itself is retried after a failure.
  const beforeRecordDone = useRef(false)

  const tenders = initialDirection === 'INCOME' ? INCOME_TENDERS : EXPENSE_TENDERS

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
      if (onBeforeRecord && !beforeRecordDone.current) {
        await onBeforeRecord()
        beforeRecordDone.current = true
      }
      await recordCashTender(
        shiftId,
        {
          direction,
          tender,
          amount_cents: cents,
          source_type: 'MANUAL',
          account_code: selected.code,
          description: text,
          // The shipped policy (service + 0072 DB check) requires a non-empty reason for
          // every MANUAL tender in addition to the account description; the walkthrough
          // form keeps a single human input and sends it as both fields.
          reason: text,
        },
        keys.current.getOrCreate(input),
      )
      keys.current.complete(input)
      setAmount('0')
      setDescription('')
      setSelected(null)
      setDirection(initialDirection)
      onRecorded('Movimiento manual registrado.')
      onDone?.()
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
      id={formId}
      onSubmit={submit}
      aria-label="Registrar movimiento manual"
      className="space-y-4"
    >
      <p className="text-sm text-ink-500">
        Cada movimiento manual requiere descripción, importe, un único método de pago y la cuenta
        contable donde se imputa.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <label className="block text-sm font-medium text-ink-700">
        Descripción / motivo
        <input
          className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
          value={description}
          disabled={pending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Importe (pesos)
        <input
          className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
          inputMode="decimal"
          maxLength={32}
          value={amount}
          disabled={pending}
          onChange={(event) => setAmount(event.target.value)}
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          Con coma o punto decimal, sin separadores de miles.
        </span>
      </label>
      <label className="block text-sm font-medium text-ink-700">
        Método de pago
        <select
          className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
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
      {initialDirection === 'EXPENSE' && (
        <p className="-mt-2 text-xs text-ink-500">
          Débito bancario registra un débito por banco en la Caja; no integra con el banco.
        </p>
      )}
      <div>
        <p className="text-sm font-medium text-ink-700">Cuenta contable</p>
        <div className="mt-1">
          <AccountCombobox selected={selected} onSelect={setSelected} disabled={pending} />
        </div>
        <span className="mt-1 block text-xs font-normal text-ink-500">
          Cuenta del plan de cuentas donde se imputa el movimiento.
        </span>
      </div>
    </form>
  )
}
