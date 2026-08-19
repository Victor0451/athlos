import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { MAX_MONEY_CENTS } from './allocations.ts'
import type { DuesTransaction } from './repository.ts'
import type { AuditContext } from './service.ts'

type DuesDb = Db | DuesTransaction
type Json = Record<string, unknown>
export type AgreementInstallment = { amountCents: number; dueDate: string }
export type AgreementTerms = { amountCents: number; installments: AgreementInstallment[] }
type AgreementRow = {
  id: string
  socioId: string
  obligationId: string
  kind: AgreementKind
  status: AgreementStatus
  revisionNumber: number
  terms: AgreementTerms
  reason: string
  agreementDate: string
  revisionOfAgreementId: string | null
}

export type AgreementKind = 'SIMPLE' | 'INSTALLMENT'
export type AgreementStatus = 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'SUPERSEDED'
export type Agreement = Omit<AgreementRow, 'reason'>
export type AgreementInput = {
  socioId: string
  obligationId: string
  kind: AgreementKind
  terms: Json
  agreementDate: string
  reason: string
  operatorId: string
  authorizationEvidence: Json
  callerKey: string
  requestFingerprint: string
}
type RescheduleInput = Omit<AgreementInput, 'socioId' | 'obligationId' | 'kind'> & {
  agreementId: string
}

const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const fields = sql`id,socio_id AS "socioId",obligation_id AS "obligationId",kind,status,revision_number AS "revisionNumber",terms,reason,agreement_date AS "agreementDate",revision_of_agreement_id AS "revisionOfAgreementId"`
const map = (row: AgreementRow): Agreement => ({
  id: row.id,
  socioId: row.socioId,
  obligationId: row.obligationId,
  kind: row.kind,
  status: row.status,
  revisionNumber: row.revisionNumber,
  terms: row.terms,
  agreementDate: row.agreementDate,
  revisionOfAgreementId: row.revisionOfAgreementId,
})

function dbCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function dbConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint)
    : undefined
}

function invalid(message: string): never {
  throw BusinessError(ErrorCode.VALIDATION_ERROR, message)
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateAgreementTerms(terms: Json, agreementDate: string): AgreementTerms {
  if (!isDateOnly(agreementDate)) invalid('Agreement date must be a valid date-only value')
  const amountCents = terms.amountCents
  const installments = terms.installments
  if (
    typeof amountCents !== 'number' ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    amountCents > MAX_MONEY_CENTS ||
    !Array.isArray(installments) ||
    installments.length < 1 ||
    installments.length > 60
  )
    invalid('Agreement terms must contain a supported amount and 1 to 60 installments')

  let sum = 0
  let previousDate: string | undefined
  for (const installment of installments) {
    if (
      installment === null ||
      typeof installment !== 'object' ||
      !Number.isSafeInteger(installment.amountCents) ||
      installment.amountCents <= 0 ||
      installment.amountCents > MAX_MONEY_CENTS ||
      !isDateOnly(installment.dueDate) ||
      installment.dueDate < agreementDate ||
      (previousDate !== undefined && installment.dueDate <= previousDate)
    )
      invalid(
        'Agreement installments must have increasing valid dates and positive integer amounts',
      )
    sum += installment.amountCents
    if (!Number.isSafeInteger(sum) || sum > MAX_MONEY_CENTS)
      invalid('Agreement installment sum is out of range')
    previousDate = installment.dueDate
  }
  if (sum !== amountCents) invalid('Agreement installment amounts must sum to the agreed amount')
  return { amountCents, installments }
}

function mapDatabaseError(error: unknown): never {
  if (dbCode(error) === '23503')
    throw BusinessError(ErrorCode.NOT_FOUND, 'Agreement reference was not found')
  if (
    dbCode(error) === '23505' &&
    dbConstraint(error) === 'dues_agreements_active_obligation_unique'
  )
    throw BusinessError(
      ErrorCode.CONFLICT,
      'An active agreement already exists for this obligation',
    )
  if (dbCode(error) === '23514') {
    if (dbConstraint(error) === 'dues_agreements_obligation_owner_check')
      throw BusinessError(ErrorCode.CONFLICT, 'Agreement obligation does not belong to the socio')
    if (dbConstraint(error) === 'dues_agreements_outstanding_check')
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Agreement amount exceeds outstanding obligation debt',
      )
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Agreement terms violate the approved contract')
  }
  if (dbCode(error) === '40001' || dbCode(error) === '40P01')
    throw BusinessError(ErrorCode.CONFLICT, 'Agreement changed concurrently')
  throw error
}

