import type { Logger } from 'pino'
import type { Db } from '@athlos/db'
import type { Email } from '@athlos/integrations-email'
import type { WhatsApp } from '@athlos/integrations-whatsapp'
import type { PermissionsRepo } from '@athlos/db/repositories/permissions'

/**
 * v1 channel types (notifications spec §"Channel Types"). Adding a new
 * channel here is a breaking change: every switch on `NotificationChannel`
 * must handle the new value.
 */
export type NotificationChannel = 'email' | 'in_app' | 'whatsapp'

/**
 * Caller-supplied event ID for idempotency dedup. Format is open —
 * the dispatcher stores the value as-is and the partial unique
 * index on `notifications.event_id` enforces the no-duplicate
 * contract. Suggested convention: `<job_run_id>:<domain>` for
 * cron-driven events, `<entity_id>:<action>` for synchronous
 * service calls.
 */
export type NotificationEventId = string

/**
 * Metadata blob stored on the in-app row and the audit event. Free
 * form at the runtime layer; trigger-specific shapes are defined in
 * `src/triggers/*` and validated by the trigger itself.
 */
export type NotificationMetadata = Record<string, unknown>

/**
 * The `sendNotification` argument. Discriminated union over the
 * 5 spec-mandated event types. Each branch carries the exact
 * metadata its trigger needs to render a template.
 *
 * The dispatcher fan-out policy (recipients × channels) is keyed
 * off the discriminator — adding a new event type here forces
 * every consumer to handle it (compile-time exhaustiveness).
 */
export type NotificationEvent =
  | {
      type: 'drift_alert'
      eventId: NotificationEventId
      metadata: {
        domain: string
        count: number
        affectedKeys: string[]
      }
    }
  | {
      type: 'import_completed'
      eventId: NotificationEventId
      operatorId: string
      metadata: {
        domain: string
        recordCount: number
      }
    }
  | {
      type: 'import_failed'
      eventId: NotificationEventId
      operatorId: string
      metadata: {
        domain: string
        errorCode: string
        errorMessage: string
      }
    }
  | {
      type: 'login_new_ip'
      eventId: NotificationEventId
      operatorId: string
      metadata: {
        ip: string
        userAgent: string
        occurredAt: string
      }
    }
  | {
      type: 'approval_link_created'
      eventId: NotificationEventId
      metadata: {
        approverAddress: string
        approverChannel: 'whatsapp' | 'email'
        approvalUrl: string
      }
    }

/**
 * Resolved recipient — an operator UUID, an external address
 * (email/phone), or both. The `email` field is the email-adapter
 * recipient; the `phone` field is the WhatsApp adapter recipient.
 * The dispatcher fills the field(s) from the operator's record
 * (for `in_app` / `email`) or the trigger's metadata (for
 * `approval_link_created`).
 */
export interface ResolvedRecipient {
  /** Operator UUID; null for external addresses with no operator row. */
  operatorId: string | null
  /** Resolved email address (or null when the channel is whatsapp-only). */
  email: string | null
  /** E.164 phone number (or null when the channel is email-only). */
  phone: string | null
  /** Operator role — used by the role-based channel filter (drift goes
   *  to ADMINs only). */
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA' | null
  /** Username (used as a friendly handle in template body — the
   *  operators table does not yet have an `email` column in v1, so
   *  the dispatcher uses the username as the local-part of the
   *  rendered greeting until email-on-operator lands in a later PR). */
  username: string | null
}

/**
 * Resolved channel attempt — pairs a recipient with a channel and
 * the rendered subject + body. The dispatcher iterates over this
 * list with `Promise.allSettled`, never throwing to the caller.
 */
export interface ResolvedAttempt {
  channel: NotificationChannel
  recipient: ResolvedRecipient
  subject: string | null
  body: string
  /** Event ID at attempt time (carried through to the audit log). */
  eventId: NotificationEventId
}

/**
 * Dependencies the dispatcher needs. Built once at app start and
 * shared across every call.
 *
 * - `db` — the notifications + operators + audit tables
 * - `email` — the email adapter (real SMTP in prod, stub in test)
 * - `whatsapp` — the WhatsApp adapter (for approval links only)
 * - `logger` — pino child logger; structured failure logs go here
 * - `clock` — optional time source (tests can inject a fake)
 * - `permissionsRepo` — used to resolve `drift_alert` recipients
 *   to operators with the `data_steward` permission (decision OI-1 B).
 *   Without it, `drift_alert` events would fall back to ADMINs — the
 *   legacy behavior that this change explicitly retired.
 */
export interface DispatcherDeps {
  db: Db
  email: Email
  whatsapp: WhatsApp
  logger: Logger
  clock?: () => Date
  permissionsRepo?: PermissionsRepo
}

/**
 * Thrown by the renderer when a `{{var}}` placeholder is missing
 * from the context. Caught by the dispatcher; the originating
 * event is logged to audit and a structured failure log is emitted.
 */
export class TemplateNotFoundError extends Error {
  public readonly code = 'TEMPLATE_NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.name = 'TemplateNotFoundError'
  }
}
