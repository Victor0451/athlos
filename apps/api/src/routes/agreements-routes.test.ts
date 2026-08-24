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
const negotiatedTerms = { narrative: 'El socio se compromete a regularizar la deuda.', commitments: [], evidence: { note: 'Acuerdo conversado en secretaría' } }
// prettier-ignore
const supersededAgreementId = '00000000-0000-4000-8000-000000000010', legacyAgreementId = '00000000-0000-4000-8000-000000000011', rescheduledAgreementId = '00000000-0000-4000-8000-000000000012', negotiatedAgreementId = '00000000-0000-4000-8000-000000000013', successorAgreementId = '00000000-0000-4000-8000-000000000014'
// prettier-ignore
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR', key?: string) => ({ authorization: `Bearer ${signAccessToken({ sub: actorId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`, ...(key === undefined ? {} : { 'idempotency-key': key }) })
const negotiatedBody = {
  socio_id: actorId,
  obligation_id: obligationId,
  kind: 'NEGOTIATED',
  terms_version: 1,
  terms: negotiatedTerms,
  reason: 'Condiciones acordadas con el socio',
}
const revisionPayload = { terms_version: 1, terms: negotiatedTerms, reason: 'Renegociación' }

function agreementMocks() {
  const legacy = {
    id: legacyAgreementId,
    socioId: actorId,
    obligationId,
    kind: 'INSTALLMENT',
    status: 'ACTIVE',
    revisionNumber: 1,
    termsVersion: 0,
    terms: planTerms,
    reason: 'Plan aprobado',
    revisionReason: null,
    agreementDate: '2026-08-19',
    revisionOfAgreementId: null,
  }
  const negotiated = {
    ...legacy,
    id: negotiatedAgreementId,
    kind: 'NEGOTIATED',
    termsVersion: 1,
    terms: negotiatedTerms,
    reason: 'Condiciones acordadas con el socio',
  }
  return {
    negotiated,
    create: vi.fn().mockResolvedValue({ outcome: 'created', agreement: legacy }),
    reschedule: vi.fn().mockResolvedValue({
      outcome: 'created',
      agreement: {
        ...legacy,
        id: rescheduledAgreementId,
        revisionNumber: 2,
        revisionReason: 'Approved revision',
        revisionOfAgreementId: legacyAgreementId,
      },
    }),
    revise: vi.fn().mockResolvedValue({
      outcome: 'created',
      agreement: {
        ...negotiated,
        id: successorAgreementId,
        revisionNumber: 2,
        revisionOfAgreementId: negotiatedAgreementId,
        revisionReason: 'Renegociación',
      },
    }),
    lineage: vi.fn().mockResolvedValue({
      active: negotiated,
      revisions: [
        { ...negotiated, id: supersededAgreementId, revisionNumber: 1, status: 'SUPERSEDED' },
        negotiated,
      ],
    }),
  }
}

// prettier-ignore
async function app(enabled: boolean) { const mocks = agreementMocks(), env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true, DUES_AGREEMENTS_ENABLED: enabled }, fastify = Fastify({ logger: false }); fastify.decorate('container', { db: {}, env } as unknown as AppContainer); await fastify.register(errorHandler); await fastify.register(authPlugin(() => env as never)); await fastify.register(duesRoutes, { agreementService: mocks, communityWorkService: { create: vi.fn() } }); apps.push(fastify); return { fastify, mocks } }
afterEach(async () => Promise.all(apps.splice(0).map((fastify) => fastify.close())))

