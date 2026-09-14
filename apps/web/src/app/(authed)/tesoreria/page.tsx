'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CashCloseHistoryDetail } from '@/components/treasury/CashCloseHistoryDetail'
import { PesoAmountInput } from '@/components/ui/PesoAmountInput'
import { CashCloseSummary, closedAtLabel } from '@/components/treasury/CashCloseSummary'
import {
  closeCashShift,
  forceCloseCashShift,
  getCashShifts,
  openCashShift,
  type CashShift,
  type CashClose,
} from '@/lib/api/treasury'
import { useAuth } from '@/lib/use-auth'
import { useFeatureConfig } from '@/lib/features'
import { buildCashContextHref, parseCashContext } from '@/lib/collections-cash-context'
import { createCollectionsIdempotencyStore } from '@/lib/collections-idempotency'
import {
  canOperateCashShift,
  isCashShiftEligible,
  isCashShiftExpired,
} from '@/lib/cash-shift-eligibility'

const parseCashAmount = (value: string): number | null => {
  const text = value.trim()
  if (text.length > 32) return null
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text)
  if (!match) return null
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}

export default function TreasuryPage() {
  const { user } = useAuth()
  const { cashEnabled } = useFeatureConfig()
  const router = useRouter()
  const cashContext = parseCashContext(useSearchParams())
  const allowed = user?.role === 'ADMIN' || user?.role === 'TESORERO'
  const [desk, setDesk] = useState('front-desk')
  const [cash, setCash] = useState('0')
  const [counted, setCounted] = useState('0')
  const [reason, setReason] = useState('')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryShift, setRecoveryShift] = useState<CashShift | null>(null)
  const [recoveryPending, setCommandPending] = useState(false)
  const [refreshWarning, setRefreshWarning] = useState('')
  const [closedIds, setClosedIds] = useState<string[]>([])
  const activeCommand = useRef<symbol | null>(null)
  const needsRefresh = useRef(false)
  const keys = useRef<ReturnType<typeof createCollectionsIdempotencyStore> | null>(null)
  const owner = `${user?.operator_id}:${user?.role}:${cashEnabled}`
  const currentOwner = useRef(owner)
  currentOwner.current = owner
  const [recoveryError, setRecoveryError] = useState('')
  const [message, setMessage] = useState('')
  const [commandError, setCommandError] = useState('')
  const [openedShift, setOpenedShift] = useState<CashShift | null>(null)
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
    setOpenedShift(null)
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
        if (result?.data) setOpenedShift(null)
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
      } catch {
        if (isCurrent(token)) reportError('No se pudo ejecutar la operación de caja.')
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
  const open = async (event: FormEvent) => {
    event.preventDefault()
    const amount = cashAmount(cash)
    if (amount === null) return
    const opening = { CASH: amount }
    await runCommand(
      'open',
      { desk, opening },
      (key) => openCashShift(desk, opening, key),
      (result) => {
        setOpenedShift(result)
        setCloseResult(null)
        setMessage('Turno abierto.')
      },
    )
  }

  const close = async (shift: CashShift) => {
    const currentShift = shifts.find(({ id }) => id === shift.id)
    if (!currentShift || !isCashShiftEligible(currentShift, user)) {
      setCommandError(
        'El turno ya no está disponible para cierre normal. Actualizá los turnos e intentá de nuevo.',
      )
      return
    }
    const amount = cashAmount(counted)
    if (amount === null) return
    const closing = { CASH: amount }
    await runCommand(
      'close',
      { shiftId: shift.id, closing, reason },
      (key) => closeCashShift(shift.id, closing, reason, key),
      (result) => {
        setClosedIds((ids) => [...ids, shift.id])
        setCloseResult(result)
        setMessage('Turno cerrado.')
      },
    )
  }

  const isOwnShift = (shift: CashShift) => shift.assigned_operator_id === user!.operator_id
  const canReturnToCollections =
    cashContext &&
    [...shifts, ...(openedShift ? [openedShift] : [])].some(
      (shift) => !closedIds.includes(shift.id) && isCashShiftEligible(shift, user),
    )
  const collectionsHref =
    cashContext && canReturnToCollections
      ? buildCashContextHref('/collections', cashContext.memberId, cashContext.obligationIds)
      : null
  const expired = (shift: CashShift) => isCashShiftExpired(shift)
  const recoverableShifts = shifts
    .filter(expired)
    .filter((shift) => canOperateCashShift(shift, user))

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
    const amount = cashAmount(counted, setRecoveryError)
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

  return (
    <main className="space-y-6" aria-labelledby="treasury-title">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Tesorería</p>
        <h1 id="treasury-title" className="font-display text-2xl font-bold text-ink-900">
          Caja
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Abrí, conciliá y cerrá los turnos asignados sin exponer evidencia privada de pagos.
        </p>
      </header>
      {query.isPending && <p role="status">Cargando turnos de caja…</p>}
      {query.isError && <p role="alert">No se pudieron cargar los turnos de caja.</p>}
      {commandError && <p role="alert">{commandError}</p>}
      {message && <p role="status">{message}</p>}
      {closeResult && (
        <section aria-label="Resumen de conciliación" className="space-y-2 rounded border p-4">
          <h2 className="font-display text-lg">Último cierre confirmado</h2>
          <CashCloseSummary close={closeResult} />
        </section>
      )}
      {refreshWarning && (
        <div>
          <p role="alert">{refreshWarning}</p>
          <button type="button" onClick={() => void retryRefresh()} disabled={recoveryPending}>
            Actualizar turnos
          </button>
        </div>
      )}
      {collectionsHref && (
        <button type="button" onClick={() => router.push(collectionsHref)}>
          Volver a cobranza
        </button>
      )}
      <form
        onSubmit={open}
        aria-label="Abrir turno de caja"
        className="grid gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-3"
      >
        <label>
          Puesto
          <input
            className="mt-1 block w-full rounded border p-2"
            value={desk}
            disabled={locked}
            onChange={(event) => setDesk(event.target.value)}
          />
        </label>
        <label>
          Efectivo inicial (pesos)
          <PesoAmountInput
            className="mt-1 block w-full rounded border p-2"
            maxLength={32}
            value={cash}
            parseCents={parseCashAmount}
            disabled={locked}
            onChange={(event) => setCash(event.target.value)}
          />
        </label>
        <button
          className="rounded bg-accent px-3 py-2 text-accent-foreground"
          type="submit"
          disabled={locked}
        >
          Abrir turno
        </button>
      </form>
      <p>
        Ingresá pesos sin separadores de miles, por ejemplo 15600. Los centavos son opcionales, con
        coma o punto decimal. El formato se aplica al salir del campo.
      </p>
      <p>El motivo es obligatorio si existe diferencia de efectivo.</p>
      <section
        aria-label="Cerrar turno de caja"
        className="grid gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-3"
      >
        <label>
          Efectivo contado (pesos)
          <PesoAmountInput
            className="mt-1 block w-full rounded border p-2"
            maxLength={32}
            value={counted}
            parseCents={parseCashAmount}
            disabled={locked}
            onChange={(event) => setCounted(event.target.value)}
          />
        </label>
        <label>
          Motivo de diferencia
          <input
            className="mt-1 block w-full rounded border p-2"
            value={reason}
            disabled={locked}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="space-y-2" aria-label="Turnos abiertos">
          {shifts.length === 0 && <p role="status">No hay turnos.</p>}
          {shifts
            .filter((shift) => isCashShiftEligible(shift, user))
            .map((shift) => (
              <button
                key={shift.id}
                type="button"
                className="rounded border px-3 py-2"
                disabled={locked}
                onClick={() => void close(shift)}
              >
                Cerrar {shift.desk_id} — {isOwnShift(shift) ? 'Tu turno' : 'Otro responsable'}
              </button>
            ))}
        </div>
      </section>
      <section aria-label="Turnos cerrados" className="space-y-2 rounded border p-4">
        <h2 className="font-display text-lg">Turnos cerrados</h2>
        <p>Consultá el detalle histórico de conciliación de los turnos cargados.</p>
        <ul className="space-y-2">
          {(query.data?.items ?? [])
            .filter(({ status }) => status === 'CLOSED')
            .map((shift) => (
              <li key={shift.id}>
                <strong>{shift.desk_id}</strong> —{' '}
                {isOwnShift(shift) ? 'Tu turno' : 'Otro responsable'}
                <p>
                  {closedAtLabel(shift.closed_at)} (hora local) · {shift.id}
                </p>
                <CashCloseHistoryDetail
                  key={owner}
                  shift={shift}
                  actorId={user?.operator_id}
                  role={user?.role}
                />
              </li>
            ))}
        </ul>
      </section>
      <section
        aria-label="Recuperación de turnos vencidos"
        className="grid gap-3 rounded-lg border border-danger/30 bg-surface p-4"
      >
        <h2 className="font-display text-lg font-semibold text-ink-900">Recuperar turno vencido</h2>
        <p className="text-sm text-ink-600">
          La recuperación está disponible después de 24 horas y requiere un motivo. El cierre normal
          se mantiene separado arriba.
        </p>
        {recoverableShifts.length === 0 && <p role="status">No hay turnos vencidos.</p>}
        {recoverableShifts.map((shift) => (
          <button
            key={shift.id}
            type="button"
            className="w-fit rounded border border-danger px-3 py-2"
            disabled={locked}
            onClick={() => {
              setRecoveryShift(shift)
              setRecoveryError('')
            }}
          >
            Recuperar turno vencido {shift.desk_id} —{' '}
            {isOwnShift(shift) ? 'Tu turno' : 'Otro responsable'}
          </button>
        ))}
      </section>
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
              Motivo de recuperación
              <input
                className="mt-1 block w-full rounded border p-2"
                required
                value={recoveryReason}
                onChange={(event) => setRecoveryReason(event.target.value)}
                disabled={recoveryPending}
              />
            </label>
            <div className="flex items-end gap-2">
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
                disabled={recoveryPending || !recoveryReason.trim()}
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
