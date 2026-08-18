/**
 * Schema barrel. `drizzle-kit` reads this file (see `/drizzle.config.ts`)
 * to compute migrations, and `createDb({...})` passes the namespace to the
 * Drizzle client so `db.query.auditEvents.findFirst()` resolves at the type
 * level.
 *
 * Adding a new table:
 *  1. Create the schema constant in the appropriate domain file (e.g.
 *     `schema/socios.ts` → `export const sociosSchema = pgSchema('socios')`).
 *  2. Define the table with that schema as the namespace.
 *  3. Re-export both the schema and the table from this file.
 *  4. Re-export the `InferSelectModel` / `InferInsertModel` types so
 *     application code imports them by name.
 */

// public ───────────────────────────────────────────────────────
export {
  auditEvents,
  appSettings,
  entityUuids,
  driftSnapshots,
  domainFreshness,
  notifications,
  rawEvents,
} from './public'
export type {
  AuditEvent,
  NewAuditEvent,
  AppSetting,
  NewAppSetting,
  EntityUuid,
  NewEntityUuid,
  DriftSnapshot,
  NewDriftSnapshot,
  DomainFreshness,
  NewDomainFreshness,
  Notification,
  NewNotification,
  NotificationStatus,
  NotificationChannelDb,
  RawEvent,
  NewRawEvent,
} from './public'

// operators + refresh tokens (PR 3a auth)
export { operators, refreshTokens, rolePermissions } from './operators'
export type {
  Operator,
  NewOperator,
  RefreshToken,
  NewRefreshToken,
  RolePermission,
} from './operators'

// approval tokens (PR 3a approval links)
export { approvalTokens } from './approval-tokens'
export type { ApprovalToken, NewApprovalToken } from './approval-tokens'

// job runs (PR 6a scheduler)
export { jobRuns } from './job-runs'
export type { JobRun, NewJobRun, JobRunStatus, JobTrigger } from './job-runs'

// socios ───────────────────────────────────────────────────────
export {
  sociosSchema,
  socioEstado,
  socios,
  escuela,
  locacion,
  socioNotes,
  socioAttachments,
  attachmentCategory,
  ctacteMovementNotes,
  identityLifecycleState,
  membershipAccounts,
  memberIdentities,
  accountMemberships,
  accountHolderHistory,
  legacyIdentityEvidence,
  legacyMembershipSnapshotState,
  legacyMembershipTypeSnapshots,
  legacyMembershipTypeSourceRows,
  legacyMembershipTypeCandidates,
  legacyCatalogMaterializationReceipts,
  legacyMemberFeeState,
  legacyMemberReviewState,
  legacyMemberEvidence,
  legacyMemberEvidenceResolutions,
} from './socios'
export type {
  Socio,
  NewSocio,
  Escuela,
  NewEscuela,
  Locacion,
  NewLocacion,
  SocioNote,
  NewSocioNote,
  SocioAttachment,
  NewSocioAttachment,
  AttachmentCategory,
  CtacteMovementNote,
  NewCtacteMovementNote,
  MembershipAccount,
  NewMembershipAccount,
  MemberIdentity,
  NewMemberIdentity,
  AccountMembership,
  NewAccountMembership,
  AccountHolderHistory,
  NewAccountHolderHistory,
  LegacyIdentityEvidence,
  NewLegacyIdentityEvidence,
  LegacyMembershipTypeSnapshot,
  NewLegacyMembershipTypeSnapshot,
  LegacyMembershipTypeSourceRow,
  NewLegacyMembershipTypeSourceRow,
  LegacyMembershipTypeCandidate,
  NewLegacyMembershipTypeCandidate,
  LegacyCatalogMaterializationReceipt,
  NewLegacyCatalogMaterializationReceipt,
  LegacyMemberEvidence,
  NewLegacyMemberEvidence,
  LegacyMemberEvidenceResolution,
  NewLegacyMemberEvidenceResolution,
} from './socios'

// contabilidad ─────────────────────────────────────────────────
export { contabilidadSchema } from './contabilidad'

// tesoreria ────────────────────────────────────────────────────
export {
  tesoreriaSchema,
  ctacteTipo,
  ctacte,
  ctacteComprobanteRetries,
  ctacte1,
  cajaMovimiento,
  gastos,
  gastosCtacteMapping,
  GASTOS_CTACTE_LINK_MOTIVOS,
} from './tesoreria'
export type {
  Ctacte,
  CtacteComprobanteRetry,
  NewCtacte,
  Ctacte1,
  NewCtacte1,
  CajaMovimiento,
  NewCajaMovimiento,
  Gastos,
  NewGastos,
  GastosCtacteMapping,
  NewGastosCtacteMapping,
  GastosCtacteLinkMotivo,
} from './tesoreria'

// native dues pricing and immutable obligations ─────────────────
export * from './dues'
export * from './dues-benefits'
export * from './dues-family-groups'

// deportes ─────────────────────────────────────────────────────
export { deportesSchema, disciplinas, ejercicios, inscripciones } from './deportes'
export type {
  Disciplina,
  NewDisciplina,
  Ejercicio,
  NewEjercicio,
  Inscripcion,
  NewInscripcion,
} from './deportes'
