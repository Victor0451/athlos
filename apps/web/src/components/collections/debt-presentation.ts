import type { DebtDetail } from '@/lib/api/dues'

type PresentedAmount = {
  label: string
  value: string
}

type PresentedComponent = PresentedAmount & {
  stableKey: string
}

type PresentedHistoryFact = {
  stableKey: string
  settlementTypeLabel: string
  settlementAmount: PresentedAmount
  allocationLabel: string
  allocationAmount: string
  compensationLabel?: string
  reversalLabel: string
}

type PresentedObligation = {
  stableKey: string
  periodLabel: string
  dateRangeLabel: string
  statusLabel: string
  original: PresentedAmount
  outstanding: PresentedAmount
  components: PresentedComponent[]
  benefits: PresentedComponent[]
  history: {
    summaryLabel: string
    expandedFacts: PresentedHistoryFact[]
  }
}

export type DebtPresentation = {
  total: PresentedAmount
  obligations: PresentedObligation[]
}

const componentLabels = {
  BASE: 'Cuota social',
  SPORT: 'Actividad deportiva',
  BENEFIT: 'Beneficio',
  ADJUSTMENT: 'Ajuste',
} as const

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(cents / 100)
}

function utcDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

function monthLabel(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(value))
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(value))
}

export function mapDebtPresentation(debt: DebtDetail): DebtPresentation {
  return {
    total: {
      label: 'Deuda total pendiente',
      value: money(debt.total_debt_cents, debt.currency ?? 'ARS'),
    },
    obligations: debt.obligations.map((obligation) => ({
      stableKey: obligation.id,
      periodLabel: monthLabel(obligation.period_start),
      dateRangeLabel: `${dateLabel(obligation.period_start)} a ${dateLabel(obligation.period_end)}`,
      statusLabel: obligation.status === 'OPEN' ? 'Pendiente' : 'Pagada',
      original: {
        label: 'Importe original',
        value: money(obligation.original_amount_cents, obligation.currency),
      },
      outstanding: {
        label: 'Importe pendiente',
        value: money(obligation.outstanding_cents, obligation.currency),
      },
      components: obligation.components.map((component) => ({
        stableKey: component.id,
        label: componentLabels[component.kind],
        value: money(component.amount_cents, obligation.currency),
      })),
      benefits: obligation.benefits.map((benefit) => ({
        stableKey: benefit.id,
        label: 'Beneficio aplicado',
        value: money(benefit.amount_cents, obligation.currency),
      })),
      history: {
        summaryLabel: 'Historial de movimientos',
        expandedFacts: obligation.allocations.map((allocation) => ({
          stableKey: allocation.id,
          settlementTypeLabel:
            allocation.settlement_kind === 'MONETARY' ? 'Pago' : 'Tratamiento no monetario',
          settlementAmount: {
            label: 'Importe de la liquidación',
            value: money(allocation.settlement_amount_cents, allocation.currency),
          },
          allocationLabel:
            allocation.kind === 'ALLOCATION' ? 'Importe aplicado' : 'Importe revertido',
          allocationAmount: money(allocation.amount_cents, allocation.currency),
          ...(allocation.kind === 'COMPENSATION'
            ? { compensationLabel: 'Reversión de una aplicación anterior' }
            : {}),
          reversalLabel: allocation.reversal_eligible
            ? 'Se puede revertir'
            : 'No se puede revertir',
        })),
      },
    })),
  }
}
