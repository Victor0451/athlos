import multipart from '@fastify/multipart'
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import type { AttachmentCategory } from '@athlos/db/schema'
import {
  getAttachment,
  listAttachments,
  softDeleteAttachment,
  streamAttachment,
  uploadAttachment,
} from '../modules/socios/attachments.ts'
import { LocalFileStorage, readStorageEnv, SizeLimitError } from '../modules/file-storage/index.ts'
import { validateMagic } from '../modules/file-storage/magic-byte.ts'
import type { AppContainer } from '../container.ts'

/**
 * `socio_attachments` routes — `/api/v1/socios/:socioId/attachments/*`.
 *
 * Five endpoints (all under /api/v1, all returning JSON or streamed bytes):
 *
 *   POST   /api/v1/socios/:socioId/attachments        multipart upload (single file)
 *   GET    /api/v1/socios/:socioId/attachments        list active, optional ?category=
 *   GET    /api/v1/socios/:socioId/attachments/:aid   metadata
 *   GET    /api/v1/socios/:socioId/attachments/:aid/file  stream bytes
 *   DELETE /api/v1/socios/:socioId/attachments/:aid   soft delete
 *
 * All five require `requireAuth()` (any authenticated operator, no role gate).
 * The POST route reads `request.file()` from `@fastify/multipart` and
 * pipes it through `LocalFileStorage.saveStream`.
 *
 * Magic-byte validation happens in the service layer (`uploadAttachment`).
 * The route's pre-handler enforces the per-file 10 MB cap before the
 * service is invoked — additional defence-in-depth alongside the
 * multipart plugin's `limits.fileSize`.
 *
 * PR 8c.1 (athlos-socio-legajo).
 */

const ATTACHMENT_AUTH = { preHandler: requireAuth() }

const attachmentParamsSchema = z.object({
  socioId: idSchema,
  attachmentId: idSchema.optional(),
})

const attachmentWithIdParamsSchema = z.object({
  socioId: idSchema,
  attachmentId: idSchema,
})

const attachmentCategoryZ = z.enum(['dni', 'comprobante', 'foto', 'contrato', 'otro'])

const attachmentListQuerySchema = z.object({
  category: attachmentCategoryZ.optional(),
})

/** Build the per-socio storage path: `socios/<socioId>/<aid>.<ext>`. */
function buildStoragePath(socioId: string, attachmentId: string, mimeType: string): string {
  const ext = mimeExt(mimeType)
  return `socios/${socioId}/${attachmentId}.${ext}`
}

function mimeExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'bin'
  }
}

/** Map a `SocioAttachment` row to the wire DTO. */
function toAttachmentDTO(row: {
  id: string
  socioId: string
  filename: string
  description: string | null
  category: AttachmentCategory
  mimeType: string
  sizeBytes: number
  storagePath: string
  storageSha256: string
  uploadedBy: string
  uploadedAt: Date
  deletedAt: Date | null
  deletedBy: string | null
}): Record<string, unknown> {
  return {
    id: row.id,
    socio_id: row.socioId,
    filename: row.filename,
    description: row.description,
    category: row.category,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    storage_path: row.storagePath,
    storage_sha256: row.storageSha256,
    uploaded_by: row.uploadedBy,
    uploaded_at: row.uploadedAt.toISOString(),
    deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
    deleted_by: row.deletedBy,
  }
}

