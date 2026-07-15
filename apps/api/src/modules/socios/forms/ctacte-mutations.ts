import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { Db } from '@athlos/db'
import type { LocalFileStorage } from '../../file-storage/local-file-storage.ts'
import {
  findCtacteByIdempotencyKey,
  insertCtacteRow,
  listMovementsByDateRange,
} from '../../ctacte/repository.ts'
import { findById as findSocioById } from '../../socios/repository.ts'
import {
  compensateNewAttachment,
  getAttachment,
  uploadAttachment,
} from '../../socios/attachments.ts'
import { emitAudit } from '@athlos/audit'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * `ctacte-mutations` service — operator-driven mutations on a socio's
 * cuenta-corriente ledger.
 *
 * PR A1a (athlos-ctacte-mutations) — backend write surface. Routes are
 * added in PR A1b; this service is the business-logic layer the
 * route handlers will call into.
 *
 * Mutates the existing `tesoreria.ctacte` table:
 *   - `registerPayment`  → INSERT CREDITO (haber populated, debe='0.00')
 *   - `registerDebit`    → INSERT DEBITO (debe populated, haber='0.00')
 *   - `getMovementsForComprobante` → date-range slice for the PDF flow
 *
 * Payment and debit ledger inserts emit their matching audit event through
 * the same database transaction. Audit failures propagate so neither side
 * can commit without the other; durable caller keys identify retries.
 *
 * Comprobante upload delegates to the existing `uploadAttachment`
 * service from PR 8c.1 — MIME / size / quota validation, magic-byte
 * sniff, and SHA-256 are all already implemented there. We don't
 * re-implement any of that.
 */

export interface CtacteMovementRow {
  id: string
  fecha: string
  /** API shape: 'DEBITO' or 'CREDITO' (matches the DB column). */
  tipo: 'DEBITO' | 'CREDITO'
  monto: number
  /** Present for payments. */
  concepto: string | null
  /** Present for debits (stored in the DB `concepto` column). */
  motivo: string | null
  comprobanteAttachmentId: string | null
  /** Running balance after this movement. Computed via `getSaldo`. */
  saldo: number
}

export interface RegisterPaymentParams {
  db: Db
  storage: LocalFileStorage
  socioId: string
  operatorId: string
  monto: number
  fecha: string
  concepto: string
  /** Optional comprobante file. When present, the bytes are uploaded
   *  via `uploadAttachment(category='comprobante')` and the returned
   *  attachment id is persisted on the ctacte row. */
  comprobante?: {
    bytes: Buffer
    mimeType: string
    filename: string
  }
  /** Required stable retry key, enforced by the ledger's UNIQUE index. */
  idempotencyKey: string
}

/**
 * Register a payment (pago) on the socio's cuenta-corriente.
 *
 * The comprobante upload happens before the database transaction because
 * the filesystem cannot participate in PostgreSQL atomicity. The payment
 * row and audit row commit in one transaction; after any transaction
 * failure, the newly uploaded attachment is compensated through the outer
 * database handle.
 */
export async function registerPayment(params: RegisterPaymentParams): Promise<CtacteMovementRow> {
  if (!Number.isFinite(params.monto) || params.monto <= 0) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'monto must be > 0', {
      field: 'monto',
      message: 'must be > 0',
    })
  }
  const socio = await findSocioById(params.db, params.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  if (!isValidIsoCalendarDate(params.fecha)) {
    throw invalidFechaError()
  }
  if (params.fecha < socio.fechaAlta || params.fecha > todayIsoDate()) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, "fecha is outside socio's relationship range", [
      { field: 'fecha', message: "outside socio's relationship range" },
    ])
  }

  const existing = await findCtacteByIdempotencyKey(params.db, params.idempotencyKey)
  if (existing) {
    await assertMatchingPaymentRetry(params, existing)
    return paymentMovement(existing)
  }

  let comprobanteAttachmentId: string | null = null
  if (params.comprobante) {
    const attachment = await uploadAttachment({
      db: params.db,
      storage: params.storage,
      socioId: params.socioId,
      operatorId: params.operatorId,
      fileStream: Readable.from(params.comprobante.bytes),
      declaredMimeType: params.comprobante.mimeType,
      filename: params.comprobante.filename,
      category: 'comprobante',
    })
    comprobanteAttachmentId = attachment.id
  }

  type TxRow = Awaited<ReturnType<typeof insertCtacteRow>>['row']
  try {
    const outcome = await params.db.transaction(async (tx) => {
      const inserted = await insertCtacteRow(tx, {
        socioId: params.socioId,
        fecha: params.fecha,
        tipo: 'CREDITO',
        concepto: params.concepto,
        monto: params.monto.toFixed(2),
        comprobanteAttachmentId,
        idempotencyKey: params.idempotencyKey,
        idempotencyOperatorId: params.operatorId,
      })
      if (!inserted.created) return { created: false as const, row: inserted.row }

      await emitPaymentAudit(
        tx,
        inserted.row,
        params.operatorId,
        comprobanteAttachmentId,
        params.monto,
        params.idempotencyKey,
      )
      return { created: true as const, row: inserted.row }
    })

    if (!outcome.created) {
      await compensateOrphanedComprobante(params.db, comprobanteAttachmentId, params.storage)
      await assertMatchingPaymentRetry(params, outcome.row)
    }
    return paymentMovement(outcome.row as TxRow)
  } catch (error) {
    await compensateOrphanedComprobante(params.db, comprobanteAttachmentId, params.storage)
    throw error
  }
}

