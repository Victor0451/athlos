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
}

export function createRealEmail(_config: RealEmailConfig): Email {
  return {
    async send({ to, subject }) {
      // Integration point: nodemailer transport.sendMail({ from, to, subject, html, text })
      return { messageId: `pending-real-${Date.now()}-${to}-${subject}` }
    },
  }
}
