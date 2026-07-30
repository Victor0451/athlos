import { releaseClosureLease, renewClosureLease } from '@athlos/db'
import type { JobHandler, JobResult } from '@athlos/scheduler'
import {
  catalogInputHash,
  materializeLegacyMembershipCatalog,
  projectLegacyMemberEvidence,
  projectLegacyMembershipCandidates,
  applyLegacyMemberEvidenceResolutions,
  type ClosurePhaseReceipt,
  type ResolutionApplicationReceipt,
} from '@athlos/promotion'
type ResolutionApplication = { executionIdentity: string; resolutionSetFingerprint: string }
type Metadata = {
  catalogBatchId: string
  sociosBatchId: string
  previewId: string
  fingerprint: string
  idempotencyKey: string
  leaseOwner: string
  leaseFence: number
  resolutionApplication?: ResolutionApplication | undefined
}
type Dependencies = {
  renew: () => Promise<boolean>
  release: () => Promise<boolean>
  now: () => Date
  catalog: () => Promise<void>
  candidates: () => Promise<ClosurePhaseReceipt>
  members: () => Promise<ClosurePhaseReceipt>
  apply?: () => Promise<ResolutionApplicationReceipt>
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
  const resolution = value.resolutionApplication
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
  if (resolution !== undefined) {
    if (
      !resolution ||
      typeof resolution !== 'object' ||
      typeof (resolution as ResolutionApplication).executionIdentity !== 'string' ||
      typeof (resolution as ResolutionApplication).resolutionSetFingerprint !== 'string' ||
      !(resolution as ResolutionApplication).executionIdentity ||
      !/^[a-f0-9]{64}$/.test((resolution as ResolutionApplication).resolutionSetFingerprint) ||
      (resolution as ResolutionApplication).executionIdentity === value.idempotencyKey
    )
      throw new Error('invalid resolution application metadata')
  }
  return {
    catalogBatchId: parsed[0]!,
    sociosBatchId: parsed[1]!,
    previewId: parsed[2]!,
    fingerprint: parsed[3]!,
    idempotencyKey: parsed[4]!,
    leaseOwner: parsed[5]!,
    leaseFence: leaseFence as number,
    resolutionApplication: resolution as ResolutionApplication | undefined,
  }
}

function reconciled(receipt: ClosurePhaseReceipt): boolean {
  return (
    receipt.eligibleCount === receipt.projectedCount + receipt.exceptionCount &&
    receipt.exceptionCount ===
      receipt.unknownTypeCount + receipt.ambiguousIdentityCount + receipt.missingIdentityCount
  )
}

function applicationReconciled(
  members: ClosurePhaseReceipt,
  application: ResolutionApplicationReceipt,
): boolean {
  return (
    application.eligibleCount === members.exceptionCount &&
    application.eligibleCount ===
      application.appliedCount +
        application.unresolvedUnknownTypeCount +
        application.unresolvedAmbiguousIdentityCount +
        application.staleCount +
        application.technicalCount &&
    application.unresolvedCount ===
      application.unresolvedUnknownTypeCount + application.unresolvedAmbiguousIdentityCount &&
    application.technicalCount === members.missingIdentityCount
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
  if (!reconciled(candidates) || !reconciled(members))
    throw new Error('incomplete closure reconciliation')
  const application = metadata.resolutionApplication
    ? await phase(() => {
        if (!deps.apply) throw new Error('resolution application dependency missing')
        return deps.apply()
      })
    : undefined
  if (
    (application && !applicationReconciled(members, application)) ||
    (!application && members.missingIdentityCount > 0) ||
    (application && (application.staleCount > 0 || application.technicalCount > 0))
  )
    throw new Error('incomplete closure reconciliation')
  const status = application
    ? application.unresolvedCount
      ? 'completed_with_review'
      : 'succeeded'
    : members.exceptionCount
      ? 'completed_with_review'
      : 'succeeded'
  if (application) await phase(async () => undefined)
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
      ...(application && {
        resolutionExecutionIdentity: metadata.resolutionApplication!.executionIdentity,
        resolutionSetFingerprint: application.applicationFingerprint,
        applied: application.appliedCount,
        unresolvedUnknownType: application.unresolvedUnknownTypeCount,
        unresolvedAmbiguousIdentity: application.unresolvedAmbiguousIdentityCount,
        staleResolutions: application.staleCount,
        technicalMissingIdentity: application.technicalCount,
      }),
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
      executionIdentity:
        metadata.resolutionApplication?.executionIdentity ?? metadata.idempotencyKey,
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
      apply: () =>
        applyLegacyMemberEvidenceResolutions(
          { acquire: () => pool.connect() },
          metadata.sociosBatchId,
          identity.executionIdentity,
          'socios',
          metadata.resolutionApplication?.resolutionSetFingerprint,
        ),
      cancelled: () => ctx.signal.aborted,
    })
    ctx.log.info({ event: 'SOCIOS_CLOSURE_DONE', ...result.metadata }, 'socios closure finished')
    return result
  }
}
