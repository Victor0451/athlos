'use client'

import { useEffect, useState } from 'react'
import { getClubStatus, type ClubStatus, type ClubStatusPeriod } from '@/lib/api/club-status'

const periods: Array<{ value: ClubStatusPeriod; label: string }> = [
  { value: 'current-month', label: 'Mes actual' },
  { value: 'last-60-days', label: 'Últimos 60 días' },
  { value: 'last-90-days', label: 'Últimos 90 días' },
]

const unavailableLabel: Record<string, string> = {
  'membership.active': 'Membresía no disponible',
  'regularization.workload': 'Regularización no disponible',
  systemState: 'Estado institucional no disponible',
}

function money(value: string) {
  return `$${value}`
}

export function ClubStatusDashboard() {
  const [period, setPeriod] = useState<ClubStatusPeriod>('current-month')
  const [data, setData] = useState<ClubStatus>()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setError(false)
    getClubStatus(period).then(
      (result) => active && setData(result),
      () => active && setError(true),
    )
    return () => {
      active = false
    }
  }, [period, retry])

  const unavailable = new Set(data?.unavailable ?? [])
  return (
    <section
      data-testid="club-status-dashboard"
      className="min-w-0 space-y-4"
      aria-label="Estado del club"
    >
      <div className="flex flex-col gap-3 border-b border-ink-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-ink-900">Estado del club</h2>
          <p className="text-sm text-ink-500">Resumen institucional autorizado por el servidor.</p>
        </div>
        <label className="grid gap-1 text-sm font-medium text-ink-700">
          Período financiero
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as ClubStatusPeriod)}
            className="min-h-11 rounded-md border border-ink-300 bg-surface-elevated px-3 text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {periods.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div role="alert" className="border border-danger p-3 text-sm text-ink-900">
          No se pudo actualizar el estado del club.{' '}
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="min-h-11 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reintentar
          </button>
        </div>
      ) : null}
      {!data && !error ? (
        <p role="status" aria-live="polite">
          Cargando estado del club
        </p>
      ) : null}
      {data ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.membership.active !== undefined ? (
            <article className="rounded-md border border-ink-300 bg-surface-elevated p-4">
              <p className="text-xs uppercase tracking-widest text-ink-500">Socios</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">
                {data.membership.active} socios activos
              </p>
            </article>
          ) : null}
          {unavailable.has('membership.active') ? (
            <p role="status">Membresía no disponible</p>
          ) : null}
          {data.finance ? (
            <>
              <article className="rounded-md border border-ink-300 bg-surface-elevated p-4">
                <p className="text-xs uppercase tracking-widest text-ink-500">Débitos</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">
                  {money(data.finance.debits)}
                </p>
              </article>
              <article className="rounded-md border border-ink-300 bg-surface-elevated p-4">
                <p className="text-xs uppercase tracking-widest text-ink-500">Créditos</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">
                  {money(data.finance.credits)}
                </p>
              </article>
              <article className="rounded-md border border-ink-300 bg-surface-elevated p-4">
                <p className="text-xs uppercase tracking-widest text-ink-500">Neto</p>
                <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink-900">
                  {money(data.finance.net)}
                </p>
              </article>
            </>
          ) : null}
          {data.unavailable.map((code) =>
            code !== 'membership.active' && unavailableLabel[code] ? (
              <p key={code} role="status">
                {unavailableLabel[code]}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
      {data ? (
        <div className="border-t border-ink-300 pt-3 text-sm text-ink-700">
          <p role="status">Actualizado</p>
          {data.freshness.length ? (
            data.freshness.map((item) => (
              <p key={item.domain}>
                {item.domain}: {item.status}
              </p>
            ))
          ) : (
            <p>Sin fuentes de actualización disponibles</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
