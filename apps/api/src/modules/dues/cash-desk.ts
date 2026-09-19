import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { createSha256Fingerprint } from '../../lib/idempotency.ts'
import { MAX_MONEY_CENTS } from './allocations.ts'
import type { AuditContext } from './service.ts'

export const CLUB_TIMEZONE = 'America/Argentina/Jujuy'
type CashDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0]
type Direction = 'INCOME' | 'EXPENSE'
type Tender = { tender: string; direction: Direction; amountCents: number }
type Totals = Record<string, number>
type Row = {
  id: string
  desk_id: string
  status: string
  assigned_operator_id: string
  business_date: string
  opened_at: string | Date
  closed_at: string | Date | null
  shift_id: string
  direction: string
  tender: string
  amount: string
  source_type: string
  source_id: string | null
  expected_tenders: Totals
  counted_tenders: Totals
  discrepancy: Totals
  reason: string | null
  force_close: boolean
  request_fingerprint: string
  reverses_tender_id: string | null
  kind: string
  original_gasto_id: string
  compensating_gasto_id: string
  fecha: string
  importe: string
  opening_tenders: Totals
  // prettier-ignore
  manual_source_id?: string;
  tender_id?: string
  account_code_snapshot?: string
  account_name_snapshot?: string
  account_path_snapshot?: unknown
  description?: string
  doc_type?: string | null
  letter?: string | null
  point_of_sale?: string | null
  doc_number?: string | null
  legend?: string | null
  issuer?: string | null
  recipient?: string | null
  issue_date?: string | null
  currency?: string
  total?: string | number
  prior_references?: string[] | null
  tax_components?: { label: string; amount_cents: number; semantic: string }[] | null
  created_at?: string | Date
}

const isShiftOwner = (shift: Pick<Row, 'assigned_operator_id'>, actorId: string) =>
  shift.assigned_operator_id === actorId

const rows = <T = Row>(value: unknown) => (value as { rows?: T[] }).rows ?? []
const cents = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}
const money = (value: number) => (value / 100).toFixed(2)
const clean = (value: unknown): Totals =>
  Object.fromEntries(
    (Object.entries((value ?? {}) as Record<string, unknown>) as Array<[string, unknown]>).flatMap(
      ([key, amount]) => {
        const numeric = Number(amount)
        return Number.isSafeInteger(numeric) && numeric >= 0 ? [[key, numeric]] : []
      },
    ),
  )

export const validateOpeningTenders = (value: unknown): Totals => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Opening tenders must contain only CASH cents')
  const opening = value as Record<string, unknown>
  const entries = Object.entries(opening)
  if (
    entries.some(
      ([tender, amount]) =>
        tender !== 'CASH' ||
        typeof amount !== 'number' ||
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > MAX_MONEY_CENTS,
    )
  )
    throw BusinessError(
      ErrorCode.VALIDATION_ERROR,
      'Opening tenders must contain only bounded non-negative CASH cents',
    )
  return entries.length ? { CASH: opening.CASH as number } : {}
}

const existingOpenShiftMessage = (id: string) =>
  `Cash shift ${id} is already OPEN; close it or use expired-shift recovery`

export function businessDateForOpening(openedAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(openedAt)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function movementInInterval(openedAt: Date, closedAt: Date, movementAt: Date): boolean {
  return movementAt >= openedAt && movementAt <= closedAt
}

export function requestFingerprintConflict(expected: string, actual: string): boolean {
  return expected !== actual
}

// Expected physical CASH: opening once + CASH income − CASH expenses. Non-cash methods never enter.
export function expectedCashTenders(opening: Totals, movements: Tender[]): Totals {
  const openingCash = clean(opening).CASH
  const expected: Totals = openingCash === undefined ? {} : { CASH: openingCash }
  for (const movement of movements) {
    if (movement.tender !== 'CASH') continue
    expected.CASH =
      (expected.CASH ?? 0) +
      (movement.direction === 'INCOME' ? movement.amountCents : -movement.amountCents)
  }
  return expected
}

export function reconcileTenders(
  opening: Totals,
  movements: Tender[],
  counted: Totals,
  reason?: string,
) {
  const expected = expectedCashTenders(opening, movements)
  const normalized = clean(counted)
  const discrepancy: Totals = {}
  for (const tender of new Set([...Object.keys(expected), ...Object.keys(normalized)])) {
    const difference = (normalized[tender] ?? 0) - (expected[tender] ?? 0)
    if (difference) discrepancy[tender] = difference
  }
  if (Object.keys(discrepancy).length && !reason?.trim()) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A discrepancy justification is required')
  }
  return { expected, counted: normalized, discrepancy }
}

const isFinance = (role: string) => role === 'ADMIN' || role === 'TESORERO'

