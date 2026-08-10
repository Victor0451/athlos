import type { Email } from './types.ts'

/**
 * In-memory email stub. Every call to `send` pushes onto `outbox` so
 * tests can assert on the queue.
 */
export interface StubEmail extends Email {
  outbox: Array<{
    to: string
    subject: string
    html: string
    text: string
    context?: Record<string, string>
    sentAt: Date
  }>
  reset(): void
}

export function createStubEmail(): StubEmail {
  const outbox: StubEmail['outbox'] = []
  return {
    outbox,
    async send({ to, subject, html, text, context }) {
      outbox.push({
        to,
        subject,
        html,
        text,
        ...(context ? { context } : {}),
        sentAt: new Date(),
      })
      return { messageId: `stub-${outbox.length}` }
    },
    reset() {
      outbox.length = 0
    },
  }
}
