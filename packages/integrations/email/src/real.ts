import nodemailer from 'nodemailer'
import type { Email } from './types.ts'

/**
 * Real SMTP transport. The actual `nodemailer.createTransport(...)` call
 * is stubbed at the integration point — wiring lives in PR 6b alongside
 * the dispatcher.
 *
 * Config comes from `packages/config` env (PR 3a) — host, port, secure,
 * auth.user, auth.pass, from.
 */
export interface RealEmailConfig {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  from: string
  timeoutMs?: number
  transport?: Pick<nodemailer.Transporter, 'sendMail'>
}

const SMTP_TIMEOUT_MS = 5_000

export function createRealEmail(config: RealEmailConfig): Email {
  const timeoutMs = config.timeoutMs ?? SMTP_TIMEOUT_MS
  const transport =
    config.transport ??
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    })

  return {
    async send({ to, subject, html, text }) {
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SMTP_TIMEOUT after ${timeoutMs}ms`)), timeoutMs)
      })
      try {
        const result = await Promise.race([
          transport.sendMail({ from: config.from, to, subject, html, text }),
          timeout,
        ])
        if (!result.messageId || result.messageId.startsWith('pending-real-')) {
          throw new Error('SMTP acknowledgement did not include a valid messageId')
        }
        return { messageId: result.messageId }
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
  }
}
