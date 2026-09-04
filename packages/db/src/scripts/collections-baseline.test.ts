import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pg', () => ({ default: { Pool: class {} } }))
import {
  acceptsCollectionsBaseline,
  classifyCollectionsBaseline,
  parseCollectionsJournal,
  type BaselineInput,
} from './collections-baseline.ts'
import {
  canonicalBajaMetadataConstraint,
  collectionsCompatibilityHashes,
  historicalBajaMetadataConstraint,
} from './collections-migration-identities.ts'

const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const sparseTags =
  '0044_socios_member_evidence_resolutions,0048_socios_admin_route_relations_repair,0049_dues_pricing_obligations,0050_dues_benefit_rules,0051_dues_family_groups,0052_dues_settlements,0053_dues_agreements_community_work,0054_dues_cash_closes,0055_cash_policy_atomicity,0056_cash_recovery_policy,0057_cash_lifecycle_boundaries,0058_dues_open_agreements'.split(
    ',',
  )

async function fixture(
  kind: 'sparse' | 'compatible',
  ledger: 'contiguous' | 'sparse' | 'contiguous-post' | 'sparse-post' = 'contiguous',
): Promise<BaselineInput> {
  const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  const compatibilityIndex = journal.entries.findIndex(
    (entry) => entry.tag === '0059_collections_inscription_compatibility',
  )
  const predecessor = journal.entries.slice(0, compatibilityIndex)
  const sparsePredecessor = predecessor.filter((entry) => sparseTags.includes(entry.tag))
  const suffix = journal.entries.slice(compatibilityIndex)
  const entries =
    ledger === 'sparse'
      ? sparsePredecessor
      : ledger === 'contiguous-post'
        ? [...predecessor, ...suffix]
        : ledger === 'sparse-post'
          ? [...sparsePredecessor, ...suffix]
          : predecessor
  const applied = entries.map(({ tag, when }) => ({ createdAt: when, hash: tag }))
  const columns =
    kind === 'sparse'
      ? []
      : [
          { name: 'fecha_baja', type: 'date', nullable: true, default: null },
          { name: 'baja_motivo', type: 'text', nullable: true, default: null },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            nullable: false,
            default: 'now()',
          },
        ]
  const constraints =
    kind === 'sparse'
      ? []
      : [
          {
            name: 'inscripciones_estado_check',
            definition:
              "CHECK ((estado = ANY (ARRAY['activa'::text, 'pendiente'::text, 'baja'::text])))",
            validated: true,
          },
          {
            name: 'inscripciones_baja_metadata_check',
            definition: canonicalBajaMetadataConstraint,
            validated: true,
          },
        ]
  return { applied, journal, columns, constraints }
}

