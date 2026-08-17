import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repository from './repository.ts'
import type { AuditContext } from './service.ts'

type DuesDb = Db | repository.DuesTransaction
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
// prettier-ignore
type Dependencies = { repository?: Pick<typeof repository, 'createBenefit' | 'revokeBenefit' | 'listApplicableBenefits'>; audit?: AuditEmitter; now?: () => Date }
// prettier-ignore
export type BenefitCommand = AuditContext & Omit<repository.BenefitInput, 'createdBy' | 'authorizationEvidence'>
// prettier-ignore
export type BenefitListCommand = Pick<AuditContext, 'role'> & { socioId: string; period: repository.Period }
// prettier-ignore
function authorize(role: BenefitCommand['role'] | BenefitListCommand['role'], allowed: BenefitCommand['role'][]) { if (!allowed.includes(role)) throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Benefit action is not authorized') }
// prettier-ignore
export class BenefitService {
  private readonly repository: NonNullable<Dependencies['repository']>
  private readonly audit: AuditEmitter
  private readonly now: () => Date
  constructor(private readonly db: Db, dependencies: Dependencies = {}) { this.repository = dependencies.repository ?? repository; this.audit = dependencies.audit ?? emitAudit; this.now = dependencies.now ?? (() => new Date()) }
  async create(input: BenefitCommand) {
    authorize(input.role, ['ADMIN'])
    return this.db.transaction(async (tx) => {
      const benefit = await this.repository.createBenefit(tx, { ...input, createdBy: input.actorId, authorizationEvidence: input.authorizationEvidence })
      // prettier-ignore
      await this.audit(tx, { action: AuditAction.DUES_BENEFIT_CREATED, operatorId: input.actorId, entityType: 'dues_benefit', entityId: benefit.id, oldValue: null, newValue: { id: benefit.id, kind: benefit.kind, scope: benefit.scope }, sourceIp: input.sourceIp, payload: input, callerKey: input.callerKey, metadata: { actorId: input.actorId, role: input.role, permissions: input.permissions, authorizationEvidence: input.authorizationEvidence, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, time: this.now().toISOString(), benefit: { kind: benefit.kind, scope: benefit.scope } } })
      return benefit
    })
  }
  async revoke(input: AuditContext & Pick<repository.BenefitRevocationInput, 'benefitId' | 'revokeReason'>) {
    authorize(input.role, ['ADMIN'])
    return this.db.transaction(async (tx) => {
      const benefit = await this.repository.revokeBenefit(tx, { benefitId: input.benefitId, revokedBy: input.actorId, revokeReason: input.revokeReason })
      // prettier-ignore
      await this.audit(tx, { action: AuditAction.DUES_BENEFIT_REVOKED, operatorId: input.actorId, entityType: 'dues_benefit', entityId: benefit.id, oldValue: null, newValue: { id: benefit.id, kind: benefit.kind, scope: benefit.scope }, sourceIp: input.sourceIp, payload: { benefitId: benefit.id }, callerKey: input.callerKey, metadata: { actorId: input.actorId, role: input.role, permissions: input.permissions, authorizationEvidence: input.authorizationEvidence, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, time: this.now().toISOString(), benefit: { kind: benefit.kind, scope: benefit.scope } } })
      return benefit
    })
  }
  async list(input: BenefitListCommand) { authorize(input.role, ['ADMIN', 'TESORERO']); return this.repository.listApplicableBenefits(this.db, input.socioId, input.period) }
  async resolve(input: BenefitListCommand) { authorize(input.role, ['ADMIN', 'TESORERO']); return this.repository.listApplicableBenefits(this.db, input.socioId, input.period) }
}