export const socioAttachmentsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container
  const storageEnv = readStorageEnv(container.env as unknown as NodeJS.ProcessEnv)
  const storage = new LocalFileStorage(storageEnv)

  // POST /api/v1/socios/:socioId/attachments — multipart upload (single file)
  fastify.post<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/attachments',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const file = await request.file()
      if (!file) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'No file uploaded' })
      }
      // Defence-in-depth: the multipart plugin also enforces fileSize
      // via `limits.fileSize`, but explicit check protects against
      // clients that bypass the limit somehow.
      if (file.file.truncated) {
        return reply
          .code(413)
          .send({ error: 'PAYLOAD_TOO_LARGE', message: 'File exceeds 10 MB cap' })
      }
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }

      // Parse category + description from the multipart fields.
      const fields = file.fields as Record<string, { value?: string } | undefined>
      const category = fields['category']?.value
      const description = fields['description']?.value ?? null
      if (!category || !isAttachmentCategory(category)) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'category is required' })
      }

      try {
        const row = await uploadAttachment({
          socioId: params.socioId,
          operatorId,
          fileStream: file.file,
          declaredMimeType: file.mimetype,
          filename: file.filename ?? 'upload',
          description,
          category,
          db: container.db,
          storage,
        })
        return reply.code(201).send(toAttachmentDTO(row))
      } catch (err) {
        // The service raises `BusinessError(VALIDATION_ERROR, ...)` for
        // both the magic-byte and quota rejections. The error
        // handler maps to 400/415 via the message — we re-shape to
        // the right code based on the `details` shape.
        if (err instanceof SizeLimitError) {
          return reply
            .code(413)
            .send({ error: 'PAYLOAD_TOO_LARGE', message: 'File exceeds 10 MB cap' })
        }
        const detected = (err as { details?: { detected?: string } })?.details?.detected
        const code = detected ? 'UNSUPPORTED_MEDIA_TYPE' : 'VALIDATION_ERROR'
        request.log.warn({ err }, 'socio-attachments: upload failed')
        return reply.code(400).send({
          error: code,
          message: (err as Error).message,
          details: (err as { details?: unknown }).details,
        })
      }
    },
  )

  // GET /api/v1/socios/:socioId/attachments — list active, optional ?category=
  fastify.get<{ Params: { socioId: string }; Querystring: { category?: string } }>(
    '/api/v1/socios/:socioId/attachments',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentParamsSchema, request.params, 'params')
      const q = throwIfInvalid(attachmentListQuerySchema, request.query, 'query')
      const items = await listAttachments({
        socioId: params.socioId,
        ...(q.category ? { category: q.category } : {}),
        db: container.db,
      })
      return reply.code(200).send({ items: items.map(toAttachmentDTO) })
    },
  )

  // GET /api/v1/socios/:socioId/attachments/:attachmentId — metadata
  fastify.get<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentWithIdParamsSchema, request.params, 'params')
      const row = await getAttachment(params.attachmentId, container.db)
      if (!row || row.socioId !== params.socioId || row.deletedAt) {
        return reply.code(404).send({ error: 'NOT_FOUND' })
      }
      return reply.code(200).send(toAttachmentDTO(row))
    },
  )

  // GET /api/v1/socios/:socioId/attachments/:attachmentId/file — stream bytes
  fastify.get<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId/file',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentWithIdParamsSchema, request.params, 'params')
      const found = await streamAttachment(params.attachmentId, container.db, storage)
      if (!found || found.row.socioId !== params.socioId) {
        return reply.code(404).send({ error: 'NOT_FOUND' })
      }
      reply.header('Content-Type', found.row.mimeType)
      reply.header(
        'Content-Disposition',
        `inline; filename="${escapeFilename(found.row.filename)}"`,
      )
      return reply.send(found.stream)
    },
  )

  // DELETE /api/v1/socios/:socioId/attachments/:attachmentId — soft delete
  fastify.delete<{ Params: { socioId: string; attachmentId: string } }>(
    '/api/v1/socios/:socioId/attachments/:attachmentId',
    ATTACHMENT_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(attachmentWithIdParamsSchema, request.params, 'params')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }
      // Confirm the attachment belongs to the socio (404 otherwise).
      const existing = await getAttachment(params.attachmentId, container.db)
      if (!existing || existing.socioId !== params.socioId) {
        return reply.code(404).send({ error: 'NOT_FOUND' })
      }
      await softDeleteAttachment({
        id: params.attachmentId,
        operatorId,
        db: container.db,
      })
      return reply.code(204).send()
    },
  )

  // Suppress the unused-import warning when the service isn't called
  // (validation tests don't exercise this code path).
  void buildStoragePath
  void validateMagic
  void multipart

  done()
}

/**
 * Type guard: `category` is one of the 5 attachment_category enum
 * values. Throws a 400 VALIDATION_ERROR when not.
 */
function isAttachmentCategory(v: string): v is AttachmentCategory {
  return (['dni', 'comprobante', 'foto', 'contrato', 'otro'] as const).includes(
    v as AttachmentCategory,
  )
}

/** Strip `"` and `\r\n` from filenames to prevent header injection. */
function escapeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
