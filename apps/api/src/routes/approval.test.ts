import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Env } from '@athlos/config'
import type { Db } from '@athlos/db'
import type { ApprovalToken } from '@athlos/db/schema'
import { generateApprovalToken, listCondonationLifecycle } from '@athlos/approval'
import type * as ApprovalModule from '@athlos/approval'
import { signAccessToken } from '@athlos/auth'
import { selectFullOutstanding } from '../modules/dues/allocations.ts'
import type * as AllocationsModule from '../modules/dues/allocations.ts'

const executeApproved = vi.fn()

vi.mock('../modules/dues/allocations.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof AllocationsModule>()),
  selectFullOutstanding: vi.fn(),
}))
vi.mock('../modules/dues/condonations.ts', () => ({
  CondonationExecutionService: class {
    executeApproved = executeApproved
  },
}))
vi.mock('@athlos/approval', async (importOriginal) => ({
  ...(await importOriginal<typeof ApprovalModule>()),
  listCondonationLifecycle: vi.fn(),
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

async function bootstrap(): Promise<{
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
            expires_at: '2026-09-01T00:00:00.000Z',
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
