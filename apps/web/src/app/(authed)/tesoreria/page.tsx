'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CashCloseHistoryDetail } from '@/components/treasury/CashCloseHistoryDetail'
import { PesoAmountInput } from '@/components/ui/PesoAmountInput'
import { CashCloseSummary, closedAtLabel } from '@/components/treasury/CashCloseSummary'
import { ManualMovementForm } from '@/components/treasury/ManualMovementForm'
import { OperatorCashDashboard } from '@/components/treasury/OperatorCashDashboard'
import { Modal } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/Alert'
import {
  closeCashShift,
  ensureOpenCashShift,
  forceCloseCashShift,
  getCashShiftDetail,
  getCashShifts,
  reverseCashTender,
  type CashShift,
  type CashClose,
  type CashMovement,
} from '@/lib/api/treasury'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { useFeatureConfig } from '@/lib/features'
import { buildCashContextHref, parseCashContext } from '@/lib/collections-cash-context'
import { createCollectionsIdempotencyStore } from '@/lib/collections-idempotency'
import {
  canOperateCashShift,
  isCashShiftEligible,
  isCashShiftExpired,
} from '@/lib/cash-shift-eligibility'
import { parseCashAmount } from '@/lib/cash-amount'

/**
 * Finding #2 of the caja #537 B2a review: a failed cash command can be a
 * network failure or a 2xx with an unreadable body (proxy-injected HTML).
 * Both used to fall through to the generic message; differentiate them so
 * operators know whether to retry or to check connectivity.
 */
const connectionMessage = (error: unknown): string | null => {
  if (error instanceof ApiError && error.code === 'MALFORMED_RESPONSE') {
    return 'El servidor respondió con datos ilegibles. Reintentá la operación.'
  }
  if (error instanceof TypeError) {
    return 'No hay conexión con el servidor. Verificá tu red e intentá de nuevo.'
  }
  return null
}

const formatPesos = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

