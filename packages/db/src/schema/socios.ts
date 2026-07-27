import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { rawEvents } from './public'

/**
 * `socios` schema — members (socios) of Club Atlético Gorriti.
 *
 * For PR 2 only the `socios` table ships. Reference tables (categorias,
 * contactos) and write-side tables (cuenta_corriente, cuenta_corriente_pago,
 * socio_disciplina) come with their respective PRs (PR 5 for socio CRUD and
 * PR 7 for projection rebuild). The schema shell is registered now so the
 * initial migration can `CREATE SCHEMA` and downstream PRs can append tables
 * without a structural migration.
 */
export const sociosSchema = pgSchema('socios')

/**
 * Per-socio free-form notes (`socio_notes`) — PR 8b.4.
 *
 * An operator can attach a free-text memo to any socio to record
 * out-of-band context that doesn't fit into the structured fields
 * (categoria, telefono, email, etc.). Examples:
 *
 *   - "Llamó el 2026-07-04 pidiendo cambio de cuota. Coordinar
 *      con tesorería para facturarle mitad de julio."
 *   - "Viuda del socio histórico #0014; contactarse con la hija
 *      María antes de fin de mes."
 *   - "Viene los martes con el nieto a la colonia."
 *
 * Edit history is preserved by routing every create/update/delete
 * through `audit_events` (action = `SOCIO_NOTE_CREATED` /
 * `SOCIO_NOTE_UPDATED` / `SOCIO_NOTE_DELETED`) — the timeline tab
 * on the detail page renders them inline with system events.
 *
 * Permissions: all authenticated operators can read + create. Edit
 * + delete is restricted to the original author OR ADMIN
 * (enforced at the route layer).
 */
export const socioNotes = sociosSchema.table(
  'socio_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    /** FK to `operators` lives in the `auth` schema — declared as a
     *  loose UUID here to avoid a cross-schema FK that breaks the
     *  Drizzle relational queries. The route layer enforces
     *  existence and ownership via a SELECT. */
    operatorId: uuid('operator_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    socioIdIdx: index('socio_notes_socio_id_idx').on(table.socioId),
  }),
)

export type SocioNote = typeof socioNotes.$inferSelect
export type NewSocioNote = typeof socioNotes.$inferInsert

/**
 * Per-movement notes for the `/ctacte/[cuenta]` page (`ctacte_movement_notes`)
 * — PR A1a (athlos-ctacte-mutations).
 *
 * An operator can attach a free-text memo to any `tesoreria.ctacte` row
 * to record context that doesn't fit into the structured columns
 * (concepto / motivo). Examples: "Verificar comprobante físico",
 * "Hablar con tesorería sobre prorroga", "Anular por error de carga".
 *
 * Soft-delete preserves the audit trail: queries exclude rows where
 * `deleted_at IS NOT NULL`, but the underlying row stays so the
 * `audit_events` row can still reference it. The audit row carries the
 * `body` snapshot, so even after a soft-delete the historical text is
 * recoverable from `audit_events.metadata.body`.
 *
 * `ctacte_movement_id` is a loose UUID because the FK target
 * (`tesoreria.ctacte.id`) is cross-schema and a Drizzle back-reference
 * from `socios` to `tesoreria` would introduce a circular import
 * (`tesoreria.ts` already imports `socios.ts`). The FK constraint is
 * enforced at SQL level via migration 0031 with `ON DELETE RESTRICT`.
 *
 * `author_operator_id` is a loose UUID (no cross-schema FK to
 * `auth.operators`) — same precedent as `socio_notes.operator_id` and
 * `socio_attachments.uploaded_by`. The route layer enforces existence
 * via the JWT.
 */
