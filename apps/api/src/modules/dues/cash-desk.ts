import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { createSha256Fingerprint } from '../../lib/idempotency.ts'
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
  kind: string
  original_gasto_id: string
  compensating_gasto_id: string
  fecha: string
  importe: string
  opening_tenders: Totals
}

const rows = (value: unknown) => (value as { rows?: Row[] }).rows ?? []
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

export function reconcileTenders(
  opening: Totals,
  movements: Tender[],
  counted: Totals,
  reason?: string,
) {
  const openingCash = clean(opening).CASH
  const expected: Totals = openingCash === undefined ? {} : { CASH: openingCash }
  for (const movement of movements) {
    if (movement.tender !== 'CASH') continue
    expected.CASH =
      (expected.CASH ?? 0) +
      (movement.direction === 'INCOME' ? movement.amountCents : -movement.amountCents)
  }
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

const authorize = (role: string) => {
  if (role !== 'ADMIN' && role !== 'TESORERO') {
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Cash desk action is not authorized')
  }
}

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

const responseClose = (row: Row) => ({
  id: row.id,
  shiftId: row.shift_id,
  expectedTenders: row.expected_tenders,
  countedTenders: row.counted_tenders,
  discrepancy: row.discrepancy,
  reason: row.reason,
  closedAt: new Date(row.closed_at!).toISOString(),
  ...(row.force_close ? { forceClose: true } : {}),
})

export type CashCommand = AuditContext & { role: AuditContext['role'] }
export type OpenCashCommand = CashCommand & { deskId: string; openingTenders: Totals }
export type TenderCommand = CashCommand & {
  shiftId: string
  direction: Direction
  tender: string
  amountCents: number
  sourceType: 'SETTLEMENT' | 'MANUAL'
  sourceId?: string
  reason?: string
}
export type ExpenseCommand = CashCommand & { shiftId: string; gastoId: string; tender: string }
export type SettlementTenderInput = CashCommand & {
  shiftId: string
  settlementId: string
  tender: 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'
}
export type CloseCashCommand = CashCommand & {
  shiftId: string
  countedTenders: Totals
  reason?: string
  forceClose?: boolean
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
  authorize(input.role)
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
    if (row.assigned_operator_id !== input.actorId && input.role !== 'ADMIN') {
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
    authorize(input.role)
    const opening = clean(input.openingTenders)
    const openedAt = this.now()
    const businessDate = businessDateForOpening(openedAt)
    return this.db
      .transaction(async (tx) => {
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
          throw BusinessError(ErrorCode.CONFLICT, 'Desk already has an open shift')
        }
        await this.audit(tx, input, AuditAction.DUES_CASH_SHIFT_OPENED, inserted.id, {
          deskId: input.deskId,
          businessDate,
        })
        return responseShift(inserted)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'Desk already has an open shift')
        }
        throw error
      })
  }

  async list(input: CashCommand) {
    authorize(input.role)
    return rows(
      await this.db.execute(
        sql`SELECT id,desk_id,status,assigned_operator_id,business_date,opened_at,closed_at FROM tesoreria.dues_cash_shifts ORDER BY opened_at DESC LIMIT 50`,
      ),
    ).map(responseShift)
  }

  async recordTender(input: TenderCommand) {
    authorize(input.role)
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
        await this.audit(tx, input, AuditAction.DUES_CASH_TENDER_RECORDED, inserted.id, {
          shiftId: input.shiftId,
          direction: input.direction,
          tender: input.tender,
          amountCents: amount,
          sourceType: input.sourceType,
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

  async close(input: CloseCashCommand) {
    authorize(input.role)
    const forceClose = input.forceClose === true
    if (forceClose) authorizeForceClose(input.role)
    if (forceClose && !input.reason?.trim()) {
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'A forced cash close requires a reason')
    }
    return this.db
      .transaction(async (tx) => {
        const replay = rows(
          await tx.execute(
            sql`SELECT * FROM tesoreria.dues_cash_closes WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
          ),
        )[0]
        if (replay) {
          if (requestFingerprintConflict(replay.request_fingerprint, input.requestFingerprint)) {
            throw BusinessError(
              ErrorCode.CONFLICT,
              'Idempotency key was already used for a different close',
            )
          }
          return responseClose(replay)
        }
        await tx.execute(
          sql`SELECT gasto_id FROM tesoreria.dues_cash_shift_expenses WHERE shift_id = ${input.shiftId} FOR UPDATE`,
        )
        const shift = await this.shift(tx, input.shiftId, input, true)
        if (shift.status !== 'OPEN') {
          const raced = rows(
            await tx.execute(
              sql`SELECT * FROM tesoreria.dues_cash_closes WHERE operator_id = ${input.actorId} AND caller_key = ${input.callerKey}`,
            ),
          )[0]
          if (raced) {
            if (requestFingerprintConflict(raced.request_fingerprint, input.requestFingerprint)) {
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Idempotency key was already used for a different close',
              )
            }
            return responseClose(raced)
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
        await this.audit(tx, input, AuditAction.DUES_CASH_SHIFT_CLOSED, input.shiftId, {
          expected: totals.expected,
          counted: totals.counted,
          discrepancy: totals.discrepancy,
          reason: input.reason ?? null,
          forceClose,
          businessDate: shift.business_date,
          interval: { startInclusive: shift.opened_at, endInclusive: closedAt.toISOString() },
        })
        return responseClose(inserted)
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw BusinessError(ErrorCode.CONFLICT, 'Cash shift already has a close')
        }
        throw error
      })
  }
}
