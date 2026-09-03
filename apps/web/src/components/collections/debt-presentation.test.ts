import { describe, expect, it } from 'vitest'
import type { DebtDetail } from '@/lib/api/dues'
import { mapDebtPresentation } from './debt-presentation'

const uuid = '11111111-1111-4111-8111-111111111111'
const componentKey = 'base:internal:component-key'
const benefitKey = 'benefit:internal:component-key'
const fingerprint = 'a'.repeat(64)

const debt = {
  status: 'ready',
  socio_id: uuid,
  currency: 'ARS',
  total_debt_cents: 10_000,
  obligations: [
    {
      id: uuid,
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      original_amount_cents: 12_500,
      outstanding_cents: 10_000,
      currency: 'ARS',
      status: 'OPEN',
      components: [
        { id: uuid, kind: 'BASE', component_key: componentKey, amount_cents: 12_500 },
        { id: uuid, kind: 'SPORT', component_key: componentKey, amount_cents: 5_000 },
        { id: uuid, kind: 'BENEFIT', component_key: benefitKey, amount_cents: -2_500 },
        { id: uuid, kind: 'ADJUSTMENT', component_key: componentKey, amount_cents: 1_000 },
      ],
      benefits: [{ id: uuid, component_key: benefitKey, amount_cents: -2_500 }],
      allocations: [
        {
          id: uuid,
          settlement_id: uuid,
          settlement_kind: 'MONETARY',
          settlement_amount_cents: 2_500,
          currency: 'ARS',
          amount_cents: 2_500,
          kind: 'ALLOCATION',
          compensates_allocation_id: null,
          reversal_eligible: true,
        },
        {
          id: uuid,
          settlement_id: uuid,
          settlement_kind: 'NON_CASH',
          settlement_amount_cents: 2_500,
          currency: 'ARS',
          amount_cents: -2_500,
          kind: 'COMPENSATION',
          compensates_allocation_id: uuid,
          reversal_eligible: false,
        },
      ],
    },
  ],
} satisfies DebtDetail

function visibleStrings(value: unknown, field = ''): string[] {
  if (typeof value === 'string') return field === 'stableKey' ? [] : [value]
  if (Array.isArray(value)) return value.flatMap((item) => visibleStrings(item))
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) => visibleStrings(item, key))
  return []
}

describe('mapDebtPresentation', () => {
  it('maps debt to a Spanish, UTC-safe obligation summary and expandable history', () => {
    const presentation = mapDebtPresentation(debt)

    expect(presentation).toMatchObject({
      total: { label: 'Deuda total pendiente', value: '$ 100,00' },
      obligations: [
        {
          stableKey: uuid,
          periodLabel: 'enero de 2026',
          dateRangeLabel: '1 de enero de 2026 a 1 de febrero de 2026',
          statusLabel: 'Pendiente',
          original: { label: 'Importe original', value: '$ 125,00' },
          outstanding: { label: 'Importe pendiente', value: '$ 100,00' },
          components: [
            { label: 'Cuota social', value: '$ 125,00' },
            { label: 'Actividad deportiva', value: '$ 50,00' },
            { label: 'Beneficio', value: '-$ 25,00' },
            { label: 'Ajuste', value: '$ 10,00' },
          ],
          benefits: [{ label: 'Beneficio aplicado', value: '-$ 25,00' }],
          history: {
            summaryLabel: 'Historial de movimientos',
            expandedFacts: [
              {
                settlementTypeLabel: 'Pago',
                allocationLabel: 'Importe aplicado',
                reversalLabel: 'Se puede revertir',
              },
              {
                settlementTypeLabel: 'Tratamiento no monetario',
                allocationLabel: 'Importe revertido',
                compensationLabel: 'Reversión de una aplicación anterior',
                reversalLabel: 'No se puede revertir',
              },
            ],
          },
        },
      ],
    })
  })

  it('translates paid obligations without exposing the source status', () => {
    const presentation = mapDebtPresentation({
      ...debt,
      obligations: [{ ...debt.obligations[0]!, status: 'PAID' }],
    })

    expect(presentation.obligations[0]?.statusLabel).toBe('Pagada')
  })

  it('keeps opaque identifiers and internal codes out of every visible field', () => {
    const presentation = mapDebtPresentation(debt)
    const text = visibleStrings(presentation).join(' ')

    expect(text).not.toContain(uuid)
    expect(text).not.toContain(componentKey)
    expect(text).not.toContain(benefitKey)
    expect(text).not.toContain(fingerprint)
    expect(text).not.toMatch(
      /\b(OPEN|PAID|BASE|SPORT|BENEFIT|ADJUSTMENT|MONETARY|NON_CASH|ALLOCATION|COMPENSATION)\b/,
    )
    expect(JSON.stringify(presentation)).not.toContain('component_key')
    expect(JSON.stringify(presentation)).not.toContain('compensates_allocation_id')
  })
})
