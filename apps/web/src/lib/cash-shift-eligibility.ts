import type { CurrentUser } from '@/lib/auth'
import type { CashShift } from '@/lib/api/treasury'

type CashShiftUser = Pick<CurrentUser, 'operator_id' | 'role'> | null

export type CashShiftAvailability =
  | 'ready'
  | 'identity_missing'
  | 'no_open'
  | 'only_foreign'
  | 'expired'
  | 'unavailable'

const maxOpenMilliseconds = 24 * 60 * 60 * 1000

const isCurrent = (shift: CashShift, now: Date) => {
  const openedAt = new Date(shift.opened_at).getTime()
  const currentTime = now.getTime()
  return (
    Number.isFinite(openedAt) &&
    Number.isFinite(currentTime) &&
    currentTime >= openedAt &&
    currentTime <= openedAt + maxOpenMilliseconds
  )
}

export const canOperateCashShift = (shift: CashShift, user: CashShiftUser) => {
  if (!user) return false
  return user.role === 'ADMIN' || shift.assigned_operator_id === user.operator_id
}

export const isCashShiftEligible = (shift: CashShift, user: CashShiftUser, now = new Date()) =>
  shift.status === 'OPEN' && canOperateCashShift(shift, user) && isCurrent(shift, now)

export const isCashShiftExpired = (shift: CashShift, now = new Date()) => {
  const openedAt = new Date(shift.opened_at).getTime()
  return (
    shift.status === 'OPEN' &&
    Number.isFinite(openedAt) &&
    Number.isFinite(now.getTime()) &&
    now.getTime() > openedAt + maxOpenMilliseconds
  )
}

export const eligibleCashShifts = (
  shifts: readonly CashShift[],
  user: CashShiftUser,
  now = new Date(),
) => shifts.filter((shift) => isCashShiftEligible(shift, user, now))

export const getCashShiftAvailability = (
  shifts: readonly CashShift[],
  user: CashShiftUser,
  now = new Date(),
): CashShiftAvailability => {
  if (!user?.operator_id) return 'identity_missing'
  const openShifts = shifts.filter(({ status }) => status === 'OPEN')
  if (!openShifts.length) return 'no_open'
  if (eligibleCashShifts(openShifts, user, now).length) return 'ready'
  if (
    user.role !== 'ADMIN' &&
    openShifts.every((shift) => shift.assigned_operator_id !== user.operator_id)
  )
    return 'only_foreign'
  return 'expired'
}

export const cashShiftAvailabilityMessage = (availability: CashShiftAvailability) => {
  switch (availability) {
    case 'identity_missing':
      return 'No se pudo identificar a la persona operadora para verificar los turnos de caja.'
    case 'no_open':
      return 'No hay turnos de caja abiertos.'
    case 'only_foreign':
      return 'Los turnos de caja abiertos están asignados a otro responsable.'
    case 'expired':
      return 'No hay un turno propio vigente: el turno está vencido o no tiene una fecha válida.'
    case 'unavailable':
      return 'No se pudieron cargar los turnos de caja abiertos.'
    default:
      return ''
  }
}
