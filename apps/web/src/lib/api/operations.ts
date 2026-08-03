import { apiFetch } from '@/lib/api'

export type OperationalReadiness = 'ready' | 'unavailable'
export type FreshnessStatus = 'current' | 'stale' | 'unknown'

export interface OperationalSnapshot {
  readiness: {
    overall: OperationalReadiness
    db: OperationalReadiness
    schema: OperationalReadiness
  }
  freshness: {
    available: boolean
    items: Array<{
      domain: string
      lastImportAt: string | null
      recordCount: number
      status: FreshnessStatus
      ageDisplay: string
    }>
  }
  jobs: {
    available: boolean
    items: Array<{
      name: string
      enabled: boolean
      healthy: boolean
      cronExpr: string
      lastRun: { startedAt: string | null } | null
    }>
  }
  attention: {
    available: boolean
    items: Array<{
      id: string
      jobName: string
      status: string
      startedAt: string | null
      durationMs: number | null
      reason: { code: string; message: string } | null
    }>
  }
}

export function getOperationalSnapshot(): Promise<OperationalSnapshot> {
  return apiFetch<OperationalSnapshot>('/api/v1/admin/operations/snapshot')
}
