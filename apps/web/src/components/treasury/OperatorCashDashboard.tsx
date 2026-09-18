'use client'

import { useQuery } from '@tanstack/react-query'
import { History, Undo2 } from 'lucide-react'
import { getCashShiftDetail } from '@/lib/api/treasury'
import { Alert } from '@/components/ui/Alert'

const formatCents = (cents: number): string =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)

const TENDER_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  DEBIT: 'Tarjeta de débito',
  CREDIT: 'Tarjeta de crédito',
  TRANSFER: 'Transferencia',
  BANK_DEBIT: 'Débito bancario',
}

type Movement = NonNullable<Awaited<ReturnType<typeof getCashShiftDetail>>['movements']>[number]

interface OperatorCashDashboardProps {
  /** Bumping this number refetches after a confirmed command. */
  refreshToken: number
  onLoadExpense: () => void
  onLoadIncome: () => void
  onEditMovement?: (movement: Movement) => void
  onDeleteMovement?: (movement: Movement) => void
  shiftId: string
}

/**
 * erpgw-style cash dashboard for the operator's own OPEN shift: color KPI row (opening,
 * cash income, cash expenses, server-computed expected cash) plus Ingresos/Egresos columns
 * grouped by source. The load buttons live in the column headers, exactly like the legacy
 * module the operator described.
 */