export default function TreasuryPage() {
  const { user } = useAuth()
  const { cashEnabled } = useFeatureConfig()
  const router = useRouter()
  const cashContext = parseCashContext(useSearchParams())
  const isFinanceRole = user?.role === 'ADMIN' || user?.role === 'TESORERO'
  const operatorId = user?.operator_id
  const allowed = isFinanceRole || user?.role === 'OPERADOR'
  // Bumped after every confirmed command so the open-shift movement list refetches.
  const [movementsToken, setMovementsToken] = useState(0)
  // erpgw-style load modals: the open-shift section shows two explicit load buttons and the
  // form lives inside a modal with the direction implied by the button that opened it.
  const [movementModal, setMovementModal] = useState<'INCOME' | 'EXPENSE' | null>(null)
  // P6 edit/delete flows over MANUAL movements (the ledger is append-only: delete = reversal,
  // edit = reversal + corrected re-record).
  const [editMovement, setEditMovement] = useState<CashMovement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CashMovement | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  // P9 corte de caja: count the drawer, declare the float that stays for change, sweep the
  // rest to Valores a Depositar.
  const [corteOpen, setCorteOpen] = useState(false)
  const [corteCounted, setCorteCounted] = useState('')
  const [corteFloat, setCorteFloat] = useState('')
  const [corteReason, setCorteReason] = useState('')
  const [recoveryCounted, setRecoveryCounted] = useState('')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryShift, setRecoveryShift] = useState<CashShift | null>(null)
  const [recoveryPending, setCommandPending] = useState(false)
  const [refreshWarning, setRefreshWarning] = useState('')
  const [closedIds, setClosedIds] = useState<string[]>([])
  const [ensuring, setEnsuring] = useState(false)
  const activeCommand = useRef<symbol | null>(null)
  const needsRefresh = useRef(false)
  const keys = useRef<ReturnType<typeof createCollectionsIdempotencyStore> | null>(null)
  const ensuringRef = useRef(false)
  const owner = `${user?.operator_id}:${user?.role}:${cashEnabled}`
  const currentOwner = useRef(owner)
  currentOwner.current = owner
  const [recoveryError, setRecoveryError] = useState('')
  const [message, setMessage] = useState('')
  const [commandError, setCommandError] = useState('')
  const [closeResult, setCloseResult] = useState<CashClose | null>(null)
  const query = useQuery({
    queryKey: ['cash-shifts', user?.operator_id, user?.role],
    queryFn: getCashShifts,
    enabled: allowed && cashEnabled,
  })

  useEffect(() => {
    activeCommand.current = null
    needsRefresh.current = false
    setCommandPending(false)
    setRefreshWarning('')
    setMessage('')
    setCommandError('')
    setCloseResult(null)
    setClosedIds([])
    setRecoveryShift(null)
    setRecoveryError('')
    return () => {
      activeCommand.current = null
    }
  }, [owner])

  if (!cashEnabled) return <div role="alert">La caja está deshabilitada actualmente.</div>
  if (!allowed) return <div role="alert">No tenés permiso para operar la caja.</div>

  const shifts = (query.data?.items ?? []).filter(({ id }) => !closedIds.includes(id))
  const locked = recoveryPending || Boolean(refreshWarning)
  const isCurrent = (token: symbol) =>
    activeCommand.current === token && currentOwner.current === owner
  const finish = (token: symbol) => {
    if (!isCurrent(token)) return
    activeCommand.current = null
    setCommandPending(false)
  }
  const refreshShifts = async (token: symbol) => {
    try {
      const result = await query.refetch()
      if (result?.isError) throw result.error
      if (isCurrent(token)) {
        needsRefresh.current = false
        setRefreshWarning('')
      }
    } catch {
      if (isCurrent(token)) {
        setRefreshWarning(
          'La operación está confirmada, pero no se pudieron actualizar los turnos.',
        )
      }
    }
  }
  const runCommand = async <T,>(
    action: string,
    draft: unknown,
    request: (key: string) => Promise<T>,
    confirm: (result: T) => void,
    reportError = setCommandError,
    errorMessage?: (error: unknown) => string,
  ) => {
    if (
      activeCommand.current ||
      needsRefresh.current ||
      !user?.operator_id ||
      currentOwner.current !== owner
    )
      return
    const token = Symbol(action)
    activeCommand.current = token
    setCommandPending(true)
    reportError('')
    const input = {
      operatorId: user.operator_id,
      action: `cash:${action}`,
      draftFingerprint: JSON.stringify(draft),
    }
    keys.current ??= createCollectionsIdempotencyStore()
    try {
      let result: T
      try {
        result = await request(keys.current.getOrCreate(input))
      } catch (error) {
        if (isCurrent(token))
          reportError(
            connectionMessage(error) ??
              errorMessage?.(error) ??
              'No se pudo ejecutar la operación de caja.',
          )
        return
      }
      keys.current.complete(input)
      if (!isCurrent(token)) return
      needsRefresh.current = true
      confirm(result)
      await refreshShifts(token)
    } finally {
      finish(token)
    }
  }
  const retryRefresh = async () => {
    if (activeCommand.current || !needsRefresh.current) return
    const token = Symbol('refresh')
    activeCommand.current = token
    setCommandPending(true)
    try {
      await refreshShifts(token)
    } finally {
      finish(token)
    }
  }
  const cashAmount = (value: string, reportError = setCommandError) => {
    const amount = parseCashAmount(value)
    if (amount === null)
      reportError('Revisá el importe en pesos: debe ser no negativo y tener hasta dos decimales.')
    return amount
  }

  const ownOpenShift = shifts.find(
    (shift) => shift.status === 'OPEN' && shift.assigned_operator_id === operatorId,
  )
  const ownClosedShifts = shifts.filter(
    (shift) => shift.status === 'CLOSED' && shift.assigned_operator_id === operatorId,
  )
  const recoverableShifts = isFinanceRole
    ? shifts
        .filter((shift) => isCashShiftExpired(shift))
        .filter((shift) => canOperateCashShift(shift, user))
    : []

  // P9 auto-open: the working period opens itself. Whenever this operator has no OPEN shift
  // (first visit of the day, or right after a corte), ensure-open bootstraps it with the
  // last close remainder; the refetch then shows the fresh period.
  useEffect(() => {
    if (!allowed || !cashEnabled || !operatorId || query.isPending) return
    if (ownOpenShift || ensuringRef.current) return
    ensuringRef.current = true
    setEnsuring(true)
    ensureOpenCashShift(crypto.randomUUID())
      .then(() => query.refetch())
      .catch(() => undefined)
      .finally(() => {
        ensuringRef.current = false
        setEnsuring(false)
      })
  }, [allowed, cashEnabled, operatorId, ownOpenShift, query])

  const canReturnToCollections =
    cashContext && ownOpenShift && isCashShiftEligible(ownOpenShift, user)
  const collectionsHref =
    cashContext && canReturnToCollections
      ? buildCashContextHref('/collections', cashContext.memberId, cashContext.obligationIds)
      : null
  const expired = (shift: CashShift) => isCashShiftExpired(shift)

  const corteDetail = useQuery({
    queryKey: ['cash-shift-detail', ownOpenShift?.id ?? 'none', movementsToken],
    queryFn: () => getCashShiftDetail(ownOpenShift!.id),
    enabled: corteOpen && Boolean(ownOpenShift),
  })
  const corteExpectedCents = corteDetail.data?.expected_tenders?.CASH ?? null
  // Prefill "dejás en cajón" with everything counted: keeping cash in the drawer is the safe
  // default (the operator lowers the float to sweep the excess to Valores a Depositar).
  useEffect(() => {
    if (!corteOpen) return
    if (corteFloat === '' && corteExpectedCents !== null) {
      setCorteFloat(formatPesos(corteExpectedCents))
    }
  }, [corteOpen, corteExpectedCents, corteFloat])

  const confirmCorte = async (event: FormEvent) => {
    event.preventDefault()
    if (!ownOpenShift) return
    const currentShift = shifts.find(({ id }) => id === ownOpenShift.id)
    if (!currentShift || !isCashShiftEligible(currentShift, user)) {
      setCommandError(
        'El turno ya no está disponible para corte normal. Actualizá los turnos e intentá de nuevo.',
      )
      return
    }
    const countedCents = cashAmount(corteCounted)
    if (countedCents === null) return
    const floatCents = cashAmount(corteFloat)
    if (floatCents === null) return
    if (floatCents > countedCents) {
      setCommandError('El efectivo que dejás en cajón no puede superar lo contado.')
      return
    }
    const discrepancy = corteExpectedCents === null ? 0 : countedCents - corteExpectedCents
    if (discrepancy !== 0 && !corteReason.trim()) return
    const closing = { CASH: countedCents }
    await runCommand(
      'close',
      { shiftId: currentShift.id, closing, reason: corteReason, drawerFloatCents: floatCents },
      (key) => closeCashShift(currentShift.id, closing, corteReason.trim(), key, floatCents),
      (result) => {
        setClosedIds((ids) => [...ids, currentShift.id])
        setCloseResult(result)
        setMessage('Corte realizado.')
        setCorteOpen(false)
        setCorteCounted('')
        setCorteFloat('')
        setCorteReason('')
      },
    )
  }

  const confirmRecovery = async (event: FormEvent) => {
    event.preventDefault()
    if (!recoveryShift || !recoveryReason.trim()) return
    const currentRecoveryShift = shifts.find(({ id }) => id === recoveryShift.id)
    if (
      !currentRecoveryShift ||
      !canOperateCashShift(currentRecoveryShift, user) ||
      !isCashShiftExpired(currentRecoveryShift)
    ) {
      setRecoveryError(
        'El turno ya no está disponible para recuperación. Actualizá los turnos e intentá de nuevo.',
      )
      return
    }
    const amount = cashAmount(recoveryCounted, setRecoveryError)
    if (amount === null) return
    const closing = { CASH: amount }
    const explanation = recoveryReason.trim()
    await runCommand(
      'recover',
      { shiftId: currentRecoveryShift.id, closing, explanation },
      (key) => forceCloseCashShift(currentRecoveryShift.id, closing, explanation, key),
      (result) => {
        setCloseResult(result)
        setClosedIds((ids) => [...ids, currentRecoveryShift.id])
        setRecoveryShift(null)
        setRecoveryReason('')
        setMessage('Turno vencido recuperado y cerrado.')
      },
      setRecoveryError,
    )
  }

  const confirmDelete = async () => {
    if (!deleteTarget || !ownOpenShift) return
    setDeletePending(true)
    try {
      await reverseCashTender(
        ownOpenShift.id,
        deleteTarget.id,
        deleteReason.trim() || 'Reversión del movimiento',
        crypto.randomUUID(),
      )
      setDeleteTarget(null)
      setDeleteReason('')
      setMovementsToken((token) => token + 1)
      setMessage('Movimiento revertido.')
    } catch (deleteError) {
      setMessage(
        deleteError instanceof ApiError
          ? deleteError.message
          : 'No se pudo revertir el movimiento.',
      )
    } finally {
      setDeletePending(false)
    }
  }

  const corteDiscrepancy =
    corteExpectedCents !== null && corteCounted !== ''
      ? (parseCashAmount(corteCounted) ?? 0) - corteExpectedCents
      : null

  return (
    <main className="space-y-6" aria-labelledby="treasury-title">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Tesorería</p>
        <h1 id="treasury-title" className="font-display text-2xl font-bold text-ink-900">
          Caja
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Tu caja del día: cobrá en cobranza, registrá ingresos y egresos, y cortá la caja cuando
          necesites. Lo que no cortás queda esperando el próximo corte.
        </p>
      </header>
      {query.isPending && <p role="status">Cargando turnos de caja…</p>}
      {query.isError && <p role="alert">No se pudieron cargar los turnos de caja.</p>}
      {commandError && <Alert tone="error">{commandError}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      {refreshWarning && (
        <div>
          <Alert tone="warning">{refreshWarning}</Alert>
          <button type="button" onClick={() => void retryRefresh()} disabled={recoveryPending}>
            Actualizar turnos
          </button>
        </div>
      )}
      {closeResult && (
        <section aria-label="Resumen de conciliación" className="space-y-2 rounded border p-4">
          <h2 className="font-display text-lg">Último corte confirmado</h2>
          <CashCloseSummary close={closeResult} />
        </section>
      )}
      {collectionsHref && (
        <button type="button" onClick={() => router.push(collectionsHref)}>
          Volver a cobranza
        </button>
      )}
      {!ownOpenShift && (
        <p role="status">
          {ensuring
            ? 'Preparando tu caja…'
            : 'Tu caja se abre sola con el primer movimiento del período.'}
        </p>
      )}
      {ownOpenShift && operatorId && (
        <section
          aria-label="Tu turno de caja"
          className="rounded-lg border border-ink-100 bg-surface p-4"
        >
          {expired(ownOpenShift) ? (
            <p>Tu turno en {ownOpenShift.desk_id} está vencido. Pedí la recuperación a Finanzas.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p>Tenés un turno abierto en {ownOpenShift.desk_id}.</p>
                <button
                  type="button"
                  className="rounded bg-accent px-3 py-2 text-accent-foreground"
                  disabled={locked}
                  onClick={() => {
                    setCorteCounted('')
                    setCorteFloat('')
                    setCorteReason('')
                    setCorteOpen(true)
                  }}
                >
                  Cortar caja
                </button>
              </div>
              <OperatorCashDashboard
                shiftId={ownOpenShift.id}
                refreshToken={movementsToken}
                onLoadIncome={() => setMovementModal('INCOME')}
                onLoadExpense={() => setMovementModal('EXPENSE')}
                onEditMovement={(movement) => {
                  setEditMovement(movement)
                  setMovementModal(movement.direction)
                }}
                onDeleteMovement={(movement) => {
                  setDeleteReason('')
                  setDeleteTarget(movement)
                }}
              />
              <Modal
                open={movementModal !== null}
                title={
                  editMovement
                    ? 'Editar movimiento'
                    : movementModal === 'EXPENSE'
                      ? 'Cargar Egreso'
                      : 'Cargar Ingreso'
                }
                footer={
                  <>
                    <button
                      type="button"
                      className="rounded border px-3 py-2"
                      onClick={() => {
                        setMovementModal(null)
                        setEditMovement(null)
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      form="manual-movement-form"
                      className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50"
                    >
                      {editMovement
                        ? 'Guardar cambios'
                        : movementModal === 'EXPENSE'
                          ? 'Agregar Egreso'
                          : 'Agregar Ingreso'}
                    </button>
                  </>
                }
              >
                <p className="mb-3 text-sm text-ink-500">
                  {editMovement
                    ? 'Al guardar, el movimiento original queda revertido y se registra el corregido.'
                    : 'Completá los datos del movimiento a registrar.'}
                </p>
                {movementModal !== null && (
                  <ManualMovementForm
                    shiftId={ownOpenShift.id}
                    operatorId={operatorId}
                    initialDirection={movementModal}
                    initialAmount={
                      editMovement
                        ? (editMovement.amount_cents / 100).toFixed(2).replace('.', ',')
                        : undefined
                    }
                    initialDescription={editMovement?.description ?? undefined}
                    initialAccount={
                      editMovement?.account_code_snapshot
                        ? {
                            code: editMovement.account_code_snapshot,
                            name: editMovement.account_name_snapshot ?? '',
                            parent: null,
                            root: { code: '', name: '' },
                            path: [],
                            active: true,
                            imputable: true,
                            eligible: true,
                          }
                        : undefined
                    }
                    onBeforeRecord={
                      editMovement
                        ? async () => {
                            try {
                              await reverseCashTender(
                                ownOpenShift.id,
                                editMovement.id,
                                `Reversión por edición del movimiento ${editMovement.id.slice(0, 8)}`,
                                crypto.randomUUID(),
                              )
                            } catch (reverseError) {
                              // A previous failed attempt may already have recorded the
                              // reversal; recording the corrected movement is then exactly
                              // the right continuation.
                              if (
                                !(reverseError instanceof ApiError && reverseError.status === 409)
                              )
                                throw reverseError
                            }
                          }
                        : undefined
                    }
                    onRecorded={setMessage}
                    onDone={() => {
                      setMovementsToken((token) => token + 1)
                      setMovementModal(null)
                      setEditMovement(null)
                    }}
                  />
                )}
              </Modal>
              <Modal
                open={deleteTarget !== null}
                title="Eliminar movimiento"
                role="alertdialog"
                descriptionId="delete-movement-description"
                footer={
                  <>
                    <button
                      type="button"
                      className="rounded border px-3 py-2"
                      onClick={() => setDeleteTarget(null)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="rounded bg-danger px-3 py-2 text-white disabled:opacity-50"
                      disabled={deletePending}
                      onClick={() => void confirmDelete()}
                    >
                      {deletePending ? 'Revirtiendo…' : 'Eliminar'}
                    </button>
                  </>
                }
              >
                <div id="delete-movement-description" className="space-y-3">
                  <p className="text-sm text-ink-600">
                    El ledger de caja es append-only: el movimiento original queda registrado y se
                    agrega su reversión (asiento inverso) al turno.
                  </p>
                  <label>
                    Motivo de la reversión
                    <input
                      className="mt-1 block w-full rounded border p-2"
                      value={deleteReason}
                      placeholder="Reversión del movimiento"
                      disabled={deletePending}
                      onChange={(event) => setDeleteReason(event.target.value)}
                    />
                  </label>
                </div>
              </Modal>
            </>
          )}
        </section>
      )}
      <Modal
        open={corteOpen}
        title="Cortar caja"
        footer={
          <>
            <button
              type="button"
              className="rounded border px-3 py-2"
              onClick={() => setCorteOpen(false)}
              disabled={recoveryPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50"
              disabled={
                recoveryPending ||
                corteCounted === '' ||
                (corteDiscrepancy !== null && corteDiscrepancy !== 0 && !corteReason.trim())
              }
              onClick={(event) => void confirmCorte(event)}
            >
              Confirmar corte
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Contá el efectivo del cajón y declará cuánto dejás para vuelto. Lo excedente va a
            Valores a Depositar y el próximo período abre con lo que dejaste.
          </p>
          <p className="text-sm font-medium text-ink-900">
            Efectivo esperado:{' '}
            {corteExpectedCents === null ? 'No disponible' : `$ ${formatPesos(corteExpectedCents)}`}
          </p>
          <label className="block text-sm font-medium text-ink-700">
            Efectivo contado (pesos)
            <PesoAmountInput
              className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
              maxLength={32}
              value={corteCounted}
              parseCents={parseCashAmount}
              disabled={recoveryPending}
              onChange={(event) => setCorteCounted(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Dejás en cajón (para vuelto)
            <PesoAmountInput
              className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
              maxLength={32}
              value={corteFloat}
              parseCents={parseCashAmount}
              disabled={recoveryPending}
              onChange={(event) => setCorteFloat(event.target.value)}
            />
          </label>
          {corteCounted !== '' && corteFloat !== '' && (
            <p className="text-sm text-ink-600">
              A Valores a Depositar:{' '}
              <span className="font-semibold text-ink-900">
                ${' '}
                {formatPesos(
                  Math.max(
                    0,
                    (parseCashAmount(corteCounted) ?? 0) -
                      Math.min(
                        parseCashAmount(corteFloat) ?? 0,
                        parseCashAmount(corteCounted) ?? 0,
                      ),
                  ),
                )}
              </span>
            </p>
          )}
          {corteDiscrepancy !== null && corteDiscrepancy !== 0 && (
            <Alert tone="warning">
              Hay una diferencia de {formatPesos(Math.abs(corteDiscrepancy))}{' '}
              {corteDiscrepancy > 0 ? 'a favor' : 'en contra'}: explicá el motivo para confirmar el
              corte.
            </Alert>
          )}
          <label className="block text-sm font-medium text-ink-700">
            Motivo de diferencia (obligatorio si no cuadra)
            <input
              className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 font-normal text-ink-900"
              value={corteReason}
              disabled={recoveryPending}
              onChange={(event) => setCorteReason(event.target.value)}
            />
          </label>
        </div>
      </Modal>
      {ownClosedShifts.length > 0 && (
        <section aria-label="Cortes del día" className="space-y-2 rounded border p-4">
          <h2 className="font-display text-lg">Cortes del día</h2>
          <p>Consultá el detalle de conciliación de tus cortes.</p>
          <ul className="space-y-2">
            {ownClosedShifts.map((shift) => (
              <li key={shift.id}>
                <strong>{shift.desk_id}</strong>
                <p>
                  {closedAtLabel(shift.closed_at)} (hora local) · {shift.id}
                </p>
                <CashCloseHistoryDetail
                  shift={shift}
                  actorId={user?.operator_id}
                  role={user?.role}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {isFinanceRole && (
        <section
          aria-label="Recuperación de turnos vencidos"
          className="grid gap-3 rounded-lg border border-danger/30 bg-surface p-4"
        >
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Recuperar turno vencido
          </h2>
          <p className="text-sm text-ink-600">
            La recuperación está disponible después de 24 horas y requiere un motivo. Aplica a los
            turnos de cualquier puesto.
          </p>
          {recoverableShifts.length === 0 && <p role="status">No hay turnos vencidos.</p>}
          {recoverableShifts.map((shift) => (
            <button
              key={shift.id}
              type="button"
              className="w-fit rounded border border-danger px-3 py-2"
              disabled={locked}
              onClick={() => {
                setRecoveryCounted('')
                setRecoveryShift(shift)
                setRecoveryError('')
              }}
            >
              Recuperar turno vencido {shift.desk_id} —{' '}
              {shift.assigned_operator_id === operatorId ? 'Tu turno' : 'Otro responsable'}
            </button>
          ))}
        </section>
      )}
      {recoveryShift && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="expired-recovery-title"
          className="rounded-lg border border-danger/30 bg-surface p-4"
        >
          <h2
            id="expired-recovery-title"
            className="font-display text-lg font-semibold text-ink-900"
          >
            Confirmar recuperación del turno vencido
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            Esta acción cierra de forma permanente el turno vencido de {recoveryShift.desk_id} y
            registra el motivo de recuperación en la auditoría.
          </p>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          <form onSubmit={confirmRecovery} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              Efectivo contado (pesos)
              <PesoAmountInput
                className="mt-1 block w-full rounded border p-2"
                maxLength={32}
                value={recoveryCounted}
                parseCents={parseCashAmount}
                disabled={recoveryPending}
                onChange={(event) => setRecoveryCounted(event.target.value)}
              />
            </label>
            <label>
              Motivo de recuperación
              <input
                className="mt-1 block w-full rounded border p-2"
                required
                value={recoveryReason}
                onChange={(event) => setRecoveryReason(event.target.value)}
                disabled={recoveryPending}
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2">
              <button
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => setRecoveryShift(null)}
                disabled={recoveryPending}
              >
                Cancelar recuperación
              </button>
              <button
                type="submit"
                className="rounded bg-danger px-3 py-2 text-white disabled:opacity-50"
                disabled={recoveryPending || !recoveryReason.trim() || recoveryCounted === ''}
                aria-busy={recoveryPending}
              >
                {recoveryPending ? 'Recuperando…' : 'Confirmar recuperación'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
