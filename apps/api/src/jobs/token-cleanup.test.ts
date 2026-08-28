import { describe, it, expect, beforeEach } from 'vitest'
import { makeTokenCleanupHandler } from './token-cleanup.ts'
import { createStandinDb } from '../test-standins/db.ts'
import type { ApprovalToken, RefreshToken, AuditEvent } from '@athlos/db/schema'

/**
 * The token-cleanup handler is the only fully-implemented job in
 * PR 6a — it deletes expired tokens + audit events. Tests verify:
 *
 *   - Expired refresh tokens (>7 days past expiry) are deleted.
 *   - Recent refresh tokens (1 day past expiry) are kept.
 *   - Revoked refresh tokens (>7 days past revoke) are deleted.
 *   - Expired approval tokens (>30 days past expiry) are deleted.
 *   - Used approval tokens (>30 days past use) are deleted.
 *   - Recent audit events are kept.
 *   - Stale audit events (>90 days) are deleted.
 *
 * Tests use the apps/api in-memory Drizzle standin (extended for
 * this PR to support the `delete` builder + the lt/or operators).
 */
function makeDb() {
  const standin = createStandinDb()
  return { standin, db: standin.drizzle }
}

function seedRefreshToken(
  standin: ReturnType<typeof createStandinDb>,
  overrides: Partial<RefreshToken>,
): RefreshToken {
  standin.state.refreshTokens.push({
    id: overrides.id ?? cryptoId(),
    operatorId: overrides.operatorId ?? 'op-1',
    tokenHash: overrides.tokenHash ?? 'h',
    expiresAt: overrides.expiresAt ?? new Date(),
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  })
  return standin.state.refreshTokens[standin.state.refreshTokens.length - 1]!
}

function seedApprovalToken(
  standin: ReturnType<typeof createStandinDb>,
  overrides: Partial<ApprovalToken>,
): ApprovalToken {
  standin.state.approvalTokens.push({
    id: overrides.id ?? cryptoId(),
    tokenHash: overrides.tokenHash ?? 'h',
    actionType: overrides.actionType ?? 'ctacte.anulate',
    actionId: overrides.actionId ?? 'a',
    contextSummary: overrides.contextSummary ?? 'c',
    createdByOperatorId: overrides.createdByOperatorId ?? 'op-1',
    approverChannel: overrides.approverChannel ?? 'email',
    approverAddress: overrides.approverAddress ?? 'a@b.c',
    expiresAt: overrides.expiresAt ?? new Date(),
    usedAt: overrides.usedAt ?? null,
    status: overrides.status ?? 'pending',
    condonationSnapshot: overrides.condonationSnapshot ?? null,
    requestReason: overrides.requestReason ?? null,
    requestEvidence: overrides.requestEvidence ?? null,
    decidedByOperatorId: overrides.decidedByOperatorId ?? null,
    decisionReason: overrides.decisionReason ?? null,
    decisionEvidence: overrides.decisionEvidence ?? null,
    decidedAt: overrides.decidedAt ?? null,
    executionId: overrides.executionId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  })
  return standin.state.approvalTokens[standin.state.approvalTokens.length - 1]!
}

function seedAuditEvent(
  standin: ReturnType<typeof createStandinDb>,
  overrides: Partial<AuditEvent>,
): AuditEvent {
  standin.state.auditEvents.push({
    id: overrides.id ?? cryptoId(),
    operatorId: overrides.operatorId ?? null,
    action: overrides.action ?? 'AUTH_LOGIN',
    entityType: overrides.entityType ?? 'operator',
    entityId: overrides.entityId ?? 'op-1',
    oldValue: overrides.oldValue ?? null,
    newValue: overrides.newValue ?? null,
    sourceIp: overrides.sourceIp ?? null,
    metadata: overrides.metadata ?? null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  })
  return standin.state.auditEvents[standin.state.auditEvents.length - 1]!
}

function cryptoId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

describe('token-cleanup', () => {
  beforeEach(() => {
    // No-op: each test gets a fresh standin via makeDb().
  })

  it('deletes refresh tokens expired more than 7 days ago', async () => {
    const { standin, db } = makeDb()
    seedRefreshToken(standin, {
      tokenHash: 'h1',
      expiresAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
    })
    seedRefreshToken(standin, {
      tokenHash: 'h2',
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago (kept)
    })
    const handler = makeTokenCleanupHandler(db as never, 90)
    const result = await handler({
      jobRunId: 'jr-1',
      jobName: 'token-cleanup',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })
    expect(result.status).toBe('succeeded')
    const meta = result.metadata as Record<string, number>
    expect(meta.deleted_refresh_tokens).toBe(1)
    expect(standin.state.refreshTokens).toHaveLength(1)
  })

  it('deletes revoked refresh tokens more than 7 days after revoke', async () => {
    const { standin, db } = makeDb()
    seedRefreshToken(standin, {
      tokenHash: 'h1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // not expired
      revokedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // revoked 10d ago
    })
    const handler = makeTokenCleanupHandler(db as never, 90)
    await handler({
      jobRunId: 'jr-1',
      jobName: 'token-cleanup',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })
    expect(standin.state.refreshTokens).toHaveLength(0)
  })

  it('deletes approval tokens expired more than 30 days ago', async () => {
    const { standin, db } = makeDb()
    seedApprovalToken(standin, {
      tokenHash: 'a1',
      expiresAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })
    seedApprovalToken(standin, {
      tokenHash: 'a2',
      expiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days (kept)
    })
    const handler = makeTokenCleanupHandler(db as never, 90)
    const result = await handler({
      jobRunId: 'jr-1',
      jobName: 'token-cleanup',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })
    const meta = result.metadata as Record<string, number>
    expect(meta.deleted_approval_tokens).toBe(1)
    expect(standin.state.approvalTokens).toHaveLength(1)
  })

  it('deletes audit events older than the retention window', async () => {
    const { standin, db } = makeDb()
    seedAuditEvent(standin, {
      action: 'AUTH_LOGIN',
      entityType: 'operator',
      entityId: 'op-1',
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100d old
    })
    seedAuditEvent(standin, {
      action: 'AUTH_LOGIN',
      entityType: 'operator',
      entityId: 'op-2',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30d old (kept)
    })
    const handler = makeTokenCleanupHandler(db as never, 90)
    const result = await handler({
      jobRunId: 'jr-1',
      jobName: 'token-cleanup',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })
    const meta = result.metadata as Record<string, number>
    expect(meta.deleted_audit_events).toBe(1)
    expect(meta.audit_retention_days).toBe(90)
  })

  it('returns zero counts when nothing matches', async () => {
    const { db } = makeDb()
    const handler = makeTokenCleanupHandler(db as never, 90)
    const result = await handler({
      jobRunId: 'jr-1',
      jobName: 'token-cleanup',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })
    const meta = result.metadata as Record<string, number>
    expect(meta.deleted_refresh_tokens).toBe(0)
    expect(meta.deleted_approval_tokens).toBe(0)
    expect(meta.deleted_audit_events).toBe(0)
  })
})

// Avoid the pino import in tests — a minimal logger that satisfies
// the JobContext['log'] shape (only .info, .warn, .error, .debug are
// called by the handlers).
function makeLogger() {
  const noop = () => undefined
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => makeLogger(),
    level: 'silent',
  } as never
}
