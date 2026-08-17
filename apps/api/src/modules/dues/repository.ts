import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'

export type DuesTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DuesDb = Db | DuesTransaction
export type Period = { start: string; end: string }
type Json = Record<string, unknown>
type Receipt = { id: string; requestFingerprint: string; result: unknown }
const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const money = (cents: number) => (cents / 100).toFixed(2)
const cents = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}
type PriceKind = 'BASE' | 'SPORT'
type PriceRule = 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
// prettier-ignore
export type PriceInput = { kind: PriceKind; disciplinaId?: string | null; amountCents: number; currency?: string; effectiveFrom: string; effectiveTo?: string | null; rule: PriceRule; createdBy: string; authorizationEvidence: Json }
export type PriceRevocationInput = {
  priceVersionId: string
  revokedBy: string
  revokeReason: string
}
// prettier-ignore
export type BenefitKind = 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT' | 'SCHOLARSHIP'
// prettier-ignore
export type BenefitInput = { kind: BenefitKind; socioId?: string | null; familyGroupId?: string | null; amountCents?: number | null; percentage?: number | null; currency?: string; effectiveFrom: string; effectiveTo?: string | null; reason: string; createdBy: string; authorizationEvidence: Json }
// prettier-ignore
export type BenefitRevocationInput = { benefitId: string; revokedBy: string; revokeReason: string }
type PriceMutationRow = {
  id: string
  kind: PriceKind
  disciplinaId: string | null
  amount: string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  rule: PriceRule
  createdBy: string
  authorizationEvidence: Json
  createdAt: Date
  revokedAt: Date | null
  revokedBy: string | null
  revokeReason: string | null
}
const priceFields = sql`id, kind, disciplina_id AS "disciplinaId", amount::text, btrim(currency) AS currency, effective_from AS "effectiveFrom", effective_to AS "effectiveTo", rule, created_by AS "createdBy", authorization_evidence AS "authorizationEvidence", created_at AS "createdAt", revoked_at AS "revokedAt", revoked_by AS "revokedBy", revoke_reason AS "revokeReason"`
const toCreatedPrice = (row: PriceMutationRow) => ({ ...row, amountCents: cents(row.amount) })
// prettier-ignore
type BenefitMutationRow = { id: string; kind: BenefitKind; socioId: string | null; familyGroupId: string | null; amount: string | null; percentage: string | null; currency: string; effectiveFrom: string; effectiveTo: string | null; reason: string; authorizationEvidence: Json; createdBy: string; createdAt: Date; revokedAt: Date | null; revokedBy: string | null; revokeReason: string | null }
// prettier-ignore
const benefitFields = sql`id, kind, socio_id AS "socioId", family_group_id AS "familyGroupId", amount::text, percentage::text, btrim(currency) AS currency, effective_from AS "effectiveFrom", effective_to AS "effectiveTo", reason, authorization_evidence AS "authorizationEvidence", created_by AS "createdBy", created_at AS "createdAt", revoked_at AS "revokedAt", revoked_by AS "revokedBy", revoke_reason AS "revokeReason"`
// prettier-ignore
const benefitListFields = sql`b.id, b.kind, b.socio_id AS "socioId", b.family_group_id AS "familyGroupId", b.amount::text, b.percentage::text, btrim(b.currency) AS currency, b.effective_from AS "effectiveFrom", b.effective_to AS "effectiveTo", b.reason, b.authorization_evidence AS "authorizationEvidence", b.created_by AS "createdBy", b.created_at AS "createdAt", b.revoked_at AS "revokedAt", b.revoked_by AS "revokedBy", b.revoke_reason AS "revokeReason"`
// prettier-ignore
const toBenefit = (row: BenefitMutationRow) => ({ ...row, scope: row.socioId ? 'MEMBER' as const : 'FAMILY' as const, amountCents: row.amount === null ? null : cents(row.amount), percentage: row.percentage === null ? null : Number(row.percentage) })
function dbCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}
function mapPriceMutationError(error: unknown): never {
  if (error instanceof BusinessError) throw error
  switch (dbCode(error)) {
    case '23P01':
    case '23505':
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Price effective interval conflicts with an active version',
      )
    case '23503':
      throw BusinessError(
        ErrorCode.NOT_FOUND,
        'Referenced price operator or discipline was not found',
      )
    case '23514':
    case '22P02':
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Price version violates pricing rules')
    default:
      throw error
  }
}
// prettier-ignore
function mapBenefitError(error: unknown): never {
  if (error instanceof BusinessError) throw error
  if (dbCode(error) === '23P01') throw BusinessError(ErrorCode.CONFLICT, 'Benefit effective interval conflicts with an active rule')
  if (dbCode(error) === '23503') throw BusinessError(ErrorCode.NOT_FOUND, 'Referenced benefit member or family group was not found')
  if (dbCode(error) === '23514' || dbCode(error) === '22P02') throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Benefit rule violates benefit constraints')
  throw error
}
export async function createPrice(db: DuesDb, input: PriceInput) {
  try {
    const row = rows<PriceMutationRow>(
      await db.execute(
        sql`INSERT INTO tesoreria.dues_price_versions (kind, disciplina_id, amount, currency, effective_from, effective_to, rule, created_by, authorization_evidence) VALUES (${input.kind}, ${input.disciplinaId ?? null}, ${money(input.amountCents)}, ${input.currency ?? 'ARS'}, ${input.effectiveFrom}, ${input.effectiveTo ?? null}, ${input.rule}, ${input.createdBy}, ${JSON.stringify(input.authorizationEvidence)}::jsonb) RETURNING ${priceFields}`,
      ),
    )[0]
    if (!row) throw BusinessError(ErrorCode.INTERNAL_ERROR, 'price insert returned no row')
    return toCreatedPrice(row)
  } catch (error) {
    return mapPriceMutationError(error)
  }
}
export async function revokePrice(db: DuesDb, input: PriceRevocationInput) {
  try {
    let row = rows<PriceMutationRow>(
      await db.execute(
        sql`UPDATE tesoreria.dues_price_versions SET revoked_at = now(), revoked_by = ${input.revokedBy}, revoke_reason = ${input.revokeReason} WHERE id = ${input.priceVersionId} AND revoked_at IS NULL RETURNING ${priceFields}`,
      ),
    )[0]
    if (!row) {
      row = rows<PriceMutationRow>(
        await db.execute(
          sql`SELECT ${priceFields} FROM tesoreria.dues_price_versions WHERE id = ${input.priceVersionId}`,
        ),
      )[0]
    }
    if (!row) throw BusinessError(ErrorCode.NOT_FOUND, 'Price version not found')
    return toCreatedPrice(row)
  } catch (error) {
    return mapPriceMutationError(error)
  }
}

