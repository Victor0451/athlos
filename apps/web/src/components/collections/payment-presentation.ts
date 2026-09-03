const utcDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`)

export const formatObligationPeriod = (periodStart: string) =>
  new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(periodStart))

const formatBusinessDate = (businessDate: string) =>
  new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(businessDate))

export const formatShiftOption = (index: number, businessDate: string) =>
  `Turno ${index} · ${formatBusinessDate(businessDate)}`
