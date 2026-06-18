import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pino } from 'pino'
import {
  NotificationDispatcher,
  buildDriftEvent,
  buildImportCompletedEvent,
  buildImportFailedEvent,
  buildApprovalEvent,
  shouldFireDrift,
  shouldFireImportCompleted,
  shouldFireImportFailed,
  shouldFireApproval,
  render,
  TemplateNotFoundError,
} from './index.ts'
import { createStandinDb, type StandinDb } from './test-standins/db.ts'
import type { Operator } from '@athlos/db/schema'
import { createStubEmail, type StubEmail } from '@athlos/integrations-email'
import { createStubWhatsApp, type StubWhatsApp } from '@athlos/integrations-whatsapp'

/**
 * Dispatcher tests. The dispatcher is the contract that every
 * trigger depends on; this file pins:
 *
 *   - Idempotency: a second `send(eventId)` short-circuits via
 *     the notifications.event_id unique index (standin mirrors
 *     the constraint with a duplicate-check + 23505).
 *   - Fan-out: a drift event writes one audit row per (admin ×
 *     channel) attempt; an import_failed writes (admin × 2) + 1.
 *   - Failure isolation: a channel adapter that throws does not
 *     prevent the in-app insert from happening.
 *   - Approval link: routes to whatsapp OR email — never both.
 *   - Trigger builders: produce the right eventId + metadata
 *     shape for each spec event type.
 *
 * No real network, no real DB — the standin + stub adapters
 * keep the suite deterministic and fast.
 */

const silent = pino({ level: 'silent' })

