import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))
const { getOpenCashShifts, getCashShiftDetail } = await import('./treasury')

describe('Treasury shift read client', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })
  const shift = {
    id: 'historic-1',
    desk_id: 'front',
    status: 'CLOSED',
    assigned_operator_id: 'other',
    business_date: '2026-08-19',
    opened_at: '2026-08-19T10:00:00Z',
    closed_at: '2026-08-19T12:00:00Z',
  }
  const close = {
    id: 'close-1',
    shift_id: shift.id,
    expected_tenders: { CASH: 2600 },
    counted_tenders: { CASH: 2550 },
    discrepancy: { CASH: -50 },
    reason: 'Counted short',
    closed_at: shift.closed_at,
    force_close: true,
  }

  it.each([close, null])(
    'preserves a historical snapshot or its explicit absence',
    async (snapshot) => {
      apiFetchMock.mockResolvedValueOnce({ shift, close: snapshot })
      await expect(getCashShiftDetail(shift.id)).resolves.toEqual({ shift, close: snapshot })
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/treasury/shifts/historic-1')
    },
  )

  it.each([
    { shift, close: undefined },
    { shift, close: { ...close, expected_tenders: undefined } },
    { shift, close: { ...close, counted_tenders: { CASH: '2550' } } },
    { shift, close: { ...close, discrepancy: { CASH: 0.5 } } },
    { shift, close: { ...close, shift_id: 'wrong-shift' } },
    { shift: { ...shift, id: 'wrong-shift' }, close },
  ])(
    'rejects malformed or wrong-shift detail rather than rendering invented amounts',
    async (value) => {
      apiFetchMock.mockResolvedValueOnce(value)
      await expect(getCashShiftDetail(shift.id)).rejects.toThrow(
        'Treasury shift detail response was incomplete',
      )
    },
  )

  it('fails closed for malformed nested shifts and returns only open shifts', async () => {
    const shift = {
      desk_id: 'desk-1',
      assigned_operator_id: 'operator-1',
      business_date: '2026-08-26',
      opened_at: '2026-08-26T09:00:00.000Z',
      closed_at: null,
    }
    apiFetchMock.mockResolvedValueOnce({
      items: [
        { id: 'shift-1', status: 'OPEN', ...shift },
        { id: 'shift-2', status: 'CLOSED', ...shift },
      ],
    })
    await expect(getOpenCashShifts()).resolves.toEqual([
      { id: 'shift-1', status: 'OPEN', ...shift },
    ])
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/treasury/shifts')
    apiFetchMock.mockResolvedValueOnce({
      items: [{ id: 'shift-1', status: 'OPEN', ...shift, opened_at: 1 }],
    })
    await expect(getOpenCashShifts()).rejects.toThrow('Treasury shift response was incomplete')
  })
})
