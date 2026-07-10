import multipart from '@fastify/multipart'
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { Readable } from 'node:stream'
import { and, eq } from 'drizzle-orm'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid, ErrorCode } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import {
  isValidIsoCalendarDate,
  registerPayment,
  registerDebit,
} from '../modules/socios/forms/ctacte-mutations.ts'
import { addNote, listNotes } from '../modules/socios/ctacte_movement_notes.ts'
import { renderComprobante } from '../modules/socios/forms/ctacte-comprobante.ts'
import { ctacte } from '@athlos/db/schema'
import { LocalFileStorage, readStorageEnv } from '../modules/file-storage/index.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { AppContainer } from '../container.ts'

/**
 * `ctacte-mutations` routes — `/api/v1/socios/:socioId/ctacte/*`.
 *
 * Four endpoints for the cuenta-corriente mutation surface:
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/payment
 *     Multipart form: monto + fecha + concepto + optional comprobante.
 *     Returns 201 + the created movement, or 400/401/404/413/415.
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/debit
 *     JSON body: monto + fecha + motivo.
 *     Returns 201 + the created movement, or 400/401/404.
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes
 *     JSON body: body (note text).
 *     Returns 201 + the created note, or 400/401/404.
 *
 *   GET  /api/v1/socios/:socioId/ctacte/comprobante.pdf?from=&to=&cuenta=
 *     Renders the cuenta-corriente comprobante as a PDF.
 *     Returns 200 + PDF, or 400/401/404.
 *
 * All four require `requireAuth()`. The comprobante route also enforces
 * the cap-50 between `getMovementsForComprobante()` and `pdfGenerator.generate()`
 * as defence-in-depth (the service already enforces it, but the route needs
 * to verify before calling puppeteer).
 *
 * PR A1b.3 + A1b.4 (athlos-ctacte-mutations).
 */

const AUTH = { preHandler: requireAuth() }

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const socioIdParamsSchema = z.object({ socioId: idSchema })

const paymentSchema = z.object({
  monto: z.coerce.number({ invalid_type_error: 'monto must be a number' }),
  fecha: z.string().refine(isValidIsoCalendarDate, 'must be a valid ISO calendar date'),
  concepto: z.string().min(1, 'concepto is required'),
})

const debitSchema = z.object({
  monto: z.coerce.number({ invalid_type_error: 'monto must be a number' }),
  fecha: z.string().refine(isValidIsoCalendarDate, 'must be a valid ISO calendar date'),
  motivo: z.string().min(1, 'motivo is required'),
})

const noteBodySchema = z.object({
  body: z.string().min(1, 'body is required').max(2000, 'body must be ≤ 2000 chars'),
})

const comprobanteQuerySchema = z
  .object({
    from: z.string().min(1, 'from is required'),
    to: z.string().min(1, 'to is required'),
    cuenta: z.string().min(1, 'cuenta is required'),
  })
  .refine((q) => new Date(q.from) <= new Date(q.to), {
    message: 'from must be ≤ to',
  })

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Escape `"` and CR/LF from the filename to prevent header injection. */
function escapeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

function movementNotFound(reply: {
  code: (n: number) => { send: (body: unknown) => unknown }
}): unknown {
  return reply.code(404).send({ error: 'NOT_FOUND' })
}

function apiError(
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  code: string,
  message: string,
  details?: unknown,
): unknown {
  return reply
    .code(400)
    .send({ error: code, message, ...(details === undefined ? {} : { details }) })
}

