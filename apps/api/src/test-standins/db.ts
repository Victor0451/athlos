import { and, eq, isNull, gt, type SQL } from 'drizzle-orm'
import type {
  ApprovalToken,
  AuditEvent,
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
type AuditEventRow = AuditEvent

type Row =
  | OperatorRow
  | RefreshTokenRow
  | ApprovalTokenRow
  | SocioRow
  | CtacteRow
  | DisciplinaRow
  | EjercicioRow
  | InscripcionRow
  | AuditEventRow

interface StandinState {
  operators: OperatorRow[]
  refreshTokens: RefreshTokenRow[]
  approvalTokens: ApprovalTokenRow[]
  socios: SocioRow[]
  ctacte: CtacteRow[]
  disciplinas: DisciplinaRow[]
  ejercicios: EjercicioRow[]
  inscripciones: InscripcionRow[]
  auditEvents: AuditEventRow[]
}

export interface StandinDb {
  state: StandinState
  reset(): void
}

type Filter = { kind: 'eq' | 'isNull' | 'gt' | 'lt' | 'ilike'; column: string; value: unknown }

/**
 * A logical group. The standin models the WHERE as a flat list of
 * predicates that are AND'd at apply time. An `OrGroup` is a
 * single predicate that evaluates to true if any of its inner
 * filters match — used for `or(ilike(a, ...), ilike(b, ...), ...)`.
 */
type FilterGroup = { or: Filter[] }
type Clause = Filter | FilterGroup
function isOrGroup(c: Clause): c is FilterGroup {
  return (c as FilterGroup).or !== undefined
}

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

const AUDIT_SQL_TO_JS: Record<string, keyof AuditEventRow> = {
  id: 'id',
  operator_id: 'operatorId',
  action: 'action',
  entity_type: 'entityType',
  entity_id: 'entityId',
  old_value: 'oldValue',
  new_value: 'newValue',
  source_ip: 'sourceIp',
  metadata: 'metadata',
  idempotency_key: 'idempotencyKey',
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
  audit_events: AUDIT_SQL_TO_JS,
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
  if (f.kind === 'ilike') {
    // The value passed in is the LIKE pattern (e.g. `%garc%`).
    // Translate `%` to `.*` and match case-insensitively.
    if (typeof v !== 'string' || typeof f.value !== 'string') return false
    const pattern = f.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')
    const re = new RegExp('^' + pattern + '$', 'i')
    return re.test(v)
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

function normalizeFilters(cond: unknown): Clause[] {
  if (!cond) return []
  if (Array.isArray(cond)) return cond.flatMap(normalizeFilters)
  const obj = cond as { queryChunks?: Array<unknown> }
  if (obj.queryChunks) return parseChunks(obj.queryChunks)
  return []
}

function parseChunks(chunks: Array<unknown>): Clause[] {
  const out: Clause[] = []
  // First, try the leaf shape on the whole array (eq/isNull/gt are
  // a flat SQL with 3 or 5 chunks).
  const leaf = parseLeaf(chunks)
  if (leaf) {
    out.push(leaf)
    return out
  }
  // Otherwise recurse: AND / OR / nested queries wrap their operands
  // in another SQL with `queryChunks` of their own.
  // Detect `or(...)` by scanning for the ` or ` separator strings
  // between child SQL fragments.
  if (isOrShape(chunks)) {
    const children = extractOrChildren(chunks)
    const inner: Filter[] = []
    for (const c of children) {
      const norm = normalizeFilters(c)
      for (const x of norm) {
        if (!isOrGroup(x)) inner.push(x)
      }
    }
    out.push({ or: inner })
    return out
  }
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

/**
 * Detect an `or(...)` wrapper. The shape is `[parens, qc-1, ' or ', qc-2, ' or ', qc-3, parens]`
 * — a sequence of child SQLs separated by StringChunk(' or ').
 */
function isOrShape(chunks: Array<unknown>): boolean {
  let sawOr = false
  for (const c of chunks) {
    if (typeof c !== 'object' || c === null) continue
    const o = c as { value?: unknown; queryChunks?: unknown }
    if (Array.isArray(o.value)) {
      const arr = o.value as unknown[]
      if (arr.some((x) => x === ' or ' || x === ' OR ')) sawOr = true
    }
  }
  return sawOr
}

/** Pull out the child SQLs of an `or(...)` wrapper. */
function extractOrChildren(chunks: Array<unknown>): unknown[] {
  const out: unknown[] = []
  for (const c of chunks) {
    if (typeof c !== 'object' || c === null) continue
    const o = c as { value?: unknown; queryChunks?: unknown }
    if (Array.isArray(o.value)) {
      // StringChunk — skip, it's the ' or ' separator
      continue
    }
    if (o.queryChunks) {
      out.push(c)
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
      if (opStr?.toLowerCase() === ' ilike ')
        return { kind: 'ilike', column: col, value: String(val) }
    }
  }
  return null
}

interface StandinDrizzle {
  select(): unknown
  insert(t: unknown): unknown
  update(t: unknown): unknown
  delete(t: unknown): unknown
  transaction<T>(fn: (tx: StandinDrizzle) => Promise<T>): Promise<T>
}

function buildDrizzleInterface(state: StandinState): StandinDrizzle {
  function applyFilters(rows: Row[], filters: Clause[], tname: string): Row[] {
    return rows.filter((r) => filters.every((f) => clauseMatches(r, f, tname)))
  }
  function clauseMatches(row: Row, c: Clause, tname: string): boolean {
    if (isOrGroup(c)) return c.or.some((f) => matches(row, f, tname))
    return matches(row, c, tname)
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
    if (tname === 'audit_events') return state.auditEvents
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
    if (tname === 'inscripciones') {
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
    // Default catch-all: audit_events and any future INSERT-only
    // tables. The standin doesn't enforce column constraints
    // here, so the caller is responsible for passing a value
    // shape that matches the row type.
    return {
      id: id as string,
      ...v,
      createdAt: (v['createdAt'] as Date) ?? new Date(),
    } as unknown as Row
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
    /**
     * Build a thenable that ALSO exposes `.offset(o)`. The chain
     * `...limit(n)` should be awaitable (returns rows) and
     * `...limit(n).offset(o)` should also be awaitable. Drizzle's
     * real client returns a thenable at every step; the standin
     * fakes the same shape so the service code can `await ...limit(n)`
     * OR `await ...limit(n).offset(o)` without branching.
     */
    function makeOffsetResult(rowsPromise: Promise<unknown[]>): unknown {
      const obj = {
        offset: (o: number) => makeOffsetResult(rowsPromise.then((r) => r.slice(o))),
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          rowsPromise.then(onFulfilled, onRejected),
      }
      return obj
    }
    function makeLimitResult(resolveRows: (offset: number) => Promise<unknown[]>): unknown {
      const rowsPromise = resolveRows(0)
      return {
        offset: (o: number) => makeOffsetResult(resolveRows(o)),
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          rowsPromise.then(onFulfilled, onRejected),
      }
    }
    return {
      from: (table: unknown) => {
        const realTname = tableName(table) || tname
        return {
          innerJoin: (table2: unknown, _on: unknown) => {
            const tname2 = tableName(table2)
            const builder = {
              where: (cond: unknown) => {
                const filters = normalizeFilters(cond)
                const resolveJoin = (offset: number, n: number): Promise<unknown[]> => {
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
                  return Promise.resolve(joined.slice(offset, offset + n))
                }
                return {
                  orderBy: (_sort: unknown) => ({
                    limit: (n: number) => makeLimitResult((o) => resolveJoin(o, n)),
                  }),
                  limit: (n: number) => makeLimitResult((o) => resolveJoin(o, n)),
                }
              },
            }
            return builder
          },
          where: (cond: unknown) => {
            const filters = normalizeFilters(cond)
            const resolveFiltered = (offset: number, n: number): Promise<unknown[]> => {
              const rows = applyFilters(getRows(realTname), filters, realTname)
              if (isCount) return Promise.resolve([{ n: rows.length }])
              if (isSum) return Promise.resolve([{ saldo: '0.00' }])
              return Promise.resolve(rows.slice(offset, offset + n))
            }
            return {
              orderBy: (_sort: unknown) => ({
                limit: (n: number) => makeLimitResult((o) => resolveFiltered(o, n)),
              }),
              limit: (n: number) => makeLimitResult((o) => resolveFiltered(o, n)),
            }
          },
          orderBy: (_sort: unknown) => {
            const resolveAll = (offset: number, n: number): Promise<unknown[]> => {
              const rows = getRows(realTname)
              if (isCount) return Promise.resolve([{ n: rows.length }])
              return Promise.resolve(rows.slice(offset, offset + n))
            }
            return {
              limit: (n: number) => makeLimitResult((o) => resolveAll(o, n)),
            }
          },
          limit: (n: number) => {
            const resolveAll = (offset: number): Promise<unknown[]> => {
              const rows = getRows(realTname)
              if (isCount) return Promise.resolve([{ n: rows.length }])
              return Promise.resolve(rows.slice(offset, offset + n))
            }
            return makeLimitResult(resolveAll)
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
      // Drizzle's real client returns nested objects keyed by
      // the table name — `{ inscripciones: {...}, socios: {...} }`.
      // The standin matches that shape so the service code can
      // `row.inscripciones.id` without branching between test
      // and prod.
      const leftTname = tnameOf(left)
      const rightTname = tnameOf(right)
      const out: Record<string, unknown> = {}
      if (leftTname) out[leftTname] = left
      if (rightTname) out[rightTname] = right
      // If we couldn't resolve a table name for either side,
      // fall back to a flat merge (the previous behavior) so
      // unknown tables don't crash.
      if (!leftTname && !rightTname) {
        return { ...left, ...right }
      }
      return out
    }
    const out: Record<string, unknown> = {}
    for (const [alias, col] of Object.entries(projection)) {
      const obj = col as { name?: string; _?: { name?: string; table?: unknown } }
      const tableSym = (col as unknown as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL]
      const sqlName = obj.name ?? obj._?.name
      if (!sqlName) continue
      const tname2 = tableSym as string | undefined
      const jsCol = tname2 ? jsColumn(tname2, sqlName) : null
      if (jsCol && right[jsCol] !== undefined) {
        out[alias] = right[jsCol]
        continue
      }
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

  /**
   * Best-effort: figure out which table a row came from by
   * looking for a known primary-key column. Used by the inner
   * join so the returned row shape matches Drizzle's nested
   * `{ <tableName>: { ...row } }`.
   */
  function tnameOf(row: Record<string, unknown>): string | null {
    if ('numeroSocio' in row) return 'socios'
    if ('anio' in row && 'fechaInicio' in row) return 'ejercicios'
    if ('codigo' in row && 'nombre' in row) return 'disciplinas'
    if ('socioId' in row && 'disciplinaId' in row && 'ejercicioId' in row) return 'inscripciones'
    if ('debe' in row && 'haber' in row) return 'ctacte'
    if ('username' in row && 'role' in row) return 'operators'
    if ('tokenHash' in row && 'operatorId' in row) return 'refreshTokens'
    if ('tokenHash' in row && 'actionType' in row) return 'approvalTokens'
    if ('entityType' in row) return 'audit_events'
    return null
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
        if (isDuplicate(tname, v, rows)) {
          if (skipDup) {
            if (cols) return Promise.resolve([])
            return Promise.resolve([])
          }
          // Surface a unique-constraint violation the same way
          // the pg driver does — the service layer sniffs for
          // `code === '23505'` and turns it into a CONFLICT.
          const err = new Error(
            `duplicate key value violates unique constraint (${tname})`,
          ) as Error & { code?: string }
          err.code = '23505'
          return Promise.reject(err)
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
          if (filters.every((f) => clauseMatches(r, f, tname))) {
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
    delete(table: unknown) {
      const tname = tableName(table)
      const applyDelete = (cond: unknown): { rowCount: number } => {
        const filters = normalizeFilters(cond)
        const rows = getRows(tname)
        const before = rows.length
        const surviving = rows.filter((r) => !filters.every((f) => clauseMatches(r, f, tname)))
        // Replace the array's contents so the standin's state arrays
        // stay the same reference (the container's state object holds
        // the array reference; we mutate it in place).
        rows.length = 0
        for (const r of surviving) rows.push(r)
        return { rowCount: before - surviving.length }
      }
      return {
        where: (cond: unknown) => {
          const built = {
            returning: () => applyDelete(cond),
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve(applyDelete(cond)).then(onFulfilled, onRejected),
          }
          return built
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
    auditEvents: [],
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
      state.auditEvents.length = 0
    },
    drizzle: buildDrizzleInterface(state),
  }
}

void ({} as SQL)
void and
void eq
void isNull
void gt
