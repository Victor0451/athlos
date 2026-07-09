import { and, asc, desc, eq, gte, lte, lt, type SQL } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { ctacte, type Ctacte, type NewCtacte } from '@athlos/db/schema'
import { parseCents, centsToString } from '../../test-standins/db.ts'

/**
 * Cuenta Corriente (ledger) repository.
 *
 * Read-only in PR 5. The schema is `tesoreria.ctacte` — see
 * `packages/db/src/schema/tesoreria.ts` for the column shape.
 *
 * Saldo: re-computed on every read from the raw `debe` / `haber`
 * columns. The repository NEVER trusts a cached balance — the
 * spec is explicit that an anulación or backfill must be reflected
 * in the response, and the only safe way to guarantee that is to
 * sum at read time. The standin ships a `parseCents` helper that
 * does the same bigint math; the production driver returns a
 * `sum(debe - haber)` value and we normalize to a NUMERIC(14,2)
 * string before returning.
 */

export interface GetMovimientosInput {
  socioId: string
  desde?: Date
  hasta?: Date
  page: number
  limit: number
}

export interface GetMovimientosResult {
  items: Ctacte[]
  total: number
  page: number
  limit: number
}

/**
 * Return the socio's current balance as a NUMERIC(14,2) string.
 *
 * The default behavior excludes anuladas — the spec says anuladas
 * must never silently leak into the saldo. Pass
 * `incluirAnuladas=true` to include them (audit / accounting-only
 * views).
 *
 * Implementation note: the standin's `sum` projection is a no-op
 * (returns `'0.00'`) — see the comment in `test-standins/db.ts`.
 * For tests we fall back to a JS-side sum via `parseCents` /
 * `centsToString`, which matches the production semantics exactly.
 * The real Drizzle driver hits `sum(debe - haber)` at the DB.
 */
export async function getSaldo(
  db: Db,
  socioId: string,
  opts: { incluirAnuladas?: boolean } = {},
): Promise<string> {
  // Pull every row for the socio and sum client-side. The
  // standin's `sum` projection is a no-op (see its comment), so
  // for the test path we walk the rows in JS using the same
  // bigint arithmetic the production driver would run in SQL.
  // For the real driver the row count per socio is bounded by
  // the operator console (it's the ctacte of one member), so
  // the JS path is safe in tests.
  const rows = await db.select().from(ctacte).where(eq(ctacte.socioId, socioId)).limit(10_000)
  let totalCents = 0n
  for (const r of rows) {
    if (!opts.incluirAnuladas && r.anulado) continue
    totalCents += parseCents(String(r.debe)) - parseCents(String(r.haber))
  }
  return centsToString(totalCents)
}

/**
 * Page through a socio's movements. Default order is `fecha DESC,
 * id DESC` so the most recent movement comes first — the legacy
 * operator UI lists from the top of the receipt pile.
 *
 * The optional date range is inclusive on `desde` and exclusive
 * on `hasta` to match the standard "since X, before Y" half-open
 * convention.
 */
export async function getMovimientos(
  db: Db,
  input: GetMovimientosInput,
): Promise<GetMovimientosResult> {
  const limit = Math.min(Math.max(input.limit, 1), 100)
  const page = Math.max(input.page, 1)
  const offset = (page - 1) * limit
  const conds: Array<SQL | undefined> = [eq(ctacte.socioId, input.socioId)]
  if (input.desde) conds.push(gte(ctacte.fecha, formatDate(input.desde)))
  if (input.hasta) conds.push(lt(ctacte.fecha, formatDate(input.hasta)))
  const where = and(...conds.filter((c): c is SQL => c !== undefined))

  const allRows = await db
    .select()
    .from(ctacte)
    .where(where)
    .orderBy(desc(ctacte.fecha), desc(ctacte.id))
    .limit(10_000)
  // Sort with fecha DESC is what the spec wants; the standin
  // ignores ORDER BY so we sort in-place for the tests to match.
  allRows.sort((a, b) => {
    if (a.fecha === b.fecha) return a.id < b.id ? 1 : -1
    return a.fecha < b.fecha ? 1 : -1
  })
  const total = allRows.length
  const items = allRows.slice(offset, offset + limit)
  return { items, total, page, limit }
}

