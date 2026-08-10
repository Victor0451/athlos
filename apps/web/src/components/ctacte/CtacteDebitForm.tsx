'use client'

import { useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '@/components/ui/Modal'
import { notify } from '@/lib/notifications'
import { registerCtacteDebit } from '@/lib/api/ctacte-mutations'
import { generateOpaqueIdempotencyKey } from '@/lib/idempotency-key'
import { applyFieldErrors } from './applyFieldErrors'

/**
 * CtacteDebitForm — modal body for "Registrar Débito" on the cuenta-corriente
 * detail page (PR A2 — athlos-ctacte-mutations).
 *
 * Uses react-hook-form + zod for inline field validation:
 *   - monto  — number, must be > 0
 *   - fecha  — string matching YYYY-MM-DD
 *   - motivo  — string, required
 *
 * On submit: POST via registerCtacteDebit().
 * On success: notify('success', …) + calls onSuccess() + closes.
 * On error: notify('error', …) + modal stays open.
 *
 * No role gate — any authenticated operator may register a débito.
 */

const debitSchema = z.object({
  monto: z.coerce
    .number({ invalid_type_error: 'Monto: debe ser un número' })
    .positive('Monto: debe ser mayor a 0'),
  fecha: z
    .string()
    .min(1, 'Fecha: es obligatoria')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha: debe tener formato YYYY-MM-DD'),
  motivo: z.string().min(1, 'Motivo: es obligatorio'),
})

type DebitFormValues = z.infer<typeof debitSchema>

interface CtacteDebitFormProps {
  open: boolean
  socioId: string
  onSuccess?: () => void
  onClose: () => void
}

export function CtacteDebitForm({ open, socioId, onSuccess, onClose }: CtacteDebitFormProps) {
  const idempotencyKeyRef = useRef<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<DebitFormValues, unknown, DebitFormValues>({
    resolver: zodResolver(debitSchema),
    defaultValues: { fecha: '', motivo: '' },
    mode: 'onSubmit',
  })

  const onSubmit = useCallback(
    async (values: DebitFormValues) => {
      try {
        idempotencyKeyRef.current ??= generateOpaqueIdempotencyKey()
        await registerCtacteDebit(socioId, {
          monto: values.monto,
          fecha: values.fecha,
          motivo: values.motivo,
          idempotencyKey: idempotencyKeyRef.current,
        })
        notify('success', 'Débito registrado')
        reset()
        idempotencyKeyRef.current = null
        onSuccess?.()
        onClose()
      } catch (err) {
        // R4 — surface server field errors inline via react-hook-form
        // `setError` while still firing the top-level failure toast
        // (toasts are NOT suppressed when inline errors render). When
        // the server returns no `details` (e.g., 500 INTERNAL_ERROR)
        // only the toast fires.
        const details = (err as { details?: unknown } | null | undefined)?.details
        applyFieldErrors(setError, details)
        notify(
          'error',
          err instanceof Error ? err.message : 'No se pudo registrar el débito. Intentá de nuevo.',
        )
      }
    },
    [socioId, reset, onSuccess, onClose, setError],
  )

  const handleCancel = useCallback(() => {
    reset()
    idempotencyKeyRef.current = null
    onClose()
  }, [reset, onClose])

  return (
    <Modal
      open={open}
      title="Registrar Débito"
      dataTestid="ctacte-debit-modal"
      footer={
        <>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="ctacte-debit-form"
            disabled={isSubmitting}
            className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Registrando…' : 'Registrar débito'}
          </button>
        </>
      }
    >
      <form
        id="ctacte-debit-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-5"
      >
        {/* Monto */}
        <div className="space-y-1">
          <label
            htmlFor="debit-monto"
            className="block font-display text-sm font-semibold text-ink-700"
          >
            Monto <span className="text-danger">*</span>
          </label>
          <input
            id="debit-monto"
            type="number"
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(errors.monto) || undefined}
            aria-describedby={errors.monto ? 'debit-monto-error' : undefined}
            {...register('monto')}
            className="block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.monto && (
            <p id="debit-monto-error" role="alert" className="text-sm text-danger">
              {errors.monto.message}
            </p>
          )}
        </div>

        {/* Fecha */}
        <div className="space-y-1">
          <label
            htmlFor="debit-fecha"
            className="block font-display text-sm font-semibold text-ink-700"
          >
            Fecha <span className="text-danger">*</span>
          </label>
          <input
            id="debit-fecha"
            type="date"
            aria-invalid={Boolean(errors.fecha) || undefined}
            aria-describedby={errors.fecha ? 'debit-fecha-error' : undefined}
            {...register('fecha')}
            className="block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.fecha && (
            <p id="debit-fecha-error" role="alert" className="text-sm text-danger">
              {errors.fecha.message}
            </p>
          )}
        </div>

        {/* Motivo */}
        <div className="space-y-1">
          <label
            htmlFor="debit-motivo"
            className="block font-display text-sm font-semibold text-ink-700"
          >
            Motivo <span className="text-danger">*</span>
          </label>
          <textarea
            id="debit-motivo"
            rows={3}
            aria-invalid={Boolean(errors.motivo) || undefined}
            aria-describedby={errors.motivo ? 'debit-motivo-error' : undefined}
            {...register('motivo')}
            className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.motivo && (
            <p id="debit-motivo-error" role="alert" className="text-sm text-danger">
              {errors.motivo.message}
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