describe('Collections migration baseline', () => {
  it.each(['{', 'not-json'])(
    'fails closed with context for malformed local journal JSON',
    (source) => {
      expect(() => parseCollectionsJournal(source)).toThrow('journal local inválido')
    },
  )

  it.each(['contiguous', 'sparse'] as const)(
    'accepts the exact %s sparse predecessor',
    async (ledger) =>
      expect(classifyCollectionsBaseline(await fixture('sparse', ledger)).kind).toBe('forward'),
  )

  it.each(['contiguous', 'contiguous-post', 'sparse-post'] as const)(
    'accepts the exact compatible %s lineage',
    async (ledger) =>
      expect(classifyCollectionsBaseline(await fixture('compatible', ledger)).kind).toBe(
        'compatible',
      ),
  )

  it('requires a compatible baseline after migration', async () => {
    expect(
      acceptsCollectionsBaseline(classifyCollectionsBaseline(await fixture('sparse')), 'post'),
    ).toBe(false)
    expect(
      acceptsCollectionsBaseline(classifyCollectionsBaseline(await fixture('compatible')), 'post'),
    ).toBe(true)
  })

  it('guards the migration with exact schema predicates rather than object counts', async () => {
    const sql = await readFile(
      `${drizzleDir}/0059_collections_inscription_compatibility.sql`,
      'utf8',
    )
    expect(sql).not.toContain('lifecycle_columns integer')
    expect(sql).toContain(
      "data_type = 'timestamp with time zone' AND is_nullable = 'NO' AND column_default = 'now()'",
    )
    expect(sql).toContain('con.convalidated')
    expect(sql).toContain(historicalBajaMetadataConstraint)
    expect(sql).toContain(canonicalBajaMetadataConstraint)
    expect(collectionsCompatibilityHashes).toEqual(
      new Set([
        '86ac3253483a8c5d3f8dd8ce24d63aa104f3ecf56e8692a6a0f81f247503da51',
        '205b763361c954078ccf99081de1e22d26744c9a9d6370a52861d19df8a1d33a',
      ]),
    )
    expect(await readFile(`${drizzleDir}/../../../docker-entrypoint.sh`, 'utf8')).toContain(
      'collections:baseline --post-migration',
    )
  })

  it('accepts the exact historical metadata constraint but rejects a third form', async () => {
    const historical = await fixture('compatible')
    historical.constraints[1]!.definition = historicalBajaMetadataConstraint
    expect(classifyCollectionsBaseline(historical).kind).toBe('compatible')
    historical.constraints[1]!.definition = 'CHECK (fecha_baja IS NOT NULL)'
    expect(classifyCollectionsBaseline(historical).kind).toBe('unsupported')
  })

  it('fails closed for hash, timestamp, partial schema, and validation mismatches', async () => {
    const hash = await fixture('sparse')
    hash.applied[0]!.hash = 'wrong'
    expect(classifyCollectionsBaseline(hash).kind).toBe('unsupported')
    const timestamp = await fixture('sparse')
    timestamp.applied[0]!.createdAt += 1
    expect(classifyCollectionsBaseline(timestamp).kind).toBe('unsupported')
    const partialSuffix = await fixture('compatible', 'sparse-post')
    partialSuffix.applied.splice(sparseTags.length + 1, 1)
    expect(classifyCollectionsBaseline(partialSuffix).kind).toBe('unsupported')
    const reorderedSuffix = await fixture('compatible', 'sparse-post')
    ;[reorderedSuffix.applied[sparseTags.length], reorderedSuffix.applied[sparseTags.length + 1]] =
      [reorderedSuffix.applied[sparseTags.length + 1]!, reorderedSuffix.applied[sparseTags.length]!]
    expect(classifyCollectionsBaseline(reorderedSuffix).kind).toBe('unsupported')
    const extraSuffix = await fixture('compatible', 'sparse-post')
    extraSuffix.applied.push({ createdAt: 0, hash: 'unexpected_suffix' })
    expect(classifyCollectionsBaseline(extraSuffix).kind).toBe('unsupported')
    const missingCompatibility = await fixture('sparse')
    missingCompatibility.journal.entries = missingCompatibility.journal.entries.filter(
      (entry) => entry.tag !== '0059_collections_inscription_compatibility',
    )
    expect(classifyCollectionsBaseline(missingCompatibility).kind).toBe('unsupported')
    const schema = await fixture('compatible')
    schema.columns[0]!.type = 'timestamp without time zone'
    expect(classifyCollectionsBaseline(schema).kind).toBe('unsupported')
    const defaultMismatch = await fixture('compatible')
    defaultMismatch.columns[2]!.default = 'CURRENT_TIMESTAMP'
    expect(classifyCollectionsBaseline(defaultMismatch).kind).toBe('unsupported')
    const nullability = await fixture('compatible')
    nullability.columns[1]!.nullable = false
    expect(classifyCollectionsBaseline(nullability).kind).toBe('unsupported')
    const definition = await fixture('compatible')
    definition.constraints[1]!.definition = 'CHECK (true)'
    expect(classifyCollectionsBaseline(definition).kind).toBe('unsupported')
    const extra = await fixture('compatible')
    extra.columns.push({ name: 'baja_observacion', type: 'text', nullable: true, default: null })
    expect(classifyCollectionsBaseline(extra).kind).toBe('unsupported')
    const constraint = await fixture('compatible')
    constraint.constraints[0]!.validated = false
    expect(classifyCollectionsBaseline(constraint).kind).toBe('unsupported')
  })

  it('classifies without mutating an unsupported baseline fixture', async () => {
    const baseline = await fixture('sparse')
    baseline.applied.pop()
    const before = JSON.stringify(baseline)
    expect(classifyCollectionsBaseline(baseline).kind).toBe('unsupported')
    expect(JSON.stringify(baseline)).toBe(before)
  })
})
