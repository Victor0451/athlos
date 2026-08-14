'use client'

import { useCallback, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '@/components/ui/Modal'
import { notify } from '@/lib/notifications'
import { registerCtactePayment } from '@/lib/api/ctacte-mutations'
import { generateOpaqueIdempotencyKey } from '@/lib/idempotency-key'
import { applyFieldErrors } from './applyFieldErrors'

/**
 * CtactePaymentForm — modal body for "Registrar Pago" on the cuenta-corriente
 * detail page (PR A2 — athlos-ctacte-mutations).
 *
 * Uses react-hook-form + zod for inline field validation:
 *   - monto  — number, must be > 0
 *   - fecha  — string matching YYYY-MM-DD
 *   - concepto — string, 1–500 chars
 *   - comprobante — optional File (PDF or image, drag-and-drop or file picker)
 *
 * On submit: builds FormData → POST via registerCtactePayment().
 * On success: notify('success', …) + calls onSuccess() + closes (parent controls open).
 * On error: notify('error', …) + modal stays open so the operator can retry.
 *
 * No role gate — any authenticated operator may register a payment.
 */

const paymentSchema = z.object({
  monto: z.coerce
    .number({ invalid_type_error: 'Monto: debe ser un número' })
    .positive('Monto: debe ser mayor a 0'),
  fecha: z
    .string()
    .min(1, 'Fecha: es obligatoria')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha: debe tener formato YYYY-MM-DD'),
  concepto: z
    .string()
    .min(1, 'Concepto: es obligatorio')
    .max(500, 'Concepto: no puede superar los 500 caracteres'),
})

type PaymentFormValues = z.infer<typeof paymentSchema>

interface CtactePaymentFormProps {
  /** Whether the modal is open. */
  open: boolean
  /** The socio/cuenta ID for the API call. */
  socioId: string
  /** Called on success after the server confirms the payment was registered. */
  onSuccess?: () => void
  /** Called when the operator clicks Cancel or the modal backdrop is dismissed. */
  onClose: () => void
}

export function CtactePaymentForm({ open, socioId, onSuccess, onClose }: CtactePaymentFormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<PaymentFormValues, unknown, PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { fecha: '', concepto: '' },
    mode: 'onSubmit',
  })
  const idempotencyKey = useRef<string | null>(null)

  const onSubmit = useCallback(
    async (values: PaymentFormValues) => {
      try {
        idempotencyKey.current ??= generateOpaqueIdempotencyKey()
        await registerCtactePayment(socioId, {
          monto: values.monto,
          fecha: values.fecha,
          concepto: values.concepto,
          ...(file ? { comprobante: file } : {}),
          idempotencyKey: idempotencyKey.current,
        })
        notify('success', 'Pago registrado')
        reset()
        setFile(null)
        idempotencyKey.current = null
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
        notify('error', 'No se pudo registrar el pago. Intente de nuevo.')
      }
    },
    [socioId, file, reset, onSuccess, onClose, setError],
  )

  const handleCancel = useCallback(() => {
    reset()
    setFile(null)
    idempotencyKey.current = null
    onClose()
  }, [reset, onClose])

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) {
      setFile(dropped)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
    }
  }

  return (
    <Modal
      open={open}
      title="Registrar Pago"
      dataTestid="ctacte-payment-modal"
      footer={
        <>
          <button
            type="button"
            onClick={handleCancel}
            className="min-h-11 rounded-md border border-ink-200 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:opacity-60"
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="ctacte-payment-form"
            disabled={isSubmitting}
            className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover disabled:opacity-60"
          >
            {isSubmitting ? 'Registrando…' : 'Registrar pago'}
          </button>
        </>
      }
    >
      <form
        id="ctacte-payment-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-5"
      >
        {/* Monto */}
        <div className="space-y-1">
          <label htmlFor="payment-monto" className="block text-sm font-medium text-ink-700">
            Monto <span className="text-danger">*</span>
          </label>
          <input
            id="payment-monto"
            type="number"
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(errors.monto) || undefined}
            aria-describedby={errors.monto ? 'payment-monto-error' : undefined}
            {...register('monto')}
            className="block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.monto && (
            <p id="payment-monto-error" role="alert" className="text-xs text-danger">
              {errors.monto.message}
            </p>
          )}
        </div>

        {/* Fecha */}
        <div className="space-y-1">
          <label htmlFor="payment-fecha" className="block text-sm font-medium text-ink-700">
            Fecha <span className="text-danger">*</span>
          </label>
          <input
            id="payment-fecha"
            type="date"
            aria-invalid={Boolean(errors.fecha) || undefined}
            aria-describedby={errors.fecha ? 'payment-fecha-error' : undefined}
            {...register('fecha')}
            className="block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.fecha && (
            <p id="payment-fecha-error" role="alert" className="text-xs text-danger">
              {errors.fecha.message}
            </p>
          )}
        </div>

        {/* Concepto */}
        <div className="space-y-1">
          <label htmlFor="payment-concepto" className="block text-sm font-medium text-ink-700">
            Concepto <span className="text-danger">*</span>
          </label>
          <textarea
            id="payment-concepto"
            rows={3}
            maxLength={500}
            aria-invalid={Boolean(errors.concepto) || undefined}
            aria-describedby={errors.concepto ? 'payment-concepto-error' : 'payment-concepto-hint'}
            {...register('concepto')}
            className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.concepto ? (
            <p id="payment-concepto-error" role="alert" className="text-xs text-danger">
              {errors.concepto.message}
            </p>
          ) : (
            <p id="payment-concepto-hint" className="text-xs text-ink-500">
              Máx. 500 caracteres
            </p>
          )}
        </div>

        {/* Comprobante — drag-and-drop or file picker */}
        <div className="space-y-1">
          <span className="block text-sm font-medium text-ink-700">
            Comprobante <span className="font-normal text-ink-500">(opcional)</span>
          </span>

          {/* Hidden file input + drag target */}
          <input
            id="payment-comprobante"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
            className="sr-only"
          />

          <div
            role="button"
            tabIndex={0}
            aria-label="Adjuntar comprobante — arrastre un archivo PDF o imagen, o haga clic para seleccionar"
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('payment-comprobante')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                document.getElementById('payment-comprobante')?.click()
              }
            }}
            data-testid="ctacte-payment-dropzone"
            className={`relative flex min-h-[80px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors duration-fast ${
              isDragging
                ? 'border-accent bg-accent/5'
                : 'border-ink-200 bg-surface hover:border-ink-300 hover:bg-surface-sunken/40'
            }`}
          >
            {file ? (
              <div className="flex items-center gap-3 text-sm text-ink-700">
                {file.type.startsWith('image/') ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt="Vista previa del comprobante"
                    className="h-12 w-12 rounded-md border border-ink-100 object-cover"
                    data-testid="ctacte-payment-preview"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border border-ink-100 bg-surface-sunken text-xs text-ink-500">
                    PDF
                  </div>
                )}
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-ink-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  aria-label="Quitar archivo"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
                  }}
                  className="ml-2 rounded-md px-2 py-1 text-xs text-ink-500 hover:bg-surface-sunken hover:text-ink-700"
                  data-testid="ctacte-payment-remove-file"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                Arrastre un PDF o imagen aquí, o{' '}
                <span className="font-medium text-accent underline">
                  haga clic para seleccionar
                </span>
              </p>
            )}
          </div>
        </div>
      </form>
    </Modal>
  )
}
