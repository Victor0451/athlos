import { boolean, date, index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { socios } from './socios.ts'

/**
 * `tesoreria` schema — cuenta corriente, cajas, cobros.
 *
 * PR 5 adds the `ctacte` table (cuenta-corriente ledger) and the
 * supporting `ctacte_tipo` enum. Reads happen through the repository
 * layer (`apps/api/src/modules/ctacte/repository.ts`); writes land
 * with the cuenta-corriente write endpoints in a later PR — for now
 * only the read API + a re-computed `saldo` are exposed.
 *
 * The `saldo_acum` generated column is added by a hand-written
 * follow-up migration because drizzle-kit does not emit
 * `GENERATED ALWAYS AS ...` syntax. Until then `saldo` is computed
 * at read time from the raw `debe` / `haber` columns.
 */
export const tesoreriaSchema = pgSchema('tesoreria')

/**
 * Movement type. `DEBITO` = the socio owes the club (cargo, cuota,
 * servicio). `CREDITO` = the socio paid (pago, cobro, nota de
 * crédito). The sign rule for `debe` / `haber` is enforced at the
 * service layer — the column is the raw amount as posted, not a
 * signed number.
 */
export const ctacteTipo = tesoreriaSchema.enum('ctacte_tipo', ['DEBITO', 'CREDITO'])

/**
 * Ledger row. `debe` and `haber` are NUMERIC(14,2) stored as strings
 * to dodge IEEE-754 rounding; the service layer parses them as
 * bigint cents for arithmetic and re-stringifies for output.
 *
 * `anulado` is the soft-delete marker (think: the operator reversed
 * the entry). Anuladas MUST be excluded from the default `saldo`
 * computation — see `getSaldo()` in ctacte/repository.ts.
 *
 * `anulado_at` + `anulado_motivo` are populated together when the
 * row is anulada. The standin / integration tests use the
 * presence of `anulado_at` to detect anulación in lieu of a
 * separate trigger.
 */
export const ctacte = tesoreriaSchema.table(
  'ctacte',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    socioId: uuid('socio_id')
      .notNull()
      .references(() => socios.id, { onDelete: 'restrict' }),
    fecha: date('fecha').notNull(),
    tipo: ctacteTipo('tipo').notNull(),
    concepto: text('concepto').notNull(),
    /** Charge (cargo) amount — string-encoded NUMERIC(14,2). >= 0. */
    debe: text('debe').notNull().default('0.00'),
    /** Payment (pago) amount — string-encoded NUMERIC(14,2). >= 0. */
    haber: text('haber').notNull().default('0.00'),
    /** Anulación marker. Default false; never UPDATEd from app code paths other than the anulación endpoint (PR 5+). */
    anulado: boolean('anulado').notNull().default(false),
    anuladoAt: timestamp('anulado_at', { withTimezone: true }),
    anuladoMotivo: text('anulado_motivo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    socioIdIdx: index('ctacte_socio_id_idx').on(table.socioId),
    fechaIdx: index('ctacte_fecha_idx').on(table.fecha),
  }),
)

export type Ctacte = typeof ctacte.$inferSelect
export type NewCtacte = typeof ctacte.$inferInsert

/**
 * ctacte1 sub-ledger — created lazily by rebuild.ts projection only.
 * E1a ships the master table so 245,370 rows can be promoted into it.
 */
export const ctacte1 = tesoreriaSchema.table(
  'ctacte1',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ctacteId: uuid('ctacte_id')
      .notNull()
      .references(() => ctacte.id, { onDelete: 'restrict' }),
    fecha: date('fecha').notNull(),
    concepto: text('concepto').notNull(),
    /** NUMERIC(14,2) stored as text. */
    monto: text('monto').notNull().default('0.00'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ctacteIdIdx: index('ctacte1_ctacte_id_idx').on(table.ctacteId),
  }),
)

export type Ctacte1 = typeof ctacte1.$inferSelect
export type NewCtacte1 = typeof ctacte1.$inferInsert
