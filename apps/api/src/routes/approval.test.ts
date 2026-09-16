import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Env } from '@athlos/config'
import type { Db } from '@athlos/db'
import type { ApprovalToken } from '@athlos/db/schema'
import {
  generateApprovalToken,
  listCondonationLifecycle,
  listCondonationQueue,
  listCommunityWorkLifecycle,
  listCommunityWorkQueue,
} from '@athlos/approval'
import type * as ApprovalModule from '@athlos/approval'
import { signAccessToken } from '@athlos/auth'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { selectFullOutstanding } from '../modules/dues/allocations.ts'
import type * as AllocationsModule from '../modules/dues/allocations.ts'
import { findActiveCommunityWorkAgreement } from '../modules/dues/agreements.ts'
import type * as AgreementsModule from '../modules/dues/agreements.ts'

const executeApproved = vi.fn()

vi.mock('../modules/dues/allocations.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof AllocationsModule>()),
  selectFullOutstanding: vi.fn(),
}))
vi.mock('../modules/dues/agreements.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof AgreementsModule>()),
  findActiveCommunityWorkAgreement: vi.fn(),
}))
vi.mock('../modules/dues/condonations.ts', () => ({
  CondonationExecutionService: class {
    executeApproved = executeApproved
  },
}))
vi.mock('@athlos/approval', async (importOriginal) => ({
  ...(await importOriginal<typeof ApprovalModule>()),
  listCondonationLifecycle: vi.fn(),
  listCondonationQueue: vi.fn(),
  listCommunityWorkLifecycle: vi.fn(),
  listCommunityWorkQueue: vi.fn(),
}))

/**
 * HTTP-level tests for the approval routes.
 *
 * The token mechanic is fully tested in @athlos/approval (PR 3a).
 * These tests pin the route contracts: GET returns context for a
 * valid token, expired/used → 410, POST records decision, reject
 * without reason → 400, internal create-link is ADMIN/TESORERO gated.
 */

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/legacy',
    CORS_ORIGINS: 'http://localhost:3000',
    FROM_ADDRESS: 'noreply@gorriti.app',
    DRIFT_DETECTION_CRON: '*/15 * * * *',
    FRESHNESS_REFRESH_CRON: '*/5 * * * *',
    TOKEN_CLEANUP_CRON: '0 3 * * *',
    RECONCILIATION_CRON: '0 * * * *',
    PROMOTION_CRON: '0 */6 * * *',
    AUDIT_RETENTION_DAYS: 90,
    STORAGE_LOCAL_ROOT: '/app/storage',
    STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  } as Env
}

async function bootstrap(extraEnv: NodeJS.ProcessEnv = {}): Promise<{
  app: FastifyInstance
  standin: ReturnType<typeof createStandinDb>
}> {
  const standin = createStandinDb()
  const app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: makeEnv().JWT_SECRET,
      JWT_REFRESH_SECRET: makeEnv().JWT_REFRESH_SECRET,
      DATABASE_URL: makeEnv().DATABASE_URL,
      LEGACY_DB_PATH: makeEnv().LEGACY_DB_PATH,
      ...extraEnv,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    quietLogger: true,
  })
  return { app, standin }
}

function makeApprovalRow(overrides: Partial<ApprovalToken> = {}): ApprovalToken {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    tokenHash: 'placeholder',
    actionType: 'ctacte.anulate',
    actionId: 'ctacte-1',
    contextSummary: 'Refund 100',
    createdByOperatorId: '00000000-0000-4000-8000-000000000001',
    approverChannel: 'whatsapp',
    approverAddress: '+5491100000000',
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    status: 'pending',
    condonationSnapshot: null,
    requestReason: null,
    requestEvidence: null,
    decidedByOperatorId: null,
    decisionReason: null,
    decisionEvidence: null,
    decidedAt: null,
    executionId: null,
    callerKey: null,
    requestFingerprint: null,
    communitySnapshot: null,
    requesterKey: null,
    agreementUuid: null,
    termsVersion: null,
    actorFingerprint: null,
    receipt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

const memberId = '00000000-0000-4000-8000-000000000010'
const obligationId = '00000000-0000-4000-8000-000000000020'
const requesterId = '00000000-0000-4000-8000-000000000030'
const approverId = '00000000-0000-4000-8000-000000000040'
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR', sub = requesterId) => ({
  authorization: `Bearer ${signAccessToken(
    { sub, role, permissions: { can_reprint: false, can_anulate: false } },
    makeEnv(),
  )}`,
})
const condonationPayload = {
  member_id: memberId,
  obligation_ids: [obligationId],
  context: 'Verified hardship case',
  reason: 'Documented hardship',
  evidence: 'case-123',
}

