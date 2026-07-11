'use client'

import { useCallback, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { notify } from '@/lib/notifications'
import { apiFetchBlob } from '@/lib/api'
import { getCtacteComprobanteUrl } from '@/lib/api/ctacte-mutations'
import { parseCapDetails, parseFieldErrors } from './applyFieldErrors'

/**
 * CtacteComprobanteButton — secondary variant button that opens a modal
 * with a date-range picker and generates a PDF comprobante (PR A2).
 *
 * Click → Modal with from/to date pickers + cuenta pre-fill → submit →
 *   getCtacteComprobanteUrl() → apiFetchBlob() → URL.createObjectURL(blob)
 *   → window.open(blobUrl, '_blank', 'noopener,noreferrer')
 *   → notify('success', 'Comprobante generado')
 *
 * Errors:
 *   - missing from/to → inline form error
 *   - from > to → inline form error
 *   - network failure → notify('error')
 */

interface CtacteComprobanteButtonProps {
  socioId: string
  cuenta: string
}

export function CtacteComprobanteButton({ socioId, cuenta }: CtacteComprobanteButtonProps) {
  const [open, setOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [errors, setErrors] = useState<{ from?: string; to?: string; submit?: string }>({})

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const idempotencyKey = useRef<string | null>(null)

  const handleOpen = useCallback(() => {
    setErrors({})
    setFrom('')
    setTo('')
    idempotencyKey.current = crypto.randomUUID()
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleGenerate = useCallback(async () => {
    // Client-side validation
    const newErrors: typeof errors = {}
    if (!from) newErrors.from = 'La fecha desde es obligatoria'
    if (!to) newErrors.to = 'La fecha hasta es obligatoria'
    if (from && to && from > to) {
      newErrors.to = 'La fecha hasta debe ser mayor o igual a la fecha desde'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setIsGenerating(true)
    try {
      const url = getCtacteComprobanteUrl(socioId, cuenta, from, to)
      const blob = await apiFetchBlob(url, {
        headers: { 'Idempotency-Key': idempotencyKey.current ?? crypto.randomUUID() },
      })
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
      notify('success', 'Comprobante generado')
      setOpen(false)
    } catch (err) {
      // R4 — comprobante surfaces TWO distinct server shapes:
      //   1. Cap-exceeded (R1.3 fix):
      //        { details: { cap: 50, requested: 51 } }
      //      Renders inline ('El rango excede el límite de 50
      //      movimientos.') plus a top-level error toast with the
      //      same message.
      //   2. Field-level (defense-in-depth):
      //        { details: [{ field: 'from', message: 'must be <= to' }] }
      //      Routes each entry to the matching aria-invalid + role=alert
      //      slot ('desde' or 'hasta') and fires the standard error toast.
      //
      // When the server returns no `details` (500) only the toast fires.
      const e = err as { details?: unknown } | null | undefined
      const cap = parseCapDetails(e?.details)
      const fieldEntries = parseFieldErrors(e?.details)
      if (cap) {
        const message = `El rango excede el límite de ${cap.cap} movimientos.`
        setErrors({ submit: message })
        notify('error', message)
      } else if (fieldEntries.length > 0) {
        const next: typeof errors = {}
        for (const entry of fieldEntries) {
          if (entry.field === 'from') next.from = entry.message
          else if (entry.field === 'to') next.to = entry.message
          else next.submit = entry.message
        }
        setErrors(next)
        notify('error', 'No se pudo generar el comprobante. Intentá de nuevo.')
      } else {
        setErrors({})
        notify('error', 'No se pudo generar el comprobante. Intentá de nuevo.')
      }
    } finally {
      setIsGenerating(false)
    }
  }, [socioId, cuenta, from, to])

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-1.5 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
        data-testid="ctacte-comprobante-btn"
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        Reimprimir Comprobante
      </button>

      <Modal
        open={open}
        title="Generar Comprobante"
        dataTestid="ctacte-comprobante-modal"
        footer={
          <>
            <button
              type="button"
              onClick={handleClose}
              disabled={isGenerating}
              className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? 'Generando…' : 'Generar PDF'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="font-body text-sm text-ink-500">
            Seleccioná el rango de fechas para generar el comprobante de cuenta corriente de{' '}
            <span className="font-medium text-ink-700">{cuenta}</span>.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* Desde */}
            <div className="space-y-1">
              <label
                htmlFor="comprobante-from"
                className="block font-display text-sm font-semibold text-ink-700"
              >
                Desde
              </label>
              <input
                id="comprobante-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setErrors(({ to }) => (to ? { to } : {}))
                }}
                aria-invalid={Boolean(errors.from) || undefined}
                aria-describedby={errors.from ? 'comprobante-from-error' : undefined}
                className="block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
              />
              {errors.from && (
                <p id="comprobante-from-error" role="alert" className="text-sm text-danger">
                  {errors.from}
                </p>
              )}
            </div>

            {/* Hasta */}
            <div className="space-y-1">
              <label
                htmlFor="comprobante-to"
                className="block font-display text-sm font-semibold text-ink-700"
              >
                Hasta
              </label>
              <input
                id="comprobante-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setErrors(({ from }) => (from ? { from } : {}))
                }}
                aria-invalid={Boolean(errors.to) || undefined}
                aria-describedby={errors.to ? 'comprobante-to-error' : undefined}
                className="block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
              />
              {errors.to && (
                <p id="comprobante-to-error" role="alert" className="text-sm text-danger">
                  {errors.to}
                </p>
              )}
            </div>
          </div>

          {errors.submit && (
            <p
              role="alert"
              className="rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-sm text-danger"
            >
              {errors.submit}
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
