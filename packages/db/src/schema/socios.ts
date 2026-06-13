import { date, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
