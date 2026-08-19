import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes } from './dues.ts'

// prettier-ignore
const actorId = '00000000-0000-4000-8000-000000000001', apps: FastifyInstance[] = []
const obligationId = '00000000-0000-4000-8000-000000000002'
const planTerms = {
  amountCents: 1_000,
  installments: [{ amountCents: 1_000, dueDate: '2026-08-19' }],
}
// prettier-ignore
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR', key: string) => ({ authorization: `Bearer ${signAccessToken({ sub: actorId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`, 'idempotency-key': key })
// prettier-ignore
async function app(enabled: boolean) { const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true, DUES_AGREEMENTS_ENABLED: enabled }, fastify = Fastify({ logger: false }); fastify.decorate('container', { db: {}, env } as unknown as AppContainer); await fastify.register(errorHandler); await fastify.register(authPlugin(() => env as never)); await fastify.register(duesRoutes, { agreementService: { create: vi.fn().mockResolvedValue({ id: 'agreement-1', socioId: actorId, obligationId, kind: 'INSTALLMENT', status: 'ACTIVE', revisionNumber: 1, terms: planTerms, agreementDate: '2026-08-19', revisionOfAgreementId: null }), reschedule: vi.fn().mockResolvedValue({ id: 'agreement-2', socioId: actorId, obligationId, kind: 'INSTALLMENT', status: 'ACTIVE', revisionNumber: 2, terms: planTerms, agreementDate: '2026-08-19', revisionOfAgreementId: actorId }) }, communityWorkService: { create: vi.fn() } }); apps.push(fastify); return fastify }
afterEach(async () => Promise.all(apps.splice(0).map((fastify) => fastify.close())))

// prettier-ignore
it('gates agreements and maps revision DTOs without evidence', async () => { const disabled = await app(false); expect((await disabled.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('ADMIN', 'off'), payload: { socio_id: actorId, obligation_id: obligationId, kind: 'INSTALLMENT', terms: planTerms, reason: 'Approved' } })).statusCode).toBe(404); const fastify = await app(true); const response = await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${actorId}/reschedule`, headers: auth('TESORERO', 'revision'), payload: { terms: planTerms, reason: 'Approved revision' } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: 'agreement-2', revision_number: 2, revision_of_agreement_id: actorId, obligation_id: obligationId, terms: planTerms }); expect(response.body).not.toContain('authorizationEvidence') })

it('rejects agreement terms outside the approved schedule contract at the route boundary', async () => {
  const fastify = await app(true)
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/v1/dues/agreements',
    headers: auth('ADMIN', 'invalid-terms'),
    payload: {
      socio_id: actorId,
      obligation_id: obligationId,
      kind: 'INSTALLMENT',
      terms: { amountCents: 1_000, installments: [{ amountCents: 500, dueDate: '2026-08-20' }] },
      reason: 'Invalid plan',
    },
  })
  expect(response.statusCode).toBe(400)
})

// prettier-ignore
it('denies community work to an operator role', async () => { const fastify = await app(true); const response = await fastify.inject({ method: 'POST', url: '/api/v1/dues/community-work', headers: auth('OPERADOR', 'denied'), payload: { socio_id: actorId, obligation_id: actorId, amount_cents: 100, evidence: { approval: true }, reason: 'Approved' } }); expect(response.statusCode).toBe(403) })
