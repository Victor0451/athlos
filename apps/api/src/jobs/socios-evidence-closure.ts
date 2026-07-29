import { releaseClosureLease, renewClosureLease } from '@athlos/db'
import type { JobHandler, JobResult } from '@athlos/scheduler'
import {
  catalogInputHash,
  materializeLegacyMembershipCatalog,
  projectLegacyMemberEvidence,
  projectLegacyMembershipCandidates,
  type ClosurePhaseReceipt,
} from '@athlos/promotion'
type Metadata = {
  catalogBatchId: string
  sociosBatchId: string
  previewId: string
  fingerprint: string
  idempotencyKey: string
  leaseOwner: string
  leaseFence: number
}
type Dependencies = {
  renew: () => Promise<boolean>
  release: () => Promise<boolean>
  now: () => Date
  catalog: () => Promise<void>
  candidates: () => Promise<ClosurePhaseReceipt>
  members: () => Promise<ClosurePhaseReceipt>
  cancelled?: () => boolean
}
type Pool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows?: Record<string, unknown>[] }>
    release(): void
  }>
}
function closureMetadata(value: Record<string, unknown>): Metadata {
  const text = (key: keyof Metadata) =>
    typeof value[key] === 'string' && value[key] ? (value[key] as string) : null
  const leaseFence = value.leaseFence
  const parsed = [
    'catalogBatchId',
    'sociosBatchId',
    'previewId',
    'fingerprint',
    'idempotencyKey',
    'leaseOwner',
  ].map((key) => text(key as keyof Metadata))
  if (
    parsed.some((item) => item === null) ||
    !Number.isInteger(leaseFence) ||
    (leaseFence as number) < 1
  )
    throw new Error('invalid closure job metadata')
  return {
    catalogBatchId: parsed[0]!,
    sociosBatchId: parsed[1]!,
    previewId: parsed[2]!,
    fingerprint: parsed[3]!,
    idempotencyKey: parsed[4]!,
    leaseOwner: parsed[5]!,
    leaseFence: leaseFence as number,
  }
}

function reconciled(receipt: ClosurePhaseReceipt): boolean {
  return (
    receipt.eligibleCount === receipt.projectedCount + receipt.exceptionCount &&
    receipt.exceptionCount ===
      receipt.unknownTypeCount + receipt.ambiguousIdentityCount + receipt.missingIdentityCount
  )
}

export async function runSociosEvidenceClosure(
  metadata: Metadata,
  deps: Dependencies,
): Promise<JobResult> {
  const phase = async <T>(work: () => Promise<T>) => {
    if (deps.cancelled?.()) throw new Error('closure cancelled')
    if (!(await deps.renew())) throw new Error('closure lease lost')
    if (deps.cancelled?.()) throw new Error('closure cancelled')
    return work()
  }
  await phase(deps.catalog)
  const candidates = await phase(deps.candidates)
  const members = await phase(deps.members)
  if (!reconciled(candidates) || !reconciled(members) || members.missingIdentityCount > 0)
    throw new Error('incomplete closure reconciliation')
  const status = members.exceptionCount ? 'completed_with_review' : 'succeeded'
  return {
    status,
    metadata: {
      catalogBatchId: metadata.catalogBatchId,
      sociosBatchId: metadata.sociosBatchId,
      previewId: metadata.previewId,
      idempotencyKey: metadata.idempotencyKey,
      status,
      eligible: members.eligibleCount,
      projected: members.projectedCount,
      unknownType: members.unknownTypeCount,
      ambiguousIdentity: members.ambiguousIdentityCount,
      missingIdentity: members.missingIdentityCount,
    },
    afterCommit: async () => {
      try {
        await deps.release()
      } catch {}
    },
  }
}

export function makeSociosEvidenceClosureHandler(pool: Pool): JobHandler {
  return async (ctx) => {
    const metadata = closureMetadata(ctx.metadata)
    const identity = {
      executionIdentity: metadata.idempotencyKey,
      fingerprint: metadata.fingerprint,
    }
    const lease = () =>
      renewClosureLease(
        pool,
        'socios',
        metadata.fingerprint,
        metadata.leaseOwner,
        metadata.leaseFence,
        new Date(),
        60_000,
      )
    const result = await runSociosEvidenceClosure(metadata, {
      renew: lease,
      release: () =>
        releaseClosureLease(
          pool,
          'socios',
          metadata.fingerprint,
          metadata.leaseOwner,
          metadata.leaseFence,
          new Date(),
        ),
      now: () => new Date(),
      catalog: async () => {
        const [receipt, inputs] = await Promise.all([
          pool.query(
            'SELECT input_hash FROM socios.legacy_catalog_materialization_receipts WHERE batch_id = $1',
            [metadata.catalogBatchId],
          ),
          pool.query(
            "SELECT id, payload->>'RECORD_ORDINAL' AS record_ordinal, content_hash FROM socios.raw_events WHERE source_table = 'tiposoci' AND import_batch = $1 ORDER BY (payload->>'RECORD_ORDINAL')::integer, id",
            [metadata.catalogBatchId],
          ),
        ])
        const inputHash = catalogInputHash(
          inputs.rows.map((row) => ({
            id: row.id,
            recordOrdinal: row.record_ordinal,
            contentHash: row.content_hash,
          })),
        )
        if (!receipt.rows[0])
          return materializeLegacyMembershipCatalog(
            { acquire: () => pool.connect() },
            metadata.catalogBatchId,
          )
        if (receipt.rows[0].input_hash !== inputHash)
          throw new Error('incompatible catalog receipt binding')
      },
      candidates: () =>
        projectLegacyMembershipCandidates(
          { acquire: () => pool.connect() },
          metadata.catalogBatchId,
          identity,
        ),
      members: () =>
        projectLegacyMemberEvidence(
          { acquire: () => pool.connect() },
          metadata.sociosBatchId,
          'socios',
          identity,
        ),
      cancelled: () => ctx.signal.aborted,
    })
    ctx.log.info({ event: 'SOCIOS_CLOSURE_DONE', ...result.metadata }, 'socios closure finished')
    return result
  }
}
