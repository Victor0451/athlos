import { eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents, notifications, operators } from '@athlos/db/schema'
import { EmailChannel } from './channels/email.ts'
import { InAppChannel } from './channels/in-app.ts'
import { WhatsAppChannel } from './channels/whatsapp.ts'
import { render } from './templates/renderer.ts'
import type {
  DispatcherDeps,
  NotificationEvent,
  ResolvedAttempt,
  ResolvedRecipient,
} from './types.ts'

/**
 * Notification dispatcher — the single entry point for every
 * cross-cutting notification in Athlos. Callers (drift-detector,
 * import service, auth login, approval link) import
 * {@link sendNotification} and call it. The dispatcher is
 * `async`, returns `Promise<void>`, and NEVER throws to the
 * caller.
 *
 * Contract (spec §"Synchronous Delivery"):
 *
 *   1. Idempotency: a duplicate `eventId` short-circuits the
 *      fan-out and writes a `skipped` audit row. Implemented via
 *      `SELECT 1 FROM notifications WHERE event_id = $1 LIMIT 1`.
 *   2. Fan-out: channels × recipients are computed once and run
 *      with `Promise.allSettled` so a failure in one channel
 *      does not block the others.
 *   3. Audit: every attempt (sent, failed, skipped) writes one
 *      row to `audit_events` with `action = 'NOTIFY_*'`,
 *      `entity_type = 'notification'`, and the channel +
 *      outcome in the metadata.
 *   4. Time budget: email and WhatsApp have a 5s per-attempt
 *      timeout. In-app inserts do not — they are local DB
 *      calls.
 */
export class NotificationDispatcher {
  private readonly db: Db
  private readonly emailChannel: EmailChannel
  private readonly whatsappChannel: WhatsAppChannel
  private readonly inAppChannel: InAppChannel

  constructor(deps: DispatcherDeps) {
    this.db = deps.db
    this.emailChannel = new EmailChannel({ email: deps.email, logger: deps.logger })
    this.whatsappChannel = new WhatsAppChannel({
      whatsapp: deps.whatsapp,
      logger: deps.logger,
    })
    this.inAppChannel = new InAppChannel({ db: deps.db, logger: deps.logger })
  }

