import { createRealEmail, type RealEmailConfig } from './real.ts'
import { createStubEmail } from './stub.ts'
import type { Email } from './types.ts'

export type { Email } from './types.ts'
export type { RealEmailConfig } from './real.ts'
export type { StubEmail } from './stub.ts'
export { createRealEmail } from './real.ts'
export { createStubEmail } from './stub.ts'

/**
 * Build an email adapter by flavor. `real` requires SMTP config; `stub`
 * returns a fresh instance with an empty outbox.
 */
export function createEmail(opts: { type: 'real' | 'stub'; config?: RealEmailConfig }): Email {
  if (opts.type === 'real') {
    if (!opts.config) {
      throw new Error('createEmail({ type: "real" }) requires config')
    }
    return createRealEmail(opts.config)
  }
  return createStubEmail()
}