export const ctacteMovementNotes = sociosSchema.table(
  'ctacte_movement_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to `tesoreria.ctacte.id` (cross-schema — see header). */
    ctacteMovementId: uuid('ctacte_movement_id').notNull(),
    body: text('body').notNull(),
    authorOperatorId: uuid('author_operator_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete marker. NULL while active. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Caller-supplied opaque Idempotency-Key (R3 corrective batch +
     * R3 fix batch — defect #1).
     *
     * Mirrors the durable idempotency pattern already established for
     * `tesoreria.ctacte` rows (migration 0032 + UNIQUE INDEX). Same
     * key + same canonical payload MUST replay the note across
     * process restarts, cross-instance routing, and arbitrary retry
     * intervals. Different payload with the same key MUST 409.
     *
     * The matching index is a FULL (unconditional) UNIQUE INDEX
     * defined by migration 0034 — the prior PARTIAL index
     * (`WHERE idempotency_key IS NOT NULL`) could NOT be inferred
     * by `ON CONFLICT (idempotency_key) DO NOTHING`, which would
     * 5xx every note POST in production PostgreSQL. The full unique
     * index preserves the same constraint (multiple NULLs allowed,
     * non-NULL uniqueness enforced) and IS inferable.
     *
     * `idempotencyKey` stays NULLABLE because earlier code paths did
     * not require one; the new contract enforces presence at the
     * service/route boundary.
     */
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    movementIdx: index('idx_ctacte_movement_notes_movement').on(table.ctacteMovementId),
    createdIdx: index('idx_ctacte_movement_notes_created').on(table.createdAt),
    idempotencyKeyUnique: uniqueIndex('ctacte_movement_notes_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
  }),
)

export type CtacteMovementNote = typeof ctacteMovementNotes.$inferSelect
export type NewCtacteMovementNote = typeof ctacteMovementNotes.$inferInsert

/**
 * Membership state. Soft-delete flips `estado` to `baja` and stamps
 * `deleted_at`; the row is never physically removed. `suspendido` is a
 * temporary hold (e.g. disciplinary) — `fecha_alta`/`fecha_baja` track the
 * active window.
 */
export const socioEstado = sociosSchema.enum('socio_estado', ['activo', 'baja', 'suspendido'])

/**
 * Core socio record. The `numero_socio` is the operator-facing identifier
 * (printed on the carnet); `id` is the surrogate UUID used by FKs.
 * `categoria` is a free-text label for PR 2 — a normalized `categorias`
 * table lands in PR 5 once the category CRUD endpoints exist.
 */
export const socios = sociosSchema.table(
  'socios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numeroSocio: text('numero_socio').notNull(),
    nombre: text('nombre').notNull(),
    apellido: text('apellido').notNull(),
    /** National ID (DNI) — stored as text to preserve leading zeros. */
    dni: text('dni').notNull(),
    fechaAlta: date('fecha_alta').notNull(),
    /**
     * Date of birth. Added in PR 8d.1 (athlos-socio-form-emit) so the
     * Gorriti `solicitud-inscripcion` PDF can be auto-filled with the
     * titular's birth date. Nullable — existing rows have no value
     * and the form renders a `..../..../......` placeholder when NULL.
     * Backfill is deferred to a follow-up change.
     */
    fechaNacimiento: date('fecha_nacimiento'),
    estado: socioEstado('estado').notNull().default('activo'),
    categoria: text('categoria'),
    direccion: text('direccion'),
    telefono: text('telefono'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Stamped on soft-delete; NULL while the socio is active or suspended. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    numeroSocioUnique: uniqueIndex('socios_numero_socio_unique').on(table.numeroSocio),
    dniUnique: uniqueIndex('socios_dni_unique').on(table.dni),
  }),
)

export type Socio = typeof socios.$inferSelect
export type NewSocio = typeof socios.$inferInsert

export const identityLifecycleState = sociosSchema.enum('identity_lifecycle_state', [
  'imported',
  'validated',
  'review_required',
])

export const membershipAccounts = sociosSchema.table(
  'membership_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountNumber: bigint('account_number', { mode: 'number' })
      .notNull()
      .generatedAlwaysAsIdentity(),
    lifecycleState: identityLifecycleState('lifecycle_state').notNull().default('imported'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountNumberUnique: uniqueIndex('membership_accounts_account_number_key').on(
      table.accountNumber,
    ),
  }),
)

export const memberIdentities = sociosSchema.table(
  'member_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberNumber: bigint('member_number', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    lifecycleState: identityLifecycleState('lifecycle_state').notNull().default('imported'),
    credentialRef: text('credential_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberNumberUnique: uniqueIndex('member_identities_member_number_key').on(table.memberNumber),
    credentialRefUnique: uniqueIndex('member_identities_credential_ref_key').on(
      table.credentialRef,
    ),
  }),
)

