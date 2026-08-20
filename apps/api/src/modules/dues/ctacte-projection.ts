import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { sql } from 'drizzle-orm'
import { BusinessError, ErrorCode } from '@athlos/errors'
import type { AuditContext } from './service.ts'

type DuesDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0]
type Row = Record<string, unknown>
export type ProjectionSourceType = 'OBLIGATION' | 'SETTLEMENT'
export type MovementType = 'DEBITO' | 'CREDITO'
// prettier-ignore
export type NativeProjection = { sourceType:ProjectionSourceType; sourceId:string; socioId:string; amountCents:number; currency:string; fecha:string; movementType:MovementType }
// prettier-ignore
export type ProjectionRow = { id:string; socioId:string; fecha:string; tipo:MovementType; concepto:string; debe:string; haber:string; idempotencyKey:string|null }
// prettier-ignore
export type ProjectionResult = NativeProjection & { status:'PROJECTED'|'REPLAYED'|'DIVERGENT'|'SKIPPED'; ctacteId:string|null; missing:boolean; divergent:boolean; retryCount:number; reason?:string }
// prettier-ignore
export type ProjectionCommand = AuditContext & { sourceType:ProjectionSourceType; sourceId:string }
// prettier-ignore
export type ProjectionRepository = { findNative(db:DuesDb,sourceType:ProjectionSourceType,sourceId:string):Promise<NativeProjection|null>; findProjection(db:DuesDb,idempotencyKey:string):Promise<ProjectionRow|null>; insertProjection(db:DuesDb,input:ReturnType<typeof projectionValues>):Promise<{created:boolean;row:ProjectionRow}> }
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>

const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? []
// prettier-ignore
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) }
const money = (value: number) => (Math.abs(value) / 100).toFixed(2)
// prettier-ignore
export function projectionKey(sourceType: ProjectionSourceType, sourceId: string): string { return `dues:ctacte:${sourceType}:${sourceId}` }
// prettier-ignore
function projectionValues(native: NativeProjection, requestFingerprint: string, operatorId: string) { return { legacyId: projectionKey(native.sourceType, native.sourceId), idempotencyKey: requestFingerprint, idempotencyOperatorId: operatorId, socioId: native.socioId, fecha: native.fecha, tipo: native.movementType, concepto: `Dues ${native.sourceType.toLowerCase()} ${native.sourceId}`, monto: money(native.amountCents) } }
// prettier-ignore
function mapProjection(row: Row): ProjectionRow { return { id: String(row.id), socioId: String(row.socioId), fecha: String(row.fecha), tipo: row.tipo as MovementType, concepto: String(row.concepto), debe: String(row.debe), haber: String(row.haber), idempotencyKey: row.idempotencyKey == null ? null : String(row.idempotencyKey) } }
// prettier-ignore
async function findNative(db: DuesDb, sourceType: ProjectionSourceType, sourceId: string) {
  const result = sourceType === 'OBLIGATION' ? await db.execute(sql`SELECT id,socio_id AS "socioId",amount::text,period_start AS fecha FROM tesoreria.dues_obligations WHERE id=${sourceId}`) : await db.execute(sql`SELECT id,socio_id AS "socioId",amount::text,btrim(currency) AS currency,created_at::date AS fecha,reversal_of_settlement_id AS "reversalOfSettlementId" FROM tesoreria.dues_settlements WHERE id=${sourceId}`)
  const row = rows<Row>(result)[0]
  if (!row) return null
  const amountCents = cents(String(row.amount))
  return { sourceType, sourceId: String(row.id), socioId: String(row.socioId), amountCents, currency: String(row.currency ?? 'ARS'), fecha: String(row.fecha), movementType: sourceType === 'OBLIGATION' ? amountCents >= 0 ? 'DEBITO' : 'CREDITO' : row.reversalOfSettlementId ? 'DEBITO' : 'CREDITO' } satisfies NativeProjection
}
// prettier-ignore
async function findProjection(db: DuesDb, legacyId: string) { const result = await db.execute(sql`SELECT id,socio_id AS "socioId",fecha,tipo,concepto,debe::text,haber::text,idempotency_key AS "idempotencyKey" FROM tesoreria.ctacte WHERE legacy_id=${legacyId}`); const row = rows<Row>(result)[0]; return row ? mapProjection(row) : null }
// prettier-ignore
async function insertProjection(db: DuesDb, input: ReturnType<typeof projectionValues>) {
  const result = await db.execute(sql`INSERT INTO tesoreria.ctacte (socio_id,fecha,tipo,concepto,debe,haber,legacy_id,idempotency_key,idempotency_operator_id) VALUES (${input.socioId},${input.fecha},${input.tipo},${input.concepto},${input.tipo === 'DEBITO' ? input.monto : '0.00'},${input.tipo === 'CREDITO' ? input.monto : '0.00'},${input.legacyId},${input.idempotencyKey},${input.idempotencyOperatorId}) ON CONFLICT DO NOTHING RETURNING id,socio_id AS "socioId",fecha,tipo,concepto,debe::text,haber::text,idempotency_key AS "idempotencyKey"`)
  const inserted = rows<Row>(result)[0]
  if (inserted) return { created: true, row: mapProjection(inserted) }
  const existing = await findProjection(db, input.legacyId)
  if (!existing) throw BusinessError(ErrorCode.CONFLICT, 'Projection fingerprint is already used by another native record')
  return { created: false, row: existing }
}
// prettier-ignore
const defaultRepository: ProjectionRepository = { findNative, findProjection, insertProjection }
// prettier-ignore
const same = (row: ProjectionRow, values: ReturnType<typeof projectionValues>) => row.socioId === values.socioId && row.fecha === values.fecha && row.tipo === values.tipo && row.concepto === values.concepto && Number(row.debe) === (values.tipo === 'DEBITO' ? Number(values.monto) : 0) && Number(row.haber) === (values.tipo === 'CREDITO' ? Number(values.monto) : 0)
// prettier-ignore
const retryable = (error: unknown) => ['40001', '40P01'].includes((error as { code?: string })?.code ?? '')

