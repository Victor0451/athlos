import { apiFetch } from '@/lib/api'

export type ClubStatusPeriod = 'current-month' | 'last-60-days' | 'last-90-days'

export interface ClubStatus {
  period: ClubStatusPeriod
  generatedAt: string
  membership: { active?: number }
  freshness: Array<{ domain: string; status: string; lastImportAt: string | null }>
  unavailable: string[]
  finance?: { debits: string; credits: string; net: string }
}

export function getClubStatus(period: ClubStatusPeriod = 'current-month'): Promise<ClubStatus> {
  return apiFetch<ClubStatus>('/api/v1/club-status', { query: { period } })
}
