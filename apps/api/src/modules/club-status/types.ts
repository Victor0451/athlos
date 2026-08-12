import type { DomainFreshness } from '@athlos/freshness'

export type ClubStatusPeriod = 'current-month' | 'last-60-days' | 'last-90-days'
export interface DateWindow {
  period: ClubStatusPeriod
  from: string
  until: string
}
export interface FinanceAggregate {
  debits: string
  credits: string
  net: string
}
export interface ClubStatusRepository {
  finance(window: Pick<DateWindow, 'from' | 'until'>): Promise<FinanceAggregate>
  activeMembership(): Promise<number>
}
export interface ClubStatusInput {
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  period?: ClubStatusPeriod
  now: Date
  repo: ClubStatusRepository
  freshness: DomainFreshness[]
}
