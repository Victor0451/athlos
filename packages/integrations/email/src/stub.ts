import type { Email } from './types.ts'

/**
 * In-memory email stub. Every call to `send` pushes onto `outbox` so
 * tests can assert on the queue.
 */
export interface StubEmail extends Email {
  outbox: Array<{ to: string; subject: string; html: string; text: string; sentAt: Date }>
  reset(): void
}

export function createStubEmail(): StubEmail {
  const outbox: Array<{ to: string; subject: string; html: string; text: string; sentAt: Date }> =
    []
  return {
    outbox,
    async send({ to, subject, html, text }) {
      outbox.push({ to, subject, html, text, sentAt: new Date() })
      return { messageId: `stub-${outbox.length}` }
    },
    reset() {
      outbox.length = 0
    },
  }
}
