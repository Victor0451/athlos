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
export { auditEvents, appSettings } from './public'
export type { AuditEvent, NewAuditEvent, AppSetting, NewAppSetting } from './public'

// operators + refresh tokens (PR 3a auth)
export { operators, refreshTokens } from './operators'
export type { Operator, NewOperator, RefreshToken, NewRefreshToken } from './operators'

// approval tokens (PR 3a approval links)
export { approvalTokens } from './approval-tokens'
export type { ApprovalToken, NewApprovalToken } from './approval-tokens'

// job runs (PR 6a scheduler)
export { jobRuns } from './job-runs'
export type { JobRun, NewJobRun, JobRunStatus, JobTrigger } from './job-runs'

// socios ───────────────────────────────────────────────────────
export { sociosSchema, socioEstado, socios } from './socios'
export type { Socio, NewSocio } from './socios'

// contabilidad ─────────────────────────────────────────────────
export { contabilidadSchema } from './contabilidad'

// tesoreria ────────────────────────────────────────────────────
export { tesoreriaSchema, ctacteTipo, ctacte } from './tesoreria'
export type { Ctacte, NewCtacte } from './tesoreria'

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
