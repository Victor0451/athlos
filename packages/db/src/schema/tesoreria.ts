import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'
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
    /** E1b1: VFP natural key (CCTCUENTA = socio number) for ctacte1 FK lookup. NULL-able. */
    cctcuenta: text('cctcuenta'),
    /**
     * Deterministic UUID derived from natural key
     * (CCTCUENTA+CCTFECHA+CCTNROCOMP+CCTMES+CCTTALONAR) via uuidv5.
     * Enables cross-run idempotency via UNIQUE INDEX — re-runs ON CONFLICT DO NOTHING.
     * Migration 0014 adds the column + UNIQUE INDEX.
     */
    legacyId: text('legacy_id'),
    /** Soft link to a comprobante file in `socios.socio_attachments`.
     *  PR A1a (athlos-ctacte-mutations) — NULL when the pago was
     *  registered without an attached comprobante. Cross-schema FK
     *  target, so it's a loose UUID at the Drizzle layer (the SQL FK
     *  is added by migration 0031 with ON DELETE SET NULL). */
    comprobanteAttachmentId: uuid('comprobante_attachment_id'),
    /** Client-supplied payment retry key. UNIQUE at the database layer. */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    socioIdIdx: index('ctacte_socio_id_idx').on(table.socioId),
    fechaIdx: index('ctacte_fecha_idx').on(table.fecha),
    cctcuentaIdx: index('ctacte_cctcuenta_idx').on(table.cctcuenta),
    legacyIdUnique: uniqueIndex('ctacte_legacy_id_unique').on(table.legacyId),
    idempotencyKeyUnique: uniqueIndex('ctacte_idempotency_key_unique').on(table.idempotencyKey),
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
    /**
     * Deterministic UUID derived from natural key
     * (CCTPAGONRO+CCTPAGOSEC+CCTPAGOTAL+CCTPAGOFAM+CCTCUENTA) via uuidv5.
     * Enables cross-run idempotency via UNIQUE INDEX — re-runs ON CONFLICT DO NOTHING.
     * Migration 0014 adds the column + UNIQUE INDEX.
     */
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ctacteIdIdx: index('ctacte1_ctacte_id_idx').on(table.ctacteId),
    legacyIdUnique: uniqueIndex('ctacte1_legacy_id_unique').on(table.legacyId),
  }),
)

export type Ctacte1 = typeof ctacte1.$inferSelect
export type NewCtacte1 = typeof ctacte1.$inferInsert

/**
 * Cash movement header with 4-tuple NK (CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA).
 * Scope correction #C3: 4-tuple verified 8145/8145 = 100% unique (3-tuple yields 7957 — 188 silent losses).
 * 122 detail columns (CAJCONCEP1..20, CAJIMPOR1..20, etc.) are discarded (deferred to N7).
 */
export const cajaMovimiento = tesoreriaSchema.table(
  'caja_movimiento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: integer('numero').notNull(),
    secuencia: integer('secuencia').notNull(),
    fecha: date('fecha').notNull(),
    hora: integer('hora').notNull(),
    tip: integer('tip'),
    descrip: text('descrip'),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    numeroSecuenciaFechaHoraUnique: uniqueIndex(
      'caja_movimiento_numero_secuencia_fecha_hora_unique',
    ).on(table.numero, table.secuencia, table.fecha, table.hora),
    legacyIdUnique: uniqueIndex('caja_movimiento_legacy_id_unique').on(table.legacyId),
  }),
)

export type CajaMovimiento = typeof cajaMovimiento.$inferSelect
export type NewCajaMovimiento = typeof cajaMovimiento.$inferInsert

/**
 * Flat accounting expense ledger with 5-tuple NK
 * (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB).
 * Scope correction #C2: 5-tuple verified 2114/2114 = 100% unique (3-tuple = 346 distinct = 84% dupes).
 * No ctacte FK (#C7: GASCTAPRIN is accounting-plan code, NOT socio carnet).
 * No socio_id FK in v1 (#C8: no source field; socio_id column reserved for future N16 backfill).
 * Migration 0015 creates table + 3 UNIQUE INDEXes (legacy_id, 5-tuple, cuenta+fecha) + 1 partial socio_id index.
 *
 * N16 (athlos-n16-gastos-ctacte-fk) adds 3 soft-delete audit columns
 * (`anulado`, `anulado_at`, `anulado_motivo`) via migration 0019 to
 * mirror the ctacte pattern. Hard DELETE on a gasto cascades to its
 * `gastos_ctacte_mapping` rows; `anular` does NOT cascade (spec Q5:
 * soft warning, no cascade).
 */