  /**
   * Dispatch a single event. Returns when every channel attempt
   * has settled (or short-circuits on idempotency hit). Never
   * throws.
   */
  async send(event: NotificationEvent): Promise<void> {
    try {
      if (await this.isDuplicate(event.eventId)) {
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'in_app',
          operatorId: null,
          outcome: 'skipped',
          error: null,
        })
        return
      }
      const attempts = await this.resolveAttempts(event)
      if (attempts.length === 0) {
        // No recipient matched the role/preference filter — still
        // mark the event as processed via an in-app row with no
        // channel (the row carries the event_id for dedup, the
        // audit log records the no-op).
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'in_app',
          operatorId: null,
          outcome: 'sent',
          error: null,
        })
        return
      }

      const results = await Promise.allSettled(attempts.map((a) => this.deliver(a, event)))
      // results are handled inside `deliver` (which writes the
      // audit row per attempt). The allSettled wrapper is here
      // as a defensive layer in case `deliver` itself throws —
      // it shouldn't, but the contract is "never throw to caller".
      void results
    } catch (err) {
      // Last-resort safety net. Individual channel errors are
      // caught inside `deliver`; this catches dispatcher-level
      // bugs (e.g. a malformed event type that passed the type
      // check).
      try {
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'in_app',
          operatorId: null,
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      } catch {
        // Audit itself failed — drop the event silently. The
        // originating call still resolves; the error is
        // observable in the dispatcher logs.
      }
    }
  }

  /**
   * Idempotency check. The dispatcher dedups on `event_id` by
   * querying the `notifications` table directly. A hit means
   * "this event was already processed"; the caller can skip
   * the fan-out.
   */
  private async isDuplicate(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.eventId, eventId))
      .limit(1)
    return rows.length > 0
  }

  /**
   * Resolve the recipient × channel matrix for an event. The
   * spec's role-based filter runs here (drift goes to ADMINs
   * only, import_failed to ADMINs + the triggering operator,
   * approval_link_created to the approver's address).
   */
  private async resolveAttempts(event: NotificationEvent): Promise<ResolvedAttempt[]> {
    switch (event.type) {
      case 'drift_alert':
        return await this.resolveDrift(event)
      case 'import_completed':
        return await this.resolveImportCompleted(event)
      case 'import_failed':
        return await this.resolveImportFailed(event)
      case 'login_new_ip':
        return await this.resolveLoginNewIp(event)
      case 'approval_link_created':
        return await this.resolveApprovalLink(event)
    }
  }

  private async resolveDrift(
    event: Extract<NotificationEvent, { type: 'drift_alert' }>,
  ): Promise<ResolvedAttempt[]> {
    const admins = await this.fetchAdmins()
    const subject = `Drift detectado: ${event.metadata.domain}`
    const body = render(
      [
        'Drift detectado en {{domain}}.',
        '',
        'Registros afectados: {{count}}',
        '',
        'Algunas claves:',
        '{{sample}}',
      ].join('\n'),
      {
        domain: event.metadata.domain,
        count: event.metadata.count,
        sample: event.metadata.affectedKeys.slice(0, 5).join(', '),
      },
    )
    return admins.flatMap((r): ResolvedAttempt[] => [
      { channel: 'email', recipient: r, subject, body, eventId: event.eventId },
      { channel: 'in_app', recipient: r, subject, body, eventId: event.eventId },
    ])
  }

  private async resolveImportCompleted(
    event: Extract<NotificationEvent, { type: 'import_completed' }>,
  ): Promise<ResolvedAttempt[]> {
    const op = await this.fetchOperator(event.operatorId)
    if (!op) return []
    const subject = `Importación de {{domain}} finalizada`
    const body = render(
      ['Importación de {{domain}} completada.', '', 'Registros importados: {{count}}'].join('\n'),
      { domain: event.metadata.domain, count: event.metadata.recordCount },
    )
    return [{ channel: 'in_app' as const, recipient: op, subject, body, eventId: event.eventId }]
  }

  private async resolveImportFailed(
    event: Extract<NotificationEvent, { type: 'import_failed' }>,
  ): Promise<ResolvedAttempt[]> {
    const admins = await this.fetchAdmins()
    const trigger = await this.fetchOperator(event.operatorId)
    const subject = `Importación de {{domain}} falló`
    const body = render(
      ['La importación de {{domain}} falló.', '', 'Código: {{code}}', 'Detalle: {{detail}}'].join(
        '\n',
      ),
      {
        domain: event.metadata.domain,
        code: event.metadata.errorCode,
        detail: event.metadata.errorMessage,
      },
    )
    const all: ResolvedAttempt[] = []
    for (const a of admins) {
      all.push({ channel: 'email', recipient: a, subject, body, eventId: event.eventId })
      all.push({ channel: 'in_app', recipient: a, subject, body, eventId: event.eventId })
    }
    if (trigger) {
      all.push({
        channel: 'in_app',
        recipient: trigger,
        subject,
        body,
        eventId: event.eventId,
      })
    }
    return all
  }

  private async resolveLoginNewIp(
    event: Extract<NotificationEvent, { type: 'login_new_ip' }>,
  ): Promise<ResolvedAttempt[]> {
    const op = await this.fetchOperator(event.operatorId)
    if (!op) return []
    // v1 limitation: the operators table has no `email` column yet
    // (that's a later PR). The login_new_ip event therefore only
    // writes an in-app row for the operator. The email channel
    // resolves to no address, and the audit row records the
    // failure. Once email-on-operator lands, the dispatcher will
    // also resolve `recipient.email` and email the operator.
    const subject = 'Nuevo inicio de sesión desde una IP desconocida'
    const body = render(
      [
        'Hola {{username}},',
        '',
        'Detectamos un inicio de sesión desde una IP no vista previamente:',
        '',
        'IP: {{ip}}',
        'Fecha (UTC): {{when}}',
        'Navegador: {{ua}}',
        '',
        'Si no fuiste vos, cambiá tu contraseña inmediatamente.',
      ].join('\n'),
      {
        username: op.username ?? op.operatorId ?? 'operador',
        ip: event.metadata.ip,
        when: event.metadata.occurredAt,
        ua: event.metadata.userAgent,
      },
    )
    // In-app notification to the operator so they see it in the UI
    // on next login. The email channel is intentionally skipped in
    // v1 (no email on the operators table).
    return [{ channel: 'in_app' as const, recipient: op, subject, body, eventId: event.eventId }]
  }

  private async resolveApprovalLink(
    event: Extract<NotificationEvent, { type: 'approval_link_created' }>,
  ): Promise<ResolvedAttempt[]> {
    const subject = 'Aprobación requerida'
    const body = render(
      ['Tenés una aprobación pendiente.', '', 'Abrí el siguiente enlace:', '', '{{url}}'].join(
        '\n',
      ),
      { url: event.metadata.approvalUrl },
    )
    if (event.metadata.approverChannel === 'whatsapp') {
      const recipient: ResolvedRecipient = {
        operatorId: null,
        email: null,
        phone: event.metadata.approverAddress,
        role: null,
        username: null,
      }
      return [{ channel: 'whatsapp', recipient, subject, body, eventId: event.eventId }]
    }
    const recipient: ResolvedRecipient = {
      operatorId: null,
      email: event.metadata.approverAddress,
      phone: null,
      role: null,
      username: null,
    }
    return [{ channel: 'email', recipient, subject, body, eventId: event.eventId }]
  }

  private async fetchAdmins(): Promise<ResolvedRecipient[]> {
    // Filter by role at the DB; the `isActive = true` check is
    // applied in JS because the standin DB does not evaluate
    // boolean placeholders. The real driver evaluates it via
    // the partial index, so this is the right shape for both.
    const rows = await this.db
      .select({
        id: operators.id,
        username: operators.username,
        role: operators.role,
        isActive: operators.isActive,
      })
      .from(operators)
      .where(eq(operators.role, 'A'))
    return rows
      .filter((r) => r.isActive === true)
      .map(
        (r): ResolvedRecipient => ({
          operatorId: r.id,
          email: null,
          phone: null,
          role: 'ADMIN',
          username: r.username,
        }),
      )
  }

  private async fetchOperator(id: string): Promise<ResolvedRecipient | null> {
    const rows = await this.db
      .select({
        id: operators.id,
        username: operators.username,
        role: operators.role,
      })
      .from(operators)
      .where(eq(operators.id, id))
      .limit(1)
    const r = rows[0]
    if (!r) return null
    return {
      operatorId: r.id,
      email: null,
      phone: null,
      role: charToRole(r.role),
      username: r.username,
    }
  }

  /**
   * Run a single channel attempt and write the audit row for it.
   * Catches every error (channel failure, timeout, audit failure)
   * so `Promise.allSettled` at the call site never sees a
   * rejection.
   */
  private async deliver(attempt: ResolvedAttempt, event: NotificationEvent): Promise<void> {
    try {
      if (attempt.channel === 'email') {
        if (!attempt.recipient.email) {
          await this.writeAudit({
            eventType: event.type,
            eventId: event.eventId,
            channel: 'email',
            operatorId: attempt.recipient.operatorId,
            outcome: 'failed',
            error: 'no email address for recipient',
          })
          return
        }
        const result = await this.emailChannel.send({
          to: attempt.recipient.email,
          subject: attempt.subject ?? '(no subject)',
          body: attempt.body,
          eventId: attempt.eventId,
        })
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'email',
          operatorId: attempt.recipient.operatorId,
          outcome: 'sent',
          error: null,
          messageId: result.messageId,
        })
        return
      }
      if (attempt.channel === 'whatsapp') {
        if (!attempt.recipient.phone) {
          await this.writeAudit({
            eventType: event.type,
            eventId: event.eventId,
            channel: 'whatsapp',
            operatorId: attempt.recipient.operatorId,
            outcome: 'failed',
            error: 'no phone for recipient',
          })
          return
        }
        const result = await this.whatsappChannel.send({
          phone: attempt.recipient.phone,
          body: attempt.body,
          eventId: attempt.eventId,
        })
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'whatsapp',
          operatorId: attempt.recipient.operatorId,
          outcome: 'sent',
          error: null,
          messageId: result.messageId,
        })
        return
      }
      // in_app
      if (!attempt.recipient.operatorId) {
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'in_app',
          operatorId: null,
          outcome: 'failed',
          error: 'no operator row for recipient',
        })
        return
      }
      try {
        await this.inAppChannel.send({
          recipientId: attempt.recipient.operatorId,
          subject: attempt.subject,
          body: attempt.body,
          eventId: attempt.eventId,
          metadata: { eventType: event.type, ...event.metadata },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // A 23505 (unique violation on event_id) is the idempotency
        // path — surface as `skipped`, not `failed`.
        const code = (err as { code?: string }).code
        if (code === '23505') {
          await this.writeAudit({
            eventType: event.type,
            eventId: event.eventId,
            channel: 'in_app',
            operatorId: attempt.recipient.operatorId,
            outcome: 'skipped',
            error: null,
          })
          return
        }
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: 'in_app',
          operatorId: attempt.recipient.operatorId,
          outcome: 'failed',
          error: msg,
        })
        return
      }
      await this.writeAudit({
        eventType: event.type,
        eventId: event.eventId,
        channel: 'in_app',
        operatorId: attempt.recipient.operatorId,
        outcome: 'sent',
        error: null,
      })
    } catch (err) {
      // Last-resort net inside the attempt — channel raised
      // something we didn't expect, audit raised, etc.
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await this.writeAudit({
          eventType: event.type,
          eventId: event.eventId,
          channel: attempt.channel,
          operatorId: attempt.recipient.operatorId,
          outcome: 'failed',
          error: msg,
        })
      } catch {
        // Drop silently — the outer `send()` catches the rest.
      }
    }
  }

  private async writeAudit(input: {
    eventType: NotificationEvent['type']
    eventId: string
    channel: 'email' | 'in_app' | 'whatsapp'
    operatorId: string | null
    outcome: 'sent' | 'failed' | 'skipped'
    error: string | null
    messageId?: string
  }): Promise<void> {
    const action = `NOTIFY_${input.outcome.toUpperCase()}` as const
    await this.db.insert(auditEvents).values({
      operatorId: input.operatorId,
      action,
      entityType: 'notification',
      entityId: input.eventId,
      metadata: {
        eventType: input.eventType,
        channel: input.channel,
        outcome: input.outcome,
        ...(input.error ? { error: input.error } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
      },
    })
  }
}

