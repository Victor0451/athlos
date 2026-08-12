import type { ClubStatusInput, ClubStatusPeriod, DateWindow } from './types.ts'

const timezone = 'America/Argentina/Buenos_Aires'
function localDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)!.value
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) }
}
function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function plusDays(date: { year: number; month: number; day: number }, days: number) {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return iso(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate())
}

export function resolvePeriod(
  period: ClubStatusPeriod = 'current-month',
  now = new Date(),
): DateWindow {
  const today = localDate(now)
  if (period === 'current-month')
    return {
      period,
      from: iso(today.year, today.month, 1),
      until: iso(
        today.year + (today.month === 12 ? 1 : 0),
        today.month === 12 ? 1 : today.month + 1,
        1,
      ),
    }
  return {
    period,
    from: plusDays(today, period === 'last-60-days' ? -59 : -89),
    until: plusDays(today, 1),
  }
}

export async function buildClubStatus(input: ClubStatusInput) {
  const window = resolvePeriod(input.period, input.now)
  const [active, finance] = await Promise.all([
    input.repo.activeMembership(),
    input.role === 'ADMIN' || input.role === 'TESORERO'
      ? input.repo.finance(window)
      : Promise.resolve(undefined),
  ])
  const unavailable =
    input.role === 'OPERADOR'
      ? ['regularization.workload']
      : ['delinquency.count', 'dataQuality.issueCount', 'systemState']
  return {
    period: window.period,
    generatedAt: input.now.toISOString(),
    membership: { active },
    freshness: input.freshness.map(({ domain, status, lastImportAt }) => ({
      domain,
      status,
      lastImportAt,
    })),
    unavailable,
    ...(finance ? { finance } : {}),
  }
}
