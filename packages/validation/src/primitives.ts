import { z } from 'zod'

/**
 * Reusable Zod primitives. Every route in `@athlos/api` composes its
 * input shape from these building blocks so validation rules stay
 * uniform across the API.
 *
 * Each primitive exports both the schema and the inferred TS type
 * (`export type X = z.infer<typeof xSchema>`). Routes consume the type
 * with `type X = z.infer<typeof xSchema>` and pass the schema to
 * `throwIfInvalid(schema, body, 'body')` from `@athlos/errors`.
 *
 * The set is intentionally narrow: adding a new primitive requires
 * you to think about which routes will need it. If a shape is only
 * used once, keep it as a `z.object` inside the route file.
 */

// --- ID + key formats ---------------------------------------------------

/**
 * UUID v4 string. Used as the canonical primary-key format for every
 * resource (`socios.id`, `operators.id`, `approval_tokens.id`, ...).
 * Throws on non-UUID input so route handlers fail fast at the
 * boundary instead of forwarding garbage to the DB layer.
 */
export const idSchema = z.string().uuid()

/**
 * Legacy DBF record key. The legacy Clipper / dBase tables use
 * alphanumeric keys up to 32 characters (e.g. `CTACTE.000123`,
 * `SOC.0042`). Matches the spec's import-pipeline format so legacy
 * rows round-trip cleanly into the new system.
 */
export const legacyIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_.-]+$/, 'legacyId must match /^[A-Z0-9_.-]+$/')

/**
 * Argentine DNI — 7 or 8 digits, no separators. The legacy system
 * stored DNIs as `CHAR(8)` zero-padded on the left, so both formats
 * appear in the wild.
 */
export const dniSchema = z.string().regex(/^\d{7,8}$/, 'DNI must be 7 or 8 digits')

/**
 * Argentine CUIT — 11 digits formatted as `XX-XXXXXXXX-X`. The
 * format check is structural only (digit positions and dashes); the
 * check-digit (verifier mod 11) is verified at the service layer
 * because not every legacy CUIT in the imported data passes the
 * check-digit test, and we don't want to block imports on a
 * pre-existing data quirk.
 */
export const cuitSchema = z.string().regex(/^\d{2}-\d{8}-\d$/, 'CUIT must match XX-XXXXXXXX-X')

// --- Pagination + filter envelopes -------------------------------------

/**
 * Standard pagination envelope. `page` is 1-indexed, `limit` capped
 * at 100 to prevent DoS via `?limit=99999999`. `sort` accepts the
 * column name; `order` is the direction. The service layer is
 * responsible for whitelisting the columns it will actually sort on.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().min(1).max(64).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
})

/**
 * Date range — both bounds are optional ISO 8601 strings. The
 * service layer parses them into `Date` and applies them as
 * `WHERE fecha >= desde AND fecha < hasta`. The shape stays a string
 * here so the route accepts the raw query param without coercion.
 */
export const dateRangeSchema = z.object({
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
})

// --- Domain enums -------------------------------------------------------

/**
 * Socio lifecycle state. `baja` is the soft-delete marker — the row
 * stays in the table for audit but is filtered out of every default
 * query. `suspendido` indicates a temporary status (e.g. unpaid
 * dues); the route layer can list suspended members on request.
 */
export const socioEstadoSchema = z.enum(['activo', 'inactivo', 'suspendido', 'baja'])

/**
 * Operator RBAC role. The ordering matters: `ADMIN` > `TESORERO` >
 * `OPERADOR` > `CONSULTA`. Mirrors the `operators.role` column
 * defined in PR 2 and the `JWTPayload.role` type in @athlos/auth.
 */
export const operatorRoleSchema = z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'])

// --- Money --------------------------------------------------------------

/**
 * Monetary amount — string-encoded `NUMERIC(14,2)`. We deliberately
 * avoid `number` because `0.1 + 0.2 !== 0.3` in IEEE-754 and the
 * accounting ledger must round-trip exactly. The service layer
 * casts the string to a `bigint` (cents) before arithmetic, then
 * back to a string for storage.
 *
 * Negative values are allowed (credits, anulaciones) — sign is
 * meaningful in the cuenta-corriente. The route layer applies
 * domain-specific sign rules (e.g. `ctacte` DEBITO rows must be
 * non-negative).
 */
export const montoSchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'monto must match /^-?\\d{1,12}(\\.\\d{1,2})?$/')

// --- Inferred types -----------------------------------------------------

export type Id = z.infer<typeof idSchema>
export type LegacyId = z.infer<typeof legacyIdSchema>
export type Dni = z.infer<typeof dniSchema>
export type Cuit = z.infer<typeof cuitSchema>
export type Pagination = z.infer<typeof paginationSchema>
export type DateRange = z.infer<typeof dateRangeSchema>
export type SocioEstado = z.infer<typeof socioEstadoSchema>
export type OperatorRole = z.infer<typeof operatorRoleSchema>
export type Monto = z.infer<typeof montoSchema>