type AccountSnapshot = { code: string; name: string; eligible: boolean; path: unknown[] }
const resolveAccountSnapshot = async (
  db: CashDb,
  accountCode: string,
): Promise<AccountSnapshot | undefined> => {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT code,name,parent_code,root_code,active,imputable,0 AS depth
      FROM contabilidad.plan_cuentas WHERE code=${accountCode}
      UNION ALL
      SELECT p.code,p.name,p.parent_code,p.root_code,p.active,p.imputable,ac.depth+1
      FROM contabilidad.plan_cuentas p JOIN ancestors ac ON ac.parent_code=p.code AND ac.root_code=p.root_code
    )
    SELECT
      (SELECT code FROM ancestors WHERE depth=0) AS code,
      (SELECT name FROM ancestors WHERE depth=0) AS name,
      (SELECT active AND imputable FROM ancestors WHERE depth=0) AS eligible,
      jsonb_agg(jsonb_build_object('code',code,'name',name) ORDER BY depth DESC) AS path
    FROM ancestors
  `)
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row || !(row.eligible === true)) return undefined
  return {
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    eligible: true,
    path: (Array.isArray(row.path) ? row.path : []) as unknown[],
  }
}
const authorize = (role: string) => {
  if (!isFinance(role)) {
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Cash desk action is not authorized')
  }
}

const authorizeOpenRead = (role: string) => {
  if (!isFinance(role) && role !== 'OPERADOR') {
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Cash desk action is not authorized')
  }
}

const authorizeSettlementTender = (role: string) => {
  if (!isFinance(role) && role !== 'OPERADOR') {
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Cash desk action is not authorized')
  }
}

// Manual movements are own-shift OPERADOR work; ownership itself is enforced by shift().
const authorizeManualTender = (role: string) => {
  if (!isFinance(role) && role !== 'OPERADOR') {
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Cash desk action is not authorized')
  }
}

// prettier-ignore
const SUPPORTING_DOC_TYPES = ['FACTURA_A','FACTURA_B','FACTURA_C','FACTURA_E','FACTURA_M','FACTURA_T','NOTA_CREDITO','NOTA_DEBITO','RECIBO_A','RECIBO_B','RECIBO_C','RECIBO_X','REMITO_R','REMITO_X','TICKET']

// Transcription guards mirror the 0072 DB policy; the database remains the fail-closed backstop.
const validateSupportingInput = (input: SupportingRecordCommand) => {
  // prettier-ignore
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Supporting records require a positive exact-cent total')
  if (input.kind === 'EXTERNAL') {
    // prettier-ignore
    if (!input.docType || !SUPPORTING_DOC_TYPES.includes(input.docType)) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'External supporting records require a whitelisted document type')
    // prettier-ignore
    if ((input.docType === 'NOTA_CREDITO' || input.docType === 'NOTA_DEBITO') && !input.priorReferences?.some((reference) => reference.trim())) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Credit and debit notes require prior document references')
  }
  // prettier-ignore
  if (input.kind === 'INTERNAL' && (input.docType || input.docNumber || input.pointOfSale)) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Internal supporting evidence is unnumbered')
  let additiveTotal = 0
  let hasAdditive = false
  for (const component of input.taxComponents ?? []) {
    // prettier-ignore
    if (!component.label?.trim() || !Number.isSafeInteger(component.amountCents) || component.amountCents <= 0 || (component.semantic !== 'ADDITIVE' && component.semantic !== 'CONTAINED')) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Tax components require a label, positive integer cents, and explicit semantics')
    if (component.semantic === 'ADDITIVE') {
      hasAdditive = true
      additiveTotal += component.amountCents
    }
  }
  // prettier-ignore
  if (hasAdditive && additiveTotal !== input.totalCents) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Additive tax components must reconcile exactly to the document total')
}

// prettier-ignore
const responseSupporting = (row: Row) => ({ id: row.id, manualSourceId: row.manual_source_id, kind: row.kind, ...(row.doc_type ? { docType: row.doc_type } : {}), ...(row.letter ? { letter: row.letter } : {}), ...(row.point_of_sale ? { pointOfSale: row.point_of_sale } : {}), ...(row.doc_number ? { docNumber: row.doc_number } : {}), ...(row.legend ? { legend: row.legend } : {}), ...(row.issuer ? { issuer: row.issuer } : {}), ...(row.recipient ? { recipient: row.recipient } : {}), ...(row.issue_date ? { issueDate: row.issue_date } : {}), currency: row.currency, totalCents: cents(String(row.total)), priorReferences: row.prior_references ?? [], taxComponents: ((row.tax_components ?? []) as { label: string; amount_cents: number; semantic: string }[]).map((component) => ({ label: component.label, amountCents: component.amount_cents, semantic: component.semantic })), createdAt: new Date(row.created_at as string | Date).toISOString() })

// prettier-ignore
const responseManualSource = (row: Row) => ({ id: row.id, tenderId: row.tender_id, accountCodeSnapshot: row.account_code_snapshot, accountNameSnapshot: row.account_name_snapshot, accountPathSnapshot: row.account_path_snapshot, description: row.description, createdAt: new Date(row.created_at as string | Date).toISOString() })

const authorizeForceClose = (role: string) => {
  if (role !== 'ADMIN' && role !== 'TESORERO') {
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Forced cash close is restricted to finance operators',
    )
  }
}

const responseShift = (row: Row) => ({
  id: row.id,
  deskId: row.desk_id,
  status: row.status,
  assignedOperatorId: row.assigned_operator_id,
  businessDate: row.business_date,
  openedAt: new Date(row.opened_at).toISOString(),
  closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
})

const responseTender = (row: Row) => ({
  id: row.id,
  shiftId: row.shift_id,
  direction: row.direction,
  tender: row.tender,
  amountCents: cents(row.amount),
  sourceType: row.source_type,
  sourceId: row.source_id,
})

// prettier-ignore
const responseClose = (row: Row, transfer?: Row | null) => ({
  id: row.id,
  shiftId: row.shift_id,
  expectedTenders: row.expected_tenders,
  countedTenders: row.counted_tenders,
  discrepancy: row.discrepancy,
  reason: row.reason,
  closedAt: new Date(row.closed_at!).toISOString(),
  ...(row.force_close ? { forceClose: true } : {}),
  // prettier-ignore
  ...(transfer ? { closeTransfer: { id: transfer.id, accountCodeSnapshot: transfer.account_code_snapshot, accountNameSnapshot: transfer.account_name_snapshot, accountPathSnapshot: transfer.account_path_snapshot, amountCents: cents(String(transfer.amount)), createdAt: new Date(transfer.created_at as string | Date).toISOString() } } : {}),
})

export type CashCommand = AuditContext & { role: AuditContext['role'] }
export type OpenCashCommand = CashCommand & { deskId: string; openingTenders: Totals }
export type TenderCommand = CashCommand & {
  shiftId: string
  accountCode?: string
  description?: string
  direction: Direction
  tender: string
  amountCents: number
  sourceType: 'SETTLEMENT' | 'MANUAL'
  sourceId?: string
  reason?: string
}
export type ExpenseCommand = CashCommand & { shiftId: string; gastoId: string; tender: string }
export type ReverseTenderCommand = CashCommand & {
  shiftId: string
  tenderId: string
  reason: string
}
// prettier-ignore
export type SupportingTaxComponent = { label: string; amountCents: number; semantic: 'ADDITIVE' | 'CONTAINED' }
// prettier-ignore
export type SupportingRecordCommand = CashCommand & { manualSourceId: string; kind: 'EXTERNAL' | 'INTERNAL'; docType?: string; letter?: string; pointOfSale?: string; docNumber?: string; legend?: string; issuer?: string; recipient?: string; issueDate?: string; currency?: string; totalCents: number; priorReferences?: string[]; taxComponents?: SupportingTaxComponent[] }
export type SettlementTenderInput = CashCommand & {
  shiftId: string
  settlementId: string
  tender: 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'
}
export type ReversalSettlementTenderInput = CashCommand & {
  settlementId: string
  originalSettlementId: string
}
export type CloseCashCommand = CashCommand & {
  shiftId: string
  countedTenders: Totals
  reason?: string
  forceClose?: boolean
  /** Cash the operator declares to keep in the drawer for change; the excess sweeps to
   * Valores a Depositar. Defaults to 0 (full sweep). Ordinary closes only. */
  drawerFloatCents?: number
}

const settlementTenders = new Set(['CASH', 'DEBIT', 'CREDIT', 'TRANSFER'])

export async function validateSettlementShiftInTransaction(
  db: CashDb,
  input: Pick<SettlementTenderInput, 'shiftId' | 'actorId' | 'role'>,
) {
  const shift = rows(
    await db.execute(
      sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE id = ${input.shiftId} FOR UPDATE`,
    ),
  )[0]
  if (!shift) throw BusinessError(ErrorCode.NOT_FOUND, 'Cash shift not found')
  if (shift.status !== 'OPEN')
    throw BusinessError(ErrorCode.CONFLICT, 'Cash shift is already closed')
  if (shift.assigned_operator_id !== input.actorId && input.role !== 'ADMIN')
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Cash shift responsibility does not match the operator',
    )
  const openedAt = new Date(shift.opened_at)
  if (Date.now() < openedAt.getTime() || Date.now() > openedAt.getTime() + 24 * 60 * 60 * 1000)
    throw BusinessError(ErrorCode.CONFLICT, 'Cash shifts cannot remain open longer than 24 hours')
}

