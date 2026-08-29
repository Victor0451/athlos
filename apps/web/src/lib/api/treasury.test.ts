import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))
const { getOpenCashShifts } = await import('./treasury')

describe('Treasury shift read client', () => {
  beforeEach(() => apiFetchMock.mockReset())
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
