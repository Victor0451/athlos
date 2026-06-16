import {
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { socios } from './socios.ts'

/**
 * `deportes` schema — disciplinas, inscripciones, cuotas de actividad.
 *
 * PR 5 ships the read-only `padrones` view endpoints, which join
 * `inscripciones` with `socios` and `disciplinas` to produce the
 * "list of socios in disciplina X for ejercicio Y" view. Writes
 * land with the deportes write endpoints in a later PR.
 */
export const deportesSchema = pgSchema('deportes')

/**
 * Sports / activities the club runs (e.g. fútbol, hockey, natación).
 * `codigo` is the short identifier used in the URL — stable, unique,
 * operator-facing. `nombre` is the display label.
 */
export const disciplinas = deportesSchema.table(
  'disciplinas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codigoUnique: uniqueIndex('disciplinas_codigo_unique').on(table.codigo),
  }),
)

/**
 * Fiscal year. Padrones are scoped per ejercicio. We don't reuse the
 * accounting `ejercicios` table (it lives in the `contabilidad` schema)
 * because padrones are an operational concept, not a chart-of-accounts
 * one — they cycle by club year, not calendar year.
 */
export const ejercicios = deportesSchema.table(
  'ejercicios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anio: integer('anio').notNull(),
    descripcion: text('descripcion').notNull(),
    fechaInicio: date('fecha_inicio').notNull(),
    fechaFin: date('fecha_fin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    anioUnique: uniqueIndex('ejercicios_anio_unique').on(table.anio),
  }),
)

/**
 * A socio's enrollment in a disciplina for a given ejercicio. The
 * padrones view joins through this table. `estado` mirrors the
 * business lifecycle: `activa` for the current cycle, `baja` for
 * withdrawals, `pendiente` for incomplete paperwork.
 */
export const inscripciones = deportesSchema.table(
  'inscripciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    disciplinaId: uuid('disciplina_id')
      .notNull()
      .references(() => disciplinas.id, { onDelete: 'restrict' }),
    ejercicioId: uuid('ejercicio_id')
      .notNull()
      .references(() => ejercicios.id, { onDelete: 'restrict' }),
    estado: text('estado').notNull().default('activa'),
    fechaAlta: date('fecha_alta').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    socioDisciplinaEjercicioUnique: uniqueIndex('inscripciones_unique').on(
      table.socioId,
      table.disciplinaId,
      table.ejercicioId,
    ),
    disciplinaEjercicioIdx: index('inscripciones_disciplina_ejercicio_idx').on(
      table.disciplinaId,
      table.ejercicioId,
    ),
  }),
)

export type Disciplina = typeof disciplinas.$inferSelect
export type NewDisciplina = typeof disciplinas.$inferInsert
export type Ejercicio = typeof ejercicios.$inferSelect
export type NewEjercicio = typeof ejercicios.$inferInsert
export type Inscripcion = typeof inscripciones.$inferSelect
export type NewInscripcion = typeof inscripciones.$inferInsert
