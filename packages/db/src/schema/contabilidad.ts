import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * `contabilidad` schema — chart of accounts, asientos, ejercicios.
 *
 * Empty in PR 2. Tables (`plan_cuentas`, `ejercicios`, `asientos`,
 * `asientos_detalle`, `categorias`, `impuestos`) land with the accounting
 * feature PR — see proposal §Future Accounting PR. The shell is registered
 * now so the initial migration reserves the namespace and downstream
 * contributors see the boundary.
 */
export const contabilidadSchema = pgSchema('contabilidad')
