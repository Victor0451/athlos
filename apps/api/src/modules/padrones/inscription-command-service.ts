import { emitAudit } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { executeInscriptionReceipt, type ReceiptOutcome } from './inscription-repository.ts'
import { applyCreate, applyTransition } from './inscription-service.ts'

type Estado = 'activa' | 'pendiente' | 'baja'
type Context = {
  operatorId: string
  callerKey: string
  sourceIp: string | null
  table?: string
  receiptTable?: string
  log?: Pick<Console, 'info'>
}
type CreateInput = Context & {
  id: string
  socioId: string
  disciplinaId: string
  ejercicioId: string
  fechaAlta: string
  estado: Extract<Estado, 'activa' | 'pendiente'>
}
type TransitionInput = Context & {
  id: string
  target: Extract<Estado, 'activa' | 'baja'>
  expectedEstado?: Estado
  motivo?: string
  fechaBaja?: string
}

const receiptTable = (input: Context) =>
  input.receiptTable ?? 'deportes.inscripcion_command_receipts'
const inscriptionTable = (input: Context) => input.table ?? 'deportes.inscripciones'
const metadata = (result: { identity: Record<string, string> }) => result.identity

async function audit(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  input: Context,
  action: 'INSCRIPCION_CREATED' | 'INSCRIPCION_STATUS_CHANGED',
  result: {
    entityId: string
    identity: Record<string, string>
    before: unknown
    after: unknown
  },
) {
  const emitted = await emitAudit(tx, {
    operatorId: input.operatorId,
    action,
    entityType: 'inscripcion',
    entityId: result.entityId,
    oldValue: result.before,
    newValue: result.after,
    sourceIp: input.sourceIp,
    payload: result.after,
    metadata: metadata(result),
    callerKey: input.callerKey,
  })
  if (!emitted.inserted) throw new Error('inscription audit event was not inserted')
}

function record(input: Context, outcome: string, entityId: string) {
  input.log?.info({ command: 'inscription', outcome, entityId })
}

export async function executeCreateInscription(
  db: Db,
  input: CreateInput,
): Promise<ReceiptOutcome<Awaited<ReturnType<typeof applyCreate>>>> {
  const outcome = await executeInscriptionReceipt(
    db,
    receiptTable(input),
    {
      operatorId: input.operatorId,
      callerKey: input.callerKey,
      command: 'create',
      endpoint: '/api/v1/padrones/inscripciones',
      payload: {
        socioId: input.socioId,
        disciplinaId: input.disciplinaId,
        ejercicioId: input.ejercicioId,
        fechaAlta: input.fechaAlta,
        estado: input.estado,
      },
    },
    async (tx) => {
      const result = await applyCreate(tx, { ...input, table: inscriptionTable(input) })
      await audit(tx, input, 'INSCRIPCION_CREATED', result)
      return { inscripcionId: result.entityId, result }
    },
  )
  record(input, outcome.outcome, input.id)
  return outcome
}

export async function executeTransitionInscription(
  db: Db,
  input: TransitionInput,
): Promise<ReceiptOutcome<Awaited<ReturnType<typeof applyTransition>>>> {
  const outcome = await executeInscriptionReceipt(
    db,
    receiptTable(input),
    {
      operatorId: input.operatorId,
      callerKey: input.callerKey,
      command: input.target === 'baja' ? 'baja' : 'reactivar',
      endpoint: `/api/v1/padrones/inscripciones/${input.id}/${input.target === 'baja' ? 'baja' : 'reactivar'}`,
      payload: {
        expectedEstado: input.expectedEstado,
        motivo: input.motivo,
        fechaBaja: input.fechaBaja,
      },
    },
    async (tx) => {
      const result = await applyTransition(tx, { ...input, table: inscriptionTable(input) })
      if (result.changed) await audit(tx, input, 'INSCRIPCION_STATUS_CHANGED', result)
      return { inscripcionId: result.entityId, result }
    },
  )
  record(input, outcome.outcome, input.id)
  return outcome
}