export const accountMemberships = sociosSchema.table(
  'account_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => membershipAccounts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => memberIdentities.id, { onDelete: 'restrict' }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
  },
  (table) => ({
    accountMemberEffectiveFromUnique: unique(
      'account_memberships_account_id_member_id_effective_from_key',
    ).on(table.accountId, table.memberId, table.effectiveFrom),
  }),
)

export const accountHolderHistory = sociosSchema.table(
  'account_holder_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => membershipAccounts.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    predecessorId: uuid('predecessor_id').references((): AnyPgColumn => accountHolderHistory.id, {
      onDelete: 'restrict',
    }),
    actorOperatorId: uuid('actor_operator_id'),
    source: text('source').notNull(),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    currentAccountUnique: uniqueIndex('account_holder_history_current_account_unique')
      .on(table.accountId)
      .where(sql`${table.effectiveTo} IS NULL`),
    idempotencyKeyUnique: uniqueIndex('account_holder_history_idempotency_key_key').on(
      table.idempotencyKey,
    ),
  }),
)

export const legacyIdentityEvidence = sociosSchema.table(
  'legacy_identity_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawEventId: uuid('raw_event_id')
      .notNull()
      .references(() => rawEvents.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').references(() => membershipAccounts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id').references(() => memberIdentities.id, { onDelete: 'restrict' }),
    sourceKey: text('source_key').notNull(),
    importBatch: uuid('import_batch').notNull(),
    soccarnet: text('soccarnet'),
    socfamilia: text('socfamilia'),
    anomalyCodes: text('anomaly_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reviewState: text('review_state', {
      enum: ['imported', 'validated', 'review_required'],
    })
      .notNull()
      .default('imported'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    rawEventUnique: uniqueIndex('legacy_identity_evidence_raw_event_id_key').on(table.rawEventId),
    legacyPairIdx: index('legacy_identity_evidence_pair_idx').on(table.soccarnet, table.socfamilia),
  }),
)

export type MembershipAccount = typeof membershipAccounts.$inferSelect
export type NewMembershipAccount = typeof membershipAccounts.$inferInsert
export type MemberIdentity = typeof memberIdentities.$inferSelect
export type NewMemberIdentity = typeof memberIdentities.$inferInsert
export type AccountMembership = typeof accountMemberships.$inferSelect
export type NewAccountMembership = typeof accountMemberships.$inferInsert
export type AccountHolderHistory = typeof accountHolderHistory.$inferSelect
export type NewAccountHolderHistory = typeof accountHolderHistory.$inferInsert
export type LegacyIdentityEvidence = typeof legacyIdentityEvidence.$inferSelect
export type NewLegacyIdentityEvidence = typeof legacyIdentityEvidence.$inferInsert

/**
 * Attachment category — `dni | comprobante | foto | contrato | otro`.
 *
 * Used by the `socio_attachments.category` column. The enum is locked
 * at the database level; the application layer reads
 * `attachmentCategory.enumValues` so the Drizzle type and the SQL
 * constraint stay in sync.
 *
 * PR 8c.1 (athlos-socio-legajo).
 */
export const attachmentCategory = sociosSchema.enum('attachment_category', [
  'dni',
  'comprobante',
  'foto',
  'contrato',
  'otro',
])

/**
 * `socio_attachments` — per-socio attachment rows for the Legajo tab.
 *
 * UUID PK (NOT ULID — codebase consistency override per file-storage
 * delta R1; all sibling tables in `socios.*` use `uuid defaultRandom()`).
 * `uploaded_by` is a loose UUID (no FK to `operators`); the route layer
 * enforces existence via the JWT.
 *
 * The on-disk file lives at
 * `<STORAGE_LOCAL_ROOT>/socios/<socio_id>/<attachment_id>.<ext>`. The
 * `storage_sha256` column carries the SHA-256 of the file bytes (64 hex
 * chars); the `(storage_sha256)` index lets a future dedup query probe
 * for existing bytes without scanning.
 *
 * Quota enforcement (100 files / 500 MB per socio, soft-delete frees
 * immediately) lives in the service layer under a `SELECT … FOR SHARE`
 * transaction — see `apps/api/src/modules/socios/attachments.ts`.
 *
 * Soft delete sets `deleted_at` + `deleted_by`; the on-disk file is
 * retained until a future retention cron (deferred per design).
 *
 * PR 8c.1 (athlos-socio-legajo).
 */
