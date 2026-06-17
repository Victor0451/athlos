// TASK-068 implements the real computeSaldo
export interface SaldoResult {
  socioEntityId: string
  debe: number
  haber: number
  saldo: number
  as_of: string
}

export async function computeSaldo(): Promise<SaldoResult> {
  throw new Error('TASK-068 not implemented')
}
