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
export type LegacyAgreementTerms = { amountCents: number; installments: AgreementInstallment[] }
export type AgreementTerms = LegacyAgreementTerms
export type NegotiatedEvidenceV1 = {
  note?: string
  references?: string[]
  metadata?: Record<string, unknown>
}
export type NegotiatedCommitmentV1 = {
  id: string
  title: string
  description?: string
  dueDate?: string
  amountCents?: number
  evidence?: NegotiatedEvidenceV1
}
export type NegotiatedAgreementTermsV1 = {
  narrative: string
  commitments?: NegotiatedCommitmentV1[]
  evidence?: NegotiatedEvidenceV1
}
export type AgreementRepresentation =
  | { kind: 'SIMPLE' | 'INSTALLMENT'; termsVersion: 0; terms: LegacyAgreementTerms }
  | { kind: 'NEGOTIATED'; termsVersion: 1; terms: NegotiatedAgreementTermsV1 }
export type AgreementMutationResult = { outcome: 'created' | 'replayed'; agreement: Agreement }
type AgreementRow = {
  id: string
  socioId: string
  obligationId: string
  kind: AgreementKind
  status: AgreementStatus
  revisionNumber: number
  termsVersion: number
  terms: LegacyAgreementTerms | NegotiatedAgreementTermsV1
  reason: string
  revisionReason: string | null
  agreementDate: string
  revisionOfAgreementId: string | null
}

export type AgreementKind = 'SIMPLE' | 'INSTALLMENT' | 'NEGOTIATED'
export type AgreementStatus = 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'SUPERSEDED'
export type Agreement = AgreementRow
export type AgreementInput = {
  socioId: string
  obligationId: string
  kind: AgreementKind
  termsVersion: number
  terms: Json
  agreementDate: string
  reason: string
  operatorId: string
  authorizationEvidence: Json
  callerKey: string
  requestFingerprint: string
}
type RescheduleInput = Omit<
  AgreementInput,
  'socioId' | 'obligationId' | 'kind' | 'termsVersion'
> & {
  agreementId: string
}