// prettier-ignore
export async function createBenefit(db: DuesDb, input: BenefitInput) {
  try {
    const row = rows<BenefitMutationRow>(await db.execute(sql`INSERT INTO tesoreria.dues_benefits (kind, socio_id, family_group_id, amount, percentage, currency, effective_from, effective_to, reason, created_by, authorization_evidence) VALUES (${input.kind}, ${input.socioId ?? null}, ${input.familyGroupId ?? null}, ${input.amountCents == null ? null : money(input.amountCents)}, ${input.percentage ?? null}, ${input.currency ?? 'ARS'}, ${input.effectiveFrom}, ${input.effectiveTo ?? null}, ${input.reason}, ${input.createdBy}, ${JSON.stringify(input.authorizationEvidence)}::jsonb) RETURNING ${benefitFields}`))[0]
    if (!row) throw BusinessError(ErrorCode.INTERNAL_ERROR, 'benefit insert returned no row')
    return toBenefit(row)
  } catch (error) { return mapBenefitError(error) }
}
// prettier-ignore
export async function revokeBenefit(db: DuesDb, input: BenefitRevocationInput) {
  try {
    let row = rows<BenefitMutationRow>(await db.execute(sql`UPDATE tesoreria.dues_benefits SET revoked_at = now(), revoked_by = ${input.revokedBy}, revoke_reason = ${input.revokeReason} WHERE id = ${input.benefitId} AND revoked_at IS NULL RETURNING ${benefitFields}`))[0]
    if (!row) row = rows<BenefitMutationRow>(await db.execute(sql`SELECT ${benefitFields} FROM tesoreria.dues_benefits WHERE id = ${input.benefitId}`))[0]
    if (!row) throw BusinessError(ErrorCode.NOT_FOUND, 'Benefit rule not found')
    return toBenefit(row)
  } catch (error) { return mapBenefitError(error) }
}
// prettier-ignore
export async function listApplicableBenefits(db: DuesDb, socioId: string, period: Period) {
  const result = await db.execute(sql`SELECT ${benefitListFields}, CASE WHEN b.socio_id IS NOT NULL THEN 'MEMBER' ELSE 'FAMILY' END AS scope FROM tesoreria.dues_benefits b LEFT JOIN tesoreria.dues_family_members fm ON fm.family_group_id = b.family_group_id AND fm.socio_id = ${socioId} WHERE b.revoked_at IS NULL AND b.effective_from <= ${period.start} AND (b.effective_to IS NULL OR b.effective_to > ${period.start}) AND (b.socio_id = ${socioId} OR fm.socio_id IS NOT NULL) ORDER BY CASE WHEN b.socio_id = ${socioId} THEN 0 ELSE 1 END, b.effective_from, b.id`)
  return rows<BenefitMutationRow & { scope: 'MEMBER' | 'FAMILY' }>(result).map(toBenefit)
}
// prettier-ignore
export type ReceiptInput = { operatorId: string; callerKey: string; requestFingerprint: string; periodStart: string; periodEnd: string; authorizationEvidence: Json }
export type ReceiptClaim =
  | { status: 'claimed'; receipt: Receipt }
  | { status: 'replayed'; receipt: Receipt; result: unknown }

