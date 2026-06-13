/**
 * Repository pattern template — FUNCTIONAL, not class-based.
 *
 * Why modules, not classes:
 *  1. Repositories are stateless wrappers around Drizzle queries; classes add
 *     a `this` binding with no benefit.
 *  2. Functions compose more cleanly with the service layer (just import
 *     `findById` directly).
 *  3. Transactions are first-class: every repo function takes `db | tx` as
 *     the first arg, so callers pass `tx` inside a service transaction and
 *     the SQL joins the same connection.
 *
 * Conventions:
 *  - `db` is always the FIRST argument. Easier to read and curries naturally
 *    with `pool.transaction(async (tx) => repo.findById(tx, id))`.
 *  - The exported type `Db` accepts `NodePgDatabase` OR a `PgTransaction`.
 *    Drizzle widens `tx` to the same query API.
 *  - Return Drizzle inferred types (`InferSelectModel` / `InferInsertModel`).
 *    No hand-rolled row interfaces — the schema is the contract.
 *  - Trivial reads (`findById`, `findBy<X>`) live here. Multi-step reads
 *    and any write go through the matching service.
 *
 * This file is a pattern reference. Concrete repos (e.g. `audit-events.ts`,
 * `socios.ts`) get added in the PR that owns the feature; they are NOT
 * exported from `@athlos/db` — the API wires them through DI (PR 10a).
 */
import { type Socio } from '../schema/socios'
import type { Db } from '../pool'

/**
 * Context passed to every repository function. The `db` field is a Drizzle
 * client OR a transaction handle; both share the query surface. Wrapping it
 * in a struct leaves room for per-request fields later (logger, request id)
 * without breaking call sites.
 */
export interface RepoContext {
  db: Db
}

/**
 * Find a socio by primary key. Real repos return the inferred row type
 * (e.g. `Promise<Socio | undefined>`) and throw `NotFoundError` from
 * `packages/db/src/errors.ts` only when the caller signals "this MUST
 * exist" (see data-access-layer spec §6).
 */
export async function exampleFindById(ctx: RepoContext, id: string): Promise<Socio | undefined> {
  return ctx.db.query.socios.findFirst({ where: (table, { eq }) => eq(table.id, id) })
}