const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const fields = sql`id,socio_id AS "socioId",obligation_id AS "obligationId",kind,status,revision_number AS "revisionNumber",terms_version AS "termsVersion",terms,reason,revision_reason AS "revisionReason",agreement_date AS "agreementDate",revision_of_agreement_id AS "revisionOfAgreementId"`
const map = (row: AgreementRow): Agreement => ({
  id: row.id,
  socioId: row.socioId,
  obligationId: row.obligationId,
  kind: row.kind,
  status: row.status,
  revisionNumber: row.revisionNumber,
  termsVersion: row.termsVersion,
  terms: row.terms,
  reason: row.reason,
  revisionReason: row.revisionReason,
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const octets = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function validateAgreementEvidence(value: unknown, label: string): NegotiatedEvidenceV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label} evidence must be an object`)
  const evidence = value as Json
  for (const key of Object.keys(evidence))
    if (key !== 'note' && key !== 'references' && key !== 'metadata')
      invalid(`${label} evidence contains an unsupported field`)
  if (octets(evidence) > 16384) invalid(`${label} evidence is outside the approved bounds`)
  if (
    evidence.note !== undefined &&
    (typeof evidence.note !== 'string' || evidence.note.length > 2000)
  )
    invalid(`${label} evidence note is outside the approved bounds`)
  if (evidence.references !== undefined) {
    if (!Array.isArray(evidence.references) || evidence.references.length > 50)
      invalid(`${label} evidence references are outside the approved bounds`)
    for (const reference of evidence.references)
      if (typeof reference !== 'string' || reference.length < 1 || reference.length > 500)
        invalid(`${label} evidence reference is outside the approved bounds`)
  }
  if (
    evidence.metadata !== undefined &&
    (evidence.metadata === null ||
      typeof evidence.metadata !== 'object' ||
      Array.isArray(evidence.metadata) ||
      octets(evidence.metadata) > 8192)
  )
    invalid(`${label} evidence metadata is outside the approved bounds`)
  // SAFETY: every evidence field was validated above; the cast restores the typed shape TypeScript cannot infer from Json.
  return evidence as unknown as NegotiatedEvidenceV1
}

function validateNegotiatedCommitment(value: unknown): NegotiatedCommitmentV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid('Negotiated agreement commitments must be objects')
  const commitment = value as Json
  for (const key of Object.keys(commitment))
    if (!['id', 'title', 'description', 'dueDate', 'amountCents', 'evidence'].includes(key))
      invalid('Negotiated agreement commitment contains an unsupported field')
  if (typeof commitment.id !== 'string' || !UUID_PATTERN.test(commitment.id))
    invalid('Negotiated agreement commitment ids must be stable UUIDs')
  if (
    typeof commitment.title !== 'string' ||
    commitment.title.trim().length < 1 ||
    commitment.title.length > 500
  )
    invalid('Negotiated agreement commitments require a title')
  if (
    commitment.description !== undefined &&
    (typeof commitment.description !== 'string' || commitment.description.length > 2000)
  )
    invalid('Negotiated agreement commitment description is outside the approved bounds')
  if (commitment.dueDate !== undefined && !isDateOnly(commitment.dueDate))
    invalid('Negotiated agreement commitment dates must be valid date-only values')
  const amountCents = commitment.amountCents
  if (
    amountCents !== undefined &&
    (typeof amountCents !== 'number' ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > MAX_MONEY_CENTS)
  )
    invalid('Negotiated agreement commitment amounts must be positive integers within range')
  const decoded: NegotiatedCommitmentV1 = { id: commitment.id, title: commitment.title }
  if (commitment.description !== undefined) decoded.description = commitment.description
  if (commitment.dueDate !== undefined) decoded.dueDate = commitment.dueDate
  if (typeof amountCents === 'number') decoded.amountCents = amountCents
  if (commitment.evidence !== undefined)
    decoded.evidence = validateAgreementEvidence(commitment.evidence, 'Commitment')
  return decoded
}

export function validateNegotiatedAgreementTerms(terms: Json): NegotiatedAgreementTermsV1 {
  for (const key of Object.keys(terms))
    if (key !== 'narrative' && key !== 'commitments' && key !== 'evidence')
      invalid('Negotiated agreement terms contain an unsupported field')
  const narrative = terms.narrative
  if (typeof narrative !== 'string' || narrative.trim().length < 1 || narrative.length > 4000)
    invalid('Negotiated agreement narrative must be 1 to 4000 characters')
  const decoded: NegotiatedAgreementTermsV1 = { narrative }
  if (terms.commitments !== undefined) {
    if (!Array.isArray(terms.commitments) || terms.commitments.length > 50)
      invalid('Negotiated agreement commitments must be a list of at most 50 entries')
    decoded.commitments = terms.commitments.map((commitment) =>
      validateNegotiatedCommitment(commitment),
    )
  }
  if (terms.evidence !== undefined)
    decoded.evidence = validateAgreementEvidence(terms.evidence, 'Agreement')
  return decoded
}

export function decodeAgreementTerms(
  kind: AgreementKind,
  termsVersion: number,
  terms: Json,
  agreementDate: string,
): AgreementRepresentation {
  if ((kind === 'SIMPLE' || kind === 'INSTALLMENT') && termsVersion === 0)
    return { kind, termsVersion: 0, terms: validateAgreementTerms(terms, agreementDate) }
  if (kind === 'NEGOTIATED' && termsVersion === 1)
    return { kind, termsVersion: 1, terms: validateNegotiatedAgreementTerms(terms) }
  return invalid('Agreement kind and terms version are unsupported')
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

export async function listObligationAgreements(
  db: DuesDb,
  obligationId: string,
): Promise<Agreement[]> {
  return rows<AgreementRow>(
    await db.execute(
      sql`SELECT ${fields} FROM tesoreria.dues_agreements WHERE obligation_id=${obligationId} ORDER BY revision_number ASC`,
    ),
  ).map(map)
}

export async function createAgreement(
  db: DuesDb,
  input: AgreementInput,
): Promise<AgreementMutationResult> {
  try {
    const inserted = rows<AgreementRow>(
      await db.execute(
        sql`INSERT INTO tesoreria.dues_agreements (socio_id,obligation_id,kind,terms_version,status,revision_number,terms,reason,revision_of_agreement_id,revision_reason,operator_id,authorization_evidence,caller_key,request_fingerprint,agreement_date) VALUES (${input.socioId},${input.obligationId},${input.kind},${input.termsVersion},'ACTIVE',1,${JSON.stringify(input.terms)}::jsonb,${input.reason},NULL,NULL,${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${input.agreementDate}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING ${fields}`,
      ),
    )[0]
    if (inserted) return { outcome: 'created', agreement: map(inserted) }
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
    return { outcome: 'replayed', agreement: map(existing) }
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

async function reviseAgreementCore(
  db: DuesDb,
  input: RescheduleInput & { termsVersion: number },
): Promise<AgreementMutationResult> {
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
      return { outcome: 'replayed', agreement: map(existing) }
    }
    if (original.status !== 'ACTIVE')
      throw BusinessError(ErrorCode.CONFLICT, 'Only active agreements can be revised')
    if (original.termsVersion !== input.termsVersion)
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Cross-representation agreement revision is not supported',
      )
    const inserted = rows<AgreementRow>(
      await db.execute(
        sql`WITH superseded AS (UPDATE tesoreria.dues_agreements SET status='SUPERSEDED' WHERE id=${input.agreementId} AND status='ACTIVE' RETURNING socio_id,obligation_id,kind,terms_version,reason,revision_number) INSERT INTO tesoreria.dues_agreements (socio_id,obligation_id,kind,terms_version,status,revision_number,terms,reason,revision_of_agreement_id,revision_reason,operator_id,authorization_evidence,caller_key,request_fingerprint,agreement_date) SELECT socio_id,obligation_id,kind,terms_version,'ACTIVE',revision_number + 1,${JSON.stringify(input.terms)}::jsonb,reason,${input.agreementId},${input.reason},${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${input.agreementDate} FROM superseded RETURNING ${fields}`,
      ),
    )[0]
    if (!inserted) throw BusinessError(ErrorCode.CONFLICT, 'Agreement changed concurrently')
    return { outcome: 'created', agreement: map(inserted) }
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

export const rescheduleAgreement = (db: DuesDb, input: RescheduleInput) =>
  reviseAgreementCore(db, { ...input, termsVersion: 0 })
export const reviseAgreement = (db: DuesDb, input: RescheduleInput) =>
  reviseAgreementCore(db, { ...input, termsVersion: 1 })

type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type AgreementRepository = {
  createAgreement: typeof createAgreement
  rescheduleAgreement: typeof rescheduleAgreement
  reviseAgreement: typeof reviseAgreement
  findAgreement: typeof findAgreement
  listObligationAgreements: typeof listObligationAgreements
}
type Dependencies = {
  repository?: Partial<AgreementRepository>
  audit?: AuditEmitter
  now?: () => Date
}
type Repository = AgreementRepository

export type AgreementCommand = AuditContext &
  Omit<
    AgreementInput,
    | 'operatorId'
    | 'authorizationEvidence'
    | 'callerKey'
    | 'requestFingerprint'
    | 'agreementDate'
    | 'termsVersion'
    | 'status'
  > & { termsVersion?: number }
export type RescheduleCommand = AuditContext & { agreementId: string; terms: Json; reason: string }
export type ReviseCommand = RescheduleCommand & { termsVersion?: number }

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
    this.repository = {
      createAgreement,
      rescheduleAgreement,
      reviseAgreement,
      findAgreement,
      listObligationAgreements,
      ...(dependencies.repository ?? {}),
    }
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }
  private async record(
    db: DuesDb,
    input: AuditContext,
    action: string,
    result: Agreement,
    reason: string,
    predecessor: Agreement | null = null,
  ) {
    await this.audit(db, {
      action,
      operatorId: input.actorId,
      entityType: 'dues_agreement',
      entityId: result.id,
      oldValue: predecessor
        ? {
            id: predecessor.id,
            obligationId: predecessor.obligationId,
            kind: predecessor.kind,
            termsVersion: predecessor.termsVersion,
            terms: predecessor.terms,
            status: predecessor.status,
            revisionNumber: predecessor.revisionNumber,
            revisionOfAgreementId: predecessor.revisionOfAgreementId,
            reason: predecessor.reason,
          }
        : null,
      newValue: {
        id: result.id,
        obligationId: result.obligationId,
        kind: result.kind,
        termsVersion: result.termsVersion,
        terms: result.terms,
        status: result.status,
        revisionNumber: result.revisionNumber,
        revisionOfAgreementId: result.revisionOfAgreementId,
        reason,
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
        ...(predecessor
          ? {
              predecessorAgreementId: predecessor.id,
              successorAgreementId: result.id,
              revisionReason: reason,
            }
          : {}),
      },
    })
  }
  async create(input: AgreementCommand): Promise<AgreementMutationResult> {
    authorize(input.role)
    const agreementDate = dateOnly(this.now())
    const representation = decodeAgreementTerms(
      input.kind,
      input.termsVersion ?? 0,
      input.terms,
      agreementDate,
    )
    return this.db.transaction(async (tx) => {
      const result = await this.repository.createAgreement(tx, {
        ...input,
        kind: representation.kind,
        termsVersion: representation.termsVersion,
        terms: representation.terms,
        agreementDate,
        operatorId: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
      })
      if (result.outcome === 'created')
        await this.record(
          tx,
          input,
          AuditAction.DUES_AGREEMENT_CREATED,
          result.agreement,
          input.reason,
        )
      return result
    })
  }
  async revise(input: ReviseCommand): Promise<AgreementMutationResult> {
    authorize(input.role)
    const agreementDate = dateOnly(this.now())
    const representation = decodeAgreementTerms(
      'NEGOTIATED',
      input.termsVersion ?? 1,
      input.terms,
      agreementDate,
    )
    return this.db.transaction(async (tx) => {
      const result = await this.repository.reviseAgreement(tx, {
        ...input,
        terms: representation.terms,
        agreementDate,
        operatorId: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
      })
      if (result.outcome === 'created') {
        const predecessor = await this.repository.findAgreement(tx, input.agreementId)
        await this.record(
          tx,
          input,
          AuditAction.DUES_AGREEMENT_REVISED,
          result.agreement,
          input.reason,
          predecessor,
        )
      }
      return result
    })
  }
  async lineage(input: { obligationId: string }): Promise<{
    active: Agreement | null
    revisions: Agreement[]
  }> {
    const agreements = await this.repository.listObligationAgreements(this.db, input.obligationId)
    for (const agreement of agreements) {
      try {
        decodeAgreementTerms(
          agreement.kind,
          agreement.termsVersion,
          agreement.terms,
          agreement.agreementDate,
        )
      } catch {
        throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Agreement lineage is unavailable')
      }
    }
    const revisions = [...agreements].sort((a, b) => a.revisionNumber - b.revisionNumber)
    return {
      active: revisions.find((agreement) => agreement.status === 'ACTIVE') ?? null,
      revisions,
    }
  }
  async reschedule(input: RescheduleCommand): Promise<AgreementMutationResult> {
    authorize(input.role)
    const agreementDate = dateOnly(this.now())
    const terms = validateAgreementTerms(input.terms, agreementDate)
    return this.db.transaction(async (tx) => {
      const result = await this.repository.rescheduleAgreement(tx, {
        ...input,
        terms,
        agreementDate,
        operatorId: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
      })
      if (result.outcome === 'created')
        await this.record(
          tx,
          input,
          AuditAction.DUES_AGREEMENT_REVISED,
          result.agreement,
          input.reason,
        )
      return result
    })
  }
}
