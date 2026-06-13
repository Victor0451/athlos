import { z } from 'zod'
import { dniSchema, socioEstadoSchema, paginationSchema } from '../primitives.ts'

/**
 * Socio (member) resource schemas.
 *
 * The three schemas cover the canonical CRUD surface for PR 5
 * (socios routes). They are kept in @athlos/validation so the web
 * app can import the SAME shape for client-side form validation —
 * a single source of truth for the contract.
 *
 * `updateSocioSchema` uses `.partial()` of `createSocioSchema` minus
 * `nro_socio` (immutable) so PATCH semantics match the route layer.
 */

// We hand-roll the PATCH body shape (no `omitShape` helper) so we can
// make `nro_socio` REJECT on update — Zod's default behavior with
// `.strict()` is to fail on unknown keys, which is what we want for
// the immutable business key.
//
// `updateSocioSchema` is built as the post-omit shape `.partial()`-ed
// then wrapped in `.strict()` to make accidental `nro_socio` edits
// fail at the boundary instead of being silently dropped.
const socioUpdateShape = {
  apellido: z.string().min(1).max(80).optional(),
  nombre: z.string().min(1).max(80).optional(),
  doc_nro: dniSchema.optional(),
  fecha_nacimiento: z.string().datetime({ offset: true }).optional(),
  email: z.string().email().max(120).optional(),
  telefono: z.string().min(6).max(40).optional(),
  direccion: z.string().max(200).optional(),
  categoria: z.string().max(40).optional(),
} as const

const socioCreateShape = {
  nro_socio: z.coerce.number().int().positive().max(99_999),
  ...socioUpdateShape,
} as const

/**
 * POST /api/v1/socios body. `nro_socio` is required and must be a
 * positive int (the legacy system uses small positive integers,
 * capped at 99_999 so the column fits in INT UNSIGNED semantics
 * across migrations).
 */
export const createSocioSchema = z.object(socioCreateShape)

/**
 * PATCH /api/v1/socios/:id body. All fields optional except the
 * implicit `id` (handled by `idSchema` in the route's params).
 * `nro_socio` is intentionally OMITTED and the schema is `.strict()`
 * so a PATCH that includes `nro_socio` returns VALIDATION_ERROR
 * (the route layer maps to 400). The field is the stable business
 * key, never reassignable — if you need to change it, that is a
 * new socio with a re-pointed legacy_id.
 */
export const updateSocioSchema = z.object(socioUpdateShape).strict()

/**
 * GET /api/v1/socios query — combines the pagination envelope with
 * socio-specific filters. `search` does a case-insensitive match on
 * `apellido || nombre || doc_nro` in the service layer (Postgres
 * `ILIKE`). `estado` is optional so the default list returns only
 * `activo` members — `baja` is hidden unless explicitly requested.
 */
export const socioFilterSchema = paginationSchema.extend({
  estado: socioEstadoSchema.default('activo'),
  search: z.string().min(1).max(80).optional(),
})

export type CreateSocio = z.infer<typeof createSocioSchema>
export type UpdateSocio = z.infer<typeof updateSocioSchema>
export type SocioFilter = z.infer<typeof socioFilterSchema>
