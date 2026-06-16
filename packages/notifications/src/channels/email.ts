import type { Email } from '@athlos/integrations-email'
import type { Logger } from 'pino'

/**
 * Email channel — wraps the {@link Email} adapter with a 5s
 * per-send timeout (spec §"Synchronous Delivery"). The adapter is
 * a black box; the channel does NOT retry, does NOT queue, and
 * does NOT swallow errors. Failures bubble up to the dispatcher,
 * which catches + logs them via {@link Promise.allSettled}.
 *
 * The timeout is implemented with `Promise.race` because the
 * `Email` interface is a single `send()` call that returns a
 * Promise. The race aborts the wait but cannot cancel the
 * underlying SMTP request — that's the responsibility of the
 * adapter (e.g. `nodemailer`'s connectionTimeout knob). The
 * dispatcher's contract is "wait at most 5s for the channel",
 * not "force the channel to abort".
 */
export interface EmailChannelDeps {
  email: Email
  logger: Logger
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000

export class EmailChannel {
  private readonly email: Email
  private readonly log: Logger
  private readonly timeoutMs: number

  constructor(deps: EmailChannelDeps) {
    this.email = deps.email
    this.log = deps.logger.child({ channel: 'email' })
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Send a single email. Returns the `messageId` from the adapter
   * on success. Throws on transport failure or timeout. The
   * dispatcher wraps this call in `Promise.allSettled` and never
   * re-throws to the caller.
   */
  async send(input: {
    to: string
    subject: string
    body: string
    eventId: string
  }): Promise<{ messageId: string }> {
    const work = this.email.send({
      to: input.to,
      subject: input.subject,
      html: input.body,
      text: input.body,
    })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`SMTP_TIMEOUT after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
    })
    try {
      const result = await Promise.race([work, timeout])
      this.log.debug(
        { eventId: input.eventId, messageId: result.messageId, to: input.to },
        'email sent',
      )
      return result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
