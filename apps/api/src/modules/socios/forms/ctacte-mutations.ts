import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { Db } from '@athlos/db'
import type { LocalFileStorage } from '../../file-storage/local-file-storage.ts'
import {
  countMovementsByDateRange,
  findCtacteByIdempotencyKey,
  insertCtacteRow,
  listMovementsByDateRange,
} from '../../ctacte/repository.ts'
import { findById as findSocioById } from '../../socios/repository.ts'
import { getAttachment, uploadAttachment } from '../../socios/attachments.ts'
import { emitAudit } from '@athlos/audit'

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
 * Audit emission is best-effort via the shared `emitAudit` wrapper
 * from `@athlos/audit` (the SHA-256 10s-bucket dedup wrapper). Pago
 * and débito retries within 10s collapse to one row — that's the
 * DESIRED behaviour for those mutations. The wrapper swallows audit
 * failures so a missed row never masks the primary write.
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
 *  1. Verify the socio exists (throws NOT_FOUND → 404).
 *  2. Validate monto > 0 (throws VALIDATION_ERROR → 400).
 *  3. If comprobante present, upload it via the existing attachments
 *     route (`category='comprobante'`).
 *  4. INSERT the CREDITO row with `haber = monto.toFixed(2)` and the
 *     uploaded attachment id (or NULL).
 *  5. Emit `CTACTE_PAYMENT_REGISTERED` audit with the exact 6-key
 *     metadata shape (`comprobante_attachment_id` is JSON null when
 *     no comprobante was uploaded — key present, value null).
 *
 * The audit emission is best-effort: a failure here does NOT roll
 * back the pago. The caller already has the movement row in hand.
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

  const result = await insertCtacteRow(params.db, {
    socioId: params.socioId,
    fecha: params.fecha,
    tipo: 'CREDITO',
    concepto: params.concepto,
    monto: params.monto.toFixed(2),
    comprobanteAttachmentId,
    idempotencyKey: params.idempotencyKey,
  })

  if (!result.created) {
    await assertMatchingPaymentRetry(params, result.row)
    return paymentMovement(result.row)
  }

  await emitPaymentAudit(
    params.db,
    result.row,
    params.operatorId,
    comprobanteAttachmentId,
    params.monto,
  )

  return paymentMovement(result.row)
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

  const result = await insertCtacteRow(params.db, {
    socioId: params.socioId,
    fecha: params.fecha,
    tipo: 'DEBITO',
    concepto: params.motivo,
    monto: params.monto.toFixed(2),
    comprobanteAttachmentId: null,
  })

  await emitDebitAudit(params.db, result.row, params.operatorId, params.motivo, params.monto)

  return {
    id: result.row.id,
    fecha: result.row.fecha,
    tipo: 'DEBITO',
    monto: params.monto,
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
 * by `fecha ASC`, hard-capped at 50 movements. Throws a typed
 * `BusinessError(QUOTA_EXCEEDED)` when the repository returns more
 * than 50 — the route layer maps this to `400 VALIDATION_ERROR`.
 *
 * The cap is also enforced at SQL level in the repository (defense
 * in depth). This service-level check is the authoritative contract
 * for the comprobante route.
 */
export async function getMovementsForComprobante(
  params: GetMovementsForComprobanteParams,
): Promise<CtacteMovementRow[]> {
  const requested = await countMovementsByDateRange(params.db, {
    socioId: params.socioId,
    from: params.from,
    to: params.to,
  })
  if (requested > 50) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'too_many_movements', {
      cap: 50,
      requested,
    })
  }
  const rows = await listMovementsByDateRange(params.db, {
    socioId: params.socioId,
    from: params.from,
    to: params.to,
    limit: 50,
  })
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
  return new Date().toISOString().slice(0, 10)
}

/**
 * Best-effort emission of `CTACTE_PAYMENT_REGISTERED` with the exact
 * 6-key metadata shape pinned by the audit-logger spec delta:
 *   - ctacte_id              (the socio's cuenta ID — same value as
 *                             movement_id for this domain; kept
 *                             separate for future schema splits)
 *   - movement_id
 *   - monto
 *   - fecha
 *   - concepto
 *   - comprobante_attachment_id (nullable — JSON null when absent)
 *
 * A failed emit becomes a `console.error`; the primary write is
 * never rolled back.
 */
async function emitPaymentAudit(
  db: Db,
  row: { id: string; socioId: string; fecha: string; concepto: string },
  operatorId: string,
  comprobanteAttachmentId: string | null,
  monto: number,
): Promise<void> {
  try {
    await emitAudit(db, {
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
    })
  } catch (err) {
    console.error('[ctacte-mutations] failed to emit CTACTE_PAYMENT_REGISTERED', err)
  }
}

/**
 * Best-effort emission of `CTACTE_DEBIT_REGISTERED` with the exact
 * 5-key metadata shape pinned by the audit-logger spec delta:
 *   - ctacte_id
 *   - movement_id
 *   - monto
 *   - fecha
 *   - motivo
 */
async function emitDebitAudit(
  db: Db,
  row: { id: string; socioId: string; fecha: string; concepto: string },
  operatorId: string,
  motivo: string,
  monto: number,
): Promise<void> {
  try {
    await emitAudit(db, {
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
    })
  } catch (err) {
    console.error('[ctacte-mutations] failed to emit CTACTE_DEBIT_REGISTERED', err)
  }
}
