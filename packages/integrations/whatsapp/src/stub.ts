import type { WhatsApp } from './types.ts'

/**
 * In-memory WhatsApp stub. Every call to `sendMessage` appends to
 * `messages` so tests can assert on the queue without scraping logs.
 *
 * Tests MUST access `stub.messages` (not a global) — each instance owns
 * its own array. Wire via `createWhatsApp({ type: 'stub' })` in the DI
 * container or directly with `createStubWhatsApp()` for unit tests.
 */
export interface StubWhatsApp extends WhatsApp {
  messages: Array<{ phone: string; text: string; sentAt: Date }>
  reset(): void
}

export function createStubWhatsApp(): StubWhatsApp {
  const messages: Array<{ phone: string; text: string; sentAt: Date }> = []
  return {
    messages,
    async sendMessage({ phone, text }) {
      messages.push({ phone, text, sentAt: new Date() })
      return { messageId: `stub-${messages.length}` }
    },
    reset() {
      messages.length = 0
    },
  }
}