export class CtacteProjectionService {
  private readonly repository: ProjectionRepository
  private readonly audit: AuditEmitter
  // prettier-ignore
  constructor(private readonly db: Db, dependencies: { repository?: ProjectionRepository; audit?: AuditEmitter } = {}) { this.repository = dependencies.repository ?? defaultRepository; this.audit = dependencies.audit ?? emitAudit }
  // prettier-ignore
  async project(input: ProjectionCommand): Promise<ProjectionResult> {
    if (input.role !== 'ADMIN' && input.role !== 'TESORERO') throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Ctacte projection is not authorized')
    let retryCount = 0
    if (!/^[a-f0-9]{64}$/i.test(input.requestFingerprint)) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Projection request fingerprint is invalid')
    for (let attempt = 0; attempt < 2; attempt += 1) try {
      return await this.db.transaction(async (tx) => {
        const native = await this.repository.findNative(tx, input.sourceType, input.sourceId)
        if (!native) throw BusinessError(ErrorCode.NOT_FOUND, 'Native dues record not found')
        if (native.currency !== 'ARS') return { ...native, status: 'SKIPPED' as const, ctacteId: null, missing: true, divergent: false, retryCount, reason: 'LEGACY_CURRENCY_UNSUPPORTED' }
        const values = projectionValues(native,input.requestFingerprint,input.actorId), existing = await this.repository.findProjection(tx, values.legacyId)
        if (existing) { if (existing.idempotencyKey !== input.requestFingerprint) throw BusinessError(ErrorCode.CONFLICT, 'Projection fingerprint conflicts with existing projection'); return { ...native, status: same(existing, values) ? 'REPLAYED' as const : 'DIVERGENT' as const, ctacteId: existing.id, missing: false, divergent: !same(existing, values), retryCount, ...(same(existing, values) ? {} : { reason: 'LEGACY_PROJECTION_CONFLICT' }) } }
        const inserted = await this.repository.insertProjection(tx, values)
        if (!inserted.created) { if (inserted.row.idempotencyKey !== input.requestFingerprint) throw BusinessError(ErrorCode.CONFLICT, 'Projection fingerprint conflicts with existing projection'); return { ...native, status: same(inserted.row, values) ? 'REPLAYED' as const : 'DIVERGENT' as const, ctacteId: inserted.row.id, missing: false, divergent: !same(inserted.row, values), retryCount } }
        await this.audit(tx, { action: AuditAction.DUES_CTACTE_PROJECTED, operatorId: input.actorId, entityType: 'ctacte_projection', entityId: native.sourceId, oldValue: null, newValue: { nativeType: native.sourceType, nativeId: native.sourceId, ctacteId: inserted.row.id, movementType: native.movementType, amountCents: Math.abs(native.amountCents), currency: native.currency }, sourceIp: input.sourceIp, callerKey: input.callerKey, metadata: { actorId: input.actorId, role: input.role, permissions: input.permissions, authorizationEvidence: input.authorizationEvidence, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, time: new Date().toISOString() } })
        return { ...native, status: 'PROJECTED' as const, ctacteId: inserted.row.id, missing: false, divergent: false, retryCount }
      })
    } catch (error) {
      if (!retryable(error) || attempt === 1) throw error
      retryCount += 1
    }
    throw new Error('Ctacte projection retry exhausted')
  }
}
