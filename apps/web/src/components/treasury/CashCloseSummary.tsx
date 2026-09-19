import { Badge } from '@/components/ui/Badge'
import type { CashClose } from '@/lib/api/treasury'

const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

const formatCashTotal = (totals: Record<string, number> | undefined): string => {
  if (!totals || !Number.isSafeInteger(totals.CASH ?? 0)) return 'No disponible'
  return currency.format((totals.CASH ?? 0) / 100)
}

const formatCents = (cents: number): string =>
  Number.isSafeInteger(cents) ? currency.format(cents / 100) : 'No disponible'

export const closedAtLabel = (value: string | null): string => {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('es-AR', { hour12: false })
    : 'Fecha no disponible'
}

export function CashCloseSummary({ close }: { close: CashClose }) {
  const diff = close.discrepancy?.CASH ?? 0
  const differenceBadge =
    !Number.isSafeInteger(diff) || diff === 0 ? null : diff < 0 ? (
      <Badge variant="danger">Faltante</Badge>
    ) : (
      <Badge variant="success">Sobrante</Badge>
    )
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        Conciliación de efectivo. Tarjetas y transferencias no se incluyen en el efectivo contado.
      </p>
      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-ink-600">Efectivo esperado</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {formatCashTotal(close.expected_tenders)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-ink-600">Efectivo contado</dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {formatCashTotal(close.counted_tenders)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-100 pt-2">
          <dt className="flex items-center gap-2 text-sm font-medium text-ink-700">
            Diferencia de efectivo
            {differenceBadge}
          </dt>
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {formatCashTotal(close.discrepancy)}
          </dd>
        </div>
        {close.closeTransfer && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-ink-600">
              A {close.closeTransfer.account_name_snapshot} (
              {close.closeTransfer.account_code_snapshot})
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-ink-900">
              {formatCents(close.closeTransfer.amount_cents)}
            </dd>
          </div>
        )}
      </dl>
      {(close.reason || close.force_close) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
          {close.force_close && <Badge variant="warning">Recuperación de turno vencido</Badge>}
          {close.reason && (
            <p>
              <span className="font-medium text-ink-700">Motivo:</span> {close.reason}
            </p>
          )}
        </div>
      )}
      <p className="font-mono text-xs text-ink-500">
        {close.id ? `Corte ${close.id.slice(0, 8)}` : 'Corte'}
        {close.closed_at ? ` · cerrado ${closedAtLabel(close.closed_at)}` : ''}
      </p>
    </div>
  )
}