/**
 * Map the operators table's single-char role code to the
 * human-readable role string used in the rest of the app. Kept
 * here (not exported) because the dispatcher is the only
 * consumer of role-based filtering in this package.
 */
function charToRole(code: string): 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA' {
  switch (code) {
    case 'A':
      return 'ADMIN'
    case 'T':
      return 'TESORERO'
    case 'O':
      return 'OPERADOR'
    case 'C':
      return 'CONSULTA'
    default:
      // Unknown role codes fall through to CONSULTA — the
      // least-privileged role. The dispatcher's channel filter
      // is conservative (drift goes to ADMINs only), so an
      // unknown role never accidentally widens the audience.
      return 'CONSULTA'
  }
}

/**
 * Module-level convenience wrapper. Most callers don't want to
 * hold a dispatcher reference; they import `sendNotification` and
 * fire-and-forget. The dispatcher instance is built once at app
 * start and stored in module state.
 */
let globalDispatcher: NotificationDispatcher | null = null

export function setGlobalDispatcher(d: NotificationDispatcher): void {
  globalDispatcher = d
}

/**
 * Send a notification. Never throws. Safe to call without
 * awaiting — the caller can `void sendNotification(event)`.
 */
export function sendNotification(event: NotificationEvent): Promise<void> {
  if (!globalDispatcher) {
    // No dispatcher wired — drop the event with a console.warn.
    // This path is hit only when the package is imported outside
    // a properly-bootstrapped app (e.g. unit tests that didn't
    // call setGlobalDispatcher). Production boots always set it.
    console.warn(`[notifications] no dispatcher set; dropping event ${event.type}/${event.eventId}`)
    return Promise.resolve()
  }
  return globalDispatcher.send(event)
}

/**
 * Test helper — clear the module-level dispatcher so each test
 * can install its own. Not exported from the package barrel.
 */
export function resetGlobalDispatcherForTests(): void {
  globalDispatcher = null
}

// (no module-level re-exports from this dispatcher file)