export function OperatorCashDashboard({
  refreshToken,
  onLoadExpense,
  onLoadIncome,
  onEditMovement,
  onDeleteMovement,
  shiftId,
}: OperatorCashDashboardProps) {
  const detail = useQuery({
    queryKey: ['cash-shift-detail', shiftId, refreshToken],
    queryFn: () => getCashShiftDetail(shiftId),
  })

  if (detail.isPending) return <p role="status">Cargando movimientos…</p>
  if (detail.isError)
    return <Alert tone="error">No se pudieron cargar los movimientos del turno.</Alert>

  const data = detail.data
  const movements = data.movements ?? []
  // Append-only ledger: a MANUAL row can be reversed (an opposite-direction row points at it).
  // Reversal pairs net exactly zero (same tender and amount, opposite direction), so the
  // operator-facing lists exclude both rows of every pair — erpgw-style: the list shows the
  // current state, not the churn. A collapsed summary keeps the audit trail discoverable.
  const reversedIds = new Set(
    movements.flatMap((movement) =>
      movement.reverses_tender_id ? [movement.reverses_tender_id] : [],
    ),
  )
  const reversals = movements.filter((movement) => movement.reverses_tender_id)
  const liveMovements = movements.filter(
    (movement) => !movement.reverses_tender_id && !reversedIds.has(movement.id),
  )
  const liveById = new Map(movements.map((movement) => [movement.id, movement]))
  const opening = data.opening_tenders?.CASH ?? 0
  const cashIncome = liveMovements
    .filter((movement) => movement.direction === 'INCOME' && movement.tender === 'CASH')
    .reduce((total, movement) => total + movement.amount_cents, 0)
  const cashExpense = liveMovements
    .filter((movement) => movement.direction === 'EXPENSE' && movement.tender === 'CASH')
    .reduce((total, movement) => total + movement.amount_cents, 0)
  const expected = data.expected_tenders?.CASH

  const production = liveMovements.filter((movement) => movement.source_type === 'SETTLEMENT')
  const productionTotal = production.reduce((total, movement) => total + movement.amount_cents, 0)
  const manualIncome = liveMovements.filter(
    (movement) => movement.direction === 'INCOME' && movement.source_type === 'MANUAL',
  )
  const manualIncomeTotal = manualIncome.reduce(
    (total, movement) => total + movement.amount_cents,
    0,
  )
  const expenses = liveMovements.filter((movement) => movement.direction === 'EXPENSE')

  const kpi = (label: string, value: string, tone: string) => (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )

  const movementRow = (movement: Movement) => {
    const time = new Date(movement.created_at).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    const method = TENDER_LABELS[movement.tender] ?? movement.tender
    const account = movement.account_code_snapshot
      ? `${movement.account_code_snapshot} ${movement.account_name_snapshot ?? ''}`.trim()
      : null
    const isReversal = Boolean(movement.reverses_tender_id)
    const isReversed = reversedIds.has(movement.id)
    let title: string
    if (movement.source_type === 'SETTLEMENT') {
      title = 'Cobro de cuotas'
    } else if (movement.source_type === 'GASTO') {
      title = 'Gasto incluido'
    } else if (isReversal) {
      title = movement.reason?.trim() || 'Reversión de movimiento'
    } else {
      title = movement.description?.trim() || account || 'Movimiento manual'
    }
    const meta = [movement.source_type === 'SETTLEMENT' ? null : account, method, time]
      .filter(Boolean)
      .join(' · ')
    const actions =
      !isReversal &&
      !isReversed &&
      movement.source_type === 'MANUAL' &&
      onEditMovement &&
      onDeleteMovement ? (
        <span className="flex shrink-0 gap-2 text-xs">
          <button
            type="button"
            className="text-ink-500 underline"
            onClick={() => onEditMovement(movement)}
          >
            Editar
          </button>
          <button
            type="button"
            className="text-danger underline"
            onClick={() => onDeleteMovement(movement)}
          >
            Eliminar
          </button>
        </span>
      ) : null
    return (
      <li
        key={movement.id}
        className="flex items-center justify-between gap-3 rounded-md border border-ink-100 bg-surface px-3 py-2"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">
            {title}
            {(isReversal || isReversed) && (
              <span className="ml-2 inline-block rounded bg-ink-100 px-1.5 py-0.5 align-middle text-xs font-normal text-ink-600">
                {isReversal ? 'Reversión' : 'Revertido'}
              </span>
            )}
          </p>
          <p className="text-xs text-ink-500">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {actions}
          <span
            className={`text-sm font-semibold ${
              movement.direction === 'INCOME' ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {movement.direction === 'INCOME' ? '+' : '−'}
            {formatCents(movement.amount_cents)}
          </span>
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi(
          'Saldo Inicial',
          formatCents(opening),
          'border-indigo-200 bg-indigo-50 text-indigo-900',
        )}
        {kpi(
          'Ingresos en Efectivo',
          formatCents(cashIncome),
          'border-emerald-200 bg-emerald-50 text-emerald-900',
        )}
        {kpi(
          'Egresos en Efectivo',
          formatCents(cashExpense),
          'border-red-200 bg-red-50 text-red-900',
        )}
        {kpi(
          'Efectivo Esperado',
          expected === undefined ? 'No disponible' : formatCents(expected),
          'border-sky-200 bg-sky-50 text-sky-900',
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Ingresos del turno"
          className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-emerald-900">Ingresos</h3>
            <button
              type="button"
              className="rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground"
              onClick={onLoadIncome}
            >
              + Cargar Ingreso
            </button>
          </div>
          <p className="text-sm text-ink-500">Producción diaria e ingresos adicionales.</p>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">
              Producción automática ({production.length}{' '}
              {production.length === 1 ? 'movimiento' : 'movimientos'})
            </h4>
            {production.length === 0 ? (
              <p className="text-sm text-ink-500">
                No hay producción registrada en este turno todavía.
              </p>
            ) : (
              <ul className="space-y-1.5">{production.map((movement) => movementRow(movement))}</ul>
            )}
            {production.length > 0 && (
              <p className="text-sm font-semibold text-emerald-800">
                Subtotal producción: {formatCents(productionTotal)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Ingresos manuales</h4>
            {manualIncome.length === 0 ? (
              <p className="text-sm text-ink-500">No hay ingresos manuales registrados.</p>
            ) : (
              <ul className="space-y-1.5">
                {manualIncome.map((movement) => movementRow(movement))}
              </ul>
            )}
            {manualIncome.length > 0 && (
              <p className="text-sm font-semibold text-emerald-800">
                Subtotal manuales: {formatCents(manualIncomeTotal)}
              </p>
            )}
          </div>
        </section>

        <section
          aria-label="Egresos del turno"
          className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold text-red-900">Egresos</h3>
            <button
              type="button"
              className="rounded bg-danger px-3 py-1.5 text-sm text-white"
              onClick={onLoadExpense}
            >
              + Cargar Egreso
            </button>
          </div>
          <p className="text-sm text-ink-500">Gastos y salidas de efectivo.</p>
          {expenses.length === 0 ? (
            <p className="text-sm text-ink-500">No hay egresos registrados.</p>
          ) : (
            <ul className="space-y-1.5">{expenses.map((movement) => movementRow(movement))}</ul>
          )}
        </section>
      </div>

      {reversals.length > 0 && (
        <details className="rounded-lg border border-info/40 bg-info-soft px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
            <History aria-hidden className="h-4 w-4 shrink-0 text-info" />
            <span>
              {reversals.length === 1 ? '1 movimiento' : `${reversals.length} movimientos`} editado
              {reversals.length === 1 ? '' : 's'} o eliminado
              {reversals.length === 1 ? '' : 's'} en este turno
            </span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-info">
              {reversals.length}
            </span>
            <span className="ml-auto hidden text-xs font-normal text-ink-500 sm:inline">
              queda registrado en el cierre
            </span>
          </summary>
          <ul className="mt-3 space-y-1.5 border-t border-info/30 pt-3">
            {reversals.map((reversal) => {
              const original = reversal.reverses_tender_id
                ? liveById.get(reversal.reverses_tender_id)
                : undefined
              return (
                <li
                  key={reversal.id}
                  className="flex items-center gap-2 rounded-md bg-surface px-2.5 py-1.5 text-xs text-ink-600"
                >
                  <Undo2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-info" />
                  <span className="min-w-0 truncate">
                    {original
                      ? `${original.description?.trim() || 'Movimiento manual'} (${formatCents(original.amount_cents)})`
                      : 'Movimiento manual'}
                  </span>
                  <span aria-hidden className="text-ink-400">
                    →
                  </span>
                  <span className="min-w-0 truncate font-medium text-ink-900">
                    {reversal.reason?.trim() || 'Reversión'}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