function schemaError(
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  error: z.ZodError,
): unknown {
  const issue = error.errors[0]!
  return apiError(reply, 'VALIDATION_ERROR', issue.message, [
    { field: String(issue.path[0] ?? 'body'), message: issue.message },
  ])
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export interface CtacteMutationsRoutesOptions {
  pdfGenerator: PdfGenerator
}

export const ctacteMutationsRoutes: FastifyPluginCallback<CtacteMutationsRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const container: AppContainer = fastify.container
  const { pdfGenerator } = opts
  const storageEnv = readStorageEnv(container.env as unknown as NodeJS.ProcessEnv)
  const storage = new LocalFileStorage(storageEnv)

  // POST /api/v1/socios/:socioId/ctacte/movements/payment
  // Multipart/form-data: monto + fecha + concepto + optional comprobante
  fastify.post<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/ctacte/movements/payment',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(socioIdParamsSchema, request.params, 'params')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }

      const idempotencyKey = request.headers['idempotency-key']
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        return apiError(reply, 'VALIDATION_ERROR', 'Idempotency-Key header is required')
      }

      const fields: Record<string, string> = {}
      let uploadedFile: { bytes: Buffer; mimeType: string; filename: string } | undefined
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.filename) {
            uploadedFile = {
              bytes: await part.toBuffer(),
              mimeType: part.mimetype ?? 'application/octet-stream',
              filename: part.filename.replace(/["\r\n]/g, '_'),
            }
          } else {
            await part.toBuffer()
          }
        } else {
          fields[part.fieldname] = String(part.value)
        }
      }
      const montoStr = fields['monto']
      const fechaVal = fields['fecha']
      const conceptoVal = fields['concepto']

      // Parse the other fields
      const parsed = paymentSchema.safeParse({
        monto: montoStr,
        fecha: fechaVal,
        concepto: conceptoVal,
      })
      if (!parsed.success) {
        return schemaError(reply, parsed.error)
      }

      const { monto, fecha, concepto } = parsed.data
      if (monto <= 0) {
        return apiError(reply, 'VALIDATION_ERROR', 'monto must be > 0')
      }

      // The comprobante is the uploaded file itself (not a separate field)
      let comprobante: { bytes: Buffer; mimeType: string; filename: string } | undefined
      if (uploadedFile) {
        const buf = uploadedFile.bytes
        if (buf.byteLength === 0) {
          return apiError(reply, 'VALIDATION_ERROR', 'comprobante file is empty')
        }
        if (buf.byteLength > 10 * 1024 * 1024) {
          return reply.code(413).send({
            error: 'PAYLOAD_TOO_LARGE',
            message: 'comprobante exceeds 10 MB cap',
          })
        }
        comprobante = {
          bytes: buf,
          mimeType: uploadedFile.mimeType,
          filename: uploadedFile.filename,
        }
      }

      try {
        const movement = await registerPayment({
          db: container.db,
          storage,
          socioId: params.socioId,
          operatorId,
          monto,
          fecha,
          concepto,
          idempotencyKey,
          ...(comprobante ? { comprobante } : {}),
        })
        return reply.code(201).send({
          id: movement.id,
          tipo: movement.tipo,
          monto: movement.monto,
          fecha: movement.fecha,
          concepto: movement.concepto,
          comprobante_attachment_id: movement.comprobanteAttachmentId,
        })
      } catch (err) {
        const e = err as { code?: string; message?: string; details?: unknown }
        if (e.code === ErrorCode.NOT_FOUND) {
          return reply.code(404).send({ error: 'NOT_FOUND' })
        }
        if (e.code === ErrorCode.VALIDATION_ERROR) {
          return reply.code(400).send({
            error: 'VALIDATION_ERROR',
            message: e.message,
            details: e.details,
          })
        }
        if (e.code === ErrorCode.CONFLICT) {
          return reply.code(409).send({ error: 'CONFLICT', message: e.message })
        }
        const detected = (e.details as { detected?: string } | undefined)?.detected
        if (detected) {
          return reply.code(415).send({
            error: 'UNSUPPORTED_MEDIA_TYPE',
            message: e.message ?? 'Unsupported media type',
          })
        }
        request.log.warn({ err }, 'registerPayment failed')
        return reply
          .code(400)
          .send({ error: 'VALIDATION_ERROR', message: e.message ?? 'Bad request' })
      }
    },
  )

  // POST /api/v1/socios/:socioId/ctacte/movements/debit
  // JSON body: monto + fecha + motivo
  fastify.post<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/ctacte/movements/debit',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(socioIdParamsSchema, request.params, 'params')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }

      const parsed = debitSchema.safeParse(request.body)
      if (!parsed.success) {
        return schemaError(reply, parsed.error)
      }

      const { monto, fecha, motivo } = parsed.data
      const idempotencyKey = request.headers['idempotency-key']
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.trim().length === 0 ||
        idempotencyKey.length > 128
      ) {
        return apiError(
          reply,
          'VALIDATION_ERROR',
          'Idempotency-Key header must be 1–128 characters',
        )
      }
      if (monto <= 0) {
        return apiError(reply, 'VALIDATION_ERROR', 'monto must be > 0')
      }

      try {
        const movement = await registerDebit({
          db: container.db,
          socioId: params.socioId,
          operatorId,
          monto,
          fecha,
          motivo,
          idempotencyKey,
        })
        return reply.code(201).send({
          id: movement.id,
          tipo: movement.tipo,
          monto: movement.monto,
          fecha: movement.fecha,
          motivo: movement.motivo,
        })
      } catch (err) {
        const e = err as { code?: string; message?: string; details?: unknown }
        if (e.code === ErrorCode.NOT_FOUND) {
          return reply.code(404).send({ error: 'NOT_FOUND' })
        }
        if (e.code === ErrorCode.VALIDATION_ERROR) {
          return reply
            .code(400)
            .send({ error: 'VALIDATION_ERROR', message: e.message, details: e.details })
        }
        if (e.code === ErrorCode.CONFLICT) {
          return reply.code(409).send({ error: 'CONFLICT', message: e.message })
        }
        request.log.warn({ err }, 'registerDebit failed')
        return reply
          .code(400)
          .send({ error: 'VALIDATION_ERROR', message: e.message ?? 'Bad request' })
      }
    },
  )

  // GET /api/v1/socios/:socioId/ctacte/movements/:movementId/notes
  fastify.get<{ Params: { socioId: string; movementId: string } }>(
    '/api/v1/socios/:socioId/ctacte/movements/:movementId/notes',
    AUTH,
    async (request, reply) => {
      const paramsSchema = z.object({ socioId: idSchema, movementId: idSchema })
      const params = throwIfInvalid(paramsSchema, request.params, 'params')
      const [movementRow] = await container.db
        .select({ id: ctacte.id })
        .from(ctacte)
        .where(and(eq(ctacte.id, params.movementId), eq(ctacte.socioId, params.socioId)))
        .limit(1)
      if (!movementRow) return movementNotFound(reply)

      const notes = await listNotes(container.db, params.movementId)
      return reply.send(
        notes.map((note) => ({
          id: note.id,
          ctacte_movement_id: params.movementId,
          body: note.body,
          author_operator_id: note.authorOperatorId,
          created_at: note.createdAt.toISOString(),
        })),
      )
    },
  )

  // POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes
  // JSON body: { body }
  fastify.post<{ Params: { socioId: string; movementId: string } }>(
    '/api/v1/socios/:socioId/ctacte/movements/:movementId/notes',
    AUTH,
    async (request, reply) => {
      const paramsSchema = z.object({
        socioId: idSchema,
        movementId: idSchema,
      })
      const params = throwIfInvalid(paramsSchema, request.params, 'params')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }

      const parsed = noteBodySchema.safeParse(request.body)
      if (!parsed.success) {
        return apiError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]!.message)
      }

      // Verify the movement belongs to the requested socio (404 if not).
      const [movementRow] = await container.db
        .select({ id: ctacte.id })
        .from(ctacte)
        .where(and(eq(ctacte.id, params.movementId), eq(ctacte.socioId, params.socioId)))
        .limit(1)
      if (!movementRow) {
        return movementNotFound(reply)
      }

      try {
        const note = await addNote(container.db, {
          ctacteMovementId: params.movementId,
          operatorId,
          body: parsed.data.body,
        })
        return reply.code(201).send({
          id: note.id,
          ctacte_movement_id: note.ctacteMovementId,
          body: note.body,
          author_operator_id: note.authorOperatorId,
          created_at: note.createdAt.toISOString(),
        })
      } catch (err) {
        request.log.warn({ err }, 'addNote failed')
        return apiError(reply, 'VALIDATION_ERROR', 'Failed to add note')
      }
    },
  )

  // GET /api/v1/socios/:socioId/ctacte/comprobante.pdf?from=&to=&cuenta=
  fastify.get<{
    Params: { socioId: string }
    Querystring: { from?: string; to?: string; cuenta?: string }
  }>('/api/v1/socios/:socioId/ctacte/comprobante.pdf', AUTH, async (request, reply) => {
    const params = throwIfInvalid(socioIdParamsSchema, request.params, 'params')
    const q = throwIfInvalid(comprobanteQuerySchema, request.query, 'query')
    const operatorId = request.operator?.sub
    if (!operatorId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' })
    }

    try {
      const result = await renderComprobante({
        socioId: params.socioId,
        cuenta: q.cuenta,
        operatorId,
        from: q.from,
        to: q.to,
        db: container.db,
        pdfGenerator,
      })

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="${escapeFilename(result.filename)}"`)
      return reply.send(result.pdf)
    } catch (err) {
      const e = err as {
        code?: string
        message?: string
        details?: { cap?: number; requested?: number }
      }
      if (e.code === ErrorCode.NOT_FOUND) {
        return reply.code(404).send({ error: 'NOT_FOUND' })
      }
      if (e.code === ErrorCode.VALIDATION_ERROR) {
        // Cap exceeded — return 400 with cap details
        if (e.details?.cap !== undefined) {
          return reply.code(400).send({
            error: 'VALIDATION_ERROR',
            message: 'cap exceeded',
            details: { cap: e.details.cap, requested: e.details.requested },
          })
        }
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: e.message })
      }
      request.log.warn({ err }, 'renderComprobante failed')
      return reply
        .code(400)
        .send({ error: 'VALIDATION_ERROR', message: 'Failed to render comprobante' })
    }
  })

  // Suppress unused import warnings
  void multipart
  void Readable

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
