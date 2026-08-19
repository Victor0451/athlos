import type { FastifyPluginCallback } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { gastoMutationReceipts, type Db } from '@athlos/db'
import { idSchema } from '@athlos/validation'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { AuditAction, emitAudit } from '@athlos/audit'
import type { AppContainer } from '../../container.ts'
import {
  anularGasto,
  countLinksForGasto,
  createGasto,
  deleteGasto,
  findGastoById,
  findLinksForGasto,
  findManyGastos,
  updateGasto,
  type Gasto,
} from '../../modules/gastos/repository.ts'
import { recordExpenseCompensationInTransaction } from '../../modules/dues/cash-desk.ts'
import { createIdempotencyFingerprint, validateIdempotencyKey } from '../../lib/idempotency.ts'

/**
 * Admin gastos CRUD routes — `/api/v1/gastos/*` (N16).
 *
 * Six endpoints, all gated by `requireRole('ADMIN')`:
 *
 *   GET    /api/v1/gastos            — paginated list with filters
 *   GET    /api/v1/gastos/:id        — detail + joined links[]
 *   POST   /api/v1/gastos            — create (5-tuple UNIQUE enforced)
 *   PATCH  /api/v1/gastos/:id        — update fields
 *   DELETE /api/v1/gastos/:id        — hard delete (cascades to links)
 *   PATCH  /api/v1/gastos/:id/anular — soft-delete (mapping rows remain)
 *
 * Every mutation emits an `audit_events` row via `emitAudit`. The
 * 5-tuple UNIQUE `(tipo, cuenta_principal, secuencia, fecha, comprobante)`
 * throws 23505 on duplicate — we map it to 409 GASTO_DUPLICATE.
 */

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cuenta_principal: z.string().min(1).optional(),
  fecha_desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  fecha_hasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  anulado: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
})

const idParamSchema = z.object({ id: idSchema })

// prettier-ignore
const createGastoFields=z.object({tipo:z.coerce.number().int(),tipo_cuenta:z.coerce.number().int(),cuenta_principal:z.string().min(1),cuenta_auxiliar:z.coerce.number().int().nullable().optional(),secuencia:z.coerce.number().int().nonnegative().default(0),comprobante:z.string().default(''),fecha:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),concepto:z.string().nullable().optional(),importe:z.string().regex(/^\d+(\.\d{1,2})?$/),iva:z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),ingreso_bruto:z.string().nullable().optional(),socio_id:z.string().uuid().nullable().optional(),legacy_id:z.string().nullable().optional(),compensates_gasto_id:z.string().uuid().optional(),compensation_reason:z.string().trim().min(1).max(500).optional()})
// prettier-ignore
const createGastoBodySchema=createGastoFields.superRefine((value,ctx)=>{if(value.compensates_gasto_id&&!value.compensation_reason)ctx.addIssue({code:z.ZodIssueCode.custom,path:['compensation_reason'],message:'A compensation reason is required'})})

const updateGastoBodySchema = createGastoFields.partial()

const anularBodySchema = z.object({
  motivo: z.string().min(1).max(500),
})

/**
 * DTO for a gasto list/detail response. snake_case ↔ camelCase is the
 * explicit boundary — DB rows are camelCase (Drizzle), wire format
 * stays snake_case for the web app.
 */
interface GastoDTO {
  id: string
  tipo: number
  tipoCuenta: number
  cuentaPrincipal: string
  cuentaAuxiliar: number | null
  secuencia: number
  comprobante: string
  fecha: string
  concepto: string | null
  importe: string
  iva: string
  ingresoBruto: string | null
  socioId: string | null
  legacyId: string | null
  anulado: boolean
  anuladoAt: string | null
  anuladoMotivo: string | null
  createdAt: string
  linkCount?: number
  links?: Array<Record<string, unknown>>
}

function toGastoDTO(row: Gasto, extras: Partial<GastoDTO> = {}): GastoDTO {
  return {
    id: row.id,
    tipo: row.tipo,
    tipoCuenta: row.tipoCuenta,
    cuentaPrincipal: row.cuentaPrincipal,
    cuentaAuxiliar: row.cuentaAuxiliar,
    secuencia: row.secuencia,
    comprobante: row.comprobante,
    fecha: row.fecha,
    concepto: row.concepto,
    importe: row.importe,
    iva: row.iva,
    ingresoBruto: row.ingresoBruto,
    socioId: row.socioId,
    legacyId: row.legacyId,
    anulado: row.anulado,
    anuladoAt: row.anuladoAt ? row.anuladoAt.toISOString() : null,
    anuladoMotivo: row.anuladoMotivo,
    createdAt: row.createdAt.toISOString(),
    ...extras,
  }
}