// prettier-ignore
it('gates agreements and maps revision DTOs without evidence', async () => { const { fastify: disabled } = await app(false); expect((await disabled.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('ADMIN', 'off'), payload: { socio_id: actorId, obligation_id: obligationId, kind: 'INSTALLMENT', terms: planTerms, reason: 'Approved' } })).statusCode).toBe(404); const { fastify } = await app(true); const response = await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${actorId}/reschedule`, headers: auth('TESORERO', 'revision'), payload: { terms: planTerms, reason: 'Approved revision' } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: rescheduledAgreementId, revision_number: 2, revision_of_agreement_id: legacyAgreementId, obligation_id: obligationId, terms: planTerms }); expect(response.body).not.toContain('authorizationEvidence') })

// prettier-ignore
it('rejects agreement terms outside the approved schedule contract at the route boundary', async () => { const { fastify } = await app(true); const response = await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('ADMIN', 'invalid-terms'), payload: { socio_id: actorId, obligation_id: obligationId, kind: 'INSTALLMENT', terms: { amountCents: 1_000, installments: [{ amountCents: 500, dueDate: '2026-08-20' }] }, reason: 'Invalid plan' } }); expect(response.statusCode).toBe(400) })

// prettier-ignore
it('denies community work to an operator role', async () => { const { fastify } = await app(true); const response = await fastify.inject({ method: 'POST', url: '/api/v1/dues/community-work', headers: auth('OPERADOR', 'denied'), payload: { socio_id: actorId, obligation_id: actorId, amount_cents: 100, evidence: { approval: true }, reason: 'Approved' } }); expect(response.statusCode).toBe(403) })

// prettier-ignore
it('reads obligation agreement lineage with ascending revisions, finance gate, and no replay flag', async () => { const { fastify, mocks } = await app(true); const response = await fastify.inject({ method: 'GET', url: `/api/v1/dues/obligations/${obligationId}/agreements`, headers: auth('TESORERO') }); expect(response.statusCode).toBe(200); expect(mocks.lineage).toHaveBeenCalledWith({ obligationId }); const body = response.json(); expect(body.active).toMatchObject({ id: negotiatedAgreementId, kind: 'NEGOTIATED', terms_version: 1, reason: 'Condiciones acordadas con el socio', replayed: false }); expect(body.revisions.map((revision: { id: string }) => revision.id)).toEqual([supersededAgreementId, negotiatedAgreementId]); expect(body.revisions.map((revision: { replayed: boolean }) => revision.replayed)).toEqual([false, false]); const { fastify: disabled } = await app(false); expect((await disabled.inject({ method: 'GET', url: `/api/v1/dues/obligations/${obligationId}/agreements`, headers: auth('TESORERO') })).statusCode).toBe(404); expect((await fastify.inject({ method: 'GET', url: `/api/v1/dues/obligations/${obligationId}/agreements`, headers: auth('OPERADOR') })).statusCode).toBe(403) })

// prettier-ignore
it('accepts negotiated creates through the strict union and rejects mixed or unsupported shapes', async () => { const { fastify, mocks } = await app(true); mocks.create.mockResolvedValueOnce({ outcome: 'created', agreement: { ...mocks.negotiated } }); const created = await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('TESORERO', 'negotiated-1'), payload: negotiatedBody }); expect(created.statusCode).toBe(201); expect(created.json()).toMatchObject({ kind: 'NEGOTIATED', terms_version: 1, reason: 'Condiciones acordadas con el socio', revision_reason: null, replayed: false }); expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'NEGOTIATED', termsVersion: 1, terms: negotiatedTerms })); expect((await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('TESORERO', 'negotiated-2'), payload: { ...negotiatedBody, terms_version: 2 } })).statusCode).toBe(400); expect((await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('ADMIN', 'mixed'), payload: { socio_id: actorId, obligation_id: obligationId, kind: 'SIMPLE', terms_version: 1, terms: planTerms, reason: 'Mixed shape' } })).statusCode).toBe(400); expect((await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('TESORERO', 'negotiated-3'), payload: { ...negotiatedBody, terms: { narrative: '' } } })).statusCode).toBe(400) })

// prettier-ignore
it('requires idempotency keys for agreement mutations', async () => { const { fastify } = await app(true); expect((await fastify.inject({ method: 'POST', url: '/api/v1/dues/agreements', headers: auth('ADMIN'), payload: { socio_id: actorId, obligation_id: obligationId, kind: 'INSTALLMENT', terms: planTerms, reason: 'Plan' } })).statusCode).toBe(400); expect((await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${negotiatedAgreementId}/revisions`, headers: auth('ADMIN'), payload: revisionPayload })).statusCode).toBe(400) })

// prettier-ignore
it('creates negotiated revision successors, communicates replay, and gates the revision route', async () => { const { fastify, mocks } = await app(true); const response = await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${negotiatedAgreementId}/revisions`, headers: auth('TESORERO', 'revision-1'), payload: revisionPayload }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: successorAgreementId, revision_number: 2, terms_version: 1, revision_of_agreement_id: negotiatedAgreementId, revision_reason: 'Renegociación', replayed: false }); expect(mocks.revise).toHaveBeenCalledWith(expect.objectContaining({ agreementId: negotiatedAgreementId, termsVersion: 1, reason: 'Renegociación' })); mocks.revise.mockResolvedValueOnce({ outcome: 'replayed', agreement: mocks.negotiated }); expect((await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${negotiatedAgreementId}/revisions`, headers: auth('TESORERO', 'revision-1'), payload: revisionPayload })).json()).toMatchObject({ id: negotiatedAgreementId, replayed: true }); expect((await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${negotiatedAgreementId}/revisions`, headers: auth('TESORERO', 'revision-2'), payload: { ...revisionPayload, terms_version: 2 } })).statusCode).toBe(400); expect((await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${negotiatedAgreementId}/revisions`, headers: auth('OPERADOR', 'revision-3'), payload: revisionPayload })).statusCode).toBe(403) })

// prettier-ignore
it('keeps the legacy reschedule alias as the monetary revision path', async () => { const { fastify, mocks } = await app(true); const response = await fastify.inject({ method: 'POST', url: `/api/v1/dues/agreements/${legacyAgreementId}/reschedule`, headers: auth('TESORERO', 'legacy-revision'), payload: { terms: planTerms, reason: 'Approved revision' } }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: rescheduledAgreementId, terms_version: 0, revision_reason: 'Approved revision', replayed: false }); expect(mocks.reschedule).toHaveBeenCalledWith(expect.objectContaining({ agreementId: legacyAgreementId })) })
