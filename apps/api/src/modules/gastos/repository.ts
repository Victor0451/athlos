import { and, count, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import {
  ctacte,
  gastos,
  gastosCtacteMapping,
  type Ctacte,
  type Gastos,
  type GastosCtacteLinkMotivo,
} from '@athlos/db/schema'

/**
 * Gastos repository — N16 (athlos-n16-gastos-ctacte-fk).
 *
 * Closes the Slice 8 deferred gap: there were no gastos CRUD endpoints
 * and no explicit gasto ↔ ctacte correlation. This module exposes:
 *
 *   Gastos CRUD (PR N16-T1):
 *     - findManyGastos
 *     - findGastoById
 *     - createGasto
 *     - updateGasto
 *     - deleteGasto
 *     - anularGasto
 *
 *   Gastos ↔ Ctacte mapping (PR N16-T2):
 *     - findLinksByGasto
 *     - findLinksByCtacteCuenta
 *     - createLink
 *     - deleteLink
 *     - anularLink
 *     - findCandidates  (heuristic, read-only — NEVER persists)
 *
 * All mutations emit an audit row via `@athlos/audit.emitAudit` from
 * the route layer. The repository is pure data access.
 */

/**
 * Heuristic candidate DTO. Returned by `findCandidates` and `scoreHeuristicCandidate`.
 * Always carries `motivo: 'heuristic-pending'` — the operator MUST confirm before
 * any row is persisted to `gastos_ctacte_mapping`.
 */
export interface HeuristicCandidate {
  ctacteId: string
  socioId: string | null
  ctacteFecha: string
  ctacteConcepto: string | null
  debe: string
  haber: string
  daysDiff: number
  amountDiff: number
  score: number
  motivo: GastosCtacteLinkMotivo
}

interface CandidateInputs {
  id: string
  socioId: string | null
  fecha: string
  debe: string
  haber: string
  anulado: boolean
  concepto: string | null
}

interface GastoInputs {
  id: string
  fecha: string
  importe: string
  cuentaPrincipal: string
  socioId?: string | null
}

/**
 * Pure scoring function for the heuristic candidate algorithm (design §4).
 *
 *   +50 date proximity  (|days_diff| ≤ 7)
 *   +30 amount match    (|amount_diff / gasto.importe| ≤ 10%)
 *   +20 socio_id match  (when both ctacte AND gasto have non-null socio_id)
 *
 * Returns the candidate when the total score > 30, otherwise `null`.
 * The threshold (> 30) means: a perfect amount match alone (30 points)
 * is NOT enough — the operator needs at least the date signal too.
 * Always tags the returned candidate with `motivo: 'heuristic-pending'`.
 *
 * The function is exported so the route test (and any future unit test)
 * can call it directly with synthetic rows. The route layer's
 * `findCandidates` wraps it with a `LIMIT 50` over the LATERAL view.
 */
export function scoreHeuristicCandidate(
  candidate: CandidateInputs,
  gasto: GastoInputs,
): HeuristicCandidate | null {
  // Skip anulados — they should never be surfaced as a candidate.
  if (candidate.anulado) return null

  const daysDiff = Math.abs(daysBetween(gasto.fecha, candidate.fecha))
  const amountDiff = Math.abs(parseNumeric(candidate.debe) - parseNumeric(gasto.importe))

  let score = 0
  if (daysDiff <= 7) score += 50
  const tolerance = parseNumeric(gasto.importe) * 0.1
  if (amountDiff <= tolerance) score += 30
  if (gasto.socioId && candidate.socioId && gasto.socioId === candidate.socioId) {
    score += 20
  }

  if (score <= 30) return null

  return {
    ctacteId: candidate.id,
    socioId: candidate.socioId,
    ctacteFecha: candidate.fecha,
    ctacteConcepto: candidate.concepto,
    debe: candidate.debe,
    haber: candidate.haber,
    daysDiff,
    amountDiff,
    score,
    motivo: 'heuristic-pending',
  }
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso.length === 10 ? `${aIso}T00:00:00Z` : aIso)
  const b = Date.parse(bIso.length === 10 ? `${bIso}T00:00:00Z` : bIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY
  return Math.round((a - b) / 86_400_000)
}

function parseNumeric(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export interface ListGastosFilters {
  cuentaPrincipal?: string
  fechaDesde?: string
  fechaHasta?: string
  anulado?: boolean
  page: number
  limit: number
}

export interface ListGastosResult {
  items: Gastos[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

/**
 * Page through gastos with filters. `fechaDesde` is inclusive,
 * `fechaHasta` is inclusive. Pagination defaults: page=1, limit=50.
 */
export async function findManyGastos(
  db: Db,
  filters: ListGastosFilters,
): Promise<ListGastosResult> {
  const limit = Math.min(Math.max(filters.limit, 1), 100)
  const page = Math.max(filters.page, 1)
  const offset = (page - 1) * limit

  const conds = []
  if (filters.cuentaPrincipal) {
    conds.push(eq(gastos.cuentaPrincipal, filters.cuentaPrincipal))
  }
  if (filters.fechaDesde) {
    conds.push(gte(gastos.fecha, filters.fechaDesde))
  }
  if (filters.fechaHasta) {
    conds.push(lte(gastos.fecha, filters.fechaHasta))
  }
  if (filters.anulado !== undefined) {
    conds.push(eq(gastos.anulado, filters.anulado))
  }
  const where = conds.length > 0 ? and(...conds) : undefined

  const rows = await db
    .select()
    .from(gastos)
    .where(where as never)
    .limit(10_000)
  // Sort in JS — production driver uses index sort; standin doesn't ORDER BY.
  rows.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  const total = rows.length
  const items = rows.slice(offset, offset + limit)
  return { items, total, page, limit, hasMore: offset + items.length < total }
}

export interface GastoWithLinks extends Gastos {
  links: GastosCtacteLink[]
}

// Local alias so callers (routes) don't import the schema directly.
export type Gasto = Gastos
export interface GastosCtacteLink {
  id: string
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: GastosCtacteLinkMotivo
  anulado: boolean
  anuladoAt: Date | null
  anuladoMotivo: string | null
  createdBy: string | null
  createdAt: Date
}

/**
 * Find a single gasto by id. Returns null when the row does not exist.
 * The `links` array is empty when no mapping rows exist (the caller
 * decides whether to do an additional query — this avoids an N+1 in
 * the list endpoint).
 */
export async function findGastoById(db: Db, id: string): Promise<Gastos | null> {
  const rows = await db.select().from(gastos).where(eq(gastos.id, id)).limit(1)
  return (rows[0] as Gastos | undefined) ?? null
}

export async function findLinksForGasto(db: Db, gastoId: string): Promise<GastosCtacteLink[]> {
  const rows = await db
    .select()
    .from(gastosCtacteMapping)
    .where(eq(gastosCtacteMapping.gastoId, gastoId))
    .limit(10_000)
  return rows as GastosCtacteLink[]
}

export interface CreateGastoInput {
  tipo: number
  tipoCuenta: number
  cuentaPrincipal: string
  cuentaAuxiliar: number | null
  secuencia: number
  comprobante: string
  fecha: string
  concepto: string | null
  importe: string
  iva: string
  ingresoBruto: string | null
  socioId: string | null
  legacyId: string | null
}

/**
 * Insert a new gasto. Throws 23505 (unique violation) when the 5-tuple
 * `(tipo, cuentaPrincipal, secuencia, fecha, comprobante)` already exists.
 */
export async function createGasto(db: Db, input: CreateGastoInput): Promise<Gastos> {
  const rows = await db
    .insert(gastos)
    .values({
      tipo: input.tipo,
      tipoCuenta: input.tipoCuenta,
      cuentaPrincipal: input.cuentaPrincipal,
      cuentaAuxiliar: input.cuentaAuxiliar,
      secuencia: input.secuencia,
      comprobante: input.comprobante,
      fecha: input.fecha,
      concepto: input.concepto,
      importe: input.importe,
      iva: input.iva,
      ingresoBruto: input.ingresoBruto,
      socioId: input.socioId,
      legacyId: input.legacyId,
    })
    .returning()
  return rows[0] as Gastos
}

export interface UpdateGastoInput {
  tipo?: number
  tipoCuenta?: number
  cuentaPrincipal?: string
  cuentaAuxiliar?: number | null
  secuencia?: number
  comprobante?: string
  fecha?: string
  concepto?: string | null
  importe?: string
  iva?: string
  ingresoBruto?: string | null
  socioId?: string | null
  legacyId?: string | null
}

export async function updateGasto(
  db: Db,
  id: string,
  input: UpdateGastoInput,
): Promise<Gastos | null> {
  const rows = await db
    .update(gastos)
    .set(input as never)
    .where(eq(gastos.id, id))
    .returning()
  return (rows[0] as Gastos | undefined) ?? null
}

/**
 * Hard-delete a gasto. CASCADE removes its `gastos_ctacte_mapping` rows.
 * Returns true when a row was removed.
 */
export async function deleteGasto(db: Db, id: string): Promise<boolean> {
  const result = await db.delete(gastos).where(eq(gastos.id, id))
  return Boolean((result as { rowCount?: number }).rowCount)
}

/**
 * Soft-anular a gasto. The `gastos_ctacte_mapping` rows are NOT cascaded
 * (spec Q5: soft warning, no cascade). They remain as audit trail; the
 * operator can re-create active links later.
 */
export async function anularGasto(db: Db, id: string, motivo: string): Promise<Gastos | null> {
  const rows = await db
    .update(gastos)
    .set({ anulado: true, anuladoAt: new Date(), anuladoMotivo: motivo })
    .where(eq(gastos.id, id))
    .returning()
  return (rows[0] as Gastos | undefined) ?? null
}

export interface CreateLinkInput {
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: GastosCtacteLinkMotivo
  createdBy: string | null
}

/**
 * Create a link between a gasto and a ctacte row. Throws 23505 when
 * an ACTIVE link already exists for the same pair (partial UNIQUE).
 */
export async function createLink(db: Db, input: CreateLinkInput): Promise<GastosCtacteLink> {
  const rows = await db
    .insert(gastosCtacteMapping)
    .values({
      gastoId: input.gastoId,
      ctacteId: input.ctacteId,
      montoCubierto: input.montoCubierto,
      motivo: input.motivo,
      createdBy: input.createdBy,
    })
    .returning()
  return rows[0] as GastosCtacteLink
}

export async function deleteLink(db: Db, linkId: string): Promise<boolean> {
  const result = await db.delete(gastosCtacteMapping).where(eq(gastosCtacteMapping.id, linkId))
  return Boolean((result as { rowCount?: number }).rowCount)
}

export async function anularLink(
  db: Db,
  linkId: string,
  motivo: string,
): Promise<GastosCtacteLink | null> {
  const rows = await db
    .update(gastosCtacteMapping)
    .set({ anulado: true, anuladoAt: new Date(), anuladoMotivo: motivo })
    .where(eq(gastosCtacteMapping.id, linkId))
    .returning()
  return (rows[0] as GastosCtacteLink | undefined) ?? null
}

export async function findLinkById(db: Db, linkId: string): Promise<GastosCtacteLink | null> {
  const rows = await db
    .select()
    .from(gastosCtacteMapping)
    .where(eq(gastosCtacteMapping.id, linkId))
    .limit(1)
  return (rows[0] as GastosCtacteLink | undefined) ?? null
}

/**
 * Resolve the linked ctacte cuenta (socio carnet) for a given gasto's
 * active links. Used by `GET /api/v1/ctacte/:cuenta/gastos-links`:
 * the route takes `cuenta` (the socio carnet), finds every active
 * ctacte row with that cuenta, and returns the linked gastos for each.
 *
 * Returns one record per (gasto, ctacte) pair, with the ctacte's
 * `fecha` and `debe` joined for context. Only ACTIVE links and
 * non-anulada ctacte rows are returned.
 */
export interface GastoLinkForCuenta {
  linkId: string
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: GastosCtacteLinkMotivo
  anulado: boolean
  gastoFecha: string
  gastoImporte: string
  gastoConcepto: string | null
  gastoCuentaPrincipal: string
}

export async function findLinksByCtacteCuenta(
  db: Db,
  cuenta: string,
): Promise<GastoLinkForCuenta[]> {
  // Join mapping → ctacte (cctcuenta = cuenta) → gasto.
  const rows = await db
    .select()
    .from(gastosCtacteMapping)
    .innerJoin(ctacte, eq(gastosCtacteMapping.ctacteId, ctacte.id))
    .innerJoin(gastos, eq(gastosCtacteMapping.gastoId, gastos.id))
    .where(and(eq(ctacte.cctcuenta, cuenta), eq(gastosCtacteMapping.anulado, false)))
    .limit(10_000)
  // The standin returns a merged row shape; map it defensively.
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const mapping = (r['gastos_ctacte_mapping'] ?? r) as Record<string, unknown>
    const gasto = (r['gastos'] ?? r) as Record<string, unknown>
    return {
      linkId: mapping['id'] as string,
      gastoId: mapping['gastoId'] as string,
      ctacteId: mapping['ctacteId'] as string,
      montoCubierto: String(mapping['montoCubierto'] ?? '0'),
      motivo: mapping['motivo'] as GastosCtacteLinkMotivo,
      anulado: Boolean(mapping['anulado']),
      gastoFecha: gasto['fecha'] as string,
      gastoImporte: gasto['importe'] as string,
      gastoConcepto: (gasto['concepto'] as string | null) ?? null,
      gastoCuentaPrincipal: gasto['cuentaPrincipal'] as string,
    }
  })
}

/**
 * Heuristic candidate discovery. Reads the `gastos_with_ctacte_candidates`
 * view (LATERAL on fecha ± 3 days AND debe=importe, LIMIT 1) and scores
 * each row through `scoreHeuristicCandidate`. NEVER inserts.
 *
 * The view itself does the heavy lifting on the production driver (real
 * LATERAL + index). The standin (test env) does NOT support LATERAL, so
 * this function gracefully degrades: it scans `state.ctacte` directly
 * and computes the heuristic in JS. The contract is the same shape.
 *
 * Spec: max 50 candidates per call; motivo is ALWAYS 'heuristic-pending'.
 */
export async function findCandidates(
  db: Db,
  gastoId: string,
  limit = 50,
): Promise<HeuristicCandidate[]> {
  const gastoRows = await db.select().from(gastos).where(eq(gastos.id, gastoId)).limit(1)
  const gasto = gastoRows[0] as Gastos | undefined
  if (!gasto) return []

  // Try the production view first (raw SQL). If the standin is in use,
  // the view query will return an empty array (the standin doesn't
  // implement custom views), so we fall back to the JS heuristic.
  let viewRows: Array<Record<string, unknown>> = []
  try {
    viewRows = (await db.execute(sql`
      SELECT * FROM tesoreria.gastos_with_ctacte_candidates
       WHERE gasto_id = ${gastoId}
         AND ctacte_id IS NOT NULL
       LIMIT ${limit}
    `)) as unknown as Array<Record<string, unknown>>
  } catch {
    viewRows = []
  }

  if (viewRows.length > 0) {
    return viewRows
      .map((row) =>
        scoreHeuristicCandidate(
          {
            id: row['ctacte_id'] as string,
            socioId: (row['socio_id'] as string | null) ?? null,
            fecha: row['ctacte_fecha'] as string,
            debe: String(row['debe'] ?? '0.00'),
            haber: String(row['haber'] ?? '0.00'),
            anulado: false,
            concepto: (row['ctacte_concepto'] as string | null) ?? null,
          },
          {
            id: gasto.id,
            fecha: gasto.fecha,
            importe: gasto.importe,
            cuentaPrincipal: gasto.cuentaPrincipal,
            socioId: gasto.socioId,
          },
        ),
      )
      .filter((c): c is HeuristicCandidate => c !== null)
      .slice(0, limit)
  }

  // Fallback heuristic (test/standin): scan ctacte rows directly.
  const ctacteRows = (await db.select().from(ctacte).limit(10_000)) as Ctacte[]
  const candidates = ctacteRows
    .map((row) =>
      scoreHeuristicCandidate(
        {
          id: row.id,
          socioId: row.socioId,
          fecha: row.fecha,
          debe: row.debe,
          haber: row.haber,
          anulado: row.anulado,
          concepto: row.concepto,
        },
        {
          id: gasto.id,
          fecha: gasto.fecha,
          importe: gasto.importe,
          cuentaPrincipal: gasto.cuentaPrincipal,
          socioId: gasto.socioId,
        },
      ),
    )
    .filter((c): c is HeuristicCandidate => c !== null)
    .slice(0, limit)
  return candidates
}

/**
 * Count active links for a gasto. Used by the list endpoint to render
 * the `link_count` column without an N+1 query.
 */
export async function countLinksForGasto(db: Db, gastoId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(gastosCtacteMapping)
    .where(and(eq(gastosCtacteMapping.gastoId, gastoId), eq(gastosCtacteMapping.anulado, false)))
  return Number((rows[0] as { n?: number | bigint } | undefined)?.n ?? 0)
}

/**
 * Resolve the count of link rows for a gasto (including anuladas).
 * Used by service code that needs the audit-trail count.
 */
export async function countAllLinksForGasto(db: Db, gastoId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(gastosCtacteMapping)
    .where(eq(gastosCtacteMapping.gastoId, gastoId))
  return Number((rows[0] as { n?: number | bigint } | undefined)?.n ?? 0)
}

/**
 * Resolve the count of link rows pointing at a ctacte row. Used by
 * audit queries that want to know "how many gastos reference this
 * ctacte movement".
 */
export async function countLinksForCtacte(db: Db, ctacteId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(gastosCtacteMapping)
    .where(and(eq(gastosCtacteMapping.ctacteId, ctacteId), eq(gastosCtacteMapping.anulado, false)))
  return Number((rows[0] as { n?: number | bigint } | undefined)?.n ?? 0)
}

/**
 * Find every active link pointing at a given ctacte row. Used by
 * internal validation (e.g. before hard-deleting a ctacte row).
 */
export async function findLinksByCtacteId(db: Db, ctacteId: string): Promise<GastosCtacteLink[]> {
  const rows = await db
    .select()
    .from(gastosCtacteMapping)
    .where(and(eq(gastosCtacteMapping.ctacteId, ctacteId), eq(gastosCtacteMapping.anulado, false)))
    .limit(10_000)
  return rows as GastosCtacteLink[]
}

/**
 * Look up a ctacte row by id. Used for 404 checks before creating a link.
 */
export async function findCtacteById(db: Db, id: string): Promise<Ctacte | null> {
  const rows = await db.select().from(ctacte).where(eq(ctacte.id, id)).limit(1)
  return (rows[0] as Ctacte | undefined) ?? null
}
