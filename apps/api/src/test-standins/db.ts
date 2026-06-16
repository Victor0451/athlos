import { and, eq, isNull, gt, type SQL } from 'drizzle-orm'
import type {
  ApprovalToken,
  Operator,
  RefreshToken,
  Socio,
  Ctacte,
  Disciplina,
  Ejercicio,
  Inscripcion,
} from '@athlos/db/schema'

/**
 * Minimal in-memory Drizzle standin. Implements only the surface the
 * auth + operators + approval + socio + ctacte + padrones services
 * use, building on the same parser as the approval standin (PR 3a).
 *
 * Why a standin instead of Testcontainers:
 *   - PR 3a's approval tests already established the pattern; route
 *     tests need a DB to fire requests against, but full SQL semantics
 *     (joins, transactions, ON CONFLICT) are not under test here.
 *   - A standin keeps the suite fast: no Docker, no DB provisioning,
 *     no migration. CI's Postgres service still runs the real tests
 *     (the buildServer sanity test, etc.) — this is for unit-level
 *     verification of route handlers.
 *
 * The standin supports:
 *   - `db.select().from(table).where(cond).limit(n)`  → returns rows
 *   - `db.insert(table).values(v).onConflictDoNothing({target}).returning(...)`
 *   - `db.update(table).set(p).where(cond).returning(...)`
 *   - `db.transaction(async (tx) => { ... })`  → passes a tx wrapper
 *   - `db.select(p).from(t1).innerJoin(t2, cond)`  → joined rows
 *   - `eq`, `and`, `isNull`, `gt`, `lt` operators (parsed from queryChunks)
 *   - `sql\`count(*)::int\`` projections
 *
 * Not supported (callers MUST NOT use):
 *   - GROUP BY, ORDER BY, OFFSET (tests don't need them)
 *   - `between`, `inArray`, `isNotNull`
 *   - LEFT / RIGHT joins (only INNER JOIN is wired)
 */

type OperatorRow = Operator
type RefreshTokenRow = RefreshToken
type ApprovalTokenRow = ApprovalToken
type SocioRow = Socio
type CtacteRow = Ctacte
type DisciplinaRow = Disciplina
type EjercicioRow = Ejercicio
type InscripcionRow = Inscripcion

type Row =
  | OperatorRow
  | RefreshTokenRow
  | ApprovalTokenRow
  | SocioRow
  | CtacteRow
  | DisciplinaRow
  | EjercicioRow
  | InscripcionRow

interface StandinState {
  operators: OperatorRow[]
  refreshTokens: RefreshTokenRow[]
  approvalTokens: ApprovalTokenRow[]
  socios: SocioRow[]
  ctacte: CtacteRow[]
  disciplinas: DisciplinaRow[]
  ejercicios: EjercicioRow[]
  inscripciones: InscripcionRow[]
}

export interface StandinDb {
  state: StandinState
  reset(): void
}

type Filter = { kind: 'eq' | 'isNull' | 'gt' | 'lt'; column: string; value: unknown }

const OPERATOR_SQL_TO_JS: Record<string, keyof OperatorRow> = {
  id: 'id',
  username: 'username',
  password_hash: 'passwordHash',
  role: 'role',
  can_reprint: 'canReprint',
  can_anulate: 'canAnulate',
  is_active: 'isActive',
  last_login_at: 'lastLoginAt',
  failed_login_attempts: 'failedLoginAttempts',
  locked_until: 'lockedUntil',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
}

const REFRESH_SQL_TO_JS: Record<string, keyof RefreshTokenRow> = {
  id: 'id',
  operator_id: 'operatorId',
  token_hash: 'tokenHash',
  expires_at: 'expiresAt',
  revoked_at: 'revokedAt',
  created_at: 'createdAt',
}

const APPROVAL_SQL_TO_JS: Record<string, keyof ApprovalTokenRow> = {
  id: 'id',
  token_hash: 'tokenHash',
  action_type: 'actionType',
  action_id: 'actionId',
  context_summary: 'contextSummary',
  created_by_operator_id: 'createdByOperatorId',
  approver_channel: 'approverChannel',
  approver_address: 'approverAddress',
  expires_at: 'expiresAt',
  used_at: 'usedAt',
  status: 'status',
  created_at: 'createdAt',
}

