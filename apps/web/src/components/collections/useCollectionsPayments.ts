'use client'

import { useRef, useState, type MutableRefObject } from 'react'
import { ApiError } from '@/lib/api'
import type { CurrentUser } from '@/lib/auth'
import {
  createFullSelectionPayment,
  DuesOperationError,
  getDebt,
  reverseDuesSettlement,
  type DebtDetail,
  type FullSelectionPaymentInput,
} from '@/lib/api/dues'
import {
  createCollectionsIdempotencyStore,
  type CollectionsIdempotencyStore,
} from '@/lib/collections-idempotency'
import { getOpenCashShifts, type CashShift } from '@/lib/api/treasury'
import type { Socio } from '@/lib/api/socios'
import type { ReversalRequest } from './SettlementActions'

export type DebtSocio = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'>
type DebtPanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'not_found'
  | 'unavailable'
  | 'error'
  | 'empty'
type PaymentsApi = {
  getDebt: typeof getDebt
  getOpenCashShifts: typeof getOpenCashShifts
  createFullSelectionPayment: typeof createFullSelectionPayment
  reverseDuesSettlement: typeof reverseDuesSettlement
}
type Props = {
  user: Pick<CurrentUser, 'operator_id' | 'role'> | null
  idempotency?: MutableRefObject<CollectionsIdempotencyStore | null>
  api?: Partial<PaymentsApi>
}

const errorText = (_reason: unknown, fallback: string) => fallback

