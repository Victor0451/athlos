import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import type { AppContainer } from '../container.ts'

/**
 * Public, credential-free inquiry endpoint. `IMPLEMENTATION_CONTACT_RECIPIENT`
 * is validated at startup and is the only delivery target; request content is
 * neither logged nor persisted. Browser clients must use an origin in
 * `CORS_ORIGINS`, or same-origin Fetch Metadata when Origin is absent.
 */
const BODY_LIMIT_BYTES = 8 * 1024
const CONTACT_RATE_LIMIT = { max: 3, timeWindow: '15 minutes' }

const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\r\n\x00-\x1F\x7F]/.test(value), 'Must be a single line')

const contactSchema = z
  .object({
    name: singleLine(120),
    organization: singleLine(160),
    role: singleLine(100),
    email: z.string().trim().email().max(254),
    primaryProblem: z.string().trim().min(1).max(500),
    phone: singleLine(40).optional(),
    message: z.string().trim().max(2000).optional(),
    website: z.string().trim().max(120).optional(),
  })
  .strict()

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }
    return entities[character]!
  })
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string): boolean {
  return Boolean(
    origin &&
    allowedOrigins
      .split(',')
      .map((value) => value.trim())
      .includes(origin),
  )
}

export const implementationContactRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  fastify.post(
    '/api/v1/implementation-contact',
    {
      bodyLimit: BODY_LIMIT_BYTES,
      config: { skipRouteAudit: true, rateLimit: CONTACT_RATE_LIMIT },
    },
    async (request, reply) => {
      reply.removeHeader('access-control-allow-credentials')

      if (request.headers.authorization || request.headers.cookie) {
        return reply.code(403).send({ error: 'REQUEST_REJECTED' })
      }

      const origin = request.headers.origin
      const sameOriginFetch = request.headers['sec-fetch-site'] === 'same-origin'
      if (origin ? !isAllowedOrigin(origin, container.env.CORS_ORIGINS) : !sameOriginFetch) {
        return reply.code(403).send({ error: 'REQUEST_REJECTED' })
      }

      const contact = throwIfInvalid(contactSchema, request.body ?? {}, 'body')
      if (contact.website) return reply.code(202).send({ status: 'received' })

      const recipient = container.env.IMPLEMENTATION_CONTACT_RECIPIENT
      if (!recipient)
        return reply
          .code(503)
          .send({ error: 'DELIVERY_UNAVAILABLE', message: 'Please try again later.' })

      const text = [
        `Name: ${contact.name}`,
        `Organization: ${contact.organization}`,
        `Role: ${contact.role}`,
        `Email: ${contact.email}`,
        `Primary problem: ${contact.primaryProblem.replace(/\r\n/g, '\n')}`,
        contact.phone ? `Phone: ${contact.phone}` : undefined,
        contact.message ? `Message: ${contact.message.replace(/\r\n/g, '\n')}` : undefined,
      ]
        .filter(Boolean)
        .join('\n')

      try {
        await container.email.send({
          to: recipient,
          subject: 'New Athlos implementation inquiry',
          text,
          html: `<pre>${escapeHtml(text)}</pre>`,
        })
        return reply.code(200).send({ status: 'sent' })
      } catch {
        return reply
          .code(503)
          .send({ error: 'DELIVERY_UNAVAILABLE', message: 'Please try again later.' })
      }
    },
  )

  done()
}
