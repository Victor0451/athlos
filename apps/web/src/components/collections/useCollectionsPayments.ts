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
import {
  eligibleCashShifts,
  getCashShiftAvailability,
  isCashShiftEligible,
} from '@/lib/cash-shift-eligibility'
import type { Socio } from '@/lib/api/socios'
import type { ReversalRequest } from './SettlementActions'

export type DebtSocio = Pick<Socio, 'id' | 'nombre' | 'apellido' | 'numero_socio'> & {
  fecha_alta?: string
}
type DebtPanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'not_found'
  | 'unavailable'
  | 'error'
  | 'empty'
export type ConfirmedPaymentOutcome = {
  memberId: string
  settlementId: string
  amountCents: number
  currency: string
  tender: FullSelectionPaymentInput['tender']
  reconciliation: 'ready' | 'pending'
}
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
  const paymentRequest = useRef<{
    input: { operatorId: string; action: string; draftFingerprint: string }
    memberId: string
  } | null>(null)
  const paymentReconciliationBusy = useRef(false)
  const [paymentOutcome, setPaymentOutcome] = useState<ConfirmedPaymentOutcome | null>(null)
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
    setPaymentOutcome(null)
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

  const cashShiftAvailability =
    openShiftAvailability === 'unavailable'
      ? 'unavailable'
      : openShiftAvailability === 'loading'
        ? null
        : getCashShiftAvailability(openShifts, user)
  const eligibleOpenShifts = eligibleCashShifts(openShifts, user)

  const pay = async (draft: Omit<FullSelectionPaymentInput, 'socio_id'>) => {
    const memberId = selectedSocio?.id
    if (!memberId || selectedMember.current !== memberId)
      throw new DuesOperationError('permission', 'Authentication required')
    if (paymentOutcome?.memberId === memberId && paymentOutcome.reconciliation === 'pending')
      throw new DuesOperationError('unavailable', 'Payment reconciliation pending')
    const selectedShift = openShifts.find(({ id }) => id === draft.shift_id)
    if (!selectedShift || !isCashShiftEligible(selectedShift, user))
      throw new DuesOperationError('conflict', 'Selected cash shift is not available')
    if (!user) throw new DuesOperationError('permission', 'Authentication required')
    if (!idempotency.current) idempotency.current = createCollectionsIdempotencyStore()
    const obligation_ids = [...draft.obligation_ids].sort()
    const input = {
      operatorId: user.operator_id,
      action: 'full-selection-payment',
      draftFingerprint: JSON.stringify({
        socioId: memberId,
        obligation_ids,
        shift_id: draft.shift_id,
        tender: draft.tender,
        selection_fingerprint: draft.selection_fingerprint,
      }),
    }
    const key = idempotency.current.getOrCreate(input)
    if (selectedMember.current !== memberId)
      throw new DuesOperationError('unavailable', 'Payment context unavailable')
    const result = await apiDependencies.createFullSelectionPayment(
      { ...draft, socio_id: memberId, obligation_ids },
      key,
    )
    if (selectedMember.current !== memberId) return result
    const outcome = {
      memberId,
      settlementId: result.settlement_id,
      amountCents: result.amount_cents,
      currency: result.currency,
      tender: draft.tender,
      reconciliation: 'pending' as const,
    }
    paymentRequest.current = { input, memberId }
    setPaymentOutcome(outcome)
    try {
      if (await refreshPaymentContext()) {
        idempotency.current.complete(input)
        paymentRequest.current = null
        setPaymentOutcome({ ...outcome, reconciliation: 'ready' })
      }
    } catch {
      // The POST result remains confirmed while GET reconciliation is retried separately.
    }
    return result
  }
  const reconcilePayment = async () => {
    const request = paymentRequest.current
    if (
      !request ||
      selectedMember.current !== request.memberId ||
      paymentReconciliationBusy.current
    )
      return false
    paymentReconciliationBusy.current = true
    try {
      if (!(await refreshPaymentContext())) return false
      idempotency.current?.complete(request.input)
      paymentRequest.current = null
      setPaymentOutcome((current) =>
        current?.memberId === request.memberId ? { ...current, reconciliation: 'ready' } : current,
      )
      return true
    } catch {
      return false
    } finally {
      paymentReconciliationBusy.current = false
    }
  }
  const reverse = (input: ReversalRequest) =>
    runSettlementMutation('reverse-settlement', JSON.stringify(input), (key) =>
      apiDependencies.reverseDuesSettlement(input.settlement_id, { reason: input.reason }, key),
    )

  return {
    cashShiftAvailability,
    debt,
    debtError,
    debtStatus,
    openShiftAvailability,
    openShifts: eligibleOpenShifts,
    pay,
    paymentOutcome,
    reconcilePayment,
    refreshDebt,
    refreshPaymentContext,
    reverse,
    selectSocio,
    selectedSocio,
  }
}