export function useCollectionsPayments({ user, idempotency: sharedIdempotency, api = {} }: Props) {
  const [selectedSocio, setSelectedSocio] = useState<DebtSocio | null>(null)
  const [debt, setDebt] = useState<DebtDetail | null>(null)
  const [debtStatus, setDebtStatus] = useState<DebtPanelStatus>('idle')
  const [debtError, setDebtError] = useState('')
  const [openShifts, setOpenShifts] = useState<CashShift[]>([])
  const [openShiftAvailability, setOpenShiftAvailability] = useState<
    'loading' | 'ready' | 'unavailable'
  >('ready')
  const localIdempotency = useRef<CollectionsIdempotencyStore | null>(null)
  const selectedMember = useRef<string | null>(null)
  const debtLoad = useRef(0)
  const idempotency = sharedIdempotency ?? localIdempotency
  const apiDependencies: PaymentsApi = {
    getDebt,
    getOpenCashShifts,
    createFullSelectionPayment,
    reverseDuesSettlement,
    ...api,
  }

  const selectSocio = async (socio: DebtSocio) => {
    selectedMember.current = socio.id
    setSelectedSocio(socio)
    setDebt(null)
    setOpenShifts([])
    setOpenShiftAvailability('loading')
    setDebtError('')
    setDebtStatus('loading')
    const debtRequest = ++debtLoad.current
    const shiftsRequest = apiDependencies.getOpenCashShifts()
    void shiftsRequest.catch(() => undefined)
    try {
      const result = await apiDependencies.getDebt(socio.id)
      if (debtRequest !== debtLoad.current) return null
      setDebt(result)
      setDebtStatus(result.status)
      try {
        const shifts = await shiftsRequest
        if (debtRequest !== debtLoad.current) return null
        setOpenShifts(shifts)
        setOpenShiftAvailability('ready')
      } catch {
        if (debtRequest !== debtLoad.current) return null
        setOpenShifts([])
        setOpenShiftAvailability('unavailable')
      }
      return result
    } catch (reason) {
      if (debtRequest !== debtLoad.current) return null
      if (reason instanceof ApiError && reason.status === 404) {
        setDebtError('No se encontró el detalle de deuda de este socio.')
        setDebtStatus('not_found')
      } else if (reason instanceof ApiError && reason.status >= 500) {
        setDebtError('El detalle de deuda no está disponible.')
        setDebtStatus('unavailable')
      } else {
        setDebtError(errorText(reason, 'No se pudo cargar el detalle de deuda.'))
        setDebtStatus('error')
      }
      return null
    }
  }

  const refreshDebt = async () => {
    if (!selectedSocio || selectedMember.current !== selectedSocio.id) return false
    const memberId = selectedSocio.id
    const load = ++debtLoad.current
    setDebtStatus('loading')
    try {
      const result = await apiDependencies.getDebt(memberId)
      if (load !== debtLoad.current || selectedMember.current !== memberId) return false
      setDebt(result)
      setDebtStatus(result.status)
      setDebtError('')
      return true
    } catch (reason) {
      if (load !== debtLoad.current || selectedMember.current !== memberId) return false
      setDebtError(errorText(reason, 'No se pudo actualizar el detalle de deuda.'))
      setDebtStatus('error')
      return false
    }
  }

  const refreshPaymentContext = async () => {
    if (!selectedSocio || selectedMember.current !== selectedSocio.id)
      throw new DuesOperationError('unavailable', 'Payment context unavailable')
    const memberId = selectedSocio.id
    const load = ++debtLoad.current
    setOpenShiftAvailability('loading')
    try {
      const [detail, shifts] = await Promise.all([
        apiDependencies.getDebt(memberId),
        apiDependencies.getOpenCashShifts(),
      ])
      if (load !== debtLoad.current || selectedMember.current !== memberId)
        throw new DuesOperationError('unavailable', 'Payment context unavailable')
      setDebt(detail)
      setDebtStatus(detail.status)
      setDebtError('')
      setOpenShifts(shifts)
      setOpenShiftAvailability('ready')
      return true
    } catch (reason) {
      if (load === debtLoad.current && selectedMember.current === memberId)
        setOpenShiftAvailability('unavailable')
      throw reason
    }
  }

  const runSettlementMutation = async <T extends object>(
    action: string,
    draftFingerprint: string,
    request: (key: string) => Promise<T>,
    retainOnConflict = false,
    refresh = refreshDebt,
  ) => {
    if (!user || !selectedSocio)
      throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const input = { operatorId: user.operator_id, action, draftFingerprint }
    const replayed = Boolean(idempotency.current.peek(input))
    const key = idempotency.current.getOrCreate(input)
    try {
      const result = await request(key)
      if (!(await refresh()))
        throw new DuesOperationError('unavailable', 'Debt refresh unavailable')
      idempotency.current.complete(input)
      return {
        ...result,
        replayed: Boolean((result as { replayed?: boolean }).replayed) || replayed,
      }
    } catch (reason) {
      if (!retainOnConflict && reason instanceof DuesOperationError && reason.kind === 'conflict')
        idempotency.current.abandon(input)
      if (
        action === 'reverse-settlement' &&
        !retainOnConflict &&
        ((reason instanceof ApiError && reason.status === 409) ||
          (reason instanceof DuesOperationError && reason.kind === 'conflict'))
      ) {
        idempotency.current.abandon(input)
        await refreshDebt()
      }
      throw reason
    }
  }

  const pay = async (draft: Omit<FullSelectionPaymentInput, 'socio_id'>) => {
    if (!openShifts.some(({ id }) => id === draft.shift_id))
      throw new DuesOperationError('conflict', 'Selected cash shift is not open')
    const obligation_ids = [...draft.obligation_ids].sort()
    return runSettlementMutation(
      'full-selection-payment',
      JSON.stringify({
        socioId: selectedSocio!.id,
        obligation_ids,
        shift_id: draft.shift_id,
        tender: draft.tender,
        selection_fingerprint: draft.selection_fingerprint,
      }),
      (key) =>
        apiDependencies.createFullSelectionPayment(
          { ...draft, socio_id: selectedSocio!.id, obligation_ids },
          key,
        ),
      true,
      refreshPaymentContext,
    )
  }
  const reverse = (input: ReversalRequest) =>
    runSettlementMutation('reverse-settlement', JSON.stringify(input), (key) =>
      apiDependencies.reverseDuesSettlement(input.settlement_id, { reason: input.reason }, key),
    )

  return {
    debt,
    debtError,
    debtStatus,
    openShiftAvailability,
    openShifts,
    pay,
    refreshDebt,
    refreshPaymentContext,
    reverse,
    selectSocio,
    selectedSocio,
  }
}