describe('GET /api/v1/condonation-requests', () => {
  const queueRow = () => ({
    id: '00000000-0000-4000-8000-000000000060',
    actionId: '00000000-0000-4000-8000-000000000070',
    status: 'pending' as const,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    decidedAt: null,
    executionId: null,
    executionReceiptId: null,
    createdAt: new Date('2026-01-01T00:00:00.123Z'),
    createdAtCursor: '2026-01-01T00:00:00.123456Z',
    condonationSnapshot: {
      memberId,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 12500 }],
    },
    contextSummary: 'Verified hardship case',
    requestReason: 'Documented hardship',
    requestEvidence: 'case-123',
    currentMember: { id: memberId, numeroSocio: '0042', nombre: 'Ana', apellido: 'Gorriti' },
    requester: { id: requesterId, username: 'operator' },
  })
  beforeEach(() => {
    vi.mocked(listCondonationQueue).mockReset()
    executeApproved.mockReset()
  })
  it('requires authenticated Treasury authority before reading across members', async () => {
    const { app } = await bootstrap()
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/condonation-requests' })).statusCode,
      ).toBe(401)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/condonation-requests',
            headers: auth('OPERADOR'),
          })
        ).statusCode,
      ).toBe(403)
      expect(listCondonationQueue).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
  it.each(['ADMIN', 'TESORERO'] as const)(
    'returns a safe paginated decision context to %s without executing',
    async (role) => {
      const row = queueRow()
      vi.mocked(listCondonationQueue).mockResolvedValue([row, { ...row, id: approverId }])
      const { app } = await bootstrap()
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/condonation-requests?limit=1',
          headers: auth(role),
        })
        expect(response.statusCode).toBe(200)
        const cursor = Buffer.from(JSON.stringify({ t: row.createdAtCursor, id: row.id })).toString(
          'base64url',
        )
        expect(response.json()).toEqual({
          items: [
            {
              id: row.actionId,
              state: 'pending',
              created_at: row.createdAt.toISOString(),
              expires_at: row.expiresAt.toISOString(),
              decided_at: null,
              execution_id: null,
              execution_status: 'unavailable',
              current_member: {
                id: memberId,
                numero_socio: '0042',
                nombre: 'Ana',
                apellido: 'Gorriti',
              },
              requester: row.requester,
              context: row.contextSummary,
              reason: row.requestReason,
              evidence: row.requestEvidence,
              snapshot: {
                member_id: memberId,
                obligations: [
                  { obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 12500 },
                ],
              },
            },
          ],
          next_cursor: cursor,
        })
        expect(listCondonationQueue).toHaveBeenCalledWith(expect.anything(), {
          view: 'actionable',
          limit: 2,
        })
        expect(executeApproved).not.toHaveBeenCalled()
        vi.mocked(listCondonationQueue).mockResolvedValue([])
        const next = await app.inject({
          method: 'GET',
          url: `/api/v1/condonation-requests?view=all&limit=1&cursor=${cursor}`,
          headers: auth(role),
        })
        expect(next.json()).toEqual({ items: [], next_cursor: null })
        expect(listCondonationQueue).toHaveBeenLastCalledWith(expect.anything(), {
          view: 'all',
          limit: 2,
          cursor,
        })
      } finally {
        await app.close()
      }
    },
  )
  it('rejects invalid queue filters before calling the read service', async () => {
    const { app } = await bootstrap()
    try {
      for (const query of [
        'limit=0',
        'limit=101',
        'limit=1.5',
        'view=pending',
        'other=1',
        'cursor=',
        `cursor=${'a'.repeat(257)}`,
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/condonation-requests?${query}`,
          headers: auth('ADMIN'),
        })
        expect(response.statusCode, query).toBe(400)
      }
      expect(listCondonationQueue).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
  it('preserves authoritative lifecycle states and reports unavailable data truthfully', async () => {
    const { app } = await bootstrap()
    try {
      for (const [status, receipt, state] of [
        ['approved', null, 'approved_awaiting_execution'],
        ['approved', approverId, 'executed'],
        ['rejected', null, 'rejected'],
      ] as const) {
        vi.mocked(listCondonationQueue).mockResolvedValue([
          {
            ...queueRow(),
            status,
            executionId: status === 'approved' ? approverId : null,
            executionReceiptId: receipt,
          },
        ])
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/condonation-requests?view=all',
          headers: auth('ADMIN'),
        })
        expect(response.json().items[0].state).toBe(state)
      }
      vi.mocked(listCondonationQueue).mockRejectedValue(
        BusinessError(ErrorCode.SERVICE_UNAVAILABLE, 'Condonation queue data is unavailable'),
      )
      const unavailable = await app.inject({
        method: 'GET',
        url: '/api/v1/condonation-requests',
        headers: auth('ADMIN'),
      })
      expect(unavailable.statusCode).toBe(503)
      expect(unavailable.json()).toMatchObject({ error: 'SERVICE_UNAVAILABLE' })
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/approval/:token', () => {
  it('returns the context for a valid token', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(makeApprovalRow({ tokenHash: hash }))

      const res = await app.inject({ method: 'GET', url: `/api/v1/approval/${raw}` })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body['action_type']).toBe('ctacte.anulate')
      expect(body['action_id']).toBe('ctacte-1')
      expect(body['context_summary']).toBe('Refund 100')
      expect(body['status']).toBe('pending')
    } finally {
      await app.close()
    }
  })

  it('returns 410 for an expired token', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(
        makeApprovalRow({ tokenHash: hash, expiresAt: new Date(Date.now() - 1000) }),
      )

      const res = await app.inject({ method: 'GET', url: `/api/v1/approval/${raw}` })
      expect(res.statusCode).toBe(410)
      expect(res.json()).toMatchObject({ error: 'APPROVAL_LINK_EXPIRED' })
    } finally {
      await app.close()
    }
  })

  it('returns 410 for an already-used token', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(
        makeApprovalRow({ tokenHash: hash, usedAt: new Date(), status: 'approved' }),
      )

      const res = await app.inject({ method: 'GET', url: `/api/v1/approval/${raw}` })
      expect(res.statusCode).toBe(410)
      expect(res.json()).toMatchObject({ error: 'APPROVAL_ALREADY_USED' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown token', async () => {
    const { app } = await bootstrap()
    try {
      const { raw } = generateApprovalToken()
      const res = await app.inject({ method: 'GET', url: `/api/v1/approval/${raw}` })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/approval/:token', () => {
  it('marks the token used on approve', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      const row = makeApprovalRow({ tokenHash: hash })
      standin.state.approvalTokens.push(row)

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'approve' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body['decision']).toBe('approved')
      expect(body['action_type']).toBe('ctacte.anulate')

      const updated = standin.state.approvalTokens[0]
      expect(updated?.usedAt).toBeInstanceOf(Date)
      expect(updated?.status).toBe('approved')
    } finally {
      await app.close()
    }
  })

  it('returns 400 for reject without reason', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(makeApprovalRow({ tokenHash: hash }))

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'reject' },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'REASON_REQUIRED' })
      // Token must NOT be consumed on a rejected reject.
      expect(standin.state.approvalTokens[0]?.usedAt).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('accepts reject with a reason', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(makeApprovalRow({ tokenHash: hash }))

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'reject', reason: 'Monto incorrecto' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body['decision']).toBe('rejected')
      expect(standin.state.approvalTokens[0]?.usedAt).toBeInstanceOf(Date)
    } finally {
      await app.close()
    }
  })

  it('returns 410 when a token is consumed twice', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(makeApprovalRow({ tokenHash: hash }))

      await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'approve' },
      })
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'approve' },
      })
      expect(second.statusCode).toBe(410)
    } finally {
      await app.close()
    }
  })
})

describe('authenticated condonation requests and decisions', () => {
  beforeEach(() => executeApproved.mockReset())

  it('executes only an approved Treasury execution identity once', async () => {
    executeApproved.mockResolvedValue({
      executionId: '00000000-0000-4000-8000-000000000050',
      approvalId: '00000000-0000-4000-8000-000000000051',
      memberId,
      currency: 'ARS',
      totalAmountCents: 12500,
      treatmentIds: ['00000000-0000-4000-8000-000000000052'],
      status: 'executed',
    })
    const { app } = await bootstrap()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/condonation-requests/00000000-0000-4000-8000-000000000053/execution',
        headers: { ...auth('TESORERO', approverId), 'idempotency-key': 'condonation-execution-1' },
        payload: { execution_id: '00000000-0000-4000-8000-000000000050' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        execution_id: '00000000-0000-4000-8000-000000000050',
        approval_id: '00000000-0000-4000-8000-000000000051',
        member_id: memberId,
        currency: 'ARS',
        approved_amount_cents: 12500,
        treatment_ids: ['00000000-0000-4000-8000-000000000052'],
        status: 'executed',
      })
      expect(executeApproved).toHaveBeenCalledWith({
        requestId: '00000000-0000-4000-8000-000000000053',
        executionId: '00000000-0000-4000-8000-000000000050',
        actorId: approverId,
        callerKey: 'condonation-execution-1',
        sourceIp: '127.0.0.1',
      })
    } finally {
      await app.close()
    }
  })

  it('denies unauthenticated and OPERADOR execution before invoking the executor', async () => {
    const { app } = await bootstrap()
    try {
      const unauthenticated = await app.inject({
        method: 'POST',
        url: '/api/v1/condonation-requests/00000000-0000-4000-8000-000000000053/execution',
        payload: { execution_id: '00000000-0000-4000-8000-000000000050' },
      })
      const operator = await app.inject({
        method: 'POST',
        url: '/api/v1/condonation-requests/00000000-0000-4000-8000-000000000053/execution',
        headers: auth('OPERADOR'),
        payload: { execution_id: '00000000-0000-4000-8000-000000000050' },
      })

      expect(unauthenticated.statusCode).toBe(401)
      expect(operator.statusCode).toBe(403)
      expect(executeApproved).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('creates an inert, audited eligible request and replays the same caller key exactly', async () => {
    vi.mocked(selectFullOutstanding).mockResolvedValue({
      socioId: memberId,
      currency: 'ARS',
      totalCents: 12500,
      allocations: [{ obligationId, amountCents: 12500 }],
      fingerprint: 'a'.repeat(64),
    })
    const { app, standin } = await bootstrap()
    try {
      const request = {
        method: 'POST' as const,
        url: '/api/v1/condonation-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'condonation-request-1' },
        payload: condonationPayload,
      }
      const first = await app.inject(request)
      const replay = await app.inject(request)

      expect(first.statusCode).toBe(201)
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(first.json())
      expect(standin.state.approvalTokens).toHaveLength(1)
      expect(standin.state.approvalTokens[0]).toMatchObject({
        actionType: 'dues.condonation',
        createdByOperatorId: requesterId,
        usedAt: null,
        executionId: null,
      })
      expect(standin.state.auditEvents).toHaveLength(1)
      expect(standin.state.auditEvents[0]).toMatchObject({
        operatorId: requesterId,
        action: 'CONDONATION_REQUEST_CREATED',
        entityType: 'condonation_request',
      })
    } finally {
      await app.close()
    }
  })

  it('rejects changed idempotency input and requires a separate Treasury actor for an audited decision', async () => {
    vi.mocked(selectFullOutstanding).mockResolvedValue({
      socioId: memberId,
      currency: 'ARS',
      totalCents: 12500,
      allocations: [{ obligationId, amountCents: 12500 }],
      fingerprint: 'a'.repeat(64),
    })
    const { app, standin } = await bootstrap()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/condonation-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'condonation-request-2' },
        payload: condonationPayload,
      })
      const { id } = created.json() as { id: string }
      const conflict = await app.inject({
        method: 'POST',
        url: '/api/v1/condonation-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'condonation-request-2' },
        payload: { ...condonationPayload, reason: 'Changed reason' },
      })
      const selfDecision = await app.inject({
        method: 'POST',
        url: `/api/v1/condonation-requests/${id}/decision`,
        headers: auth('TESORERO'),
        payload: { decision: 'approved', reason: 'Approved', evidence: 'treasury-1' },
      })
      const decision = await app.inject({
        method: 'POST',
        url: `/api/v1/condonation-requests/${id}/decision`,
        headers: auth('TESORERO', approverId),
        payload: { decision: 'rejected', reason: 'Insufficient evidence', evidence: 'treasury-2' },
      })

      expect(conflict.statusCode).toBe(409)
      expect(selfDecision.statusCode).toBe(403)
      expect(decision.statusCode).toBe(200)
      expect(decision.json()).toMatchObject({ id, status: 'rejected' })
      expect(decision.json()).not.toHaveProperty('execution_id')
      expect(standin.state.approvalTokens[0]).toMatchObject({
        status: 'rejected',
        decidedByOperatorId: approverId,
        usedAt: null,
      })
      expect(standin.state.auditEvents).toHaveLength(2)
      expect(standin.state.auditEvents[1]).toMatchObject({
        operatorId: approverId,
        action: 'CONDONATION_DECISION_RECORDED',
        entityType: 'condonation_request',
      })
    } finally {
      await app.close()
    }
  })

  it('does not allow a public token decision to consume a condonation request', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(
        makeApprovalRow({ actionType: 'dues.condonation', actionId: 'request-1', tokenHash: hash }),
      )
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'approve' },
      })

      expect(response.statusCode).toBe(403)
      expect(standin.state.approvalTokens[0]?.usedAt).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('reads a bounded member lifecycle from persisted approval and execution facts', async () => {
    vi.mocked(listCondonationLifecycle).mockResolvedValueOnce([
      {
        actionId: '00000000-0000-4000-8000-000000000060',
        status: 'approved',
        expiresAt: new Date('2099-09-01T00:00:00.000Z'),
        decidedAt: new Date('2026-08-27T00:00:00.000Z'),
        executionId: '00000000-0000-4000-8000-000000000061',
        condonationSnapshot: {
          memberId,
          obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 12500 }],
        },
        executionReceiptId: null,
      },
    ])
    const { app } = await bootstrap()
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${memberId}/condonation-requests?limit=1`,
        headers: auth('OPERADOR'),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000060',
            state: 'approved_awaiting_execution',
            expires_at: '2099-09-01T00:00:00.000Z',
            decided_at: '2026-08-27T00:00:00.000Z',
            execution_id: '00000000-0000-4000-8000-000000000061',
            execution_status: 'recoverable',
            snapshot: {
              member_id: memberId,
              obligations: [
                {
                  obligation_id: obligationId,
                  currency: 'ARS',
                  outstanding_amount_cents: 12500,
                },
              ],
            },
          },
        ],
      })
      expect(listCondonationLifecycle).toHaveBeenCalledWith(expect.anything(), {
        memberId,
        requesterId,
        limit: 1,
      })
    } finally {
      await app.close()
    }
  })

  it('lets Treasury read an authorized member lifecycle without requester filtering', async () => {
    vi.mocked(listCondonationLifecycle).mockResolvedValueOnce([])
    const { app } = await bootstrap()
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/members/${memberId}/condonation-requests`,
        headers: auth('ADMIN', approverId),
      })
      expect(response.statusCode).toBe(200)
      expect(listCondonationLifecycle).toHaveBeenCalledWith(expect.anything(), {
        memberId,
        limit: 25,
      })
    } finally {
      await app.close()
    }
  })
})

describe('community-work requests and decisions', () => {
  const CW_ON = { COMMUNITY_WORK_APPROVALS_ENABLED: 'true' }
  const communityPayload = {
    member_id: memberId,
    obligation_id: obligationId,
    context: 'Member offers community work',
    reason: 'Documented commitment',
    evidence: 'cw-case-1',
  }
  const outstanding = () => ({
    socioId: memberId,
    currency: 'ARS',
    totalCents: 12500,
    allocations: [{ obligationId, amountCents: 12500 }],
    fingerprint: 'a'.repeat(64),
  })

  beforeEach(() => {
    vi.mocked(selectFullOutstanding).mockReset()
    vi.mocked(findActiveCommunityWorkAgreement).mockReset()
  })

  it('hides the write surface while the rollout flag is off', async () => {
    const { app } = await bootstrap()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community-work-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-off-1' },
        payload: communityPayload,
      })
      const decided = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${memberId}/decision`,
        headers: auth('TESORERO', approverId),
        payload: { decision: 'approved', reason: 'x', evidence: 'y' },
      })
      expect(created.statusCode).toBe(404)
      expect(decided.statusCode).toBe(404)
      expect(selectFullOutstanding).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('creates an inert audited request with a server-captured snapshot and replays the caller key exactly', async () => {
    vi.mocked(selectFullOutstanding).mockResolvedValue(outstanding())
    const { app, standin } = await bootstrap(CW_ON)
    try {
      const request = {
        method: 'POST' as const,
        url: '/api/v1/community-work-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-request-1' },
        payload: communityPayload,
      }
      const first = await app.inject(request)
      const replay = await app.inject(request)

      expect(first.statusCode).toBe(201)
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(first.json())
      expect(standin.state.approvalTokens).toHaveLength(1)
      expect(standin.state.approvalTokens[0]).toMatchObject({
        actionType: 'dues.community-work-request',
        createdByOperatorId: requesterId,
        communitySnapshot: {
          memberId,
          obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 12500 }],
        },
        requesterKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        agreementUuid: null,
        termsVersion: null,
        condonationSnapshot: null,
        usedAt: null,
        executionId: null,
      })
      expect(standin.state.auditEvents).toHaveLength(1)
      expect(standin.state.auditEvents[0]).toMatchObject({
        operatorId: requesterId,
        action: 'COMMUNITY_WORK_REQUEST_CREATED',
        entityType: 'community_work_request',
      })

      // the finance-access policy is preserved: ADMIN may also request
      const byAdmin = await app.inject({
        ...request,
        headers: { ...auth('ADMIN', approverId), 'idempotency-key': 'cw-request-2' },
      })
      expect(byAdmin.statusCode).toBe(201)
      expect(standin.state.approvalTokens).toHaveLength(2)
    } finally {
      await app.close()
    }
  })

  it('validates supplied agreement context server-side and rejects ownership mismatch', async () => {
    vi.mocked(selectFullOutstanding).mockResolvedValue(outstanding())
    const agreementId = '00000000-0000-4000-8000-0000000000a1'
    vi.mocked(findActiveCommunityWorkAgreement)
      .mockResolvedValueOnce({ termsVersion: 7 })
      .mockResolvedValueOnce(null)
    const { app, standin } = await bootstrap(CW_ON)
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/v1/community-work-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-agreement-1' },
        payload: { ...communityPayload, agreement_id: agreementId },
      })
      const mismatch = await app.inject({
        method: 'POST',
        url: '/api/v1/community-work-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-agreement-2' },
        payload: { ...communityPayload, agreement_id: agreementId },
      })
      expect(ok.statusCode).toBe(201)
      expect(standin.state.approvalTokens[0]).toMatchObject({
        agreementUuid: agreementId,
        termsVersion: 7,
      })
      expect(findActiveCommunityWorkAgreement).toHaveBeenCalledWith(expect.anything(), {
        agreementId,
        socioId: memberId,
        obligationId,
      })
      expect(mismatch.statusCode).toBe(409)
      expect(standin.state.approvalTokens).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('rejects strict-schema violations and a missing idempotency key', async () => {
    const { app, standin } = await bootstrap(CW_ON)
    try {
      for (const payload of [
        { ...communityPayload, extra_field: 'x' },
        { ...communityPayload, member_id: 'not-a-uuid' },
        { ...communityPayload, obligation_id: undefined },
        { ...communityPayload, context: '' },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/community-work-requests',
          headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-invalid-1' },
          payload,
        })
        expect(response.statusCode, JSON.stringify(payload)).toBe(400)
      }
      const noKey = await app.inject({
        method: 'POST',
        url: '/api/v1/community-work-requests',
        headers: auth('OPERADOR'),
        payload: communityPayload,
      })
      expect(noKey.statusCode).toBe(400)
      expect(standin.state.approvalTokens).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('records an audited Treasury decision with fingerprint, exact replay and denial matrix', async () => {
    vi.mocked(selectFullOutstanding).mockResolvedValue(outstanding())
    const { app, standin } = await bootstrap(CW_ON)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community-work-requests',
        headers: { ...auth('OPERADOR'), 'idempotency-key': 'cw-decide-1' },
        payload: communityPayload,
      })
      const { id } = created.json() as { id: string }

      const asOperator = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${id}/decision`,
        headers: auth('OPERADOR', approverId),
        payload: { decision: 'approved', reason: 'Nope', evidence: 'e' },
      })
      const selfDecision = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${id}/decision`,
        headers: auth('TESORERO'), // sub defaults to requesterId
        payload: { decision: 'approved', reason: 'Self', evidence: 'e' },
      })
      expect(asOperator.statusCode).toBe(403)
      expect(selfDecision.statusCode).toBe(403)

      const decisionPayload = {
        decision: 'approved',
        reason: 'Plan accepted',
        evidence: 'treasury-9',
      }
      const headers = auth('TESORERO', approverId)
      const decision = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${id}/decision`,
        headers,
        payload: decisionPayload,
      })
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${id}/decision`,
        headers,
        payload: decisionPayload,
      })
      const divergent = await app.inject({
        method: 'POST',
        url: `/api/v1/community-work-requests/${id}/decision`,
        headers,
        payload: { ...decisionPayload, reason: 'Changed' },
      })

      expect(decision.statusCode).toBe(200)
      expect(decision.json()).toMatchObject({ id, status: 'approved' })
      expect(decision.json()).not.toHaveProperty('execution_id')
      expect(replay.statusCode).toBe(200)
      expect(replay.json()).toEqual(decision.json())
      expect(divergent.statusCode).toBe(409)
      expect(standin.state.approvalTokens[0]).toMatchObject({
        status: 'approved',
        decidedByOperatorId: approverId,
        actorFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        usedAt: null,
      })
      expect(standin.state.approvalTokens[0]?.executionId).toMatch(/^[0-9a-f-]{36}$/)
      // only new transitions audit: request + decision; replays dedupe
      expect(standin.state.auditEvents).toHaveLength(2)
      expect(standin.state.auditEvents[1]).toMatchObject({
        operatorId: approverId,
        action: 'COMMUNITY_WORK_DECISION_RECORDED',
        entityType: 'community_work_request',
      })
    } finally {
      await app.close()
    }
  })

  it('does not allow a public token decision to consume a community-work request', async () => {
    const { app, standin } = await bootstrap()
    try {
      const { raw, hash } = generateApprovalToken()
      standin.state.approvalTokens.push(
        makeApprovalRow({
          actionType: 'dues.community-work-request',
          actionId: 'cw-1',
          tokenHash: hash,
        }),
      )
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/approval/${raw}`,
        payload: { decision: 'approve' },
      })
      expect(response.statusCode).toBe(403)
      expect(standin.state.approvalTokens[0]?.usedAt).toBeNull()
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/members/:memberId/community-work-requests', () => {
  const CW_ON = { COMMUNITY_WORK_APPROVALS_ENABLED: 'true' }
  const readHistory = (
    app: FastifyInstance,
    role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | null = 'ADMIN',
    query = '',
    member = memberId,
  ) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/members/${member}/community-work-requests${query}`,
      ...(role === null
        ? {}
        : { headers: auth(role, role === 'OPERADOR' ? requesterId : approverId) }),
    })
  beforeEach(() => {
    vi.mocked(listCommunityWorkLifecycle).mockReset()
    vi.mocked(listCondonationLifecycle).mockReset()
  })
  type CwLifecycleRow = Awaited<ReturnType<typeof listCommunityWorkLifecycle>>[number]
  const cwRow = (overrides: Partial<CwLifecycleRow>): CwLifecycleRow => ({
    actionId: '00000000-0000-4000-8000-0000000000c1',
    status: 'pending',
    expiresAt: new Date('2099-09-01T00:00:00.000Z'),
    decidedAt: null,
    executionId: null,
    communitySnapshot: {
      memberId,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 1000 }],
    },
    executionReceiptId: null,
    ...overrides,
  })

  it('hides the read surface while the rollout flag is off', async () => {
    const { app } = await bootstrap()
    try {
      // All authenticated roles see 404 when flag is off.
      expect((await readHistory(app, 'ADMIN')).statusCode).toBe(404)
      expect((await readHistory(app, 'OPERADOR')).statusCode).toBe(404)
      expect(listCommunityWorkLifecycle).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('returns 401 when unauthenticated', async () => {
    const { app } = await bootstrap(CW_ON)
    try {
      expect((await readHistory(app, null)).statusCode).toBe(401)
      expect(listCommunityWorkLifecycle).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it.each([
    ['non-UUID memberId', 'not-a-uuid', ''],
    ['limit=0', memberId, '?limit=0'],
    ['limit=101', memberId, '?limit=101'],
    ['unknown query keys via strict schema', memberId, '?foo=bar'],
  ] as const)('rejects invalid query: %s', async (_case, member, query) => {
    const { app } = await bootstrap(CW_ON)
    try {
      expect((await readHistory(app, 'ADMIN', query, member)).statusCode).toBe(400)
      expect(listCommunityWorkLifecycle).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it.each([
    ['ADMIN', { memberId, limit: 25 }],
    ['TESORERO', { memberId, limit: 25 }],
    ['OPERADOR', { memberId, requesterId, limit: 25 }],
  ] as const)(
    'scopes the lifecycle read for %s to the route contract',
    async (role, expectedInput) => {
      vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([])
      const { app } = await bootstrap(CW_ON)
      try {
        expect((await readHistory(app, role)).statusCode).toBe(200)
        expect(listCommunityWorkLifecycle).toHaveBeenCalledWith(expect.anything(), expectedInput)
      } finally {
        await app.close()
      }
    },
  )

  it('accepts limit boundaries 1 and 100 and forwards them unchanged', async () => {
    vi.mocked(listCommunityWorkLifecycle).mockResolvedValue([])
    const { app } = await bootstrap(CW_ON)
    try {
      expect((await readHistory(app, 'ADMIN', '?limit=1')).statusCode).toBe(200)
      expect(listCommunityWorkLifecycle).toHaveBeenLastCalledWith(expect.anything(), {
        memberId,
        limit: 1,
      })
      expect((await readHistory(app, 'ADMIN', '?limit=100')).statusCode).toBe(200)
      expect(listCommunityWorkLifecycle).toHaveBeenLastCalledWith(expect.anything(), {
        memberId,
        limit: 100,
      })
    } finally {
      await app.close()
    }
  })

  it('returns every pending request for one member without collapsing them', async () => {
    vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([
      cwRow({ actionId: '00000000-0000-4000-8000-0000000000c1' }),
      cwRow({
        actionId: '00000000-0000-4000-8000-0000000000c2',
        expiresAt: new Date('2099-10-01T00:00:00.000Z'),
      }),
    ])
    const { app } = await bootstrap(CW_ON)
    try {
      const response = await readHistory(app, 'ADMIN')
      expect(response.statusCode).toBe(200)
      const items = response.json().items as Array<{ id: string; state: string }>
      expect(items).toHaveLength(2)
      expect(items.map((item) => item.id)).toEqual([
        '00000000-0000-4000-8000-0000000000c1',
        '00000000-0000-4000-8000-0000000000c2',
      ])
      expect(items.every((item) => item.state === 'pending')).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('never reads the condonation lifecycle from the community-work endpoint', async () => {
    vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([])
    const { app } = await bootstrap(CW_ON)
    try {
      expect((await readHistory(app, 'ADMIN')).statusCode).toBe(200)
      expect(listCommunityWorkLifecycle).toHaveBeenCalledTimes(1)
      expect(listCondonationLifecycle).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('returns full DTO shape for approved_awaiting_execution', async () => {
    vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([
      cwRow({
        actionId: '00000000-0000-4000-8000-000000000060',
        status: 'approved',
        decidedAt: new Date('2026-08-27T00:00:00.000Z'),
        executionId: '00000000-0000-4000-8000-000000000061',
        communitySnapshot: {
          memberId,
          obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 12500 }],
        },
      }),
    ])
    const { app } = await bootstrap(CW_ON)
    try {
      const response = await readHistory(app, 'ADMIN', '?limit=1')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000060',
            state: 'approved_awaiting_execution',
            expires_at: '2099-09-01T00:00:00.000Z',
            decided_at: '2026-08-27T00:00:00.000Z',
            execution_id: '00000000-0000-4000-8000-000000000061',
            execution_status: 'recoverable',
            snapshot: {
              member_id: memberId,
              obligations: [
                {
                  obligation_id: obligationId,
                  currency: 'ARS',
                  outstanding_amount_cents: 12500,
                },
              ],
            },
          },
        ],
      })
    } finally {
      await app.close()
    }
  })

  const stateCases: Array<{
    name: string
    overrides: Partial<CwLifecycleRow>
    expectedState: string
    expectedExecutionStatus: string
  }> = [
    {
      name: 'executed when executionReceiptId is set',
      overrides: {
        status: 'approved',
        decidedAt: new Date('2026-08-27T00:00:00.000Z'),
        executionId: '00000000-0000-4000-8000-000000000071',
        executionReceiptId: '00000000-0000-4000-8000-000000000080',
      },
      expectedState: 'executed',
      expectedExecutionStatus: 'executed',
    },
    {
      name: 'expired when past expiry and not executed',
      overrides: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      expectedState: 'expired',
      expectedExecutionStatus: 'unavailable',
    },
    {
      name: 'rejected when status is rejected',
      overrides: { status: 'rejected', decidedAt: new Date('2026-08-27T00:00:00.000Z') },
      expectedState: 'rejected',
      expectedExecutionStatus: 'unavailable',
    },
    {
      name: 'pending when status is pending and not expired',
      overrides: {},
      expectedState: 'pending',
      expectedExecutionStatus: 'unavailable',
    },
  ]
  it.each(stateCases)(
    'maps state: $name',
    async ({ overrides, expectedState, expectedExecutionStatus }) => {
      vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([cwRow(overrides)])
      const { app } = await bootstrap(CW_ON)
      try {
        const response = await readHistory(app, 'ADMIN')
        expect(response.statusCode).toBe(200)
        const item = response.json().items[0] as { state: string; execution_status: string }
        expect(item.state).toBe(expectedState)
        expect(item.execution_status).toBe(expectedExecutionStatus)
      } finally {
        await app.close()
      }
    },
  )

  it('returns empty list for an unknown member', async () => {
    vi.mocked(listCommunityWorkLifecycle).mockResolvedValueOnce([])
    const { app } = await bootstrap(CW_ON)
    try {
      const response = await readHistory(app, 'ADMIN', '', '00000000-0000-4000-8000-0000000000ff')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ items: [] })
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/community-work-requests', () => {
  const CW_ON = { COMMUNITY_WORK_APPROVALS_ENABLED: 'true' }
  type CwQueueRow = Awaited<ReturnType<typeof listCommunityWorkQueue>>[number]
  const cwQueueRow = (overrides: Partial<CwQueueRow> = {}): CwQueueRow => ({
    id: '00000000-0000-4000-8000-000000000060',
    actionId: '00000000-0000-4000-8000-000000000070',
    status: 'pending' as const,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    decidedAt: null,
    executionId: null,
    executionReceiptId: null,
    communitySnapshot: {
      memberId,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 12500 }],
    },
    createdAt: new Date('2026-01-01T00:00:00.123Z'),
    createdAtCursor: '2026-01-01T00:00:00.123456Z',
    contextSummary: 'Verified community commitment',
    requestReason: 'Documented commitment',
    requestEvidence: 'case-456',
    currentMember: { id: memberId, numeroSocio: '0042', nombre: 'Ana', apellido: 'Gorriti' },
    requester: { id: requesterId, username: 'operator' },
    ...overrides,
  })
  const readQueue = (
    app: FastifyInstance,
    role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | null,
    query = '',
  ) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/community-work-requests${query}`,
      ...(role === null ? {} : { headers: auth(role, approverId) }),
    })
  beforeEach(() => {
    vi.mocked(listCommunityWorkQueue).mockReset()
  })

  it('hides the queue while the rollout flag is off', async () => {
    const { app } = await bootstrap()
    try {
      expect((await readQueue(app, 'ADMIN')).statusCode).toBe(404)
      expect(listCommunityWorkQueue).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('requires authenticated Treasury authority before reading across members', async () => {
    const { app } = await bootstrap(CW_ON)
    try {
      expect((await readQueue(app, null)).statusCode).toBe(401)
      expect((await readQueue(app, 'OPERADOR')).statusCode).toBe(403)
      expect(listCommunityWorkQueue).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it.each(['ADMIN', 'TESORERO'] as const)(
    'returns the actionable treasury queue to %s with no-store and the full DTO shape',
    async (role) => {
      const row = cwQueueRow()
      vi.mocked(listCommunityWorkQueue).mockResolvedValue([row])
      const { app } = await bootstrap(CW_ON)
      try {
        const response = await readQueue(app, role)
        expect(response.statusCode).toBe(200)
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.json()).toEqual({
          items: [
            {
              id: '00000000-0000-4000-8000-000000000070',
              state: 'pending',
              created_at: '2026-01-01T00:00:00.123Z',
              expires_at: '2099-01-01T00:00:00.000Z',
              decided_at: null,
              execution_id: null,
              execution_status: 'unavailable',
              snapshot: {
                member_id: memberId,
                obligations: [
                  { obligation_id: obligationId, currency: 'ARS', outstanding_amount_cents: 12500 },
                ],
              },
              current_member: {
                id: memberId,
                numero_socio: '0042',
                nombre: 'Ana',
                apellido: 'Gorriti',
              },
              requester: { id: requesterId, username: 'operator' },
              context: 'Verified community commitment',
              reason: 'Documented commitment',
              evidence: 'case-456',
            },
          ],
          next_cursor: null,
        })
        expect(listCommunityWorkQueue).toHaveBeenCalledWith(expect.anything(), {
          view: 'actionable',
          limit: 26,
        })
      } finally {
        await app.close()
      }
    },
  )

  it('emits a base64url cursor when the +1 probe finds another page and forwards view and cursor verbatim', async () => {
    const row = cwQueueRow()
    vi.mocked(listCommunityWorkQueue).mockResolvedValueOnce([row, { ...row, id: approverId }])
    const { app } = await bootstrap(CW_ON)
    try {
      const response = await readQueue(app, 'ADMIN', '?limit=1')
      const { next_cursor: cursor } = response.json()
      expect(response.json().items).toHaveLength(1)
      expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual({
        t: row.createdAtCursor,
        id: row.id,
      })
      vi.mocked(listCommunityWorkQueue).mockResolvedValueOnce([])
      const next = await readQueue(app, 'ADMIN', `?view=all&limit=1&cursor=${cursor}`)
      expect(next.json()).toEqual({ items: [], next_cursor: null })
      expect(listCommunityWorkQueue).toHaveBeenLastCalledWith(expect.anything(), {
        view: 'all',
        limit: 2,
        cursor,
      })
    } finally {
      await app.close()
    }
  })

  it.each(['limit=0', 'limit=101', 'other=1', `cursor=${'a'.repeat(257)}`])(
    'rejects invalid queue filter %s before calling the read service',
    async (query) => {
      const { app } = await bootstrap(CW_ON)
      try {
        expect((await readQueue(app, 'ADMIN', `?${query}`)).statusCode).toBe(400)
        expect(listCommunityWorkQueue).not.toHaveBeenCalled()
      } finally {
        await app.close()
      }
    },
  )
})
