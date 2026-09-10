import type { DebtDetail } from '@/lib/api/dues'
import type { DebtPresentation } from './debt-presentation'

type Props = {
  obligations: DebtPresentation['obligations']
  debt?: DebtDetail | null
  onViewSettlement?: (settlementId: string) => void
}

type DetailListProps = {
  title: string
  items: { stableKey: string; label: string; value: string }[]
  emptyMessage: string
}

function DetailList({ title, items, emptyMessage }: DetailListProps) {
  return (
    <details className="border-t border-ink-200 pt-3">
      <summary className="cursor-pointer font-display text-sm font-semibold text-ink-900">
        {title}
      </summary>
      {items.length ? (
        <ul className="mt-2 divide-y divide-ink-200 text-sm">
          {items.map((item) => (
            <li key={item.stableKey} className="flex justify-between gap-3 py-2">
              <span className="text-ink-700">{item.label}</span>
              <span className="shrink-0 font-semibold text-ink-900">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-700">{emptyMessage}</p>
      )}
    </details>
  )
}

export function DebtObligationList({ obligations, debt, onViewSettlement }: Props) {
  const receipts = new Map<string, string>()
  const seen = new Set<string>()
  const visibleFacts = new Set(
    obligations.flatMap((item) => item.history.expandedFacts.map((fact) => fact.stableKey)),
  )
  for (const item of debt?.obligations ?? []) {
    for (const allocation of item.allocations) {
      if (
        allocation.settlement_kind !== 'MONETARY' ||
        allocation.kind !== 'ALLOCATION' ||
        !visibleFacts.has(allocation.id) ||
        seen.has(allocation.settlement_id)
      )
        continue
      seen.add(allocation.settlement_id)
      receipts.set(allocation.id, allocation.settlement_id)
    }
  }
  if (!obligations.length) return <p role="status">No hay obligaciones para detallar.</p>

  return (
    <ul aria-label="Obligaciones de deuda" className="grid min-w-0 gap-3 md:grid-cols-2">
      {obligations.map((obligation) => (
        <li
          key={obligation.stableKey}
          aria-label={`Obligación de ${obligation.periodLabel}`}
          className="min-w-0 space-y-4 border border-ink-200 bg-surface p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-display font-semibold text-ink-900">{obligation.periodLabel}</h3>
              <p className="font-body text-sm text-ink-700">{obligation.dateRangeLabel}</p>
            </div>
            <span className="border border-info bg-info-soft px-2 py-1 font-body text-xs font-semibold text-ink-900">
              {obligation.statusLabel}
            </span>
          </div>
          <dl className="space-y-2 border-y border-ink-200 py-3 text-sm">
            <div>
              <dt className="font-body text-ink-700">{obligation.outstanding.label}</dt>
              <dd className="font-display text-lg font-semibold text-ink-900">
                {obligation.outstanding.value}
              </dd>
            </div>
            <div>
              <dt className="font-body text-ink-700">{obligation.original.label}</dt>
              <dd className="font-semibold text-ink-900">{obligation.original.value}</dd>
            </div>
          </dl>
          <DetailList
            title="Composición de la deuda"
            items={obligation.components}
            emptyMessage="Sin componentes financieros."
          />
          <DetailList
            title="Beneficios aplicados"
            items={obligation.benefits}
            emptyMessage="Sin beneficios aplicados."
          />
          <details className="border-t border-ink-200 pt-3">
            <summary className="cursor-pointer font-display text-sm font-semibold text-ink-900">
              {obligation.history.summaryLabel}
            </summary>
            {obligation.history.expandedFacts.length ? (
              <ul className="mt-2 space-y-3 text-sm">
                {obligation.history.expandedFacts.map((fact) => (
                  <li key={fact.stableKey} className="border-l-2 border-ink-300 pl-3">
                    <p className="text-ink-700">{fact.settlementTypeLabel}</p>
                    <p className="font-semibold text-ink-900">
                      {fact.settlementAmount.label}: {fact.settlementAmount.value}
                    </p>
                    <p className="text-ink-700">
                      {fact.allocationLabel}: {fact.allocationAmount}
                    </p>
                    {fact.compensationLabel && (
                      <p className="text-ink-700">{fact.compensationLabel}</p>
                    )}
                    <p className="text-ink-700">{fact.reversalLabel}</p>
                    {onViewSettlement && receipts.has(fact.stableKey) && (
                      <button
                        type="button"
                        className="min-h-11 rounded border px-3 py-2"
                        onClick={() => onViewSettlement(receipts.get(fact.stableKey)!)}
                      >
                        Ver constancia
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-700">No hay movimientos registrados.</p>
            )}
          </details>
        </li>
      ))}
    </ul>
  )
}