async function compensateOrphanedComprobante(
  db: Db,
  comprobanteAttachmentId: string | null,
  storage: LocalFileStorage,
): Promise<void> {
  if (comprobanteAttachmentId === null) return
  await compensateNewAttachment(db, comprobanteAttachmentId, storage)
}

async function assertMatchingPaymentRetry(
  params: RegisterPaymentParams,
  existing: {
    socioId: string
    fecha: string
    tipo: string
    concepto: string
    haber: string
    comprobanteAttachmentId: string | null
    idempotencyOperatorId: string | null
  },
): Promise<void> {
  const expectedAttachmentHash = params.comprobante
    ? createHash('sha256').update(params.comprobante.bytes).digest('hex')
    : null
  let existingAttachmentHash: string | null = null
  if (existing.comprobanteAttachmentId) {
    existingAttachmentHash =
      (await getAttachment(existing.comprobanteAttachmentId, params.db))?.storageSha256 ?? null
  }
  if (
    existing.socioId !== params.socioId ||
    existing.idempotencyOperatorId !== params.operatorId ||
    existing.tipo !== 'CREDITO' ||
    existing.fecha !== params.fecha ||
    existing.concepto !== params.concepto ||
    existing.haber !== params.monto.toFixed(2) ||
    existingAttachmentHash !== expectedAttachmentHash
  ) {
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Idempotency-Key was already used for a different payment',
    )
  }
}

function paymentMovement(row: {
  id: string
  fecha: string
  haber: string
  concepto: string
  comprobanteAttachmentId: string | null
}): CtacteMovementRow {
  return {
    id: row.id,
    fecha: row.fecha,
    tipo: 'CREDITO',
    monto: Number(row.haber),
    concepto: row.concepto,
    motivo: null,
    comprobanteAttachmentId: row.comprobanteAttachmentId,
    saldo: 0,
  }
}

export interface RegisterDebitParams {
  db: Db
  socioId: string
  operatorId: string
  monto: number
  fecha: string
  motivo: string
  idempotencyKey: string
}

/**
 * Register a debit (cargo) on the socio's cuenta-corriente.
 *
 * Mirrors `registerPayment` but with `tipo='DEBITO'` and no
 * comprobante. The `motivo` is stored in the DB `concepto` column
 * (the schema has no dedicated `motivo` column — same precedent
 * as the legacy VFP import).
 */
export async function registerDebit(params: RegisterDebitParams): Promise<CtacteMovementRow> {
  if (!Number.isFinite(params.monto) || params.monto <= 0) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'monto must be > 0', {
      field: 'monto',
      message: 'must be > 0',
    })
  }
  const socio = await findSocioById(params.db, params.socioId)
  if (!socio) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  if (!isValidIsoCalendarDate(params.fecha)) {
    throw invalidFechaError()
  }

  const result = await params.db.transaction(async (tx) => {
    const inserted = await insertCtacteRow(tx, {
      socioId: params.socioId,
      fecha: params.fecha,
      tipo: 'DEBITO',
      concepto: params.motivo,
      monto: params.monto.toFixed(2),
      comprobanteAttachmentId: null,
      idempotencyKey: params.idempotencyKey,
      idempotencyOperatorId: params.operatorId,
    })
    if (inserted.created) {
      await emitDebitAudit(
        tx,
        inserted.row,
        params.operatorId,
        params.motivo,
        params.monto,
        params.idempotencyKey,
      )
    }
    return inserted
  })

  if (!result.created) {
    const existing = result.row
    if (
      existing.socioId !== params.socioId ||
      existing.idempotencyOperatorId !== params.operatorId ||
      existing.tipo !== 'DEBITO' ||
      existing.fecha !== params.fecha ||
      existing.concepto !== params.motivo ||
      existing.debe !== params.monto.toFixed(2)
    ) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'Idempotency-Key was already used for a different debit',
      )
    }
  }

  return {
    id: result.row.id,
    fecha: result.row.fecha,
    tipo: 'DEBITO',
    monto: Number(result.row.debe),
    concepto: null,
    motivo: params.motivo,
    comprobanteAttachmentId: null,
    saldo: 0,
  }
}