export async function findAgreement(db: DuesDb, id: string): Promise<Agreement | null> {
  return (
    rows<AgreementRow>(
      await db.execute(sql`SELECT ${fields} FROM tesoreria.dues_agreements WHERE id=${id}`),
    ).map(map)[0] ?? null
  )
}

export async function createAgreement(db: DuesDb, input: AgreementInput): Promise<Agreement> {
  try {
    const inserted = rows<AgreementRow>(
      await db.execute(
        sql`INSERT INTO tesoreria.dues_agreements (socio_id,obligation_id,kind,status,revision_number,terms,reason,revision_of_agreement_id,revision_reason,operator_id,authorization_evidence,caller_key,request_fingerprint,agreement_date) VALUES (${input.socioId},${input.obligationId},${input.kind},'ACTIVE',1,${JSON.stringify(input.terms)}::jsonb,${input.reason},NULL,NULL,${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${input.agreementDate}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING ${fields}`,
      ),
    )[0]
    if (inserted) return map(inserted)
    const existing = rows<AgreementRow & { requestFingerprint: string }>(
      await db.execute(
        sql`SELECT ${fields},request_fingerprint AS "requestFingerprint" FROM tesoreria.dues_agreements WHERE operator_id=${input.operatorId} AND caller_key=${input.callerKey}`,
      ),
    )[0]
    if (!existing)
      throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Agreement claim is unavailable')
    if (existing.requestFingerprint !== input.requestFingerprint)
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different agreement',
      )
    return map(existing)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      Object.prototype.hasOwnProperty.call(error, 'statusCode')
    )
      throw error
    return mapDatabaseError(error)
  }
}

export async function rescheduleAgreement(db: DuesDb, input: RescheduleInput): Promise<Agreement> {
  try {
    const reference = rows<{ obligationId: string }>(
      await db.execute(
        sql`SELECT obligation_id AS "obligationId" FROM tesoreria.dues_agreements WHERE id=${input.agreementId}`,
      ),
    )[0]
    if (!reference) throw BusinessError(ErrorCode.NOT_FOUND, 'Agreement not found')
    await db.execute(
      sql`SELECT id FROM tesoreria.dues_obligations WHERE id=${reference.obligationId} FOR UPDATE`,
    )
    const original = rows<AgreementRow>(
      await db.execute(
        sql`SELECT ${fields} FROM tesoreria.dues_agreements WHERE id=${input.agreementId} FOR UPDATE`,
      ),
    )[0]
    if (!original) throw BusinessError(ErrorCode.NOT_FOUND, 'Agreement not found')
    const existing = rows<AgreementRow & { requestFingerprint: string }>(
      await db.execute(
        sql`SELECT ${fields},request_fingerprint AS "requestFingerprint" FROM tesoreria.dues_agreements WHERE operator_id=${input.operatorId} AND caller_key=${input.callerKey}`,
      ),
    )[0]
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint)
        throw BusinessError(
          ErrorCode.CONFLICT,
          'Idempotency key was already used for a different agreement',
        )
      return map(existing)
    }
    if (original.status !== 'ACTIVE')
      throw BusinessError(ErrorCode.CONFLICT, 'Only active agreements can be rescheduled')
    const inserted = rows<AgreementRow>(
      await db.execute(
        sql`WITH superseded AS (UPDATE tesoreria.dues_agreements SET status='SUPERSEDED' WHERE id=${input.agreementId} AND status='ACTIVE' RETURNING socio_id,obligation_id,kind,reason,revision_number) INSERT INTO tesoreria.dues_agreements (socio_id,obligation_id,kind,status,revision_number,terms,reason,revision_of_agreement_id,revision_reason,operator_id,authorization_evidence,caller_key,request_fingerprint,agreement_date) SELECT socio_id,obligation_id,kind,'ACTIVE',revision_number + 1,${JSON.stringify(input.terms)}::jsonb,reason,${input.agreementId},${input.reason},${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${input.agreementDate} FROM superseded RETURNING ${fields}`,
      ),
    )[0]
    if (!inserted) throw BusinessError(ErrorCode.CONFLICT, 'Agreement changed concurrently')
    return map(inserted)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      Object.prototype.hasOwnProperty.call(error, 'statusCode')
    )
      throw error
    return mapDatabaseError(error)
  }
}