export const socioAttachments = sociosSchema.table(
  'socio_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    filename: text('filename').notNull(),
    description: text('description'),
    category: attachmentCategory('category').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    storageSha256: text('storage_sha256').notNull(),
    /** Loose UUID — no cross-schema FK to `auth.operators`. The route
     *  layer / JWT enforces existence. */
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  },
  (table) => ({
    socioActiveIdx: index('socio_attachments_socio_active_idx').on(table.socioId, table.deletedAt),
    socioCategoryIdx: index('socio_attachments_socio_category_idx').on(
      table.socioId,
      table.category,
    ),
    storageShaIdx: index('socio_attachments_storage_sha_idx').on(table.storageSha256),
    uploadedAtIdx: index('socio_attachments_uploaded_at_idx').on(table.uploadedAt),
  }),
)

export type SocioAttachment = typeof socioAttachments.$inferSelect
export type NewSocioAttachment = typeof socioAttachments.$inferInsert
export type AttachmentCategory = (typeof attachmentCategory.enumValues)[number]

/**
 * Per-school master table (NO socio_id FK).
 * Scope correction #C1: escuela is per-school master, NOT per-socio enrollment.
 * The 66 distinct ESCCODIGO values = 100% unique NK.
 * deporte_codigo is nullable integer with NO FK constraint (Q9 LOCKED).
 */
export const escuela = sociosSchema.table(
  'escuela',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: integer('codigo').notNull(),
    nombre: text('nombre').notNull(),
    deporteCodigo: integer('deporte_codigo'),
    estado: varchar('estado', { length: 1 }).notNull(),
    cuotaSocial: numeric('cuota_social', { precision: 14, scale: 2 }),
    cobertura: numeric('cobertura', { precision: 14, scale: 2 }),
    contribucion: numeric('contribucion', { precision: 14, scale: 2 }),
    importeEscolar: numeric('importe_escolar', { precision: 14, scale: 2 }),
    otroContrib: numeric('otro_contrib', { precision: 14, scale: 2 }),
    claveInscripcion: numeric('clave_inscripcion', { precision: 14, scale: 2 }),
    fechaEscolar: date('fecha_escolar'),
    entrenadorCodigo: integer('entrenador_codigo'),
    escuelaNumero: integer('escuela_numero'),
    instructor: text('instructor'),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codigoUnique: uniqueIndex('escuela_codigo_unique').on(table.codigo),
    legacyIdUnique: uniqueIndex('escuela_legacy_id_unique').on(table.legacyId),
  }),
)

export type Escuela = typeof escuela.$inferSelect
export type NewEscuela = typeof escuela.$inferInsert

/**
 * Per-socio address/location with composite NK (LCNCTAPRIN, LCNNUMERO).
 * 89 distinct composite values = 100% unique NK.
 * 15/89 rows have empty LCNCTAPRIN promoted as '' sentinel (no FK constraint).
 */
export const locacion = sociosSchema.table(
  'locacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cuentaPrincipal: text('cuenta_principal').notNull(),
    cuentaSecundaria: text('cuenta_secundaria'),
    numero: integer('numero').notNull(),
    calle: text('calle'),
    barrio: integer('barrio'),
    piso: text('piso'),
    puerta: integer('puerta'),
    departamento: text('departamento'),
    anexo1: integer('anexo1'),
    anexo2: integer('anexo2'),
    nombre: text('nombre').notNull(),
    dni: integer('dni'),
    cuit: integer('cuit'),
    telefono: integer('telefono'),
    fechaNacimiento: date('fecha_nacimiento'),
    fechaBaja: date('fecha_baja'),
    situacionIva: integer('situacion_iva'),
    cuota: numeric('cuota', { precision: 14, scale: 2 }),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    cuentaPrincipalNumeroUnique: uniqueIndex('locacion_cuenta_principal_numero_unique').on(
      table.cuentaPrincipal,
      table.numero,
    ),
    legacyIdUnique: uniqueIndex('locacion_legacy_id_unique').on(table.legacyId),
  }),
)

export type Locacion = typeof locacion.$inferSelect
export type NewLocacion = typeof locacion.$inferInsert