export async function findReceipt(db: DuesDb, operatorId: string, callerKey: string) {
  const result = await db.execute(
    sql`SELECT id, request_fingerprint AS "requestFingerprint", result FROM tesoreria.dues_generation_receipts WHERE operator_id = ${operatorId} AND caller_key = ${callerKey} LIMIT 1`,
  )
  return rows<Receipt>(result)[0] ?? null
}
export async function claimReceipt(db: DuesDb, input: ReceiptInput): Promise<ReceiptClaim> {
  const inserted = rows<Receipt>(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_generation_receipts (operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES (${input.operatorId}, ${input.callerKey}, ${input.requestFingerprint}, ${input.periodStart}, ${input.periodEnd}, ${JSON.stringify(input.authorizationEvidence)}::jsonb) ON CONFLICT (operator_id, caller_key) DO NOTHING RETURNING id, request_fingerprint AS "requestFingerprint", result`,
    ),
  )[0]
  if (inserted) return { status: 'claimed', receipt: inserted }
  const existing = await findReceipt(db, input.operatorId, input.callerKey)
  if (!existing) throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Receipt claim is unavailable')
  if (existing.requestFingerprint !== input.requestFingerprint)
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Idempotency key was already used for a different request',
    )
  if (existing.result === null)
    throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Assessment receipt is still in flight')
  return { status: 'replayed', receipt: existing, result: existing.result }
}
export async function finalizeReceipt(
  db: DuesDb,
  receiptId: string,
  result: unknown,
): Promise<Receipt> {
  const current = rows<Receipt>(
    await db.execute(
      sql`SELECT id, request_fingerprint AS "requestFingerprint", result FROM tesoreria.dues_generation_receipts WHERE id = ${receiptId}`,
    ),
  )[0]
  if (!current) throw BusinessError(ErrorCode.NOT_FOUND, 'Generation receipt not found')
  if (current.result !== null && JSON.stringify(current.result) !== JSON.stringify(result))
    throw BusinessError(ErrorCode.CONFLICT, 'Generation receipt already has a different result')
  if (current.result !== null) return current
  const updated = rows<Receipt>(
    await db.execute(
      sql`UPDATE tesoreria.dues_generation_receipts SET result = ${JSON.stringify(result)}::jsonb, updated_at = now() WHERE id = ${receiptId} RETURNING id, request_fingerprint AS "requestFingerprint", result`,
    ),
  )[0]
  if (!updated) throw BusinessError(ErrorCode.NOT_FOUND, 'Generation receipt not found')
  return updated
}
export function lockPeriod(db: DuesDb, periodStart: string): Promise<unknown> {
  return db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${periodStart}))`)
}

// prettier-ignore
export type EligibleEnrollment = { id: string; disciplinaId: string; estado: string; fechaAlta: string; fechaBaja: string | null; eligibleFrom: string; eligibleTo: string }
// prettier-ignore
export type EligibleMember = { socioId: string; baseEligible: true; sports: EligibleEnrollment[] }
// prettier-ignore
type EnrollmentRow = { socioId: string; enrollmentId: string | null; disciplinaId: string | null; estado: string | null; fechaAlta: string | null; fechaBaja: string | null }
export async function listEligibleMembers(db: DuesDb, period: Period): Promise<EligibleMember[]> {
  const result = await db.execute(
    sql`SELECT s.id AS "socioId", i.id AS "enrollmentId", i.disciplina_id AS "disciplinaId", i.estado, i.fecha_alta AS "fechaAlta", i.fecha_baja AS "fechaBaja" FROM socios.socios s LEFT JOIN deportes.inscripciones i ON i.socio_id = s.id AND i.estado IN ('activa', 'baja') AND i.fecha_alta < ${period.end} AND (i.fecha_baja IS NULL OR i.fecha_baja > ${period.start}) WHERE s.estado = 'activo' ORDER BY s.id, i.id`,
  )
  const members = new Map<string, EligibleMember>()
  for (const row of rows<EnrollmentRow>(result)) {
    const member = members.get(row.socioId) ?? {
      socioId: row.socioId,
      baseEligible: true,
      sports: [],
    }
    if (row.enrollmentId && row.fechaAlta) {
      const eligibleFrom = row.fechaAlta > period.start ? row.fechaAlta : period.start
      const eligibleTo = row.fechaBaja && row.fechaBaja < period.end ? row.fechaBaja : period.end
      if (eligibleFrom < eligibleTo)
        member.sports.push({
          id: row.enrollmentId,
          disciplinaId: row.disciplinaId!,
          estado: row.estado!,
          fechaAlta: row.fechaAlta,
          fechaBaja: row.fechaBaja,
          eligibleFrom,
          eligibleTo,
        })
    }
    members.set(row.socioId, member)
  }
  return [...members.values()]
}

// prettier-ignore
type PriceRow = { versionId: string; kind: 'BASE' | 'SPORT'; disciplinaId: string | null; amount: string; currency: string; rule: 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'; effectiveFrom: string; effectiveTo: string | null }
export async function listEffectivePrices(db: DuesDb, period: Period) {
  const result = await db.execute(
    sql`SELECT id AS "versionId", kind, disciplina_id AS "disciplinaId", amount::text, btrim(currency) AS currency, rule, effective_from AS "effectiveFrom", effective_to AS "effectiveTo" FROM tesoreria.dues_price_versions WHERE revoked_at IS NULL AND effective_from <= ${period.start} AND (effective_to IS NULL OR effective_to > ${period.start}) ORDER BY kind, disciplina_id`,
  )
  const prices = rows<PriceRow>(result).map((row) => ({ ...row, amountCents: cents(row.amount) }))
  return {
    base: prices.filter((price) => price.kind === 'BASE'),
    sports: prices.filter((price) => price.kind === 'SPORT'),
  }
}

// prettier-ignore
export type ObligationComponentInput = { kind: 'BASE' | 'SPORT' | 'BENEFIT' | 'ADJUSTMENT'; componentKey: string; amountCents: number; priceVersionId?: string | null; benefitId?: string | null; disciplinaId?: string | null; enrollmentId?: string | null; unitAmountCents?: number | null; rule?: 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD' | null; eligibleFrom?: string | null; eligibleTo?: string | null; eligibleDays?: number | null; periodDays?: number | null; calculationInputs: Json; eligibilitySnapshot: Json; priceSnapshot: Json }
// prettier-ignore
export type ObligationInput = { periodStart: string; periodEnd: string; socioId: string; amountCents: number; generationReceiptId: string; actorId: string; snapshot: Json; authorizationEvidence: Json; components: ObligationComponentInput[] }
type StoredObligation = { id: string; snapshot: unknown }
async function insertObligationRows(db: DuesDb, input: ObligationInput) {
  const obligation = rows<StoredObligation>(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_obligations (socio_id, kind, period_start, period_end, amount, generation_receipt_id, snapshot, actor_id, authorization_evidence) VALUES (${input.socioId}, 'MONTHLY_DUES', ${input.periodStart}, ${input.periodEnd}, ${money(input.amountCents)}, ${input.generationReceiptId}, ${JSON.stringify(input.snapshot)}::jsonb, ${input.actorId}, ${JSON.stringify(input.authorizationEvidence)}::jsonb) RETURNING id, snapshot`,
    ),
  )[0]
  if (!obligation)
    throw BusinessError(ErrorCode.INTERNAL_ERROR, 'obligation insert returned no row')
  const values = input.components.map(
    (component) =>
      sql`(${obligation.id}, ${component.kind}, ${component.componentKey}, ${money(component.amountCents)}, ${component.priceVersionId ?? null}, ${component.benefitId ?? null}, ${component.disciplinaId ?? null}, ${component.enrollmentId ?? null}, ${component.unitAmountCents == null ? null : money(component.unitAmountCents)}, ${component.rule ?? null}, ${component.eligibleFrom ?? null}, ${component.eligibleTo ?? null}, ${component.eligibleDays ?? null}, ${component.periodDays ?? null}, ${JSON.stringify(component.calculationInputs)}::jsonb, ${JSON.stringify(component.eligibilitySnapshot)}::jsonb, ${JSON.stringify(component.priceSnapshot)}::jsonb)`,
  )
  const components = rows(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_obligation_components (obligation_id, kind, component_key, amount, price_version_id, benefit_id, disciplina_id, enrollment_id, unit_amount, rule, eligible_from, eligible_to, eligible_days, period_days, calculation_inputs, eligibility_snapshot, price_snapshot) VALUES ${sql.join(values, sql`, `)} RETURNING id, component_key AS "componentKey", calculation_inputs AS "calculationInputs", eligibility_snapshot AS "eligibilitySnapshot", price_snapshot AS "priceSnapshot"`,
    ),
  )
  return { obligation, components }
}
export function insertObligation(db: DuesDb, input: ObligationInput) {
  return db.transaction((tx) => insertObligationRows(tx, input))
}
export async function findObligation(db: DuesDb, socioId: string, periodStart: string) {
  const obligation = rows<StoredObligation>(
    await db.execute(
      sql`SELECT id, snapshot FROM tesoreria.dues_obligations WHERE socio_id = ${socioId} AND period_start = ${periodStart} AND kind = 'MONTHLY_DUES' LIMIT 1`,
    ),
  )[0]
  if (!obligation) return null
  const components = rows(
    await db.execute(
      sql`SELECT id, component_key AS "componentKey", calculation_inputs AS "calculationInputs", eligibility_snapshot AS "eligibilitySnapshot", price_snapshot AS "priceSnapshot" FROM tesoreria.dues_obligation_components WHERE obligation_id = ${obligation.id}`,
    ),
  )
  return { obligation, components }
}
