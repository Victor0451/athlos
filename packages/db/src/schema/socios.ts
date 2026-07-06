import {
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

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
