import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const sparseTags =
  '0044_socios_member_evidence_resolutions,0048_socios_admin_route_relations_repair,0049_dues_pricing_obligations,0050_dues_benefit_rules,0051_dues_family_groups,0052_dues_settlements,0053_dues_agreements_community_work,0054_dues_cash_closes,0055_cash_policy_atomicity,0056_cash_recovery_policy,0057_cash_lifecycle_boundaries,0058_dues_open_agreements'.split(
    ',',
  )
const expectedConstraints = {
  inscripciones_estado_check:
    "CHECK ((estado = ANY (ARRAY['activa'::text, 'pendiente'::text, 'baja'::text])))",
  inscripciones_baja_metadata_check:
    "CHECK (((estado <> 'baja'::text) OR ((fecha_baja IS NOT NULL) AND (baja_motivo IS NOT NULL) AND (btrim(baja_motivo) <> ''::text))))",
}

type Journal = { entries: Array<{ tag: string; when: number }> }
type Applied = { hash: string; createdAt: number }
type Column = { name: string; type: string; nullable: boolean; default: string | null }
type Constraint = { name: string; definition: string; validated: boolean }
export type BaselineInput = {
  applied: Applied[]
  journal: Journal
  columns: Column[]
  constraints: Constraint[]
}
export type BaselineResult = { kind: 'forward' | 'compatible' | 'unsupported'; reason: string }

export function parseCollectionsJournal(source: string): Journal {
  try {
    return JSON.parse(source) as Journal
  } catch {
    throw new Error('journal local inválido')
  }
}

const canonical = (value: string) =>
  value
    .replace(/::[a-z_ ]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
const equal = (left: Applied[], right: Applied[]) =>
  left.length === right.length &&
  left.every(
    (item, index) => item.hash === right[index]?.hash && item.createdAt === right[index]?.createdAt,
  )

export const acceptsCollectionsBaseline = (
  result: BaselineResult,
  phase: 'pre' | 'post',
): boolean => result.kind === 'compatible' || (phase === 'pre' && result.kind === 'forward')

export function classifyCollectionsBaseline(input: BaselineInput): BaselineResult {
  const local = input.journal.entries
  const compatibilityIndex = local.findIndex(
    (entry) => entry.tag === '0059_collections_inscription_compatibility',
  )
  if (compatibilityIndex < 0)
    return { kind: 'unsupported', reason: 'no existe la migración de compatibilidad 0059' }
  const predecessor = local.slice(0, compatibilityIndex)
  const sparsePredecessor = predecessor.filter((entry) => sparseTags.includes(entry.tag))
  const suffix = local.slice(compatibilityIndex)
  const applied = input.applied
  const matches = (entries: typeof local) =>
    equal(
      applied,
      entries.map((entry) => ({ hash: entry.tag, createdAt: entry.when })),
    )
  const supportedPredecessor = [predecessor, sparsePredecessor].some(matches)
  const supportedHead = [predecessor, sparsePredecessor].some((entries) =>
    matches([...entries, ...suffix]),
  )
  if (!supportedPredecessor && !supportedHead)
    return { kind: 'unsupported', reason: 'ledger no coincide con una línea soportada' }
  const expectedColumns = new Set(['fecha_baja', 'baja_motivo', 'updated_at'])
  if (input.columns.some((column) => !expectedColumns.has(column.name)))
    return { kind: 'unsupported', reason: 'campo de baja adicional no soportado' }
  const columns = new Map(input.columns.map((column) => [column.name, column]))
  const constraints = new Map(input.constraints.map((constraint) => [constraint.name, constraint]))
  const absent =
    ['fecha_baja', 'baja_motivo', 'updated_at'].every((name) => !columns.has(name)) &&
    Object.keys(expectedConstraints).every((name) => !constraints.has(name))
  if (absent && supportedPredecessor)
    return { kind: 'forward', reason: 'preestado compatible para migración 0059' }
  const compatible =
    columns.get('fecha_baja')?.type === 'date' &&
    columns.get('fecha_baja')?.nullable &&
    !columns.get('fecha_baja')?.default &&
    columns.get('baja_motivo')?.type === 'text' &&
    columns.get('baja_motivo')?.nullable &&
    !columns.get('baja_motivo')?.default &&
    columns.get('updated_at')?.type === 'timestamp with time zone' &&
    !columns.get('updated_at')?.nullable &&
    canonical(columns.get('updated_at')?.default ?? '') === 'now()' &&
    Object.entries(expectedConstraints).every(([name, definition]) => {
      const constraint = constraints.get(name)
      return constraint?.validated && canonical(constraint.definition) === canonical(definition)
    })
  if (compatible && (supportedPredecessor || supportedHead))
    return { kind: 'compatible', reason: 'esquema compatible' }
  return { kind: 'unsupported', reason: 'esquema de inscripciones incompleto o incompatible' }
}

async function localInput() {
  const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
  const journal = parseCollectionsJournal(
    await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8'),
  )
  return { drizzleDir, journal }
}

export async function verifyCollectionsBaseline(connectionString: string): Promise<BaselineResult> {
  const { drizzleDir, journal } = await localInput()
  const pool = new Pool({ connectionString })
  try {
    const ledger = await pool.query<{ ledger: string | null }>(
      "SELECT COALESCE(to_regclass('drizzle.__drizzle_migrations'), to_regclass('public.__drizzle_migrations'))::text AS ledger",
    )
    if (!ledger.rows[0]?.ledger)
      return { kind: 'unsupported', reason: 'no existe el libro de migraciones Drizzle' }
    const appliedRows = await pool.query<{ hash: string; created_at: number }>(
      `SELECT hash, created_at FROM ${ledger.rows[0].ledger} ORDER BY id`,
    )
    const hashes = await Promise.all(
      journal.entries.map(
        async (entry) =>
          [
            entry.tag,
            createHash('sha256')
              .update(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
              .digest('hex'),
          ] as const,
      ),
    )
    const byHash = new Map(hashes.map(([tag, hash]) => [hash, tag]))
    const applied = appliedRows.rows.map((row) => ({
      hash: byHash.get(row.hash) ?? row.hash,
      createdAt: Number(row.created_at),
    }))
    const columns = await pool.query<Column>(
      "SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable, column_default AS \"default\" FROM information_schema.columns WHERE table_schema = 'deportes' AND table_name = 'inscripciones' AND (column_name IN ('fecha_baja', 'baja_motivo', 'updated_at') OR column_name LIKE 'baja_%')",
    )
    const constraints = await pool.query<Constraint>(
      "SELECT conname AS name, pg_get_constraintdef(oid) AS definition, convalidated AS validated FROM pg_constraint WHERE conrelid = 'deportes.inscripciones'::regclass AND conname IN ('inscripciones_estado_check', 'inscripciones_baja_metadata_check')",
    )
    return classifyCollectionsBaseline({
      applied,
      journal,
      columns: columns.rows,
      constraints: constraints.rows,
    })
  } finally {
    await pool.end()
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const result = await verifyCollectionsBaseline(
    process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos',
  )
  const phase = argv.includes('--post-migration') ? 'post' : 'pre'
  console.info(`collections baseline: ${result.kind} — ${result.reason}`)
  if (!acceptsCollectionsBaseline(result, phase)) {
    console.error(
      phase === 'post' && result.kind === 'forward'
        ? 'collections baseline: falta aplicar la migración 0059 antes de iniciar la API'
        : 'collections baseline: baseline no soportado',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`collections baseline: ${String(error)}`)
    process.exitCode = 2
  })
