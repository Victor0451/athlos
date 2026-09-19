'use client'

import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

/**
 * Alert — Gorriti Premium inline feedback primitive.
 *
 * Inline banner for validation errors, command outcomes and contextual warnings:
 * soft tinted background, 4px left accent border and a leading lucide icon so
 * feedback is unmissable without shouting. Complements `Toast` (transient,
 * top-right) and `Badge` (status tags): use Alert whenever the message belongs
 * to a surface and must stay until the user acts or it is dismissed by flow.
 *
 * Tones and tokens (mirroring `Badge`):
 *   | tone    | bg            | accent border | icon            | ARIA role |
 *   |---------|---------------|---------------|-----------------|-----------|
 *   | error   | danger-soft   | danger        | AlertCircle     | alert     |
 *   | success | accent-soft   | accent        | CheckCircle2    | status    |
 *   | info    | info-soft     | info          | Info            | status    |
 *   | warning | warning-soft  | warning       | AlertTriangle   | alert     |
 *
 * `warning` uses role="alert" because it always precedes a required action
 * (e.g. a confirmed command whose refresh failed); plain `info` is passive.
 */

export type AlertTone = 'error' | 'success' | 'info' | 'warning'

const TONE_CLASSES: Record<AlertTone, { container: string; icon: string; Icon: typeof Info }> = {
  error: {
    container: 'border-danger bg-danger-soft',
    icon: 'text-danger',
    Icon: AlertCircle,
  },
  success: {
    container: 'border-accent bg-accent-soft',
    icon: 'text-accent',
    Icon: CheckCircle2,
  },
  info: {
    container: 'border-info bg-info-soft',
    icon: 'text-info',
    Icon: Info,
  },
  warning: {
    container: 'border-warning bg-warning-soft',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
}

interface AlertProps {
  tone: AlertTone
  children: ReactNode
  /** Extra classes on the container — e.g. `mt-3`. */
  className?: string
}

export function Alert({ tone, children, className = '' }: AlertProps) {
  const { container, icon, Icon } = TONE_CLASSES[tone]
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-md border-l-4 px-3 py-2.5 text-sm text-ink-900 ${container} ${className}`}
    >
      <Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