const SOCIO_SQL_TO_JS: Record<string, keyof SocioRow> = {
  id: 'id',
  numero_socio: 'numeroSocio',
  nombre: 'nombre',
  apellido: 'apellido',
  dni: 'dni',
  fecha_alta: 'fechaAlta',
  estado: 'estado',
  categoria: 'categoria',
  direccion: 'direccion',
  telefono: 'telefono',
  email: 'email',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  deleted_at: 'deletedAt',
}

const CTACTE_SQL_TO_JS: Record<string, keyof CtacteRow> = {
  id: 'id',
  socio_id: 'socioId',
  fecha: 'fecha',
  tipo: 'tipo',
  concepto: 'concepto',
  debe: 'debe',
  haber: 'haber',
  anulado: 'anulado',
  anulado_at: 'anuladoAt',
  anulado_motivo: 'anuladoMotivo',
  created_at: 'createdAt',
}

const DISCIPLINA_SQL_TO_JS: Record<string, keyof DisciplinaRow> = {
  id: 'id',
  codigo: 'codigo',
  nombre: 'nombre',
  created_at: 'createdAt',
}

const EJERCICIO_SQL_TO_JS: Record<string, keyof EjercicioRow> = {
  id: 'id',
  anio: 'anio',
  descripcion: 'descripcion',
  fecha_inicio: 'fechaInicio',
  fecha_fin: 'fechaFin',
  created_at: 'createdAt',
}

const INSCRIPCION_SQL_TO_JS: Record<string, keyof InscripcionRow> = {
  id: 'id',
  socio_id: 'socioId',
  disciplina_id: 'disciplinaId',
  ejercicio_id: 'ejercicioId',
  estado: 'estado',
  fecha_alta: 'fechaAlta',
  created_at: 'createdAt',
}

const SQL_TO_JS_FOR: Record<string, Record<string, string>> = {
  operators: OPERATOR_SQL_TO_JS,
  refresh_tokens: REFRESH_SQL_TO_JS,
  approval_tokens: APPROVAL_SQL_TO_JS,
  socios: SOCIO_SQL_TO_JS,
  ctacte: CTACTE_SQL_TO_JS,
  disciplinas: DISCIPLINA_SQL_TO_JS,
  ejercicios: EJERCICIO_SQL_TO_JS,
  inscripciones: INSCRIPCION_SQL_TO_JS,
}

function jsColumn(tableName: string, sqlName: string): string | null {
  return SQL_TO_JS_FOR[tableName]?.[sqlName] ?? null
}

function matches(row: Row, f: Filter, tableName: string): boolean {
  const jsCol = jsColumn(tableName, f.column)
  if (!jsCol) return false
  const v = (row as unknown as Record<string, unknown>)[jsCol]
  if (f.kind === 'eq') return v === f.value
  if (f.kind === 'isNull') return v === null || v === undefined
  if (f.kind === 'gt') {
    if (v instanceof Date && f.value instanceof Date) return v > f.value
    if (typeof v === 'number' && typeof f.value === 'number') return v > f.value
    if (typeof v === 'string' && typeof f.value === 'string') return v > f.value
    return false
  }
  if (f.kind === 'lt') {
    if (v instanceof Date && f.value instanceof Date) return v < f.value
    if (typeof v === 'number' && typeof f.value === 'number') return v < f.value
    if (typeof v === 'string' && typeof f.value === 'string') return v < f.value
    return false
  }
  return false
}

// Drizzle 0.36 tables expose their name via a private symbol
// `Symbol(drizzle:Name)`. We can't reference the symbol by name in
// an index signature, so we resolve it at lookup time.
const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name')

