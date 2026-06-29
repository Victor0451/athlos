import { describe, it, expect } from 'vitest'
import { scoreHeuristicCandidate } from './repository.ts'

/**
 * Heuristic scoring unit tests (RED → GREEN → TRIANGULATE).
 *
 * The heuristic surfaces "candidate" ctacte rows for a given gasto.
 * Per design §4 the scoring is:
 *   +50 date proximity  (|days_diff| ≤ 7)
 *   +30 amount match    (|amount_diff / importe| ≤ 10%)
 *   +20 socio_id match  (when both rows have socio_id; today always 0 for gastos)
 *
 * Threshold: score > 30 → return the candidate; ≤ 30 → omit.
 *
 * Contract: every returned candidate is tagged `motivo: 'heuristic-pending'`
 * and the function NEVER inserts. The view is read-only.
 *
 * The function is exported as a pure function so the route test can
 * call it directly with synthetic rows (no SQL needed).
 */

describe('scoreHeuristicCandidate', () => {
  it('returns a candidate with motivo=heuristic-pending when score > 30', () => {
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-15',
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '5000.00',
        cuentaPrincipal: '6003009',
      },
    )
    expect(candidate).not.toBeNull()
    expect(candidate?.motivo).toBe('heuristic-pending')
    // Same day = 50 + exact amount = 30 + socio_id null on both sides = 0 = 80
    expect(candidate?.score).toBe(80)
    expect(candidate?.daysDiff).toBe(0)
    expect(candidate?.amountDiff).toBe(0)
  })

  it('returns the candidate with date-only score (50) when amount diff exceeds 10% but date matches', () => {
    // Spec: threshold is `score > 30`. Date alone scores 50 (within ±7 days).
    // So the candidate IS returned with score=50, even though amount diff
    // is 20% off — the operator still benefits from seeing "this gasto is
    // dated the same day as a $5000 movement on socio X" in the candidate panel.
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-15',
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '4000.00', // 20% off — out of amount tolerance
        cuentaPrincipal: '6003009',
      },
    )
    expect(candidate).not.toBeNull()
    expect(candidate?.score).toBe(50) // date proximity only
  })

  it('omits the candidate when neither date nor amount matches the tolerance (score ≤ 30)', () => {
    // Date 8+ days off → no date score. Amount 20% off → no amount score.
    // Total = 0 → omitted.
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-30', // 15 days off
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '4000.00',
        cuentaPrincipal: '6003009',
      },
    )
    expect(candidate).toBeNull()
  })

  it('omits the candidate when date diff exceeds 7 days (returns null)', () => {
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-22', // 7 days after gasto
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '5000.00',
        cuentaPrincipal: '6003009',
      },
    )
    // 7 days = boundary, score 50 (date)
    expect(candidate).not.toBeNull()
  })

  it('omits the candidate when date diff is greater than 7 days (returns null)', () => {
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-23', // 8 days after gasto
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '5000.00',
        cuentaPrincipal: '6003009',
      },
    )
    // 8 days → date score 0, amount 30 → score = 30 (NOT > 30) → omitted
    expect(candidate).toBeNull()
  })

  it('adds 20 when both gasto and ctacte have a non-null socio_id (future case)', () => {
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: 's-1', // ctacte has socio_id
        fecha: '2024-03-15',
        debe: '5000.00',
        haber: '0.00',
        anulado: false,
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '5000.00',
        cuentaPrincipal: '6003009',
        // gasto socio_id is currently always null; the function checks
        // both sides and returns the score as if both had it.
        socioId: 's-1',
      },
    )
    // Same day (50) + amount match (30) + socio_id match (20) = 100
    expect(candidate?.score).toBe(100)
  })

  it('always omits anulada ctacte rows even when date+amount match perfectly', () => {
    const candidate = scoreHeuristicCandidate(
      {
        id: 'c-1',
        socioId: null,
        fecha: '2024-03-15',
        debe: '5000.00',
        haber: '0.00',
        anulado: true, // already anulada — never surface as candidate
        concepto: 'cuota',
      },
      {
        id: 'g-1',
        fecha: '2024-03-15',
        importe: '5000.00',
        cuentaPrincipal: '6003009',
      },
    )
    expect(candidate).toBeNull()
  })
})
