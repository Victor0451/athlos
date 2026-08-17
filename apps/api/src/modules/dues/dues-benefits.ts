import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repository from './repository.ts'
import type { AuditContext } from './service.ts'

type DuesDb = Db | repository.DuesTransaction
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
// prettier-ignore
type Dependencies = { repository?: Pick<typeof repository, 'createBenefitRule' | 'revokeBenefitRule' | 'listEffectiveBenefitRules'>; audit?: AuditEmitter; now?: () => Date }
// prettier-ignore
export type BenefitCommand = AuditContext & Omit<repository.BenefitInput, 'createdBy' | 'authorizationEvidence'>
export type BenefitListCommand = Pick<AuditContext, 'role'> & { period: repository.Period }
// prettier-ignore
function authorize(role: BenefitCommand['role'] | BenefitListCommand['role'], allowed: BenefitCommand['role'][]) { if (!allowed.includes(role)) throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Benefit action is not authorized') }

// prettier-ignore
export class BenefitService {
  private readonly repository: NonNullable<Dependencies['repository']>
  private readonly audit: AuditEmitter
  private readonly now: () => Date
  constructor(private readonly db: Db, dependencies: Dependencies = {}) { this.repository = dependencies.repository ?? repository; this.audit = dependencies.audit ?? emitAudit; this.now = dependencies.now ?? (() => new Date()) }
  private async record(db: DuesDb, input: AuditContext, action: string, benefit: { id: string; kind: string; priority: number; combinability: string; exclusiveGroup: string | null; percentageBasis: string | null }, reason: string) {
    await this.audit(db, { action, operatorId: input.actorId, entityType: 'dues_benefit_rule', entityId: benefit.id, oldValue: null, newValue: { id: benefit.id, kind: benefit.kind, priority: benefit.priority, combinability: benefit.combinability, exclusiveGroup: benefit.exclusiveGroup, percentageBasis: benefit.percentageBasis }, sourceIp: input.sourceIp, payload: { benefitId: benefit.id, reason }, callerKey: input.callerKey, metadata: { actorId: input.actorId, role: input.role, permissions: input.permissions, authorizationEvidence: input.authorizationEvidence, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, time: this.now().toISOString(), reason } })
  }
  async create(input: BenefitCommand) { authorize(input.role, ['ADMIN']); return this.db.transaction(async (tx) => { const benefit = await this.repository.createBenefitRule(tx, { ...input, createdBy: input.actorId, authorizationEvidence: input.authorizationEvidence }); await this.record(tx, input, AuditAction.DUES_BENEFIT_CREATED, benefit, input.reason); return benefit }) }
  async revoke(input: AuditContext & Pick<repository.BenefitRevocationInput, 'benefitRuleId' | 'revokeReason'>) { authorize(input.role, ['ADMIN']); return this.db.transaction(async (tx) => { const benefit = await this.repository.revokeBenefitRule(tx, { benefitRuleId: input.benefitRuleId, revokedBy: input.actorId, revokeReason: input.revokeReason }); await this.record(tx, input, AuditAction.DUES_BENEFIT_REVOKED, benefit, input.revokeReason); return benefit }) }
  async list(input: BenefitListCommand) { authorize(input.role, ['ADMIN', 'TESORERO']); return this.repository.listEffectiveBenefitRules(this.db, input.period) }
}