function tableName(t: unknown): string {
  if (typeof t !== 'object' || t === null) return ''
  const obj = t as {
    name?: unknown
    _?: { name?: unknown }
    getSQL?: () => unknown
  }
  const sym = (obj as unknown as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
  if (typeof sym === 'string') return sym
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  if (typeof obj.getSQL === 'function') {
    const sql = obj.getSQL() as { queryChunks?: Array<unknown> } | undefined
    const inner = sql?.queryChunks?.[0]
    if (inner) {
      const innerSym = (inner as unknown as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
      if (typeof innerSym === 'string') return innerSym
    }
  }
  return ''
}

function columnName(col: unknown): string | null {
  if (typeof col === 'string') return col
  if (typeof col !== 'object' || col === null) return null
  const obj = col as { name?: unknown; _: { name: string } }
  if (typeof obj.name === 'string') return obj.name
  if (obj._ && typeof obj._.name === 'string') return obj._.name
  return null
}

function unwrapValue(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  const obj = v as { value?: unknown }
  if ('value' in obj) return obj.value
  return v
}

/**
 * Detect a `count(*)` projection: the projection is `{ n: <sql> }`
 * where the SQL fragment contains `count(*)`. Used by the admin
 * operator service to pre-check username uniqueness.
 */
function isCountProjection(projection: Record<string, unknown> | undefined): boolean {
  if (!projection) return false
  const keys = Object.keys(projection)
  if (keys.length !== 1) return false
  const value = projection[keys[0]!]
  if (value === null || typeof value !== 'object') return false
  // The SQL fragment's `queryChunks` is an array; one of the chunks
  // is a StringChunk with `value: ['count(*)::int']` or similar.
  // We scan every chunk — the position varies by Drizzle version.
  const sql = value as { queryChunks?: Array<{ value?: string[] | string }> }
  for (const chunk of sql.queryChunks ?? []) {
    if (Array.isArray(chunk.value)) {
      for (const s of chunk.value) {
        if (typeof s === 'string' && s.toLowerCase().includes('count(*)')) return true
      }
    } else if (typeof chunk.value === 'string' && chunk.value.toLowerCase().includes('count(*)')) {
      return true
    }
  }
  return false
}

/**
 * Detect a `sum(... - ...)` projection (e.g. `sum(debe - haber)`).
 * Used by the ctacte repository for saldo computation.
 */
function isSumProjection(projection: Record<string, unknown> | undefined): boolean {
  if (!projection) return false
  const keys = Object.keys(projection)
  if (keys.length !== 1) return false
  const value = projection[keys[0]!]
  if (value === null || typeof value !== 'object') return false
  const sql = value as { queryChunks?: Array<{ value?: string[] | string }> }
  for (const chunk of sql.queryChunks ?? []) {
    if (Array.isArray(chunk.value)) {
      for (const s of chunk.value) {
        if (typeof s === 'string' && s.toLowerCase().includes('sum(')) return true
      }
    } else if (typeof chunk.value === 'string' && chunk.value.toLowerCase().includes('sum(')) {
      return true
    }
  }
  return false
}

function normalizeFilters(cond: unknown): Filter[] {
  if (!cond) return []
  if (Array.isArray(cond)) return cond.flatMap(normalizeFilters)
  const obj = cond as { queryChunks?: Array<unknown> }
  if (obj.queryChunks) return parseChunks(obj.queryChunks)
  return []
}

function parseChunks(chunks: Array<unknown>): Filter[] {
  const out: Filter[] = []
  // First, try the leaf shape on the whole array (eq/isNull/gt are
  // a flat SQL with 3 or 5 chunks).
  const leaf = parseLeaf(chunks)
  if (leaf) {
    out.push(leaf)
    return out
  }
  // Otherwise recurse: AND / OR / nested queries wrap their operands
  // in another SQL with `queryChunks` of their own.
  for (const chunk of chunks) {
    if (chunk === null || chunk === undefined) continue
    if (typeof chunk === 'string') continue
    if (typeof chunk !== 'object') continue
    const inner = chunk as { value?: unknown; queryChunks?: Array<unknown> }
    if (Array.isArray(inner.value)) continue
    if (inner.queryChunks) {
      out.push(...parseChunks(inner.queryChunks))
    }
  }
  return out
}

function parseLeaf(chunks: Array<unknown>): Filter | null {
  if (chunks.length === 3) {
    const col = columnName(chunks[1])
    const op = chunks[2] as { value?: string[] } | string | undefined
    const opStr = typeof op === 'object' && op && Array.isArray(op.value) ? op.value[0] : undefined
    if (col && opStr === ' is null') {
      return { kind: 'isNull', column: col, value: undefined }
    }
  }
  if (chunks.length === 5) {
    const col = columnName(chunks[1])
    const op = chunks[2] as { value?: string[] } | string | undefined
    const val = unwrapValue(chunks[3])
    const opStr = typeof op === 'object' && op && Array.isArray(op.value) ? op.value[0] : undefined
    if (col) {
      if (opStr === ' = ') return { kind: 'eq', column: col, value: val }
      if (opStr === ' > ') return { kind: 'gt', column: col, value: val }
      if (opStr === ' < ') return { kind: 'lt', column: col, value: val }
    }
  }
  return null
}

interface StandinDrizzle {
  select(): unknown
  insert(t: unknown): unknown
  update(t: unknown): unknown
  transaction<T>(fn: (tx: StandinDrizzle) => Promise<T>): Promise<T>
}

function buildDrizzleInterface(state: StandinState): StandinDrizzle {
  function applyFilters(rows: Row[], filters: Filter[], tname: string): Row[] {
    return rows.filter((r) => filters.every((f) => matches(r, f, tname)))
  }
  function getRows(tname: string): Row[] {
    if (tname === 'operators') return state.operators
    if (tname === 'refresh_tokens') return state.refreshTokens
    if (tname === 'approval_tokens') return state.approvalTokens
    if (tname === 'socios') return state.socios
    if (tname === 'ctacte') return state.ctacte
    if (tname === 'disciplinas') return state.disciplinas
    if (tname === 'ejercicios') return state.ejercicios
    if (tname === 'inscripciones') return state.inscripciones
    return []
  }

  function makeRow(tname: string, v: Record<string, unknown>): Row {
    const id = v['id'] ?? cryptoRandomId()
    if (tname === 'operators') {
      return {
        id: id as string,
        username: v['username']!,
        passwordHash: v['passwordHash']!,
        role: v['role']!,
        canReprint: (v['canReprint'] as boolean) ?? false,
        canAnulate: (v['canAnulate'] as boolean) ?? false,
        isActive: (v['isActive'] as boolean) ?? true,
        lastLoginAt: (v['lastLoginAt'] as Date | null) ?? null,
        failedLoginAttempts: (v['failedLoginAttempts'] as number) ?? 0,
        lockedUntil: (v['lockedUntil'] as Date | null) ?? null,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
        updatedAt: (v['updatedAt'] as Date) ?? new Date(),
      } as OperatorRow
    }
    if (tname === 'refresh_tokens') {
      return {
        id: id as string,
        operatorId: v['operatorId']!,
        tokenHash: v['tokenHash']!,
        expiresAt: v['expiresAt']!,
        revokedAt: (v['revokedAt'] as Date | null) ?? null,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
      } as RefreshTokenRow
    }
    if (tname === 'approval_tokens') {
      return {
        id: id as string,
        tokenHash: v['tokenHash']!,
        actionType: v['actionType']!,
        actionId: v['actionId']!,
        contextSummary: v['contextSummary']!,
        createdByOperatorId: v['createdByOperatorId']!,
        approverChannel: v['approverChannel']!,
        approverAddress: v['approverAddress']!,
        expiresAt: v['expiresAt']!,
        usedAt: (v['usedAt'] as Date | null) ?? null,
        status: (v['status'] as ApprovalTokenRow['status']) ?? 'pending',
        createdAt: (v['createdAt'] as Date) ?? new Date(),
      } as ApprovalTokenRow
    }
    if (tname === 'socios') {
      return {
        id: id as string,
        numeroSocio: v['numeroSocio']!,
        nombre: v['nombre']!,
        apellido: v['apellido']!,
        dni: v['dni']!,
        fechaAlta: v['fechaAlta']!,
        estado: (v['estado'] as SocioRow['estado']) ?? 'activo',
        categoria: (v['categoria'] as string | null) ?? null,
        direccion: (v['direccion'] as string | null) ?? null,
        telefono: (v['telefono'] as string | null) ?? null,
        email: (v['email'] as string | null) ?? null,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
        updatedAt: (v['updatedAt'] as Date) ?? new Date(),
        deletedAt: (v['deletedAt'] as Date | null) ?? null,
      } as SocioRow
    }
    if (tname === 'ctacte') {
      return {
        id: id as string,
        socioId: v['socioId']!,
        fecha: v['fecha']!,
        tipo: v['tipo']!,
        concepto: v['concepto']!,
        debe: (v['debe'] as string) ?? '0.00',
        haber: (v['haber'] as string) ?? '0.00',
        anulado: (v['anulado'] as boolean) ?? false,
        anuladoAt: (v['anuladoAt'] as Date | null) ?? null,
        anuladoMotivo: (v['anuladoMotivo'] as string | null) ?? null,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
      } as CtacteRow
    }
    if (tname === 'disciplinas') {
      return {
        id: id as string,
        codigo: v['codigo']!,
        nombre: v['nombre']!,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
      } as DisciplinaRow
    }
    if (tname === 'ejercicios') {
      return {
        id: id as string,
        anio: v['anio']!,
        descripcion: v['descripcion']!,
        fechaInicio: v['fechaInicio']!,
        fechaFin: v['fechaFin']!,
        createdAt: (v['createdAt'] as Date) ?? new Date(),
      } as EjercicioRow
    }
    return {
      id: id as string,
      socioId: v['socioId']!,
      disciplinaId: v['disciplinaId']!,
      ejercicioId: v['ejercicioId']!,
      estado: (v['estado'] as string) ?? 'activa',
      fechaAlta: v['fechaAlta']!,
      createdAt: (v['createdAt'] as Date) ?? new Date(),
    } as InscripcionRow
  }

  function project(tname: string, row: Row, cols: Record<string, unknown>): unknown {
    if (Object.keys(cols).length === 0) return row
    const out: Record<string, unknown> = {}
    for (const [alias, col] of Object.entries(cols)) {
      const sqlName = (col as { name?: string }).name
      if (!sqlName) continue
      const jsCol = jsColumn(tname, sqlName)
      if (jsCol) out[alias] = (row as unknown as Record<string, unknown>)[jsCol]
    }
    return out
  }

  function isDuplicate(tname: string, v: Record<string, unknown>, rows: Row[]): boolean {
    if (tname === 'operators') {
      return rows.some((r) => (r as OperatorRow).username === v['username'])
    }
    if (tname === 'refresh_tokens') {
      return rows.some((r) => (r as RefreshTokenRow).tokenHash === v['tokenHash'])
    }
    if (tname === 'approval_tokens') {
      return rows.some((r) => (r as ApprovalTokenRow).tokenHash === v['tokenHash'])
    }
    if (tname === 'socios') {
      return rows.some(
        (r) => (r as SocioRow).numeroSocio === v['numeroSocio'] || (r as SocioRow).dni === v['dni'],
      )
    }
    if (tname === 'disciplinas') {
      return rows.some((r) => (r as DisciplinaRow).codigo === v['codigo'])
    }
    if (tname === 'ejercicios') {
      return rows.some((r) => (r as EjercicioRow).anio === v['anio'])
    }
    if (tname === 'inscripciones') {
      return rows.some(
        (r) =>
          (r as InscripcionRow).socioId === v['socioId'] &&
          (r as InscripcionRow).disciplinaId === v['disciplinaId'] &&
          (r as InscripcionRow).ejercicioId === v['ejercicioId'],
      )
    }
    return false
  }

  function selectChain(tname: string, projection: Record<string, unknown> | undefined) {
    const isCount = isCountProjection(projection)
    const isSum = isSumProjection(projection)
    return {
      from: (table: unknown) => {
        const realTname = tableName(table) || tname
        return {
          innerJoin: (table2: unknown, _on: unknown) => {
            const tname2 = tableName(table2)
            const builder = {
              where: (cond: unknown) => {
                const filters = normalizeFilters(cond)
                return {
                  orderBy: (_sort: unknown) => {
                    return {
                      limit: (n: number) => {
                        // INNER JOIN semantics: row exists only if
                        // both sides have a match. For PR 5 the
                        // standin implements this as a cartesian
                        // filter — only emit rows whose FK matches
                        // a row in the joined table. Good enough
                        // for the small fixtures the tests use.
                        const left = applyFilters(getRows(realTname), filters, realTname)
                        const rightRows = getRows(tname2)
                        const joined = left.flatMap((l) => {
                          const lAny = l as unknown as Record<string, unknown>
                          // Pick the FK from left that points to right
                          // by checking known FK columns.
                          const fkCandidates: Array<keyof typeof lAny> = []
                          for (const k of Object.keys(lAny)) {
                            if (tname2 === 'socios' && k === 'socioId') fkCandidates.push(k)
                            if (tname2 === 'disciplinas' && k === 'disciplinaId')
                              fkCandidates.push(k)
                            if (tname2 === 'ejercicios' && k === 'ejercicioId') fkCandidates.push(k)
                          }
                          return rightRows
                            .filter((r) => {
                              const rAny = r as unknown as Record<string, unknown>
                              return fkCandidates.some((fk) => lAny[fk] === rAny['id'])
                            })
                            .map((r) => mergeJoinRow(lAny, rAny(r), projection))
                        })
                        return Promise.resolve(joined.slice(0, n))
                      },
                    }
                  },
                  limit: (n: number) => {
                    const left = applyFilters(getRows(realTname), filters, realTname)
                    const rightRows = getRows(tname2)
                    const joined = left.flatMap((l) => {
                      const lAny = l as unknown as Record<string, unknown>
                      const fkCandidates: Array<keyof typeof lAny> = []
                      for (const k of Object.keys(lAny)) {
                        if (tname2 === 'socios' && k === 'socioId') fkCandidates.push(k)
                        if (tname2 === 'disciplinas' && k === 'disciplinaId') fkCandidates.push(k)
                        if (tname2 === 'ejercicios' && k === 'ejercicioId') fkCandidates.push(k)
                      }
                      return rightRows
                        .filter((r) => {
                          const rAny = r as unknown as Record<string, unknown>
                          return fkCandidates.some((fk) => lAny[fk] === rAny['id'])
                        })
                        .map((r) => mergeJoinRow(lAny, rAny(r), projection))
                    })
                    return Promise.resolve(joined.slice(0, n))
                  },
                }
              },
            }
            return builder
          },
          where: (cond: unknown) => {
            const filters = normalizeFilters(cond)
            return {
              orderBy: (_sort: unknown) => {
                return {
                  limit: (n: number) => {
                    const rows = applyFilters(getRows(realTname), filters, realTname).slice(0, n)
                    if (isCount) return Promise.resolve([{ n: rows.length }])
                    if (isSum) {
                      // Sum debe - haber for ctacte when applicable;
                      // the standin doesn't fully parse the SQL
                      // expression but the repository's getSaldo
                      // pre-filters rows client-side before calling
                      // sum, so we just return 0 here. The route's
                      // getSaldo calls run a custom path — see
                      // select().from(ctacte).where(...).limit(1) with
                      // a sum() projection. The standin returns 0
                      // for sum projections; the service uses a
                      // dedicated helper instead. (See ctacte
                      // service.ts `sumDebeHaber`.)
                      return Promise.resolve([{ saldo: '0.00' }])
                    }
                    return Promise.resolve(rows)
                  },
                }
              },
              limit: (n: number) => {
                const rows = applyFilters(getRows(realTname), filters, realTname).slice(0, n)
                if (isCount) return Promise.resolve([{ n: rows.length }])
                if (isSum) return Promise.resolve([{ saldo: '0.00' }])
                return Promise.resolve(rows.slice(0, n))
              },
            }
          },
          orderBy: (_sort: unknown) => {
            return {
              limit: (n: number) => {
                const rows = getRows(realTname).slice(0, n)
                if (isCount) return Promise.resolve([{ n: rows.length }])
                return Promise.resolve(rows)
              },
            }
          },
          limit: (n: number) => {
            const rows = getRows(realTname).slice(0, n)
            if (isCount) return Promise.resolve([{ n: rows.length }])
            return Promise.resolve(rows)
          },
        }
      },
    }
  }

  function rAny(r: unknown): Record<string, unknown> {
    return r as unknown as Record<string, unknown>
  }

  function mergeJoinRow(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    projection: Record<string, unknown> | undefined,
  ): unknown {
    if (!projection || Object.keys(projection).length === 0) {
      return { ...left, ...right }
    }
    const out: Record<string, unknown> = {}
    for (const [alias, col] of Object.entries(projection)) {
      const obj = col as { name?: string; _?: { name?: string; table?: unknown } }
      const tableSym = (col as unknown as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
      const sqlName = obj.name ?? obj._?.name
      if (!sqlName) continue
      // Try right side first, then left. This is a heuristic —
      // the standin is good enough for the padrones join used in
      // PR 5 tests, but real queries should use the real DB.
      const tname2 = tableSym as string | undefined
      const jsCol = tname2 ? jsColumn(tname2, sqlName) : null
      if (jsCol && right[jsCol] !== undefined) {
        out[alias] = right[jsCol]
        continue
      }
      // Fallback: walk both sides for the column.
      if (right[sqlName] !== undefined) {
        out[alias] = right[sqlName]
        continue
      }
      if (left[sqlName] !== undefined) {
        out[alias] = left[sqlName]
        continue
      }
    }
    return out
  }

  return {
    select(projection?: Record<string, unknown>) {
      return selectChain('', projection)
    },
    insert(table: unknown) {
      const tname = tableName(table)
      function doInsert(
        v: Record<string, unknown>,
        skipDup: boolean,
        cols: Record<string, unknown> | null,
      ): unknown {
        const rows = getRows(tname)
        if (skipDup && isDuplicate(tname, v, rows)) {
          if (cols) return Promise.resolve([])
          return Promise.resolve([])
        }
        const newRow = makeRow(tname, v)
        rows.push(newRow)
        if (cols) return Promise.resolve([project(tname, newRow, cols)])
        return Promise.resolve([newRow])
      }
      return {
        values: (v: Record<string, unknown>) => {
          const built = {
            onConflictDoNothing: (_opts: { target: unknown }) => ({
              returning: (cols?: Record<string, unknown>) => doInsert(v, true, cols ?? null),
            }),
            returning: (cols?: Record<string, unknown>) => doInsert(v, false, cols ?? null),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve(doInsert(v, false, null)).then(onFulfilled, onRejected),
          }
          return built
        },
      }
    },
    update(table: unknown) {
      const tname = tableName(table)
      function applyUpdate(
        cond: unknown,
        patch: Record<string, unknown>,
        cols: Record<string, unknown> | null,
      ): unknown {
        const filters = normalizeFilters(cond)
        const rows = getRows(tname)
        const updated: Row[] = []
        for (const r of rows) {
          if (filters.every((f) => matches(r, f, tname))) {
            Object.assign(r, patch)
            updated.push(r)
          }
        }
        if (cols) return updated.map((u) => project(tname, u, cols))
        return updated
      }
      return {
        set: (patch: Record<string, unknown>) => {
          const result = {
            where: (cond: unknown) => {
              const built = {
                returning: (cols?: Record<string, unknown>) =>
                  applyUpdate(cond, patch, cols ?? null),
                then: (
                  onFulfilled: (v: unknown) => unknown,
                  onRejected?: (e: unknown) => unknown,
                ) => Promise.resolve(applyUpdate(cond, patch, null)).then(onFulfilled, onRejected),
              }
              return built
            },
          }
          return result
        },
      }
    },
    async transaction<T>(fn: (tx: StandinDrizzle) => Promise<T>): Promise<T> {
      return fn(buildDrizzleInterface(state))
    },
  }
}

function cryptoRandomId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Sum `debe - haber` for non-anuladas rows of a socio. Exposed so the
 * ctacte service can compute the saldo client-side without depending
 * on the standin's sum() projection. Returns a string-encoded
 * NUMERIC(14,2) (same format as the column).
 */
export function sumDebeHaberStandin(state: StandinState, socioId: string): string {
  let totalCents = 0n
  for (const r of state.ctacte) {
    if (r.socioId !== socioId) continue
    if (r.anulado) continue
    totalCents += parseCents(r.debe) - parseCents(r.haber)
  }
  return centsToString(totalCents)
}

export function parseCents(s: string): bigint {
  // "1234.56" -> 123456n; "-12.00" -> -1200n
  const sign = s.startsWith('-') ? -1n : 1n
  const unsigned = s.replace(/^-/, '')
  const [intPart, fracPart = ''] = unsigned.split('.')
  const intCents = BigInt(intPart ?? '0') * 100n
  const fracCents = BigInt((fracPart + '00').slice(0, 2))
  return sign * (intCents + fracCents)
}

export function centsToString(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  const intPart = abs / 100n
  const fracPart = abs % 100n
  return `${sign}${intPart.toString()}.${fracPart.toString().padStart(2, '0')}`
}

export function createStandinDb(): StandinDb & { drizzle: StandinDrizzle } {
  const state: StandinState = {
    operators: [],
    refreshTokens: [],
    approvalTokens: [],
    socios: [],
    ctacte: [],
    disciplinas: [],
    ejercicios: [],
    inscripciones: [],
  }
  return {
    state,
    reset() {
      state.operators.length = 0
      state.refreshTokens.length = 0
      state.approvalTokens.length = 0
      state.socios.length = 0
      state.ctacte.length = 0
      state.disciplinas.length = 0
      state.ejercicios.length = 0
      state.inscripciones.length = 0
    },
    drizzle: buildDrizzleInterface(state),
  }
}

void ({} as SQL)
void and
void eq
void isNull
void gt
