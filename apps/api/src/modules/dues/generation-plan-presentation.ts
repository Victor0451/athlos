import { createGenerationPlanEntry, type GenerationPlanEntry } from './generation-plan-entry.ts'
import type {
  GenerationMember,
  GenerationPlanInput,
  GenerationPrice,
} from './generation-plan-fingerprint.ts'

type PresentationSummary = {
  eligibleCount: number
  readyCount: number
  newCount: number
  existingCount: number
  reviewCount: number
  conflictCount: number
  estimatedNewTotalCents: number
}

type PresentationMember = {
  memberNumber: string
  name: string
  status: string
  grossCents: number
  netCents: number
  configurationLabels: string[]
  summary: string
  details: string[]
}

export type GenerationPlanPresentation = {
  period: string
  currency: string
  configurations: Array<{
    label: string
    amountCents: number
    rule: string
    validity: string
  }>
  summary: PresentationSummary
  members: PresentationMember[]
}

const monthFormatter = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const formatMonth = (value: string) => monthFormatter.format(new Date(`${value}T00:00:00Z`))
const formatDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00Z`))
const formatAmount = (amountCents: number, currency: string) =>
  `${currency} ${(amountCents / 100).toFixed(2).replace('.', ',')}`

const ruleLabels = {
  FULL_MONTH: 'Mes completo',
  DAILY_PRORATED: 'Prorrateo diario',
  NEXT_PERIOD: 'Período siguiente',
} as const

const componentLabel = (componentKey: string, member: GenerationMember) =>
  componentKey === 'base'
    ? 'cuota base'
    : (member.sports.find((sport) => `sport:${sport.id}` === componentKey)?.label ?? 'disciplina')

const componentPrices = (
  componentKey: string,
  member: GenerationMember,
  prices: GenerationPrice[],
) =>
  componentKey === 'base'
    ? prices.filter((price) => price.kind === 'BASE')
    : prices.filter(
        (price) =>
          price.kind === 'SPORT' &&
          price.disciplineId ===
            member.sports.find((sport) => `sport:${sport.id}` === componentKey)?.disciplineId,
      )

const detailMessages = (
  entry: GenerationPlanEntry,
  member: GenerationMember,
  prices: GenerationPrice[],
  period: string,
) =>
  entry.issues.flatMap((issue) => {
    const label = componentLabel(issue.componentKey, member)
    if (issue.code === 'PRICE_GAP') {
      if (!componentPrices(issue.componentKey, member, prices).length)
        return [
          `Falta configurar un importe para ${issue.componentKey === 'base' ? 'la cuota base' : label} durante ${period}.`,
        ]
      return [
        `La configuración de ${label} no cubre el período comprendido entre ${formatDate(issue.from)} y ${formatDate(issue.to)}.`,
      ]
    }
    if (issue.code === 'PRICE_OVERLAP')
      return [
        `Hay más de un importe vigente para ${label} entre ${formatDate(issue.from)} y ${formatDate(issue.to)}. Revisá las fechas de vigencia.`,
      ]
    return []
  })

const memberStatus = (entry: GenerationPlanEntry) => {
  if (entry.status === 'READY') return 'Listo para generar'
  if (entry.status === 'CONFLICT') return 'Conflicto de configuración'
  if (entry.reviewCodes.includes('EXISTING_OBLIGATION')) return 'Obligación existente'
  return 'Requiere revisión'
}

const memberSummary = (entry: GenerationPlanEntry, currency: string) => {
  if (entry.status === 'READY')
    return `Se generará una nueva obligación por ${formatAmount(entry.netCents, currency)}.`
  if (entry.reviewCodes.includes('EXISTING_OBLIGATION'))
    return 'Ya existe una obligación para este período.'
  if (entry.reviewCodes.includes('ZERO_GROSS')) return 'No hay importe a generar para este período.'
  return 'Los beneficios dejan el importe neto en cero.'
}

const configurationLabels = (entry: GenerationPlanEntry, member: GenerationMember) =>
  entry.components.map((component) =>
    component.kind === 'BASE'
      ? 'Cuota social'
      : (member.sports.find((sport) => sport.id === component.enrollmentId)?.label ?? 'Disciplina'),
  )

export function createGenerationPlanPresentation(
  input: GenerationPlanInput,
  entries = input.members.map((member) =>
    createGenerationPlanEntry({
      period: input.period,
      currency: input.currency,
      prices: input.prices,
      member,
    }),
  ),
): GenerationPlanPresentation {
  const period = formatMonth(input.period.start)
  const members = entries.map((entry) => {
    const member = input.members.find((candidate) => candidate.id === entry.memberId)!
    return {
      memberNumber: member.memberNumber,
      name: member.label,
      status: memberStatus(entry),
      grossCents: entry.grossCents,
      netCents: entry.netCents,
      configurationLabels: configurationLabels(entry, member),
      summary: memberSummary(entry, input.currency),
      details: detailMessages(entry, member, input.prices, period),
    }
  })
  const summary = members.reduce<PresentationSummary>(
    (result, _member, index) => {
      const entry = entries[index]!
      return {
        eligibleCount:
          result.eligibleCount +
          Number(
            entry.components.some((component) => component.eligibleFrom < component.eligibleTo),
          ),
        readyCount: result.readyCount + Number(entry.status === 'READY'),
        newCount: result.newCount + Number(entry.status === 'READY'),
        existingCount:
          result.existingCount + Number(entry.reviewCodes.includes('EXISTING_OBLIGATION')),
        reviewCount:
          result.reviewCount +
          Number(entry.status === 'REVIEW' && !entry.reviewCodes.includes('EXISTING_OBLIGATION')),
        conflictCount: result.conflictCount + Number(entry.status === 'CONFLICT'),
        estimatedNewTotalCents:
          result.estimatedNewTotalCents + (entry.status === 'READY' ? entry.netCents : 0),
      }
    },
    {
      eligibleCount: 0,
      readyCount: 0,
      newCount: 0,
      existingCount: 0,
      reviewCount: 0,
      conflictCount: 0,
      estimatedNewTotalCents: 0,
    },
  )

  return {
    period,
    currency: input.currency,
    configurations: input.prices.map((price) => ({
      label: price.label,
      amountCents: price.amountCents,
      rule: ruleLabels[price.rule],
      validity: price.to
        ? `Desde el ${formatDate(price.from)} hasta el ${formatDate(price.to)}`
        : `Desde el ${formatDate(price.from)}`,
    })),
    summary,
    members,
  }
}