export async function recordSettlementTenderInTransaction(
  db: CashDb,
  input: SettlementTenderInput,
) {
  authorizeSettlementTender(input.role)
  if (!settlementTenders.has(input.tender)) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A supported settlement tender is required')
  }
  const replay = rows(
    await db.execute(
      sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
    ),
  )[0]
  if (replay) {
    if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different tender',
      )
    }
    return responseTender(replay)
  }
  await validateSettlementShiftInTransaction(db, input)
  const settlement = rows(
    await db.execute(
      sql`SELECT kind,amount::text FROM tesoreria.dues_settlements WHERE id = ${input.settlementId}`,
    ),
  )[0]
  if (!settlement) throw BusinessError(ErrorCode.NOT_FOUND, 'Settlement not found')
  if (settlement.kind !== 'MONETARY') {
    throw BusinessError(ErrorCode.CONFLICT, 'Non-cash settlement cannot enter a tender total')
  }
  const amountCents = cents(settlement.amount)
  const inserted = rows(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint) VALUES (${input.shiftId},'INCOME',${input.tender},${money(amountCents)},'SETTLEMENT',${input.settlementId},${input.actorId},${input.callerKey},${input.requestFingerprint}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING *`,
    ),
  )[0]
  if (!inserted) {
    const raced = rows(
      await db.execute(
        sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
      ),
    )[0]
    if (!raced) throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Tender replay is unavailable')
    if (requestFingerprintConflict(raced.request_fingerprint, input.requestFingerprint)) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different tender',
      )
    }
    return responseTender(raced)
  }
  await emitAudit(db, {
    operatorId: input.actorId,
    action: AuditAction.DUES_CASH_TENDER_RECORDED,
    entityType: 'dues_cash',
    entityId: inserted.id,
    oldValue: null,
    newValue: null,
    sourceIp: input.sourceIp,
    callerKey: input.callerKey,
    metadata: {
      ...input.authorizationEvidence,
      shiftId: input.shiftId,
      tender: input.tender,
      amountCents,
      sourceType: 'SETTLEMENT',
    },
  })
  return responseTender(inserted)
}

export async function recordReversalSettlementTenderInTransaction(
  db: CashDb,
  input: ReversalSettlementTenderInput,
) {
  const original = rows(
    await db.execute(
      sql`SELECT tender.shift_id,tender.tender,tender.amount::text FROM tesoreria.dues_cash_tenders AS tender WHERE tender.source_type='SETTLEMENT' AND tender.direction='INCOME' AND tender.source_id=${input.originalSettlementId} ORDER BY tender.created_at,tender.id FOR UPDATE`,
    ),
  )[0]
  if (!original) throw BusinessError(ErrorCode.CONFLICT, 'Settlement has no cash tender to reverse')
  await validateSettlementShiftInTransaction(db, { ...input, shiftId: original.shift_id })
  const inserted = rows(
    await db.execute(
      sql`INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint) VALUES (${original.shift_id},'EXPENSE',${original.tender},${original.amount},'SETTLEMENT',${input.settlementId},${input.actorId},${input.callerKey},${input.requestFingerprint}) RETURNING *`,
    ),
  )[0]
  if (!inserted)
    throw BusinessError(ErrorCode.INTERNAL_ERROR, 'Settlement reversal tender was not recorded')
  return responseTender(inserted)
}

type CompensationInput = {
  originalGastoId: string
  compensatingGastoId: string
  operatorId: string
  callerKey: string
  requestFingerprint?: string
  reason: string
}

export async function recordExpenseCompensation(db: Db, input: CompensationInput) {
  return db.transaction((tx) => recordExpenseCompensationInTransaction(tx, input))
}

export async function recordExpenseCompensationInTransaction(db: CashDb, input: CompensationInput) {
  if (!input.callerKey.trim()) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'An explicit idempotency key is required')
  }
  if (!input.reason.trim()) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A compensation reason is required')
  }
  const requestFingerprint =
    input.requestFingerprint ??
    createSha256Fingerprint(
      `gasto-compensation|${input.originalGastoId}|${input.compensatingGastoId}|${input.reason}`,
    )
  const existing = rows(
    await db.execute(
      sql`SELECT * FROM tesoreria.gasto_compensations WHERE operator_id = ${input.operatorId} AND caller_key = ${input.callerKey}`,
    ),
  )[0]
  if (existing) {
    if (requestFingerprintConflict(existing.request_fingerprint, requestFingerprint)) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency key was already used for a different compensation',
      )
    }
    return compensationResponse(existing)
  }
  const closed = rows(
    await db.execute(
      sql`SELECT c.id FROM tesoreria.dues_cash_shift_expenses e JOIN tesoreria.dues_cash_closes c ON c.shift_id = e.shift_id WHERE e.gasto_id = ${input.originalGastoId}`,
    ),
  )[0]
  if (!closed) {
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Compensation requires an expense from a closed cash shift',
    )
  }
  const inserted = rows(
    await db.execute(
      sql`INSERT INTO tesoreria.gasto_compensations (original_gasto_id,compensating_gasto_id,reason,operator_id,caller_key,request_fingerprint) VALUES (${input.originalGastoId},${input.compensatingGastoId},${input.reason},${input.operatorId},${input.callerKey},${requestFingerprint}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING *`,
    ),
  )[0]
  if (inserted) return compensationResponse(inserted)
  const replay = rows(
    await db.execute(
      sql`SELECT * FROM tesoreria.gasto_compensations WHERE operator_id = ${input.operatorId} AND caller_key = ${input.callerKey}`,
    ),
  )[0]
  if (!replay)
    throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Expense compensation is unavailable')
  if (requestFingerprintConflict(replay.request_fingerprint, requestFingerprint)) {
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Idempotency key was already used for a different compensation',
    )
  }
  return compensationResponse(replay)
}

const compensationResponse = (row: Row) => ({
  id: row.id,
  originalGastoId: row.original_gasto_id,
  compensatingGastoId: row.compensating_gasto_id,
  reason: row.reason,
})

export class CashDeskService {
  constructor(
    private readonly db: Db,
    private readonly now = () => new Date(),
  ) {}

  private async audit(
    db: CashDb,
    input: CashCommand,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await emitAudit(db, {
      operatorId: input.actorId,
      action,
      entityType: 'dues_cash',
      entityId,
      oldValue: null,
      newValue: null,
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
        ...metadata,
      },
    })
  }

  private async shift(db: CashDb, id: string, input: CashCommand, lock = false) {
    const row = rows(
      await db.execute(
        sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE id = ${id} ${lock ? sql`FOR UPDATE` : sql``}`,
      ),
    )[0]
    if (!row) throw BusinessError(ErrorCode.NOT_FOUND, 'Cash shift not found')
    if (!isShiftOwner(row, input.actorId) && input.role !== 'ADMIN') {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Cash shift responsibility does not match the operator',
      )
    }
    return row
  }

  private assertWithinPolicy(shift: Row, at: Date) {
    const openedAt = new Date(shift.opened_at)
    if (at < openedAt || at.getTime() > openedAt.getTime() + 24 * 60 * 60 * 1000) {
      throw BusinessError(ErrorCode.CONFLICT, 'Cash shifts cannot remain open longer than 24 hours')
    }
  }

  async open(input: OpenCashCommand) {
    authorizeOpenRead(input.role)
    const opening = validateOpeningTenders(input.openingTenders)
    const openedAt = this.now()
    const businessDate = businessDateForOpening(openedAt)
    return this.db
      .transaction(async (tx) => {
        const keyed = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
          ),
        )[0]
        if (keyed) {
          if (requestFingerprintConflict(keyed.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different shift',
            )
          }
          return responseShift(keyed)
        }
        const prior = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE assigned_operator_id = ${input.actorId} AND status = 'OPEN' AND caller_key <> ${input.callerKey} ORDER BY opened_at LIMIT 1`,
          ),
        )[0]
        if (prior) throw BusinessError(ErrorCode.CONFLICT, existingOpenShiftMessage(prior.id))
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_shifts (desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,timezone,opened_at) VALUES (${input.deskId},${input.actorId},${JSON.stringify(opening)}::jsonb,${input.actorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${businessDate},${CLUB_TIMEZONE},${openedAt}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING *`,
          ),
        )[0]
        if (!inserted) {
          const replay = rows(
            await tx.execute(
              sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
            ),
          )[0]
          if (replay) {
            if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Idempotency key was already used for a different shift',
              )
            }
            return responseShift(replay)
          }
          throw BusinessError(ErrorCode.CONFLICT, 'A desk or operator already has an open shift')
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_SHIFT_OPENED, inserted.id, {
          deskId: input.deskId,
          businessDate,
        })
        return responseShift(inserted)
      })
      .catch(async (error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          const prior = rows(
            await this.db.execute(
              sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE assigned_operator_id = ${input.actorId} AND status = 'OPEN' AND caller_key <> ${input.callerKey} ORDER BY opened_at LIMIT 1`,
            ),
          )[0]
          throw BusinessError(
            ErrorCode.CONFLICT,
            prior
              ? existingOpenShiftMessage(prior.id)
              : 'Cash shift opening conflicted; retry the request',
          )
        }
        throw error
      })
  }

  async list(input: CashCommand) {
    authorizeOpenRead(input.role)
    const ownership =
      input.role === 'OPERADOR' ? sql`WHERE assigned_operator_id = ${input.actorId}` : sql``
    return rows(
      await this.db.execute(
        sql`SELECT id,desk_id,status,assigned_operator_id,business_date,opened_at,closed_at FROM tesoreria.dues_cash_shifts ${ownership} ORDER BY opened_at DESC LIMIT 50`,
      ),
    ).map(responseShift)
  }

  /**
   * P9 auto-open: the operator's working period opens itself — there is no manual "open
   * shift" step. The opening anchor is the remainder of the operator's last close
   * (counted − transferred, clamped to 0: a counted overage stays in the drawer and opens
   * the next period; a recorded shortage opens at 0). A first-ever drawer opens at 0 on
   * the canonical desk. Idempotent: an existing own OPEN shift always wins regardless of
   * caller key, and a concurrent opener's conflict resolves to that shift.
   */
  async ensureOpenShift(input: CashCommand) {
    authorizeOpenRead(input.role)
    const existing = rows(
      await this.db.execute(
        sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE assigned_operator_id = ${input.actorId} AND status = 'OPEN' ORDER BY opened_at LIMIT 1`,
      ),
    )[0]
    if (existing) return responseShift(existing)
    const last = rows<{
      desk_id: string
      counted_tenders: Totals | null
      transfer_amount: string | null
    }>(
      await this.db.execute(sql`
        SELECT s.desk_id, c.counted_tenders, t.amount AS transfer_amount
        FROM tesoreria.dues_cash_closes c
        JOIN tesoreria.dues_cash_shifts s ON s.id = c.shift_id
        LEFT JOIN tesoreria.dues_cash_close_transfers t ON t.close_id = c.id
        WHERE c.operator_id = ${input.actorId}
        ORDER BY c.closed_at DESC, c.id DESC
        LIMIT 1
      `),
    )[0]
    const countedCents = clean(last?.counted_tenders ?? {}).CASH ?? 0
    const transferredCents = last?.transfer_amount == null ? 0 : cents(last.transfer_amount)
    const openingCents = Math.max(0, countedCents - transferredCents)
    const deskId = last?.desk_id ?? 'front-desk'
    try {
      return await this.open({ ...input, deskId, openingTenders: { CASH: openingCents } })
    } catch (error) {
      // A concurrent ensure/open may have won the race after our check; that shift is
      // exactly what the caller needs, so resolve to it instead of failing.
      const raced = rows(
        await this.db.execute(
          sql`SELECT * FROM tesoreria.dues_cash_shifts WHERE assigned_operator_id = ${input.actorId} AND status = 'OPEN' ORDER BY opened_at LIMIT 1`,
        ),
      )[0]
      if (raced) return responseShift(raced)
      throw error
    }
  }

  async detail(input: CashCommand & { shiftId: string }) {
    authorizeOpenRead(input.role)
    const result = rows<{ shift: Row; close: Row | null; transfer: Row | null }>(
      await this.db.execute(sql`
        SELECT row_to_json(s) AS shift, row_to_json(c) AS close, row_to_json(t.*) AS transfer
        FROM tesoreria.dues_cash_shifts s
        LEFT JOIN tesoreria.dues_cash_closes c ON c.shift_id = s.id
        LEFT JOIN tesoreria.dues_cash_close_transfers t ON t.close_id = c.id
        WHERE s.id = ${input.shiftId}
      `),
    )[0]
    if (!result) throw BusinessError(ErrorCode.NOT_FOUND, 'Cash shift not found')
    if (input.role === 'OPERADOR' && !isShiftOwner(result.shift, input.actorId)) {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Cash shift responsibility does not match the operator',
      )
    }
    // Movement list with manual attribution for the informational close preview; expectation is
    // recomputed from persisted rows and stays CASH-only, never client-supplied.
    const movements = rows(
      await this.db.execute(sql`
            SELECT t.id,t.direction,t.tender,t.amount::text,t.source_type,t.source_id,t.created_at,
                   t.reverses_tender_id,t.reason,
                   ms.account_code_snapshot,ms.account_name_snapshot,ms.description
            FROM tesoreria.dues_cash_tenders t
            LEFT JOIN tesoreria.dues_cash_manual_sources ms ON ms.tender_id = t.id
            WHERE t.shift_id = ${input.shiftId}
            ORDER BY t.created_at,t.id
          `),
    )
    const openingTenders = clean(result.shift.opening_tenders)
    // Expected CASH is recomputed only while OPEN (close preview); a CLOSED shift reads its
    // stored close as the authority and is never recomputed.
    // prettier-ignore
    const expectedTenders = result.shift.status === 'OPEN' ? expectedCashTenders(openingTenders, movements.map((row) => ({ tender: row.tender, direction: row.direction as Direction, amountCents: cents(row.amount) }))) : undefined
    return {
      shift: responseShift(result.shift),
      close: result.close ? responseClose(result.close, result.transfer) : null,
      openingTenders,
      ...(expectedTenders ? { expectedTenders } : {}),
      // prettier-ignore
      movements: movements.map((row) => ({ id: row.id, direction: row.direction, tender: row.tender, amountCents: cents(row.amount), sourceType: row.source_type, ...(row.source_id ? { sourceId: row.source_id } : {}), createdAt: new Date(row.created_at as string | Date).toISOString(), ...(row.reverses_tender_id ? { reversesTenderId: row.reverses_tender_id } : {}), ...(row.reason ? { reason: row.reason } : {}), ...(row.account_code_snapshot ? { accountCodeSnapshot: row.account_code_snapshot, accountNameSnapshot: row.account_name_snapshot, description: row.description } : {}) })),
    }
  }

  async recordTender(input: TenderCommand) {
    if (input.sourceType === 'MANUAL') authorizeManualTender(input.role)
    else authorize(input.role)
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      (input.sourceType === 'MANUAL' && !input.reason?.trim()) ||
      (input.sourceType === 'SETTLEMENT' && input.direction !== 'INCOME')
    ) {
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'Tender amount, direction, and manual reason are required',
      )
    }
    if (input.sourceType === 'MANUAL' && (input.accountCode?.trim() || input.description?.trim())) {
      if (!input.accountCode?.trim()) {
        throw BusinessError(
          ErrorCode.VALIDATION_ERROR,
          'A manual account code and description are required together',
        )
      }
      if (!input.description?.trim()) {
        throw BusinessError(
          ErrorCode.VALIDATION_ERROR,
          'A manual account code and description are required together',
        )
      }
    }
    if (input.sourceType === 'SETTLEMENT') {
      return this.db.transaction((tx) =>
        recordSettlementTenderInTransaction(tx, {
          ...input,
          settlementId: input.sourceId ?? '',
          tender: input.tender as SettlementTenderInput['tender'],
        }),
      )
    }
    return this.db
      .transaction(async (tx) => {
        const replay = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
          ),
        )[0]
        if (replay) {
          if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different tender',
            )
          }
          return responseTender(replay)
        }
        const shift = await this.shift(tx, input.shiftId, input, true)
        this.assertWithinPolicy(shift, this.now())
        let amount = input.amountCents
        if (input.sourceType === 'SETTLEMENT') {
          const settlement = rows(
            await tx.execute(
              sql`SELECT kind,amount::text FROM tesoreria.dues_settlements WHERE id = ${input.sourceId ?? null}`,
            ),
          )[0]
          if (!settlement) throw BusinessError(ErrorCode.NOT_FOUND, 'Settlement not found')
          if (settlement.kind !== 'MONETARY')
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Non-cash settlement cannot enter a tender total',
            )
          amount = cents(settlement.amount)
        }
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,source_id,reason,operator_id,caller_key,request_fingerprint) VALUES (${input.shiftId},${input.direction},${input.tender},${money(amount)},${input.sourceType},${input.sourceId ?? null},${input.reason ?? null},${input.actorId},${input.callerKey},${input.requestFingerprint}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING *`,
          ),
        )[0]
        if (!inserted) {
          const raced = rows(
            await tx.execute(
              sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
            ),
          )[0]
          if (raced) {
            if (requestFingerprintConflict(raced.request_fingerprint, input.requestFingerprint)) {
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Idempotency key was already used for a different tender',
              )
            }
            return responseTender(raced)
          }
          throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Tender replay is unavailable')
        }
        let manualSourceId: string | undefined
        if (
          input.sourceType === 'MANUAL' &&
          input.accountCode?.trim() &&
          input.description?.trim()
        ) {
          const acct = await resolveAccountSnapshot(tx, input.accountCode.trim())
          if (!acct?.eligible)
            throw BusinessError(ErrorCode.CONFLICT, 'Manual movement account is unavailable')
          const snapPath = JSON.stringify(acct.path)
          const srcInserted = rows(
            await tx.execute(
              sql`INSERT INTO tesoreria.dues_cash_manual_sources (tender_id,account_code_snapshot,account_name_snapshot,account_path_snapshot,description) VALUES (${inserted.id},${input.accountCode.trim()},${acct.name},${snapPath}::jsonb,${input.description.trim()}) RETURNING id`,
            ),
          )[0]
          if (srcInserted) manualSourceId = srcInserted.id
          else {
            const retained = rows(
              await tx.execute(
                sql`SELECT id FROM tesoreria.dues_cash_manual_sources WHERE tender_id=${inserted.id} AND account_code_snapshot=${input.accountCode.trim()} FOR UPDATE`,
              ),
            )[0]
            if (!retained)
              throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Manual source is unavailable')
            manualSourceId = retained.id
          }
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_TENDER_RECORDED, inserted.id, {
          shiftId: input.shiftId,
          direction: input.direction,
          tender: input.tender,
          amountCents: amount,
          sourceType: input.sourceType,
          ...(manualSourceId ? { manualSourceId } : {}),
        })
        return responseTender(inserted)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'Tender source or idempotency key already exists')
        }
        throw error
      })
  }

  async recordSupporting(input: SupportingRecordCommand) {
    authorizeManualTender(input.role)
    validateSupportingInput(input)
    return this.db
      .transaction(async (tx) => {
        const source = rows<{ source_id: string; shift_id: string }>(
          await tx.execute(
            sql`SELECT s.id AS source_id, t.shift_id FROM tesoreria.dues_cash_manual_sources s JOIN tesoreria.dues_cash_tenders t ON t.id = s.tender_id WHERE s.id = ${input.manualSourceId} FOR UPDATE OF s, t`,
          ),
        )[0]
        if (!source) throw BusinessError(ErrorCode.NOT_FOUND, 'Manual cash source not found')
        const shift = await this.shift(tx, source.shift_id, input, true)
        if (shift.status !== 'OPEN') {
          throw BusinessError(ErrorCode.CONFLICT, 'Supporting records require an open cash shift')
        }
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_supporting_records (manual_source_id,kind,doc_type,letter,point_of_sale,doc_number,legend,issuer,recipient,issue_date,currency,total,prior_references,tax_components) VALUES (${input.manualSourceId},${input.kind},${input.docType ?? null},${input.letter ?? null},${input.pointOfSale ?? null},${input.docNumber ?? null},${input.legend ?? null},${input.issuer ?? null},${input.recipient ?? null},${input.issueDate ?? null},${input.currency ?? 'ARS'},${money(input.totalCents)},${JSON.stringify(input.priorReferences ?? [])}::jsonb,${JSON.stringify((input.taxComponents ?? []).map((component) => ({ label: component.label, amount_cents: component.amountCents, semantic: component.semantic })))}::jsonb) ON CONFLICT (manual_source_id) DO NOTHING RETURNING *`,
          ),
        )[0]
        if (!inserted) {
          throw BusinessError(
            ErrorCode.CONFLICT,
            'Manual cash source already has a supporting record',
          )
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_SUPPORTING_RECORDED, inserted.id, {
          manualSourceId: input.manualSourceId,
          shiftId: source.shift_id,
          kind: input.kind,
          docType: input.docType ?? null,
          totalCents: input.totalCents,
        })
        return responseSupporting(inserted)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(
            ErrorCode.CONFLICT,
            'Manual cash source already has a supporting record',
          )
        }
        throw error
      })
  }

  async manualSourceDetail(input: CashCommand & { manualSourceId: string }) {
    authorizeOpenRead(input.role)
    const result = rows<{ source: Row; record: Row | null; shift: Row }>(
      await this.db.execute(
        sql`SELECT row_to_json(s.*) AS source, row_to_json(r.*) AS record, row_to_json(h.*) AS shift
          FROM tesoreria.dues_cash_manual_sources s
          JOIN tesoreria.dues_cash_tenders t ON t.id = s.tender_id
          JOIN tesoreria.dues_cash_shifts h ON h.id = t.shift_id
          LEFT JOIN tesoreria.dues_cash_supporting_records r ON r.manual_source_id = s.id
          WHERE s.id = ${input.manualSourceId}`,
      ),
    )[0]
    if (!result) throw BusinessError(ErrorCode.NOT_FOUND, 'Manual cash source not found')
    if (input.role === 'OPERADOR' && !isShiftOwner(result.shift, input.actorId)) {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Cash shift responsibility does not match the operator',
      )
    }
    return {
      source: responseManualSource(result.source),
      supportingRecord: result.record ? responseSupporting(result.record) : null,
    }
  }

  async includeExpense(input: ExpenseCommand) {
    authorize(input.role)
    return this.db
      .transaction(async (tx) => {
        const replay = rows(
          await tx.execute(
            sql`SELECT t.*,g.importe::text AS gasto_importe FROM tesoreria.dues_cash_tenders t JOIN tesoreria.gastos g ON g.id=t.source_id WHERE t.operator_id = ${input.actorId} AND t.caller_key = ${input.callerKey} AND t.source_type='GASTO'`,
          ),
        )[0]
        if (replay) {
          if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different expense',
            )
          }
          return {
            id: replay.id,
            shiftId: replay.shift_id,
            gastoId: replay.source_id,
            tender: replay.tender,
            amountCents: cents(replay.amount),
          }
        }
        const shift = await this.shift(tx, input.shiftId, input, true)
        this.assertWithinPolicy(shift, this.now())
        const raced = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey} AND source_type='GASTO'`,
          ),
        )[0]
        if (raced) {
          if (requestFingerprintConflict(raced.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different expense',
            )
          }
          return {
            id: raced.id,
            shiftId: raced.shift_id,
            gastoId: raced.source_id,
            tender: raced.tender,
            amountCents: cents(raced.amount),
          }
        }
        const gasto = rows(
          await tx.execute(
            sql`SELECT importe::text,fecha FROM tesoreria.gastos WHERE id = ${input.gastoId}`,
          ),
        )[0]
        if (!gasto) throw BusinessError(ErrorCode.NOT_FOUND, 'Expense not found')
        if (gasto.fecha !== shift.business_date)
          throw BusinessError(
            ErrorCode.CONFLICT,
            'Gasto accounting date must equal the shift business date',
          )
        await tx.execute(
          sql`INSERT INTO tesoreria.dues_cash_shift_expenses (shift_id,gasto_id,operator_id) VALUES (${input.shiftId},${input.gastoId},${input.actorId})`,
        )
        const amount = cents(gasto.importe)
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint) VALUES (${input.shiftId},'EXPENSE',${input.tender},${money(amount)},'GASTO',${input.gastoId},${input.actorId},${input.callerKey},${input.requestFingerprint}) RETURNING *`,
          ),
        )[0]
        if (!inserted)
          throw BusinessError(ErrorCode.INTERNAL_ERROR, 'Expense tender was not recorded')
        await this.audit(tx, input, AuditAction.DUES_CASH_EXPENSE_INCLUDED, input.gastoId, {
          shiftId: input.shiftId,
          tender: input.tender,
          amountCents: amount,
        })
        return {
          id: inserted.id,
          shiftId: input.shiftId,
          gastoId: input.gastoId,
          tender: input.tender,
          amountCents: amount,
        }
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'Expense or idempotency key already exists')
        }
        throw error
      })
  }

  // prettier-ignore
  async reverseTender(input: ReverseTenderCommand) {
    authorizeManualTender(input.role)
    if (!input.reason.trim()) {
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A reversal reason is required')
    }
    return this.db
      .transaction(async (tx) => {
        const replay = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
          ),
        )[0]
        if (replay) {
          if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different reversal',
            )
          }
          return responseTender(replay)
        }
        const shift = await this.shift(tx, input.shiftId, input, true)
        this.assertWithinPolicy(shift, this.now())
        const original = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_tenders WHERE id = ${input.tenderId} AND shift_id = ${input.shiftId} FOR UPDATE`,
          ),
        )[0]
        if (!original) throw BusinessError(ErrorCode.NOT_FOUND, 'Tender not found')
        if (original.source_type !== 'MANUAL' || original.reverses_tender_id) {
          throw BusinessError(
            ErrorCode.CONFLICT,
            'Only manual movements that are not themselves reversals can be reversed',
          )
        }
        const existing = rows(
          await tx.execute(
            sql`SELECT id FROM tesoreria.dues_cash_tenders WHERE reverses_tender_id = ${original.id} FOR UPDATE`,
          ),
        )[0]
        if (existing) {
          throw BusinessError(ErrorCode.CONFLICT, 'This movement was already reversed')
        }
        const direction = original.direction === 'INCOME' ? 'EXPENSE' : 'INCOME'
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,reason,operator_id,caller_key,request_fingerprint,reverses_tender_id) VALUES (${input.shiftId},${direction},${original.tender},${original.amount},'MANUAL',${input.reason},${input.actorId},${input.callerKey},${input.requestFingerprint},${original.id}) RETURNING *`,
          ),
        )[0]
        if (!inserted) {
          throw BusinessError(ErrorCode.INTERNAL_ERROR, 'Reversal tender was not recorded')
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_TENDER_RECORDED, inserted.id, {
          shiftId: input.shiftId,
          reversesTenderId: original.id,
          direction,
          tender: original.tender,
          amountCents: cents(original.amount),
        })
        return responseTender(inserted)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'This movement was already reversed')
        }
        throw error
      })
  }

  async close(input: CloseCashCommand) {
    const forceClose = input.forceClose === true
    // Forced/recovery closes stay finance-only; an ordinary close is own-shift OPERADOR work (ownership enforced by shift()).
    if (forceClose) authorizeForceClose(input.role)
    else authorizeManualTender(input.role)
    if (forceClose && !input.reason?.trim()) {
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A forced cash close requires a reason')
    }
    // Drawer float (P9): the operator declares how much counted cash stays in the drawer
    // for change; only the excess sweeps to Valores a Depositar. Forced closes sweep
    // fully (finance recovery never leaves undeclared cash behind). Input-only checks run
    // before the transaction so they win over the recovery window gate.
    const drawerFloatCents = input.drawerFloatCents ?? 0
    if (forceClose && input.drawerFloatCents !== undefined) {
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'A forced close sweeps all computed cash and does not take a drawer float',
      )
    }
    if (!Number.isSafeInteger(drawerFloatCents) || drawerFloatCents < 0) {
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'The drawer float must be a non-negative integer amount in cents',
      )
    }
    const countedCashCents = input.countedTenders.CASH ?? 0
    if (drawerFloatCents > countedCashCents) {
      throw BusinessError(
        ErrorCode.VALIDATION_ERROR,
        'The drawer float cannot exceed the counted cash',
      )
    }
    return this.db
      .transaction(async (tx) => {
        const replay = rows(
          await tx.execute(
            sql`SELECT c.*, row_to_json(t.*) AS transfer FROM tesoreria.dues_cash_closes c LEFT JOIN tesoreria.dues_cash_close_transfers t ON t.close_id = c.id WHERE c.operator_id = ${input.actorId} AND c.caller_key = ${input.callerKey}`,
          ),
        )[0]
        if (replay) {
          if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different close',
            )
          }
          return responseClose(replay, (replay as { transfer?: Row | null }).transfer)
        }
        await tx.execute(
          sql`SELECT gasto_id FROM tesoreria.dues_cash_shift_expenses WHERE shift_id = ${input.shiftId} FOR UPDATE`,
        )
        const shift = await this.shift(tx, input.shiftId, input, true)
        if (shift.status !== 'OPEN') {
          const raced = rows(
            await tx.execute(
              sql`SELECT c.*, row_to_json(t.*) AS transfer FROM tesoreria.dues_cash_closes c LEFT JOIN tesoreria.dues_cash_close_transfers t ON t.close_id = c.id WHERE c.operator_id = ${input.actorId} AND c.caller_key = ${input.callerKey}`,
            ),
          )[0]
          if (raced) {
            if (requestFingerprintConflict(raced.request_fingerprint, input.requestFingerprint)) {
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Idempotency key was already used for a different close',
              )
            }
            return responseClose(raced, (raced as { transfer?: Row | null }).transfer)
          }
          throw BusinessError(ErrorCode.CONFLICT, 'Cash shift is already closed')
        }
        const closedAt = this.now()
        const recoveryAt = new Date(new Date(shift.opened_at).getTime() + 24 * 60 * 60 * 1000)
        if (forceClose && closedAt < recoveryAt) {
          throw BusinessError(
            ErrorCode.CONFLICT,
            'Forced cash close is available only after 24 hours',
          )
        }
        if (!forceClose) this.assertWithinPolicy(shift, closedAt)
        const movements = rows(
          await tx.execute(
            sql`SELECT tender,direction,amount::text FROM tesoreria.dues_cash_tenders WHERE shift_id = ${input.shiftId} AND created_at >= ${shift.opened_at} AND created_at <= ${closedAt} ORDER BY created_at,id`,
          ),
        ).map((row) => ({
          tender: row.tender,
          direction: row.direction as Direction,
          amountCents: cents(row.amount),
        }))
        // Server-recomputed CASH: opening once + CASH income − CASH expenses (close transfers live in their own table and never re-enter here).
        const openingCashCents = clean(shift.opening_tenders).CASH ?? 0
        let cashIncome = 0
        let cashExpense = 0
        for (const movement of movements) {
          if (movement.tender !== 'CASH') continue
          if (movement.direction === 'INCOME') cashIncome += movement.amountCents
          else cashExpense += movement.amountCents
        }
        const computedCashCents = openingCashCents + cashIncome - cashExpense
        // prettier-ignore
        if (computedCashCents < 0) throw BusinessError(ErrorCode.CONFLICT, `Computed cash is negative (opening ${openingCashCents}, cash income ${cashIncome}, cash expense ${cashExpense}); refetch the current shift state`)
        const totals = reconcileTenders(
          clean(shift.opening_tenders),
          movements,
          input.countedTenders,
          input.reason,
        )
        const inserted = rows(
          await tx.execute(
            sql`INSERT INTO tesoreria.dues_cash_closes (shift_id,expected_tenders,counted_tenders,discrepancy,reason,force_close,operator_id,authorization_evidence,caller_key,request_fingerprint,closed_at) VALUES (${input.shiftId},${JSON.stringify(totals.expected)}::jsonb,${JSON.stringify(totals.counted)}::jsonb,${JSON.stringify(totals.discrepancy)}::jsonb,${input.reason ?? null},${forceClose},${input.actorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint},${closedAt}) ON CONFLICT (operator_id,caller_key) DO NOTHING RETURNING *`,
          ),
        )[0]
        if (!inserted)
          throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Close replay is unavailable')
        let transfer: Row | null = null
        const transferCents = Math.max(0, computedCashCents - drawerFloatCents)
        if (transferCents > 0) {
          const account = await resolveAccountSnapshot(tx, '1.1.3.02')
          // prettier-ignore
          if (!account) throw BusinessError(ErrorCode.CONFLICT, 'The close transfer account is unavailable')
          transfer =
            rows(
              await tx.execute(
                sql`INSERT INTO tesoreria.dues_cash_close_transfers (close_id,shift_id,account_code_snapshot,account_name_snapshot,account_path_snapshot,amount) VALUES (${inserted.id},${input.shiftId},${account.code},${account.name},${JSON.stringify(account.path)}::jsonb,${money(transferCents)}) RETURNING *`,
              ),
            )[0] ?? null
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_SHIFT_CLOSED, input.shiftId, {
          expected: totals.expected,
          counted: totals.counted,
          discrepancy: totals.discrepancy,
          reason: input.reason ?? null,
          forceClose,
          computedCashCents,
          closeTransferId: transfer?.id ?? null,
          businessDate: shift.business_date,
          interval: { startInclusive: shift.opened_at, endInclusive: closedAt.toISOString() },
        })
        return responseClose(inserted, transfer)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'Cash shift already has a close')
        }
        throw error
      })
  }
}
