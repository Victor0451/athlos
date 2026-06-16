import type { WhatsApp } from '@athlos/integrations-whatsapp'
import type { Logger } from 'pino'

/**
 * WhatsApp channel — out-of-band (OOB) delivery for approval
 * links only. Per the spec §"Channel Types", the `whatsapp`
 * channel MUST NOT be resolved for non-approval events; the
 * dispatcher enforces this in `resolveChannels()`.
 *
 * Like the email channel, the call is wrapped in a 5s
 * `Promise.race` timeout. The WhatsApp adapter does not expose
 * a `signal` argument, so the timeout is a wait, not an abort.
 */
export interface WhatsAppChannelDeps {
  whatsapp: WhatsApp
  logger: Logger
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000

export class WhatsAppChannel {
  private readonly whatsapp: WhatsApp
  private readonly log: Logger
  private readonly timeoutMs: number

  constructor(deps: WhatsAppChannelDeps) {
    this.whatsapp = deps.whatsapp
    this.log = deps.logger.child({ channel: 'whatsapp' })
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async send(input: {
    phone: string
    body: string
    eventId: string
  }): Promise<{ messageId: string }> {
    const work = this.whatsapp.sendMessage({ phone: input.phone, text: input.body })
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`WHATSAPP_TIMEOUT after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
    })
    try {
      const result = await Promise.race([work, timeout])
      this.log.debug(
        { eventId: input.eventId, messageId: result.messageId, phone: input.phone },
        'whatsapp sent',
      )
      return result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
