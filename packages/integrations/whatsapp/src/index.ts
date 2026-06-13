import { createRealWhatsApp, type RealWhatsAppConfig } from './real.ts'
import { createStubWhatsApp } from './stub.ts'
import type { WhatsApp } from './types.ts'

export type { WhatsApp } from './types.ts'
export type { RealWhatsAppConfig } from './real.ts'
export type { StubWhatsApp } from './stub.ts'
export { createRealWhatsApp } from './real.ts'
export { createStubWhatsApp } from './stub.ts'

/**
 * Build a WhatsApp adapter by flavor. `real` requires the production
 * API config; `stub` returns a fresh instance with an empty queue.
 *
 * The DI container passes `real` in production and `stub` in test env.
 */
export function createWhatsApp(opts: {
  type: 'real' | 'stub'
  config?: RealWhatsAppConfig
}): WhatsApp {
  if (opts.type === 'real') {
    if (!opts.config) {
      throw new Error('createWhatsApp({ type: "real" }) requires config')
    }
    return createRealWhatsApp(opts.config)
  }
  return createStubWhatsApp()
}