function makeOp(overrides: Partial<Operator> = {}): Operator {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin1',
    passwordHash: 'placeholder',
    role: 'A',
    canReprint: true,
    canAnulate: true,
    isActive: true,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

interface TestHarness {
  standin: StandinDb
  dispatcher: NotificationDispatcher
  email: StubEmail
  whatsapp: StubWhatsApp
  admin: Operator
  op: Operator
}

function makeHarness(): TestHarness {
  const standin = createStandinDb()
  const email = createStubEmail()
  const whatsapp = createStubWhatsApp()
  const admin = makeOp({ id: '00000000-0000-4000-8000-00000000aaaa', username: 'admin1' })
  const op = makeOp({
    id: '00000000-0000-4000-8000-000000000bbb',
    username: 'operador1',
    role: 'O',
  })
  standin.state.operators.push(admin, op)
  const dispatcher = new NotificationDispatcher({
    db: standin.drizzle as never,
    email,
    whatsapp,
    logger: silent,
  })
  return { standin, dispatcher, email, whatsapp, admin, op }
}

describe('renderer', () => {
  it('substitutes {{var}} with context values', () => {
    expect(render('Hi {{name}}', { name: 'Vero' })).toBe('Hi Vero')
  })
  it('coerces numbers and booleans via String()', () => {
    expect(render('count={{n}} ok={{b}}', { n: 5, b: true })).toBe('count=5 ok=true')
  })
  it('throws TemplateNotFoundError on missing var', () => {
    expect(() => render('{{x}}', {})).toThrow(TemplateNotFoundError)
  })
})

describe('trigger builders', () => {
  it('drift event has run:domain eventId', () => {
    const ev = buildDriftEvent({
      jobRunId: 'run-42',
      domain: 'socios',
      count: 7,
      affectedKeys: ['S-1', 'S-2'],
    })
    expect(ev.type).toBe('drift_alert')
    expect(ev.eventId).toBe('run-42:socios')
    if (ev.type === 'drift_alert') {
      expect(ev.metadata.count).toBe(7)
    }
  })
  it('import-completed event has jobRunId:import-completed', () => {
    const ev = buildImportCompletedEvent({
      jobRunId: 'r1',
      operatorId: 'op1',
      domain: 'ctacte',
      recordCount: 33,
    })
    expect(ev.type).toBe('import_completed')
    expect(ev.eventId).toBe('r1:import-completed')
  })
  it('import-failed event has jobRunId:import-failed', () => {
    const ev = buildImportFailedEvent({
      jobRunId: 'r1',
      operatorId: 'op1',
      domain: 'ctacte',
      errorCode: 'LEGACY_UNREACHABLE',
      errorMessage: 'share offline',
    })
    expect(ev.type).toBe('import_failed')
    expect(ev.eventId).toBe('r1:import-failed')
  })
  it('approval event has approvalTokenId:approval-link-created', () => {
    const ev = buildApprovalEvent({
      approvalTokenId: 'tok-1',
      approverAddress: '+5491155550000',
      approverChannel: 'whatsapp',
      approvalUrl: 'https://api.gorriti.app/api/approval/tok-1',
    })
    expect(ev.type).toBe('approval_link_created')
    expect(ev.eventId).toBe('tok-1:approval-link-created')
  })
  it('shouldFire predicates gate at the documented thresholds', () => {
    expect(shouldFireDrift({ jobRunId: 'r', domain: 'socios', count: 0, affectedKeys: [] })).toBe(
      false,
    )
    expect(
      shouldFireDrift({ jobRunId: 'r', domain: 'socios', count: 1, affectedKeys: ['x'] }),
    ).toBe(true)
    expect(
      shouldFireImportCompleted({
        jobRunId: 'r',
        operatorId: 'o',
        domain: 'socios',
        recordCount: 0,
      }),
    ).toBe(false)
    expect(
      shouldFireImportFailed({
        jobRunId: 'r',
        operatorId: 'o',
        domain: 'socios',
        errorCode: 'x',
        errorMessage: 'y',
      }),
    ).toBe(true)
    expect(
      shouldFireApproval({
        approvalTokenId: 't',
        approverAddress: 'a',
        approverChannel: 'email',
        approvalUrl: 'u',
      }),
    ).toBe(true)
  })
})

describe('dispatcher.send', () => {
  let harness: TestHarness
  beforeEach(() => {
    harness = makeHarness()
  })

  it('fan-out: drift writes 2 admins × 1 in-app channel = 2 in-app rows (email is v1-no-op since operators.email is unset)', async () => {
    // Add a second admin to verify the fan-out hits every ADMIN.
    harness.standin.state.operators.push(
      makeOp({ id: '00000000-0000-4000-8000-00000000cccc', username: 'admin2' }),
    )
    const event = buildDriftEvent({
      jobRunId: 'run-7',
      domain: 'ctacte',
      count: 3,
      affectedKeys: ['CTA-1', 'CTA-2', 'CTA-3'],
    })
    await harness.dispatcher.send(event)
    // 2 in-app rows (one per admin). v1 does not yet have
    // operators.email so the email channel resolves to a
    // `failed` audit row per admin.
    expect(harness.standin.state.notifications).toHaveLength(2)
    expect(harness.email.outbox).toHaveLength(0)
    const sent = harness.standin.state.auditEvents.filter((a) => a.action === 'NOTIFY_SENT')
    const failed = harness.standin.state.auditEvents.filter((a) => a.action === 'NOTIFY_FAILED')
    expect(sent).toHaveLength(2)
    expect(failed).toHaveLength(2)
  })

  it('drift fan-out uses DATA_STEWARD permission (not ADMIN role) when permissionsRepo is wired', async () => {
    // Per design §3 + decision OI-1 B: drift alerts go to operators
    // with `role_permissions.permission_key = 'data_steward'`, NOT
    // to ADMINs. This test wires a permissionsRepo with 2 active
    // data stewards and verifies the fan-out hits the stewards only.
    const steward1 = makeOp({
      id: '00000000-0000-4000-8000-00000000ddd1',
      username: 'steward1',
      role: 'O',
    })
    const steward2 = makeOp({
      id: '00000000-0000-4000-8000-00000000ddd2',
      username: 'steward2',
      role: 'O',
    })
    const permissionsRepo = {
      hasPermission: vi.fn().mockResolvedValue(true),
      grant: vi.fn(),
      revoke: vi.fn(),
      listOperatorsWithPermission: vi.fn().mockResolvedValue([
        { id: steward1.id, username: steward1.username },
        { id: steward2.id, username: steward2.username },
      ]),
    }
    const dispatcherWithPerms = new NotificationDispatcher({
      db: harness.standin.drizzle as never,
      email: harness.email,
      whatsapp: harness.whatsapp,
      logger: silent,
      permissionsRepo: permissionsRepo as never,
    })
    const event = buildDriftEvent({
      jobRunId: 'run-data-steward',
      domain: 'socios',
      count: 5,
      affectedKeys: ['S-1', 'S-2'],
    })
    await dispatcherWithPerms.send(event)

    // 2 in-app rows, one per data steward. The existing admin and op
    // in the harness are NOT in role_permissions(data_steward) so they
    // receive no notifications.
    expect(harness.standin.state.notifications).toHaveLength(2)
    const inAppRecipients = harness.standin.state.notifications.map((n) => n.recipientId)
    expect(inAppRecipients).toContain(steward1.id)
    expect(inAppRecipients).toContain(steward2.id)
    expect(inAppRecipients).not.toContain(harness.admin.id)
    expect(inAppRecipients).not.toContain(harness.op.id)
    // The repo was consulted with the correct key.
    expect(permissionsRepo.listOperatorsWithPermission).toHaveBeenCalledWith('data_steward')
  })

  it('idempotency: a second send with the same eventId writes a skipped audit row and 0 new channels', async () => {
    const event = buildDriftEvent({
      jobRunId: 'run-7',
      domain: 'ctacte',
      count: 1,
      affectedKeys: ['CTA-1'],
    })
    await harness.dispatcher.send(event)
    expect(harness.standin.state.notifications).toHaveLength(1)
    const before = harness.standin.state.auditEvents.length
    await harness.dispatcher.send(event)
    expect(harness.standin.state.notifications).toHaveLength(1)
    // One extra `skipped` audit row.
    expect(harness.standin.state.auditEvents.length).toBe(before + 1)
    const last = harness.standin.state.auditEvents.at(-1)
    expect(last?.action).toBe('NOTIFY_SKIPPED')
  })

  it('import_failed: writes in-app for admins + the triggering operator (email is v1-no-op)', async () => {
    harness.standin.state.operators.push(
      makeOp({ id: '00000000-0000-4000-8000-00000000cccc', username: 'admin2' }),
    )
    const event = buildImportFailedEvent({
      jobRunId: 'r9',
      operatorId: harness.op.id,
      domain: 'socios',
      errorCode: 'LEGACY_UNREACHABLE',
      errorMessage: 'share offline',
    })
    await harness.dispatcher.send(event)
    // 3 in-app rows: 2 admins + 1 triggering op
    expect(harness.standin.state.notifications).toHaveLength(3)
    // v1: no email on operators → 0 email sends
    expect(harness.email.outbox).toHaveLength(0)
  })

  it('approval link routes to whatsapp OR email, never both', async () => {
    const wa = buildApprovalEvent({
      approvalTokenId: 'tok-wa',
      approverAddress: '+5491155550000',
      approverChannel: 'whatsapp',
      approvalUrl: 'https://api.gorriti.app/api/approval/tok-wa',
    })
    await harness.dispatcher.send(wa)
    expect(harness.whatsapp.messages).toHaveLength(1)
    expect(harness.email.outbox).toHaveLength(0)

    const em = buildApprovalEvent({
      approvalTokenId: 'tok-em',
      approverAddress: 'gerente@gorriti.com',
      approverChannel: 'email',
      approvalUrl: 'https://api.gorriti.app/api/approval/tok-em',
    })
    await harness.dispatcher.send(em)
    expect(harness.email.outbox).toHaveLength(1)
    expect(harness.whatsapp.messages).toHaveLength(1) // unchanged
  })

  it('channel failure: a throwing email adapter does not break the in-app insert', async () => {
    // Replace the email adapter with one that throws.
    const failingEmail: StubEmail = {
      outbox: [],
      reset() {
        this.outbox.length = 0
      },
      send: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const standin2 = createStandinDb()
    standin2.state.operators.push(harness.admin)
    const dispatcher = new NotificationDispatcher({
      db: standin2.drizzle as never,
      email: failingEmail,
      whatsapp: createStubWhatsApp(),
      logger: silent,
    })
    const event = buildDriftEvent({
      jobRunId: 'r1',
      domain: 'ctacte',
      count: 1,
      affectedKeys: ['x'],
    })
    await dispatcher.send(event)
    // The in-app insert succeeded; the email attempt was skipped
    // (no email on operator in v1). The audit log records the
    // in_app `sent` row. The failing-email path itself is
    // exercised in the email-throws-on-call test below.
    expect(standin2.state.notifications).toHaveLength(1)
    expect(standin2.state.auditEvents.find((a) => a.action === 'NOTIFY_SENT')).toBeDefined()
  })

  it('channel failure: email throws after the dispatcher tries to send', async () => {
    // Force the email path: inject a recipient with an email set.
    // The dispatcher resolves to `email` when `recipient.email` is
    // non-null; the failing adapter then throws and the dispatcher
    // logs a `failed` audit row without affecting the in-app path.
    const failingEmail: StubEmail = {
      outbox: [],
      reset() {
        this.outbox.length = 0
      },
      send: async () => {
        throw new Error('ECONNREFUSED')
      },
    }
    const standin2 = createStandinDb()
    standin2.state.operators.push(
      makeOp({
        id: '00000000-0000-4000-8000-00000000eeee',
        username: 'admin-with-email',
        role: 'A',
      }),
    )
    // Reach into the dispatcher via a custom recipient? The
    // current dispatcher only resolves recipients from the
    // operators table (no email column). We can only force the
    // email path via the `approval_link_created` event where the
    // email is supplied via the trigger's metadata.
    const event = buildApprovalEvent({
      approvalTokenId: 'tok-throw',
      approverAddress: 'gerente@gorriti.com',
      approverChannel: 'email',
      approvalUrl: 'https://api.gorriti.app/api/approval/tok-throw',
    })
    const dispatcher = new NotificationDispatcher({
      db: standin2.drizzle as never,
      email: failingEmail,
      whatsapp: createStubWhatsApp(),
      logger: silent,
    })
    await dispatcher.send(event)
    // 0 in-app rows (approval links don't write in-app per spec).
    expect(standin2.state.notifications).toHaveLength(0)
    // 1 `failed` audit row for the email attempt.
    const failed = standin2.state.auditEvents.filter((a) => a.action === 'NOTIFY_FAILED')
    expect(failed).toHaveLength(1)
  })

  it('import_completed writes in-app only (no email)', async () => {
    const event = buildImportCompletedEvent({
      jobRunId: 'r1',
      operatorId: harness.op.id,
      domain: 'socios',
      recordCount: 5,
    })
    await harness.dispatcher.send(event)
    expect(harness.email.outbox).toHaveLength(0)
    expect(harness.standin.state.notifications).toHaveLength(1)
  })

  it('returns void and never throws, even with no ADMINs in the DB', async () => {
    const standin2 = createStandinDb()
    const dispatcher = new NotificationDispatcher({
      db: standin2.drizzle as never,
      email: createStubEmail(),
      whatsapp: createStubWhatsApp(),
      logger: silent,
    })
    const event = buildDriftEvent({
      jobRunId: 'r1',
      domain: 'socios',
      count: 1,
      affectedKeys: ['x'],
    })
    await expect(dispatcher.send(event)).resolves.toBeUndefined()
  })
})