function operatorId(req: { operator?: { sub: string } | null }): string {
  return req.operator?.sub ?? 'unknown'
}

function mutationKey(req: { headers: Record<string, unknown> }): string {
  const value = req.headers['idempotency-key']
  if (typeof value !== 'string' || !validateIdempotencyKey(value)) {
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Idempotency-Key header is required')
  }
  return value
}

function mutationFingerprint(url: string, body: unknown): string {
  return createIdempotencyFingerprint('gasto-mutation', url, body)
}

async function findMutationReceipt(
  db: Db,
  operator: string,
  callerKey: string,
  fingerprint: string,
) {
  const [receipt] = await db
    .select()
    .from(gastoMutationReceipts)
    .where(
      and(
        eq(gastoMutationReceipts.operatorId, operator),
        eq(gastoMutationReceipts.callerKey, callerKey),
      ),
    )
    .limit(1)
  if (!receipt) return null
  if (receipt.requestFingerprint !== fingerprint) {
    throw BusinessError(
      ErrorCode.CONFLICT,
      'Idempotency key was already used for a different gasto mutation',
    )
  }
  return receipt.result as GastoDTO
}

async function saveMutationReceipt(
  db: Db,
  operator: string,
  callerKey: string,
  fingerprint: string,
  result: GastoDTO | { ok: true },
) {
  await db.insert(gastoMutationReceipts).values({
    operatorId: operator,
    callerKey,
    requestFingerprint: fingerprint,
    result,
  })
}

// prettier-ignore
export async function assertGastoMutable(db:Db,id:string):Promise<void>{const result=await db.execute(sql`SELECT e.id FROM tesoreria.dues_cash_shift_expenses e WHERE e.gasto_id=${id} LIMIT 1`);if((result as unknown as {rows?:unknown[]}).rows?.length)throw BusinessError(ErrorCode.CONFLICT,'Gasto is immutable after cash inclusion')}
// prettier-ignore
export async function assertGastoClosed(db:Db,id:string):Promise<void>{const result=await db.execute(sql`SELECT c.id FROM tesoreria.dues_cash_shift_expenses e JOIN tesoreria.dues_cash_closes c ON c.shift_id=e.shift_id WHERE e.gasto_id=${id} LIMIT 1`);if(!(result as unknown as {rows?:unknown[]}).rows?.length)throw BusinessError(ErrorCode.CONFLICT,'Compensation requires an expense from a closed cash shift')}

