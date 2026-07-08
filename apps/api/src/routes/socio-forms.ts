import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import { emitForm } from '../modules/socios/forms/emit-form.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { AppContainer } from '../container.ts'

/**
 * `socio_forms` routes — `/api/v1/socios/:socioId/forms/*`.
 *
 * One endpoint today:
 *
 *   GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf
 *     - Returns `application/pdf` with `Content-Disposition: inline;
 *       filename="${result.filename}"` so the browser renders in-tab.
 *     - 200 with the PDF body (starts with `%PDF-`).
 *     - 404 SOCIO_NOT_FOUND when the socio row is absent.
 *     - 401 UNAUTHORIZED when the JWT is missing.
 *
 * No role gate (any authenticated operator; mirrors the notes +
 * attachments precedent). The audit row is emitted at the service
 * layer (`emit-form.ts`) so the timeline tab on `/socios/[id]` can
 * surface the emission alongside operator events.
 *
 * PR 8d.1 (athlos-socio-form-emit).
 */

const FORM_AUTH = { preHandler: requireAuth() }

const socioFormParamsSchema = z.object({ socioId: idSchema })

/**
 * Escape `"` and CR/LF from the filename before interpolating into
 * the `Content-Disposition` header — prevents header injection if an
 * `apellido` somehow survives sanitization with control characters.
 */
function escapeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_')
}

export interface SocioFormsRoutesOptions {
  /**
   * Puppeteer singleton + semaphore wrapper. Wired in `server.ts`
   * once at boot and re-used across requests so the browser launch
   * cost is paid once per process.
   */
  pdfGenerator: PdfGenerator
}

export const socioFormsRoutes: FastifyPluginCallback<SocioFormsRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const container: AppContainer = fastify.container
  const { pdfGenerator } = opts

  fastify.get<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf',
    FORM_AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(socioFormParamsSchema, request.params, 'params')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' })
      }

      const result = await emitForm({
        socioId: params.socioId,
        operatorId,
        db: container.db,
        pdfGenerator,
      })
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `inline; filename="${escapeFilename(result.filename)}"`)
      return reply.send(result.pdf)
    },
  )

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