type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type AgreementRepository = {
  createAgreement: typeof createAgreement
  rescheduleAgreement: typeof rescheduleAgreement
}
type Dependencies = { repository?: AgreementRepository; audit?: AuditEmitter; now?: () => Date }
type Repository = AgreementRepository

export type AgreementCommand = AuditContext &
  Omit<
    AgreementInput,
    | 'operatorId'
    | 'authorizationEvidence'
    | 'callerKey'
    | 'requestFingerprint'
    | 'agreementDate'
    | 'status'
  >
export type RescheduleCommand = AuditContext & { agreementId: string; terms: Json; reason: string }

const authorize = (role: AuditContext['role']) => {
  if (role !== 'ADMIN' && role !== 'TESORERO')
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Agreement action is not authorized')
}
const dateOnly = (date: Date) => date.toISOString().slice(0, 10)

export class AgreementService {
  private readonly repository: Repository
  private readonly audit: AuditEmitter
  private readonly now: () => Date
  constructor(
    private readonly db: Db,
    dependencies: Dependencies = {},
  ) {
    this.repository = dependencies.repository ?? { createAgreement, rescheduleAgreement }
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }
  private async record(
    db: DuesDb,
    input: AuditContext,
    action: string,
    result: Agreement,
    reason: string,
  ) {
    await this.audit(db, {
      action,
      operatorId: input.actorId,
      entityType: 'dues_agreement',
      entityId: result.id,
      oldValue: null,
      newValue: {
        id: result.id,
        obligationId: result.obligationId,
        kind: result.kind,
        status: result.status,
        revisionNumber: result.revisionNumber,
        revisionOfAgreementId: result.revisionOfAgreementId,
      },
      sourceIp: input.sourceIp,
      callerKey: input.callerKey,
      metadata: {
        actorId: input.actorId,
        role: input.role,
        permissions: input.permissions,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
        time: this.now().toISOString(),
        reason,
      },
    })
  }
  async create(input: AgreementCommand) {
    authorize(input.role)
    const agreementDate = dateOnly(this.now())
    validateAgreementTerms(input.terms, agreementDate)
    return this.db.transaction(async (tx) => {
      const result = await this.repository.createAgreement(tx, {
        ...input,
        agreementDate,
        operatorId: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
      })
      await this.record(tx, input, AuditAction.DUES_AGREEMENT_CREATED, result, input.reason)
      return result
    })
  }
  async reschedule(input: RescheduleCommand) {
    authorize(input.role)
    const agreementDate = dateOnly(this.now())
    validateAgreementTerms(input.terms, agreementDate)
    return this.db.transaction(async (tx) => {
      const result = await this.repository.rescheduleAgreement(tx, {
        ...input,
        agreementDate,
        operatorId: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
      })
      await this.record(tx, input, AuditAction.DUES_AGREEMENT_REVISED, result, input.reason)
      return result
    })
  }
}
