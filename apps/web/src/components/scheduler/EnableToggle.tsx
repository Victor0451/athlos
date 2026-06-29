'use client'

import { useState } from 'react'
import { setSchedulerJobEnabled } from '@/lib/api/scheduler'

/**
 * EnableToggle — enable/disable switch for a scheduler job (TASK-034, PR 8c.1).
 *
 * The /admin/scheduler/<name> detail page's secondary action. Per
 * the spec:
 *   - Toggle OFF → PATCH /scheduler/jobs/<name> with { enabled: false }
 *   - Toggle ON  → PATCH /scheduler/jobs/<name> with { enabled: true }
 *   - On success: onToggled(newEnabled) fires so the parent can
 *     update from the response (no second GET round-trip)
 *   - On error: onError(message) fires; the switch visually
 *     reverts (controlled by the parent's `enabled` prop)
 *
 * The toggle is rendered as a labelled `<button role="switch">`
 * (Gorriti-Premium-styled) rather than a native checkbox so the
 * visual treatment can stay in lock-step with the rest of the
 * design system.
 */

export interface EnableToggleProps {
  jobName: string
  enabled: boolean
  onToggled: (newEnabled: boolean) => void
  onError: (message: string) => void
}

export function EnableToggle({ jobName, enabled, onToggled, onError }: EnableToggleProps) {
  const [isPending, setIsPending] = useState(false)

  async function toggle() {
    if (isPending) return
    const nextEnabled = !enabled
    setIsPending(true)
    try {
      const response = await setSchedulerJobEnabled(jobName, nextEnabled)
      onToggled(response.enabled)
    } catch {
      onError('No se pudo cambiar el estado del trabajo. Intentá nuevamente.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex items-center gap-3" data-testid="enable-toggle">
      <span className="font-mono text-xs text-ink-500">{jobName}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Deshabilitar' : 'Habilitar'} ${jobName}`}
        disabled={isPending}
        onClick={() => void toggle()}
        data-testid="enable-toggle-switch"
        className={[
          'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full',
          'transition-colors duration-fast',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          enabled ? 'bg-success' : 'bg-ink-200',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-fast',
            enabled ? 'translate-x-6' : 'translate-x-1',
          ].join(' ')}
        />
      </button>
    </div>
  )
}
