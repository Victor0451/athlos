/**
 * @athlos/db — public API.
 *
 * Consumers (apps/api, jobs) import the Drizzle client factory, the schema
 * barrel, and the inferred row types. Repositories and services live under
 * `repositories/` and `services/` and are NOT re-exported here — the API
 * layer wires them through the DI container (PR 10a).
 */
export { createDb, type Db, type DbConfig } from './pool'

export * from './schema/index'
