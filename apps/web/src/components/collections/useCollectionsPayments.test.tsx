import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DuesOperationError } from '@/lib/api/dues'
import { useCollectionsPayments } from './useCollectionsPayments'

const socio = { id: 'socio-1', nombre: 'Ana', apellido: 'Gorriti', numero_socio: '42' }
const shift = { id: 'shift-1', desk_id: 'desk-1', business_date: '2026-01-15' }
const debt = {
  status: 'ready' as const,
  socio_id: socio.id,
  currency: 'ARS',
  total_debt_cents: 10_000,
  obligations: [],
}

describe('useCollectionsPayments', () => {
  beforeEach(() => sessionStorage.clear())

  it('sorts a full selection, refreshes authoritative debt and shifts, then completes its key', async () => {
    const getDebt = vi.fn().mockResolvedValue(debt)
    const getOpenCashShifts = vi.fn().mockResolvedValue([shift])
    const createFullSelectionPayment = vi.fn().mockResolvedValue({ settlement_id: 'settlement-1' })
    const { result } = renderHook(() =>
      useCollectionsPayments({
        user: { operator_id: 'operator-1', role: 'ADMIN' },
        api: { getDebt, getOpenCashShifts, createFullSelectionPayment },
      }),
    )

    await act(() => result.current.selectSocio(socio))
    await act(() =>
      result.current.pay({
        obligation_ids: ['obligation-2', 'obligation-1'],
        shift_id: shift.id,
        tender: 'TRANSFER',
        selection_fingerprint: 'selection-fingerprint',
      }),
    )

    expect(createFullSelectionPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        socio_id: socio.id,
        obligation_ids: ['obligation-1', 'obligation-2'],
        shift_id: shift.id,
      }),
      expect.any(String),
    )
    expect(getDebt).toHaveBeenCalledTimes(2)
    expect(getOpenCashShifts).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('athlos:collections:idempotency')).toBeNull()
  })

  it('retains a payment key after conflict until an authoritative payment-context refresh', async () => {
    const getDebt = vi.fn().mockResolvedValue(debt)
    const getOpenCashShifts = vi.fn().mockResolvedValue([shift])
    const createFullSelectionPayment = vi
      .fn()
      .mockRejectedValue(new DuesOperationError('conflict', 'stale'))
    const { result } = renderHook(() =>
      useCollectionsPayments({
        user: { operator_id: 'operator-1', role: 'ADMIN' },
        api: { getDebt, getOpenCashShifts, createFullSelectionPayment },
      }),
    )

    await act(() => result.current.selectSocio(socio))
    await expect(
      result.current.pay({
        obligation_ids: ['obligation-1'],
        shift_id: shift.id,
        tender: 'TRANSFER',
        selection_fingerprint: 'selection-fingerprint',
      }),
    ).rejects.toMatchObject({ kind: 'conflict' })
    const key = JSON.parse(sessionStorage.getItem('athlos:collections:idempotency')!)[0].key

    await act(() => result.current.refreshPaymentContext())

    expect(createFullSelectionPayment).toHaveBeenCalledTimes(1)
    expect(getDebt).toHaveBeenCalledTimes(2)
    expect(getOpenCashShifts).toHaveBeenCalledTimes(2)
    expect(JSON.parse(sessionStorage.getItem('athlos:collections:idempotency')!)[0].key).toBe(key)
  })

  it('marks stale open shifts unavailable and restores them through a complete context retry', async () => {
    const getDebt = vi.fn().mockResolvedValue(debt)
    const getOpenCashShifts = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([shift])
    const { result } = renderHook(() =>
      useCollectionsPayments({
        user: { operator_id: 'operator-1', role: 'ADMIN' },
        api: { getDebt, getOpenCashShifts },
      }),
    )

    await act(() => result.current.selectSocio(socio))
    expect(result.current.openShiftAvailability).toBe('unavailable')

    await act(() => result.current.refreshPaymentContext())

    expect(result.current.openShiftAvailability).toBe('ready')
    expect(result.current.openShifts).toEqual([shift])
    expect(getDebt).toHaveBeenCalledTimes(2)
    expect(getOpenCashShifts).toHaveBeenCalledTimes(2)
  })
})