export interface GetMovementsForComprobanteParams {
  db: Db
  socioId: string
  /** The cuenta identifier from the route query string. Kept in the
   *  signature for parity with the spec contract; the v1 PDF flow
   *  doesn't filter by cuenta (it lists all movements in the date
   *  range for the socio). Future per-cuenta isolation may use it. */
  cuenta: string
  from: string
  to: string
}

/**
 * Fetch the movements for a comprobante PDF — date range, ordered
 * by `fecha ASC`, fetching at most 51 movements to distinguish an
 * exact 50-row result from an over-cap range. Throws a typed
 * `BusinessError(VALIDATION_ERROR)` when the snapshot contains more
 * than 50 — the route layer maps this to `400 VALIDATION_ERROR`.
 *
 * The 51-row query and service-level check are the authoritative
 * comprobante contract; they avoid a separate count/fetch snapshot.
 */
export async function getMovementsForComprobante(
  params: GetMovementsForComprobanteParams,
): Promise<CtacteMovementRow[]> {
  const rows = await listMovementsByDateRange(params.db, {
    socioId: params.socioId,
    from: params.from,
    to: params.to,
    limit: 51,
  })
  if (rows.length > 50) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'too_many_movements', {
      cap: 50,
      requested: rows.length,
    })
  }
  return rows.map((row) => ({
    id: row.id,
    fecha: row.fecha,
    tipo: row.tipo,
    monto: Number(row.haber === '0.00' ? row.debe : row.haber),
    concepto: row.tipo === 'CREDITO' ? row.concepto : null,
    motivo: row.tipo === 'DEBITO' ? row.concepto : null,
    comprobanteAttachmentId: row.comprobanteAttachmentId ?? null,
    saldo: 0,
  }))
}

function todayIsoDate(): string {
  return argentinaBusinessDate(new Date())
}

export function argentinaBusinessDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isValidIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
  )
}

function invalidFechaError() {
  return BusinessError(ErrorCode.VALIDATION_ERROR, 'fecha must be a valid ISO calendar date', [
    { field: 'fecha', message: 'must be a valid ISO calendar date' },
  ])
}

/**
 * Emit `CTACTE_PAYMENT_REGISTERED` inside the caller's transaction.
 * Errors propagate so PostgreSQL rolls back the payment row before the
 * outer catch compensates a newly uploaded comprobante.
 */
async function emitPaymentAudit(
  tx: Db | Tx,
  row: { id: string; socioId: string; fecha: string; concepto: string },
  operatorId: string,
  comprobanteAttachmentId: string | null,
  monto: number,
  callerKey: string,
): Promise<void> {
  await emitAudit(tx, {
    operatorId,
    action: 'CTACTE_PAYMENT_REGISTERED',
    entityType: 'ctacte_movement',
    entityId: row.id,
    oldValue: null,
    newValue: {
      id: row.id,
      socio_id: row.socioId,
      fecha: row.fecha,
      concepto: row.concepto,
      monto,
      comprobante_attachment_id: comprobanteAttachmentId,
    },
    sourceIp: null,
    payload: { id: row.id, monto, fecha: row.fecha },
    metadata: {
      ctacte_id: row.socioId,
      movement_id: row.id,
      monto,
      fecha: row.fecha,
      concepto: row.concepto,
      comprobante_attachment_id: comprobanteAttachmentId,
    },
    callerKey,
  })
}

/**
 * Emit `CTACTE_DEBIT_REGISTERED` inside the caller's transaction with the
 * exact 5-key metadata shape pinned by the audit-logger spec delta:
 *   - ctacte_id
 *   - movement_id
 *   - monto
 *   - fecha
 *   - motivo
 */
async function emitDebitAudit(
  tx: Db | Tx,
  row: { id: string; socioId: string; fecha: string; concepto: string },
  operatorId: string,
  motivo: string,
  monto: number,
  callerKey: string,
): Promise<void> {
  await emitAudit(tx, {
    operatorId,
    action: 'CTACTE_DEBIT_REGISTERED',
    entityType: 'ctacte_movement',
    entityId: row.id,
    oldValue: null,
    newValue: {
      id: row.id,
      socio_id: row.socioId,
      fecha: row.fecha,
      motivo,
      monto,
    },
    sourceIp: null,
    payload: { id: row.id, monto, fecha: row.fecha },
    metadata: {
      ctacte_id: row.socioId,
      movement_id: row.id,
      monto,
      fecha: row.fecha,
      motivo,
    },
    callerKey,
  })
}
