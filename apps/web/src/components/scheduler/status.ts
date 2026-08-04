import type { StatusBadgeKind } from '@/components/cards/StatusBadge'
import type { SchedulerRunStatus } from '@/lib/api/scheduler'

const STATUS_LABELS: Record<SchedulerRunStatus, string> = {
  pending: 'Pendiente',
  running: 'En ejecución',
  succeeded: 'Completada',
  completed_with_review: 'Requiere revisión',
  failed: 'Fallida',
  dead_letter: 'Reintentos agotados',
  cancelled: 'Cancelada',
}

export function schedulerStatusLabel(status: SchedulerRunStatus): string {
  return STATUS_LABELS[status]
}

export function schedulerStatusBadgeKind(status: SchedulerRunStatus): StatusBadgeKind {
  switch (status) {
    case 'succeeded':
      return 'healthy'
    case 'failed':
    case 'dead_letter':
      return 'down'
    case 'pending':
    case 'running':
    case 'completed_with_review':
    case 'cancelled':
      return 'degraded'
  }
}
