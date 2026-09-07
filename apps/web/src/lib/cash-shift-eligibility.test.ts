import { describe, expect, it } from 'vitest'
import {
  cashShiftAvailabilityMessage,
  eligibleCashShifts,
  getCashShiftAvailability,
} from './cash-shift-eligibility'

const now = new Date('2026-02-01T12:00:00.000Z')
const user = { operator_id: 'operator-1', role: 'TESORERO' as const }
const shift = {
  id: 'shift-1',
  desk_id: 'front',
  status: 'OPEN' as const,
  business_date: '2026-02-01',
  assigned_operator_id: 'operator-1',
  opened_at: '2026-01-31T12:00:00.000Z',
  closed_at: null,
}

describe('cash shift eligibility', () => {
  it('allows a shift belonging to the treasurer and allows an ADMIN to operate another owner shift', () => {
    expect(eligibleCashShifts([shift], user, now)).toEqual([shift])
    expect(
      eligibleCashShifts(
        [{ ...shift, assigned_operator_id: 'operator-2' }],
        { operator_id: 'operator-1', role: 'ADMIN' },
        now,
      ),
    ).toEqual([{ ...shift, assigned_operator_id: 'operator-2' }])
  })

  it('keeps the exact 24-hour boundary valid and fails closed for malformed timestamps', () => {
    expect(eligibleCashShifts([shift], user, now)).toEqual([shift])
    expect(eligibleCashShifts([{ ...shift, opened_at: 'invalid' }], user, now)).toEqual([])
  })

  it.each([
    [[], 'no_open', 'No hay turnos de caja abiertos.'],
    [[{ ...shift, assigned_operator_id: 'operator-2' }], 'only_foreign', 'otro responsable'],
    [[{ ...shift, opened_at: '2026-01-31T11:59:59.999Z' }], 'expired', 'vencido'],
  ] as const)('explains availability truthfully', (shifts, availability, message) => {
    expect(getCashShiftAvailability(shifts, user, now)).toBe(availability)
    expect(cashShiftAvailabilityMessage(availability)).toContain(message)
  })

  it('explains a shift request error without presenting it as no open shift', () => {
    expect(cashShiftAvailabilityMessage('unavailable')).toBe(
      'No se pudieron cargar los turnos de caja abiertos.',
    )
  })
})
