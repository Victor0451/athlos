/**
 * @athlos/test-builders — public exports.
 *
 * Builders produce INSERT shapes (`InferInsertModel<T>` or local
 * equivalents) for the most-used entities. Defaults are deterministic
 * (fixed UUIDs + epoch timestamp) so test failures are reproducible;
 * use `defaults.freshUuid()` / `defaults.freshNow()` to opt into entropy
 * where tests need uniqueness (e.g. UNIQUE-constraint collision suites).
 */
export { defaults } from './defaults.ts'

export { aSocio, SocioBuilder } from './builders/socio.ts'
export { aOperator, OperatorBuilder, type OperatorInsert } from './builders/operator.ts'
export { aAuditEvent, AuditEventBuilder } from './builders/audit-event.ts'
