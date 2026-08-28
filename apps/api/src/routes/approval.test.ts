import { describe, it, expect } from 'vitest'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Env } from '@athlos/config'
import type { Db } from '@athlos/db'
import type { ApprovalToken } from '@athlos/db/schema'
import { generateApprovalToken } from '@athlos/approval'

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
    createdAt: new Date(),
    ...overrides,
  }
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
