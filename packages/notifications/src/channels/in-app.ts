import type { Db } from '@athlos/db'
import { notifications } from '@athlos/db/schema'
import type { Logger } from 'pino'

/**
 * In-app channel — inserts a row into the `notifications` table.
 * Per the spec, this is the "outbox" the UI polls: every drift
 * alert, every import completion, every login notification (in
 * the events that DO emit in-app rows) shows up here.
 *
 * The channel does NOT honour the 5s timeout: an in-app insert
 * is a local DB call (typically <50ms against a healthy
 * Postgres). The timeout applies only to network I/O — email
 * and WhatsApp. The dispatcher never awaits the in-app insert
 * under the same timeout budget as the network channels.
 *
 * Idempotency is handled at the dispatcher level via the
 * `notifications.event_id` unique index. The channel itself
 * does not dedup — it always attempts the insert and lets the
 * unique constraint raise a 23505 that the caller can ignore.
 */
export interface InAppChannelDeps {
  db: Db
  logger: Logger
}

export class InAppChannel {
  private readonly db: Db
  private readonly log: Logger

  constructor(deps: InAppChannelDeps) {
    this.db = deps.db
    this.log = deps.logger.child({ channel: 'in_app' })
  }

  /**
   * Insert a single in-app notification row. Returns the new id.
   * The `eventId` field has a partial unique index; on conflict
   * the underlying driver throws `code: '23505'` and the
   * dispatcher logs the duplicate as a `skipped` audit row.
   */
  async send(input: {
    recipientId: string
    subject: string | null
    body: string
    eventId: string
    metadata: Record<string, unknown>
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        channel: 'in_app',
        recipientId: input.recipientId,
        subject: input.subject,
        body: input.body,
        eventId: input.eventId,
        metadata: input.metadata,
        status: 'sent',
      })
      .returning({ id: notifications.id })
    if (!row) {
      throw new Error('in_app insert returned no row')
    }
    this.log.debug(
      { eventId: input.eventId, recipientId: input.recipientId, id: row.id },
      'in-app row inserted',
    )
    return { id: row.id }
  }
}
