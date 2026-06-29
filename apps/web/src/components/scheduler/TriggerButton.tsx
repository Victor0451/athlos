'use client'

import { useState } from 'react'
import { triggerSchedulerJob } from '@/lib/api/scheduler'

/**
 * TriggerButton — "Disparar ahora" with confirm dialog (TASK-034, PR 8c.1).
 *
 * The /admin/scheduler/<name> detail page's primary action button.
 * Per the spec, triggering a manual run is an ADMIN-only, rate-
 * limited (1/min/operator), and must be confirmed before firing.
 *
 * Flow:
 *   1. Operator clicks "Disparar ahora"
 *   2. Dialog appears with job name + Confirmar / Cancelar
 *   3. On Confirmar: triggerSchedulerJob(name) is called
 *   4. On success: dialog closes, onTriggered() fires so the
 *      parent page can refetch the recent runs
 *   5. On 429: dialog stays open with the rate-limit message
 *      (spec: "Espera N segundos antes de volver a disparar")
 *   6. On any other ApiError: dialog stays open with a generic
 *      error message; the operator can cancel and retry
 *
 * The dialog is rendered inline (no portal) — the spec is a
 * simple confirmation, not a Modal-with-backdrop, and keeping
 * the markup local makes the page's role + z-index story
 * straightforward.
 */

const RATE_LIMIT_MESSAGE = 'Espera unos segundos antes de volver a disparar.'
const GENERIC_ERROR_MESSAGE = 'No se pudo disparar la corrida. Intentá nuevamente.'

export interface TriggerButtonProps {
  jobName: string
  onTriggered: () => void
  /** Disable the trigger (e.g. when the job is currently running). */
  disabled?: boolean
}

export function TriggerButton({ jobName, onTriggered, disabled = false }: TriggerButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function open() {
    setErrorMessage(null)
    setIsOpen(true)
  }

  function cancel() {
    if (isPending) return
    setIsOpen(false)
    setErrorMessage(null)
  }

  async function confirm() {
    setIsPending(true)
    setErrorMessage(null)
    try {
      await triggerSchedulerJob(jobName)
      setIsOpen(false)
      onTriggered()
    } catch (err) {
      // Duck-typed status check (works for both real ApiError and
      // the test's Object.assign mocks). The 429 branch is the
      // spec's "Espera N segundos" copy; anything else falls back
      // to the generic message.
      const status = (err as { status?: number })?.status
      if (status === 429) {
        setErrorMessage(RATE_LIMIT_MESSAGE)
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE)
      }
    } finally {
      setIsPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        data-testid="trigger-now-button"
        className="rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        Disparar ahora
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`trigger-dialog-${jobName}-title`}
          aria-describedby={`trigger-dialog-${jobName}-body`}
          data-testid="trigger-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
            <h2
              id={`trigger-dialog-${jobName}-title`}
              className="font-display text-lg font-semibold text-ink-900"
            >
              Disparar corrida manual
            </h2>
            <p
              id={`trigger-dialog-${jobName}-body`}
              className="mt-2 font-body text-sm text-ink-700"
            >
              Vas a disparar una corrida manual de{' '}
              <span className="font-mono font-semibold">{jobName}</span>. Esta acción queda
              registrada en el log de auditoría.
            </p>
            {errorMessage ? (
              <p
                role="alert"
                className="mt-3 rounded-md bg-danger/10 px-3 py-2 font-body text-sm text-danger"
                data-testid="trigger-dialog-error"
              >
                {errorMessage}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={isPending}
                className="rounded-md border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={isPending}
                data-testid="trigger-dialog-confirm"
                className="rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? 'Disparando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