export const gastos = tesoreriaSchema.table(
  'gastos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: integer('tipo').notNull(),
    tipoCuenta: integer('tipo_cuenta').notNull(),
    cuentaPrincipal: text('cuenta_principal').notNull(),
    cuentaAuxiliar: integer('cuenta_auxiliar'),
    secuencia: integer('secuencia').notNull().default(0),
    comprobante: text('comprobante').notNull().default(''),
    fecha: date('fecha').notNull(),
    concepto: text('concepto'),
    importe: text('importe').notNull().default('0.00'),
    iva: text('iva').default('0.00').notNull(),
    ingresoBruto: text('ingreso_bruto'),
    socioId: uuid('socio_id'), // NULLABLE; FK constraint deferred to N16
    legacyId: text('legacy_id'),
    /** Soft-delete marker. Default false; never UPDATEd from app code paths other than the anulación endpoint (PR N16). */
    anulado: boolean('anulado').notNull().default(false),
    anuladoAt: timestamp('anulado_at', { withTimezone: true }),
    anuladoMotivo: text('anulado_motivo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    legacyIdUnique: uniqueIndex('gastos_legacy_id_unique').on(table.legacyId),
    tupleUnique: uniqueIndex('gastos_5tuple_unique').on(
      table.tipo,
      table.cuentaPrincipal,
      table.secuencia,
      table.fecha,
      table.comprobante,
    ),
    cuentaFechaIdx: index('gastos_cuenta_fecha_idx').on(table.cuentaPrincipal, table.fecha),
    socioIdIdx: index('gastos_socio_id_idx')
      .on(table.socioId)
      .where(sql`${table.socioId} IS NOT NULL`),
  }),
)

export type Gastos = typeof gastos.$inferSelect
export type NewGastos = typeof gastos.$inferInsert

/**
 * Reason an operator attached a gasto to a ctacte movement.
 *   - `manual`: human chose the pair explicitly via the UI form
 *   - `heuristic-pending`: surfaced by the heuristic view, awaiting
 *     operator confirmation. Once the operator confirms, the row is
 *     re-INSERTed (or UPDATEd) with motivo='manual' — heuristic-pending
 *     rows are never the source of truth.
 *   - `auto`: reserved for future use (e.g. nightly import pipeline)
 */
export type GastosCtacteLinkMotivo = 'manual' | 'heuristic-pending' | 'auto'

export const GASTOS_CTACTE_LINK_MOTIVOS = [
  'manual',
  'heuristic-pending',
  'auto',
] as const satisfies readonly GastosCtacteLinkMotivo[]

/**
 * N16 gastos ↔ ctacte mapping table.
 *
 * Manual many-to-many bridge between `tesoreria.gastos` (accounting-plan
 * code) and `tesoreria.ctacte` (socio carnet). The two namespaces do
 * not intersect (verified live 2026-06-29), so this is an explicit
 * table rather than a FK constraint.
 *
 * CRITICAL: the PARTIAL UNIQUE INDEX `gastos_ctacte_mapping_active_uniq`
 * excludes rows where `anulado = false`. This is the spec's Re-link
 * scenario — once a previous link is soft-anulada, a fresh link for
 * the same (gasto_id, ctacte_id) pair is allowed (returns 201 not 409).
 *
 * ON DELETE CASCADE on both FKs mirrors the spec: hard-deleting a
 * gasto wipes its links; hard-deleting a ctacte row wipes its links.
 * Soft annulment on either side does NOT cascade — the link row stays
 * as audit trail (spec Q5).
 */
export const gastosCtacteMapping = tesoreriaSchema.table(
  'gastos_ctacte_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gastoId: uuid('gasto_id')
      .notNull()
      .references(() => gastos.id, { onDelete: 'cascade' }),
    ctacteId: uuid('ctacte_id')
      .notNull()
      .references(() => ctacte.id, { onDelete: 'cascade' }),
    montoCubierto: numeric('monto_cubierto', { precision: 14, scale: 2 }).notNull(),
    motivo: text('motivo').notNull().$type<GastosCtacteLinkMotivo>(),
    anulado: boolean('anulado').notNull().default(false),
    anuladoAt: timestamp('anulado_at', { withTimezone: true }),
    anuladoMotivo: text('anulado_motivo'),
    createdBy: uuid('created_by').references(() => operators.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gastoIdx: index('gastos_ctacte_mapping_gasto_idx').on(table.gastoId),
    ctacteIdx: index('gastos_ctacte_mapping_ctacte_idx').on(table.ctacteId),
    motivoCheck: check(
      'gastos_ctacte_mapping_motivo_check',
      sql`${table.motivo} IN ('manual','heuristic-pending','auto')`,
    ),
    montoCheck: check(
      'gastos_ctacte_mapping_monto_positive_check',
      sql`${table.montoCubierto} > 0`,
    ),
    activeUniq: uniqueIndex('gastos_ctacte_mapping_active_uniq')
      .on(table.gastoId, table.ctacteId)
      .where(sql`${table.anulado} = false`),
  }),
)

export type GastosCtacteMapping = typeof gastosCtacteMapping.$inferSelect
export type NewGastosCtacteMapping = typeof gastosCtacteMapping.$inferInsert
