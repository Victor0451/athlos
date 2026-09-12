import type { CashClose } from '@/lib/api/treasury'

const formatCashTotal = (totals: Record<string, number> | undefined): string => {
  if (!totals || !Number.isSafeInteger(totals.CASH ?? 0)) return 'No disponible'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
    (totals.CASH ?? 0) / 100,
  )
}

export const closedAtLabel = (value: string | null): string => {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('es-AR')
    : 'Fecha no disponible'
}

export function CashCloseSummary({ close }: { close: CashClose }) {
  return (
    <div className="space-y-2 break-words">
      <p>
        Conciliación de efectivo. Tarjetas y transferencias no se incluyen en el efectivo contado.
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        <dt>Efectivo esperado</dt>
        <dd>{formatCashTotal(close.expected_tenders)}</dd>
        <dt>Efectivo contado</dt>
        <dd>{formatCashTotal(close.counted_tenders)}</dd>
        <dt>Diferencia de efectivo</dt>
        <dd>{formatCashTotal(close.discrepancy)}</dd>
      </dl>
      {close.reason && <p>{close.reason}</p>}
      {close.id && <p>Referencia de cierre: {close.id}</p>}
      {close.closed_at && <p>Cerrado: {closedAtLabel(close.closed_at)} (hora local)</p>}
      {close.force_close && <p>Recuperación de turno vencido.</p>}
    </div>
  )
}
