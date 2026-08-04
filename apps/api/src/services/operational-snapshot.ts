export interface SnapshotReadiness {
  db: 'ok' | 'down'
  schema: 'ok' | 'down'
}

export interface OperationalSnapshotDependencies<Freshness, Job, Attention> {
  readReadiness: () => Promise<SnapshotReadiness>
  readFreshness: () => Promise<Freshness[]>
  readJobs: () => Promise<Job[]>
  readAttention: () => Promise<Attention[]>
}

function unavailableReadiness() {
  return {
    overall: 'unavailable' as const,
    db: 'unavailable' as const,
    schema: 'unavailable' as const,
  }
}

export async function buildOperationalSnapshot<Freshness, Job, Attention>(
  dependencies: OperationalSnapshotDependencies<Freshness, Job, Attention>,
) {
  const [readiness, freshness, jobs, attention] = await Promise.allSettled([
    dependencies.readReadiness(),
    dependencies.readFreshness(),
    dependencies.readJobs(),
    dependencies.readAttention(),
  ])
  const readinessValue =
    readiness.status === 'fulfilled'
      ? {
          overall:
            readiness.value.db === 'ok' && readiness.value.schema === 'ok'
              ? ('ready' as const)
              : ('unavailable' as const),
          db: readiness.value.db === 'ok' ? ('ready' as const) : ('unavailable' as const),
          schema: readiness.value.schema === 'ok' ? ('ready' as const) : ('unavailable' as const),
        }
      : unavailableReadiness()

  return {
    readiness: readinessValue,
    freshness:
      freshness.status === 'fulfilled'
        ? { available: true, items: freshness.value }
        : { available: false, items: [] },
    jobs:
      jobs.status === 'fulfilled'
        ? { available: true, items: jobs.value }
        : { available: false, items: [] },
    attention:
      attention.status === 'fulfilled'
        ? { available: true, items: attention.value.slice(0, 10) }
        : { available: false, items: [] },
  }
}