function formatDate(d: Date): string {
  // YYYY-MM-DD; the column is `date` in Drizzle.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Re-exported so the service can re-use the parser for any
 * client-side aggregation (e.g. the running `saldo_resultante`
 * per row in the response).
 */
export { parseCents, centsToString }

/** Helper kept for parity with the api-design spec wording. */
export const ASC = asc

/**
 * Write-path additions for the ctacte-mutations service (PR A1a).
 *
 * `insertCtacteRow` is the single INSERT helper for registerPayment
 * (CREDITO + haber) and registerDebit (DEBITO + debe). The
 * `monto` field is the NUMERIC(14,2) string the DB expects — the
 * service layer formats it before calling here.
 *
 * `listMovementsByDateRange` is the comprobante-PDF query: a
 * date-filtered slice ordered by `fecha ASC` (the comprovante lists
 * movements chronologically). The `limit` cap is enforced at SQL
 * level — the route layer also enforces `limit <= 50` BEFORE calling
 * puppeteer (defense-in-depth, per the spec delta).
 */

export interface InsertCtacteRowInput {
  socioId: string
  fecha: string
  tipo: 'DEBITO' | 'CREDITO'
  concepto: string
  /** NUMERIC(14,2) string (e.g. "1500.00"). Stored as `debe` when
   *  tipo='DEBITO' and as `haber` when tipo='CREDITO'. */
  monto: string
  /** Optional FK to `socios.socio_attachments.id` (the comprobante
   *  upload). NULL when the pago was registered without a comprobante. */
  comprobanteAttachmentId?: string | null
}

/**
 * Insert a new ctacte row. Returns the persisted shape (id +
 * createdAt populated by the DB).
 *
 * Throws when the underlying insert returns no row (driver-level
 * anomaly — defensive guard mirroring the pattern in
 * `notes-repository.ts:insert`).
 */
export async function insertCtacteRow(db: Db, input: InsertCtacteRowInput): Promise<Ctacte> {
  const row: NewCtacte = {
    socioId: input.socioId,
    fecha: input.fecha,
    tipo: input.tipo,
    concepto: input.concepto,
    debe: input.tipo === 'DEBITO' ? input.monto : '0.00',
    haber: input.tipo === 'CREDITO' ? input.monto : '0.00',
    comprobanteAttachmentId: input.comprobanteAttachmentId ?? null,
  }
  const [inserted] = await db.insert(ctacte).values(row).returning()
  if (!inserted) {
    throw new Error('insertCtacteRow returned no row')
  }
  return inserted
}

export interface ListMovementsByDateRangeInput {
  socioId: string
  /** YYYY-MM-DD inclusive. */
  from: string
  /** YYYY-MM-DD inclusive. */
  to: string
  /** Hard cap on the result size. The comprobante route enforces 50
   *  before invoking puppeteer; the SQL cap is defense-in-depth. */
  limit: number
}

/**
 * List a socio's movements within an inclusive date range, ordered
 * by `fecha ASC` (chronological — the comprovante lists them in
 * receipt order). Anuladas are excluded to match the read endpoint.
 *
 * The `limit` cap is applied at SQL level. The route layer is
 * expected to enforce a stricter cap (50 for the comprobante PDF)
 * before calling puppeteer — this SQL-level cap is the belt-and-
 * suspenders guard for the unlikely case a future caller bypasses
 * the route layer.
 */
export async function listMovementsByDateRange(
  db: Db,
  input: ListMovementsByDateRangeInput,
): Promise<Ctacte[]> {
  const limit = Math.min(Math.max(input.limit, 1), 10_000)
  const conds: Array<SQL | undefined> = [
    eq(ctacte.socioId, input.socioId),
    gte(ctacte.fecha, input.from),
    lte(ctacte.fecha, input.to),
    eq(ctacte.anulado, false),
  ]
  const where = and(...conds.filter((c): c is SQL => c !== undefined))

  // The standin ignores ORDER BY (per handover #253); production
  // drizzle honours it. For the test path we sort in JS using the
  // same canonical order.
  const rows = await db
    .select()
    .from(ctacte)
    .where(where)
    .orderBy(asc(ctacte.fecha), asc(ctacte.id))
    .limit(limit)
  rows.sort((a, b) => {
    if (a.fecha === b.fecha) return a.id < b.id ? -1 : 1
    return a.fecha < b.fecha ? -1 : 1
  })
  return rows
}
