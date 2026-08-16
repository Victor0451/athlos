import { sql } from 'drizzle-orm'
import type { ReceiptTx } from './inscription-repository.ts'

type Estado = 'activa' | 'pendiente' | 'baja'
type Row = {
  id: string
  socio_id: string
  disciplina_id: string
  ejercicio_id: string
  fecha_alta: string
  estado: Estado
  baja_motivo: string | null
  fecha_baja: string | null
}
type Input = {
  table?: string
  id: string
  socioId?: string
  disciplinaId?: string
  ejercicioId?: string
  fechaAlta?: string
  estado?: Extract<Estado, 'activa' | 'pendiente'>
  target?: Extract<Estado, 'activa' | 'baja'>
  expectedEstado?: Estado
  motivo?: string
  fechaBaja?: string
}
class LifecycleError extends Error {
  constructor(readonly kind: 'conflict' | 'notFound' | 'validation') {
    super(kind)
  }
}

const rows = (value: unknown) => (value as { rows?: Row[] }).rows ?? []
const table = (input: Input) => sql.raw(input.table ?? 'deportes.inscripciones')
const snapshot = (row: Row) => ({
  entityId: row.id,
  identity: {
    socioId: row.socio_id,
    disciplinaId: row.disciplina_id,
    ejercicioId: row.ejercicio_id,
  },
  current: row.estado,
  after: row,
})
const fail = (kind: LifecycleError['kind']): never => {
  throw new LifecycleError(kind)
}

export async function applyCreate(tx: ReceiptTx, input: Input) {
  if (
    !input.socioId ||
    !input.disciplinaId ||
    !input.ejercicioId ||
    !input.fechaAlta ||
    !input.estado
  )
    fail('validation')
  try {
    const after = rows(
      await tx.execute(sql`INSERT INTO ${table(input)} (id, socio_id, disciplina_id, ejercicio_id, fecha_alta, estado)
      VALUES (${input.id}, ${input.socioId}, ${input.disciplinaId}, ${input.ejercicioId}, ${input.fechaAlta}, ${input.estado}) RETURNING *`),
    )[0]
    if (!after) fail('conflict')
    return { ...snapshot(after!), before: null, target: after!.estado, changed: true as const }
  } catch (error) {
    if ((error as { code?: string }).code === '23503') fail('notFound')
    if ((error as { code?: string }).code === '23505') fail('conflict')
    throw error
  }
}

export async function applyTransition(tx: ReceiptTx, input: Input) {
  if (!input.target) fail('validation')
  const observed = rows(
    await tx.execute(sql`SELECT * FROM ${table(input)} WHERE id = ${input.id}`),
  )[0]
  if (!observed) fail('notFound')
  if (observed!.estado === input.target) {
    const locked = rows(
      await tx.execute(
        sql`SELECT * FROM ${table(input)} WHERE id = ${input.id} AND estado = ${input.target} FOR UPDATE`,
      ),
    )[0]
    if (!locked) fail('conflict')
    return { ...snapshot(locked!), before: locked!, target: input.target, changed: false as const }
  }
  if (input.target !== 'baja' && observed!.estado !== 'baja') fail('conflict')
  if (input.target === 'baja' && (!input.motivo?.trim() || !input.fechaBaja)) fail('validation')
  const expected = input.expectedEstado ?? observed!.estado
  const after = rows(
    await tx.execute(sql`UPDATE ${table(input)} SET estado = ${input.target},
    baja_motivo = CASE WHEN ${input.target === 'baja'} THEN ${input.motivo ?? null} ELSE baja_motivo END,
    fecha_baja = CASE WHEN ${input.target === 'baja'} THEN ${input.fechaBaja ?? null} ELSE fecha_baja END
    WHERE id = ${input.id} AND estado = ${expected} RETURNING *`),
  )[0]
  if (!after) fail('conflict')
  return { ...snapshot(after!), before: observed!, target: input.target, changed: true as const }
}