export const gastosAdminRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/gastos
  fastify.get('/api/v1/gastos', ADMIN_GATE, async (request, reply) => {
    // Cast the zod schema to a permissive type — the schema's input
    // shape is correct at runtime; TS struggles with the .default()
    // helper producing `T | undefined` for input vs `T` for output.
    const q = throwIfInvalid(listQuerySchema as never, request.query, 'query') as {
      page: number
      limit: number
      cuenta_principal?: string
      fecha_desde?: string
      fecha_hasta?: string
      anulado?: boolean
    }
    const result = await findManyGastos(container.db, {
      page: q.page,
      limit: q.limit,
      ...(q.cuenta_principal ? { cuentaPrincipal: q.cuenta_principal } : {}),
      ...(q.fecha_desde ? { fechaDesde: q.fecha_desde } : {}),
      ...(q.fecha_hasta ? { fechaHasta: q.fecha_hasta } : {}),
      ...(q.anulado !== undefined ? { anulado: q.anulado } : {}),
    })

    // Resolve link_count per row (avoid N+1 by issuing one count query
    // per row — bounded by `limit`, not by the full table).
    const items = await Promise.all(
      result.items.map(async (row) => {
        const linkCount = await countLinksForGasto(container.db, row.id)
        return toGastoDTO(row, { linkCount })
      }),
    )
    return reply.code(200).send({
      items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      has_more: result.hasMore,
    })
  })

  // GET /api/v1/gastos/:id
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/gastos/:id',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const row = await findGastoById(container.db, id)
      if (!row) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
      const links = await findLinksForGasto(container.db, id)
      return reply
        .code(200)
        .send(toGastoDTO(row, { links: links as unknown as Array<Record<string, unknown>> }))
    },
  )

  // POST /api/v1/gastos
  fastify.post('/api/v1/gastos', ADMIN_GATE, async (request, reply) => {
    const body = throwIfInvalid(createGastoBodySchema, request.body ?? {}, 'body')
    const opId = operatorId(request)
    const callerKey = mutationKey(request)
    const fingerprint = mutationFingerprint(request.url, body)
    try {
      const result = await container.db.transaction(async (tx) => {
        const replay = await findMutationReceipt(tx, opId, callerKey, fingerprint)
        if (replay) return { replay: true, result: replay }
        if (body.compensates_gasto_id) await assertGastoClosed(tx, body.compensates_gasto_id)
        const created = await createGasto(tx, {
          tipo: body.tipo,
          tipoCuenta: body.tipo_cuenta,
          cuentaPrincipal: body.cuenta_principal,
          cuentaAuxiliar: body.cuenta_auxiliar ?? null,
          secuencia: body.secuencia ?? 0,
          comprobante: body.comprobante ?? '',
          fecha: body.fecha,
          concepto: body.concepto ?? null,
          importe: body.importe,
          iva: body.iva ?? '0.00',
          ingresoBruto: body.ingreso_bruto ?? null,
          socioId: body.socio_id ?? null,
          legacyId: body.legacy_id ?? null,
        })
        await emitAudit(tx, {
          operatorId: opId,
          action: 'GASTO_CREATE',
          entityType: 'gasto',
          entityId: created.id,
          oldValue: null,
          newValue: { ...body },
          sourceIp: request.ip ?? null,
          callerKey,
          metadata: { requestFingerprint: fingerprint },
        })
        if (body.compensates_gasto_id) {
          const compensation = await recordExpenseCompensationInTransaction(tx, {
            originalGastoId: body.compensates_gasto_id,
            compensatingGastoId: created.id,
            operatorId: opId,
            callerKey,
            requestFingerprint: fingerprint,
            reason: body.compensation_reason!,
          })
          await emitAudit(tx, {
            operatorId: opId,
            action: AuditAction.DUES_CASH_EXPENSE_COMPENSATED,
            entityType: 'gasto_compensation',
            entityId: compensation.id,
            oldValue: null,
            newValue: {
              originalGastoId: compensation.originalGastoId,
              compensatingGastoId: compensation.compensatingGastoId,
              reason: compensation.reason,
            },
            sourceIp: request.ip ?? null,
            callerKey,
            metadata: {
              actorId: opId,
              role: request.operator?.role,
              permissions: Object.entries(request.operator?.permissions ?? {})
                .filter(([, granted]) => granted)
                .map(([name]) => name),
              authorizationEvidence: {
                role: request.operator?.role,
                permissions: Object.entries(request.operator?.permissions ?? {})
                  .filter(([, granted]) => granted)
                  .map(([name]) => name),
              },
              callerKey,
              requestFingerprint: fingerprint,
              time: new Date().toISOString(),
              originalGastoId: compensation.originalGastoId,
              compensatingGastoId: compensation.compensatingGastoId,
              reason: compensation.reason,
            },
          })
        }
        const dto = toGastoDTO(created)
        await saveMutationReceipt(tx, opId, callerKey, fingerprint, dto)
        return { replay: false, result: dto }
      })
      return reply.code(result.replay ? 200 : 201).send(result.result)
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '55000') {
        throw BusinessError(ErrorCode.CONFLICT, 'Gasto is immutable after cash inclusion')
      }
      if ((e as { code?: string })?.code === '23505') {
        const replay = await findMutationReceipt(container.db, opId, callerKey, fingerprint)
        if (replay) return reply.code(200).send(replay)
      }
      if ((e as { code?: string })?.code === '23505') {
        return reply.code(409).send({ error: 'GASTO_DUPLICATE' })
      }
      throw e
    }
  })

  // PATCH /api/v1/gastos/:id
  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/gastos/:id',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(updateGastoBodySchema, request.body ?? {}, 'body')
      const opId = operatorId(request)
      const callerKey = mutationKey(request)
      const fingerprint = mutationFingerprint(request.url, body)
      const update: Record<string, unknown> = {}
      if (body.tipo !== undefined) update['tipo'] = body.tipo
      if (body.tipo_cuenta !== undefined) update['tipoCuenta'] = body.tipo_cuenta
      if (body.cuenta_principal !== undefined) update['cuentaPrincipal'] = body.cuenta_principal
      if (body.cuenta_auxiliar !== undefined) update['cuentaAuxiliar'] = body.cuenta_auxiliar
      if (body.secuencia !== undefined) update['secuencia'] = body.secuencia
      if (body.comprobante !== undefined) update['comprobante'] = body.comprobante
      if (body.fecha !== undefined) update['fecha'] = body.fecha
      if (body.concepto !== undefined) update['concepto'] = body.concepto
      if (body.importe !== undefined) update['importe'] = body.importe
      if (body.iva !== undefined) update['iva'] = body.iva
      if (body.ingreso_bruto !== undefined) update['ingresoBruto'] = body.ingreso_bruto
      if (body.socio_id !== undefined) update['socioId'] = body.socio_id
      if (body.legacy_id !== undefined) update['legacyId'] = body.legacy_id
      try {
        const result = await container.db.transaction(async (tx) => {
          const replay = await findMutationReceipt(tx, opId, callerKey, fingerprint)
          if (replay) return { replay: true, result: replay }
          await assertGastoMutable(tx, id)
          const updated = await updateGasto(tx, id, update as never)
          if (!updated) return { missing: true as const }
          await emitAudit(tx, {
            operatorId: opId,
            action: 'GASTO_UPDATE',
            entityType: 'gasto',
            entityId: id,
            oldValue: null,
            newValue: { ...body },
            sourceIp: request.ip ?? null,
            callerKey,
            metadata: { requestFingerprint: fingerprint },
          })
          const dto = toGastoDTO(updated)
          await saveMutationReceipt(tx, opId, callerKey, fingerprint, dto)
          return { replay: false, result: dto }
        })
        if ('missing' in result) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
        return reply.code(result.replay ? 200 : 200).send(result.result)
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === '55000') {
          throw BusinessError(ErrorCode.CONFLICT, 'Gasto is immutable after cash inclusion')
        }
        if ((e as { code?: string })?.code === '23505') {
          const replay = await findMutationReceipt(container.db, opId, callerKey, fingerprint)
          if (replay) return reply.code(200).send(replay)
        }
        if ((e as { code?: string })?.code === '23505') {
          return reply.code(409).send({ error: 'GASTO_DUPLICATE' })
        }
        throw e
      }
    },
  )

  // DELETE /api/v1/gastos/:id
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/gastos/:id',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const opId = operatorId(request)
      const callerKey = mutationKey(request)
      const fingerprint = mutationFingerprint(request.url, {})
      try {
        const result = await container.db.transaction(async (tx) => {
          const replay = await findMutationReceipt(tx, opId, callerKey, fingerprint)
          if (replay) return replay
          await assertGastoMutable(tx, id)
          const removed = await deleteGasto(tx, id)
          if (!removed) return null
          await emitAudit(tx, {
            operatorId: opId,
            action: 'GASTO_DELETE',
            entityType: 'gasto',
            entityId: id,
            oldValue: null,
            newValue: { deleted: true },
            sourceIp: request.ip ?? null,
            callerKey,
            metadata: { requestFingerprint: fingerprint },
          })
          const response = { ok: true as const }
          await saveMutationReceipt(tx, opId, callerKey, fingerprint, response)
          return response
        })
        if (!result) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
        return reply.code(200).send(result)
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === '55000') {
          throw BusinessError(ErrorCode.CONFLICT, 'Gasto is immutable after cash inclusion')
        }
        if ((e as { code?: string })?.code === '23505') {
          const replay = await findMutationReceipt(container.db, opId, callerKey, fingerprint)
          if (replay) return reply.code(200).send(replay)
        }
        throw e
      }
    },
  )

  // PATCH /api/v1/gastos/:id/anular
  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/gastos/:id/anular',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(anularBodySchema, request.body ?? {}, 'body')
      const opId = operatorId(request)
      const callerKey = mutationKey(request)
      const fingerprint = mutationFingerprint(request.url, body)
      try {
        const result = await container.db.transaction(async (tx) => {
          const replay = await findMutationReceipt(tx, opId, callerKey, fingerprint)
          if (replay) return replay
          await assertGastoMutable(tx, id)
          const anulado = await anularGasto(tx, id, body.motivo)
          if (!anulado) return null
          await emitAudit(tx, {
            operatorId: opId,
            action: 'GASTO_ANULAR',
            entityType: 'gasto',
            entityId: id,
            oldValue: null,
            newValue: { motivo: body.motivo },
            sourceIp: request.ip ?? null,
            callerKey,
            metadata: { requestFingerprint: fingerprint },
          })
          const response = toGastoDTO(anulado)
          await saveMutationReceipt(tx, opId, callerKey, fingerprint, response)
          return response
        })
        if (!result) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
        return reply.code(200).send(result)
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === '55000') {
          throw BusinessError(ErrorCode.CONFLICT, 'Gasto is immutable after cash inclusion')
        }
        if ((e as { code?: string })?.code === '23505') {
          const replay = await findMutationReceipt(container.db, opId, callerKey, fingerprint)
          if (replay) return reply.code(200).send(replay)
        }
        throw e
      }
    },
  )

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
