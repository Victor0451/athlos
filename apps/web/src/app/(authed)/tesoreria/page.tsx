'use client'

import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  closeCashShift,
  forceCloseCashShift,
  getCashShifts,
  openCashShift,
  type CashShift,
} from '@/lib/api/treasury'
import { useAuth } from '@/lib/use-auth'
import { useFeatureConfig } from '@/lib/features'

export default function TreasuryPage() {
  const { user } = useAuth()
  const { cashEnabled } = useFeatureConfig()
  const allowed = user?.role === 'ADMIN' || user?.role === 'TESORERO'
  const [desk, setDesk] = useState('front-desk')
  const [cash, setCash] = useState('0')
  const [counted, setCounted] = useState('0')
  const [reason, setReason] = useState('')
  const [recoveryReason, setRecoveryReason] = useState('')
  const [recoveryShift, setRecoveryShift] = useState<CashShift | null>(null)
  const [recoveryPending, setRecoveryPending] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [message, setMessage] = useState('')
  const [commandError, setCommandError] = useState('')
  const query = useQuery({
    queryKey: ['cash-shifts'],
    queryFn: getCashShifts,
    enabled: allowed && cashEnabled,
  })

  if (!cashEnabled) return <div role="alert">Cash desk is currently disabled.</div>
  if (!allowed) return <div role="alert">You do not have permission to operate the cash desk.</div>

  const shifts = query.data?.items ?? []
  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Cash desk command failed'

  const open = async (event: FormEvent) => {
    event.preventDefault()
    setCommandError('')
    try {
      await openCashShift(desk, { CASH: Number(cash) }, crypto.randomUUID())
      setMessage('Shift opened.')
      await query.refetch?.()
    } catch (error) {
      setCommandError(errorMessage(error))
    }
  }

  const close = async (shift: CashShift) => {
    setCommandError('')
    try {
      const result = await closeCashShift(
        shift.id,
        { CASH: Number(counted) },
        reason,
        crypto.randomUUID(),
      )
      setMessage(
        Object.keys(result.discrepancy).length
          ? `Discrepancy: ${JSON.stringify(result.discrepancy)}`
          : 'Shift closed.',
      )
      await query.refetch?.()
    } catch (error) {
      setCommandError(errorMessage(error))
    }
  }

  const expired = (shift: CashShift) =>
    shift.status === 'OPEN' &&
    Boolean(shift.opened_at) &&
    Date.now() >= new Date(shift.opened_at!).getTime() + 24 * 60 * 60 * 1000

  const confirmRecovery = async (event: FormEvent) => {
    event.preventDefault()
    if (!recoveryShift || !recoveryReason.trim()) return
    setRecoveryPending(true)
    setRecoveryError('')
    try {
      await forceCloseCashShift(
        recoveryShift.id,
        { CASH: Number(counted) },
        recoveryReason.trim(),
        crypto.randomUUID(),
      )
      setRecoveryShift(null)
      setRecoveryReason('')
      setMessage('Expired shift recovered and closed.')
      await query.refetch?.()
    } catch (error) {
      setRecoveryError(errorMessage(error))
    } finally {
      setRecoveryPending(false)
    }
  }

  return (
    <main className="space-y-6" aria-labelledby="treasury-title">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Treasury</p>
        <h1 id="treasury-title" className="font-display text-2xl font-bold text-ink-900">
          Cash desk
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Open, reconcile, and close assigned shifts without exposing private settlement evidence.
        </p>
      </header>
      {query.isPending && <p role="status">Loading cash shifts…</p>}
      {query.isError && <p role="alert">Unable to load cash shifts.</p>}
      {commandError && <p role="alert">{commandError}</p>}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={open}
        aria-label="Open cash shift"
        className="grid gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-3"
      >
        <label>
          Desk
          <input
            className="mt-1 block w-full rounded border p-2"
            value={desk}
            onChange={(event) => setDesk(event.target.value)}
          />
        </label>
        <label>
          Opening cash (cents)
          <input
            className="mt-1 block w-full rounded border p-2"
            inputMode="numeric"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
          />
        </label>
        <button className="rounded bg-accent px-3 py-2 text-accent-foreground" type="submit">
          Open shift
        </button>
      </form>
      <section
        aria-label="Close cash shift"
        className="grid gap-3 rounded-lg border border-ink-100 bg-surface p-4 sm:grid-cols-3"
      >
        <label>
          Counted cash (cents)
          <input
            className="mt-1 block w-full rounded border p-2"
            inputMode="numeric"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
          />
        </label>
        <label>
          Discrepancy reason
          <input
            className="mt-1 block w-full rounded border p-2"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="space-y-2" aria-label="Open shifts">
          {shifts.length === 0 && <p role="status">No shifts</p>}
          {shifts
            .filter((shift) => shift.status === 'OPEN' && !expired(shift))
            .map((shift) => (
              <button
                key={shift.id}
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => void close(shift)}
              >
                Close {shift.desk_id}
              </button>
            ))}
        </div>
      </section>
      <section
        aria-label="Expired shift recovery"
        className="grid gap-3 rounded-lg border border-danger/30 bg-surface p-4"
      >
        <h2 className="font-display text-lg font-semibold text-ink-900">Expired shift recovery</h2>
        <p className="text-sm text-ink-600">
          Recovery is available only after 24 hours and requires a reason. Normal close remains
          separate above.
        </p>
        {shifts.filter(expired).length === 0 && <p role="status">No expired shifts</p>}
        {shifts.filter(expired).map((shift) => (
          <button
            key={shift.id}
            type="button"
            className="w-fit rounded border border-danger px-3 py-2"
            onClick={() => {
              setRecoveryShift(shift)
              setRecoveryError('')
            }}
          >
            Recover expired shift {shift.desk_id}
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
            Confirm expired shift recovery
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            This permanently closes the expired shift for {recoveryShift.desk_id} and records the
            recovery reason in the audit log.
          </p>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          <form onSubmit={confirmRecovery} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              Recovery reason
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
                Cancel recovery
              </button>
              <button
                type="submit"
                className="rounded bg-danger px-3 py-2 text-white disabled:opacity-50"
                disabled={recoveryPending || !recoveryReason.trim()}
                aria-busy={recoveryPending}
              >
                {recoveryPending ? 'Recovering…' : 'Confirm recovery'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
