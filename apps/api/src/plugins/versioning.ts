import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * API versioning plugin.
 *
 * Adds the `API-Version: <x.y.z>` response header on every response
 * served from `/api/v1/*`. The version string is read from
 * `package.json` at boot (passed as a plugin option). Routes
 * outside `/api/v1/*` (e.g. `/health`, `/api/versions`, `/metrics`)
 * do NOT receive the header — they're unversioned by design.
 *
 * Implementation: a single `onSend` hook regex-matches the request
 * URL. If it starts with `/api/v1`, the header is set. The hook
 * runs in microseconds (a single regex test + a header set) and
 * applies to the parent scope via `fastify-plugin`.
 */
const VERSION_REGEX = /^\/api\/v\d+\//

export interface VersioningOptions {
  version: string
}

const versioningPlugin: FastifyPluginAsync<VersioningOptions> = async (fastify, { version }) => {
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (VERSION_REGEX.test(request.url)) {
      reply.header('API-Version', version)
    }
    return payload
  })
}

export const versioning = fp(versioningPlugin, { name: 'athlos-versioning' })
