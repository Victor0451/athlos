import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * `deportes` schema — disciplinas, inscripciones, cuotas de actividad.
 *
 * Empty in PR 2. Tables (`disciplinas`, `inscripciones`, `cuotas_actividad`,
 * `pago_actividad`) land with the deportes feature PR. The `file_storage`
 * schema and `archivos` table are separate (see design §File Storage) and
 * are scheduled for a dedicated PR alongside the legacy-import flow that
 * needs them.
 */
export const deportesSchema = pgSchema('deportes')
