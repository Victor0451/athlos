/**
 * @athlos/validation — public API.
 *
 * Two layers:
 *
 *   1. Primitives (`./primitives`) — UUID, pagination, money, dates,
 *      enums, and the legacy DBF key. Compose these into resource
 *      shapes; do not duplicate the rules inline.
 *
 *   2. Per-resource schemas (`./resources/*`) — one file per
 *      resource. They are the contract for the corresponding
 *      Fastify route's `body` / `query` / `params` shape and can
 *      also be consumed by the web app for client-side form
 *      validation (single source of truth).
 *
 * Schemas export both the schema and an inferred type. Routes use
 * `throwIfInvalid(schema, body, 'body')` from @athlos/errors to
 * produce a `BusinessError(VALIDATION_ERROR)` with the field path
 * included in `details`.
 */
export * from './primitives.ts'
export {
  createSocioSchema,
  updateSocioSchema,
  socioFilterSchema,
  type CreateSocio,
  type UpdateSocio,
  type SocioFilter,
} from './resources/socio.ts'
export { ctacteQuerySchema, type CtacteQuery } from './resources/ctacte.ts'
export {
  createOperadorSchema,
  updateOperadorSchema,
  type CreateOperador,
  type UpdateOperador,
} from './resources/operador.ts'
