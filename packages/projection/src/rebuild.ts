// Domain keys for the projection engine
export const DOMAIN_PROJECTION_TABLE = {
  socios: 'socios.socios_projection',
  ctacte: 'tesoreria.ctacte_projection',
  ctacte1: 'tesoreria.ctacte1_projection',
  contable: 'contabilidad.contable_projection',
  contabl1: 'contabilidad.contabl1_projection',
  catastros: 'socios.catastros_projection',
  escuela: 'socios.escuela_projection',
  deportes: 'deportes.deportes_projection',
  locacion: 'socios.locacion_projection',
  caja: 'tesoreria.caja_projection',
  gastos: 'tesoreria.gastos_projection',
} as const

export type Domain = keyof typeof DOMAIN_PROJECTION_TABLE

export async function rebuildProjection(): Promise<unknown> {
  throw new Error('TASK-067 not implemented')
}
