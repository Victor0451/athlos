/**
 * Service pattern template.
 *
 * Services sit ABOVE repositories (see data-access-layer spec §1) and own:
 *  1. Multi-repository orchestration inside a single transaction.
 *  2. Business rules and validation (Zod lives at the API edge; the service
 *     layer enforces invariants the schema can't, e.g. "can't close an
 *     ejercicio with unbalanced asientos").
 *  3. Cross-cutting side effects (audit_events, notifications) inside the
 *     same transaction as the write.
 *
 * Trivial reads BYPASS the service layer. The rule of thumb from the spec:
 * a service is required when ≥2 repositories are involved OR business logic
 * is present.
 *
 * This file is a pattern reference. Concrete services land in the feature
 * PR that owns the workflow; they are NOT exported from `@athlos/db` and are
 * wired through the DI container in `apps/api`.
 */
import type { Db } from '../pool'
import { exampleFindById } from '../repositories/_template'

/**
 * Example orchestration: read → validate → write. The transaction is
 * mandatory here because the read feeds the write (read-then-write
 * dependency — see data-access-layer spec §4 on serializable / FOR UPDATE).
 */
export async function exampleBusinessAction(
  db: Db,
  input: { id: string; field: string },
): Promise<unknown> {
  return db.transaction(async (tx) => {
    const existing = await exampleFindById({ db: tx }, input.id)
    if (!existing) {
      throw new Error('not found')
    }
    // ... real business logic + write + audit_events insert on `tx`
    return existing
  })
}
