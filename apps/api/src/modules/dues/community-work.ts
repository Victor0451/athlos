import { sql } from 'drizzle-orm'
import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as allocations from './allocations.ts'
import type { DuesTransaction } from './repository.ts'
import type { AuditContext } from './service.ts'

// prettier-ignore
type DuesDb = Db | DuesTransaction;
type Json = Record<string, unknown>
// prettier-ignore
export type CommunityWork = { id: string; socioId: string; obligationId: string; agreementId: string | null; settlementId: string; amountCents: number; replayed?: boolean; allocationId?: string }
// prettier-ignore
export type CommunityWorkCommand = AuditContext & { socioId: string; obligationId: string; agreementId?: string; amountCents: number; evidence: Json; reason: string }
// prettier-ignore
const rows = <T>(value: unknown) => (value as { rows?: T[] }).rows ?? [], cents = (amount: string) => Math.round(Number(amount) * 100), money = (amount: number) => (amount / 100).toFixed(2)
// prettier-ignore
const work = (row: { id: string; socioId: string; obligationId: string; agreementId: string | null; settlementId: string; amount: string }): CommunityWork => ({ id: row.id, socioId: row.socioId, obligationId: row.obligationId, agreementId: row.agreementId, settlementId: row.settlementId, amountCents: cents(row.amount) })
// prettier-ignore
const fields = sql`id,socio_id AS "socioId",obligation_id AS "obligationId",agreement_id AS "agreementId",settlement_id AS "settlementId",amount::text`
// prettier-ignore
export async function findCommunityWork(db: DuesDb, settlementId: string) { const row = rows<Parameters<typeof work>[0]>(await db.execute(sql`SELECT ${fields} FROM tesoreria.dues_community_work WHERE settlement_id=${settlementId}`))[0]; return row ? work(row) : null }
// prettier-ignore
export async function createCommunityWork(db: DuesDb, input: { socioId: string; obligationId: string; agreementId?: string; settlementId: string; amountCents: number; evidence: Json; reason: string; operatorId: string; authorizationEvidence: Json; callerKey: string; requestFingerprint: string }) { const row = rows<Parameters<typeof work>[0]>(await db.execute(sql`INSERT INTO tesoreria.dues_community_work (socio_id,obligation_id,agreement_id,settlement_id,amount,evidence,approval_reason,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES (${input.socioId},${input.obligationId},${input.agreementId ?? null},${input.settlementId},${money(input.amountCents)},${JSON.stringify(input.evidence)}::jsonb,${input.reason},${input.operatorId},${JSON.stringify(input.authorizationEvidence)}::jsonb,${input.callerKey},${input.requestFingerprint}) RETURNING ${fields}`))[0]; if (!row) throw BusinessError(ErrorCode.INTERNAL_ERROR, 'Community work insert returned no row'); return work(row) }
// prettier-ignore
type Repository = { claimSettlement: typeof allocations.claimSettlement; insertAllocation: typeof allocations.insertAllocation; findCommunityWork: typeof findCommunityWork; createCommunityWork: typeof createCommunityWork };
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Dependencies = { repository?: Partial<Repository>; audit?: AuditEmitter; now?: () => Date }
// prettier-ignore
const authorize = (role: AuditContext['role']) => { if (role !== 'ADMIN' && role !== 'TESORERO') throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Community work action is not authorized') }
export class CommunityWorkService {
  private readonly repository: Repository
  private readonly audit: AuditEmitter
  private readonly now: () => Date
  constructor(
    private readonly db: Db,
    dependencies: Dependencies = {},
  ) {
    this.repository = {
      claimSettlement: allocations.claimSettlement,
      insertAllocation: allocations.insertAllocation,
      findCommunityWork,
      createCommunityWork,
      ...dependencies.repository,
    }
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }
  // prettier-ignore
  async create(input: CommunityWorkCommand) { authorize(input.role); if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > allocations.MAX_MONEY_CENTS || !input.reason.trim() || Object.keys(input.evidence).length === 0) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Approved community work requires positive value, evidence, and reason'); return this.db.transaction(async (tx) => { const claim = await this.repository.claimSettlement(tx, { operatorId: input.actorId, socioId: input.socioId, kind: 'NON_CASH', amountCents: input.amountCents, currency: 'ARS', evidence: input.evidence, reason: input.reason, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, authorizationEvidence: input.authorizationEvidence }); if (claim.status === 'replayed') { const existing = await this.repository.findCommunityWork(tx, claim.settlement.id); const allocationId = claim.allocations[0]?.id; if (!existing || !allocationId) throw BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Community work claim is unavailable'); return { ...existing, agreementId: existing.agreementId ?? input.agreementId ?? null, allocationId, replayed: true } } const allocation = await this.repository.insertAllocation(tx, { settlementId: claim.settlement.id, socioId: input.socioId, obligationId: input.obligationId, amountCents: input.amountCents }); const result = await this.repository.createCommunityWork(tx, { ...input, settlementId: claim.settlement.id, operatorId: input.actorId, authorizationEvidence: input.authorizationEvidence }); const metadata = { actorId: input.actorId, role: input.role, permissions: input.permissions, authorizationEvidence: input.authorizationEvidence, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, time: this.now().toISOString(), reason: input.reason }; for (const [action, entityType, entityId, newValue] of [[AuditAction.DUES_SETTLEMENT_CREATED, 'dues_settlement', claim.settlement.id, { settlementId: claim.settlement.id, kind: 'NON_CASH', amountCents: input.amountCents, currency: 'ARS', agreementId: input.agreementId ?? null }], [AuditAction.DUES_ALLOCATION_CREATED, 'dues_allocation', allocation.id, { allocationId: allocation.id, obligationId: input.obligationId, amountCents: input.amountCents, agreementId: input.agreementId ?? null }], [AuditAction.DUES_COMMUNITY_WORK_CREATED, 'dues_community_work', result.id, { communityWorkId: result.id, settlementId: result.settlementId, obligationId: result.obligationId, agreementId: input.agreementId ?? null, amountCents: result.amountCents, evidence: input.evidence, reason: input.reason }]] as const) await this.audit(tx, { action, operatorId: input.actorId, entityType, entityId, oldValue: null, newValue, sourceIp: input.sourceIp, callerKey: input.callerKey, metadata }); return { ...result, agreementId: result.agreementId ?? input.agreementId ?? null, allocationId: allocation.id, replayed: false } }) }
}
