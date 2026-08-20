import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repository from './repository.ts'
import type { AuditContext } from './service.ts'

type DuesDb = Db | repository.DuesTransaction
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Dependencies = {
  repository?: Pick<
    typeof repository,
    'createFamilyGroup' | 'createFamilyMembership' | 'revokeFamilyMembership'
  >
  audit?: AuditEmitter
}
export type FamilyGroupCommand = AuditContext & Pick<repository.FamilyGroupInput, 'id' | 'reason'>
export type FamilyMembershipCommand = AuditContext &
  Omit<repository.FamilyMembershipInput, 'createdBy' | 'authorizationEvidence'>
export type RevokeFamilyMembershipCommand = AuditContext &
  Pick<repository.FamilyMembershipRevocationInput, 'membershipId' | 'revokeReason'>

function authorize(role: AuditContext['role']): void {
  if (role !== 'ADMIN')
    throw BusinessError(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'Family eligibility action is not authorized',
    )
}

export class FamilyGroupService {
  private readonly repository: NonNullable<Dependencies['repository']>
  private readonly audit: AuditEmitter

  constructor(
    private readonly db: Db,
    dependencies: Dependencies = {},
  ) {
    this.repository = dependencies.repository ?? repository
    this.audit = dependencies.audit ?? emitAudit
  }

  private record(
    db: DuesDb,
    input: AuditContext,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ) {
    return this.audit(db, {
      action,
      operatorId: input.actorId,
      entityType,
      entityId,
      oldValue: null,
      newValue: null,
      sourceIp: input.sourceIp,
      payload,
      callerKey: input.callerKey,
      metadata: {
        actorId: input.actorId,
        role: input.role,
        permissions: input.permissions,
        authorizationEvidence: input.authorizationEvidence,
        callerKey: input.callerKey,
        requestFingerprint: input.requestFingerprint,
        time: new Date().toISOString(),
      },
    })
  }

  async create(input: FamilyGroupCommand) {
    authorize(input.role)
    return this.db.transaction(async (tx) => {
      const group = await this.repository.createFamilyGroup(tx, {
        ...(input.id ? { id: input.id } : {}),
        reason: input.reason,
        createdBy: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
      })
      await this.record(
        tx,
        input,
        AuditAction.DUES_FAMILY_GROUP_CREATED,
        'dues_family_group',
        group.id,
        { familyGroupId: group.id },
      )
      return group
    })
  }

  async addMembership(input: FamilyMembershipCommand) {
    authorize(input.role)
    return this.db.transaction(async (tx) => {
      const membership = await this.repository.createFamilyMembership(tx, {
        familyGroupId: input.familyGroupId,
        socioId: input.socioId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        reason: input.reason,
        createdBy: input.actorId,
        authorizationEvidence: input.authorizationEvidence,
      })
      await this.record(
        tx,
        input,
        AuditAction.DUES_FAMILY_MEMBERSHIP_CREATED,
        'dues_family_membership',
        membership.id,
        {
          membershipId: membership.id,
          familyGroupId: membership.familyGroupId,
          effectiveFrom: membership.effectiveFrom,
          effectiveTo: membership.effectiveTo,
        },
      )
      return membership
    })
  }

  async revokeMembership(input: RevokeFamilyMembershipCommand) {
    authorize(input.role)
    return this.db.transaction(async (tx) => {
      const membership = await this.repository.revokeFamilyMembership(tx, {
        membershipId: input.membershipId,
        revokedBy: input.actorId,
        revokeReason: input.revokeReason,
      })
      await this.record(
        tx,
        input,
        AuditAction.DUES_FAMILY_MEMBERSHIP_REVOKED,
        'dues_family_membership',
        membership.id,
        { membershipId: membership.id, reason: input.revokeReason },
      )
      return membership
    })
  }
}
