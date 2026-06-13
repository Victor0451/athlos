import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * `tesoreria` schema — cuenta corriente, cajas, cobros.
 *
 * Empty in PR 2. Tables (`ctacte`, `ctacte1`, `cajas`, `cobros`) land with
 * the cuenta-corriente + legacy-import PRs (PR 5 + PR 7). The
 * `saldo_acum` generated column on `ctacte1` requires a hand-written follow-up
 * migration because drizzle-kit does not emit `GENERATED ALWAYS AS ...`
 * syntax — see design §5 data-access-layer.
 */
export const tesoreriaSchema = pgSchema('tesoreria')
