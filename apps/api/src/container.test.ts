import { describe, expect, it } from 'vitest'
import { createStubEmail } from '@athlos/integrations-email'
import { buildContainer } from './container.ts'

const requiredEnv = {
  DATABASE_URL: 'postgresql://athlos:athlos@localhost:5432/athlos_test',
  JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
  JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
  LEGACY_DB_PATH: '/tmp/athlos-test-legacy',
}

describe('buildContainer', () => {
  it.each([undefined, 'not-an-email'])(
    'rejects a missing or invalid implementation contact recipient outside tests: %s',
    (recipient) => {
      expect(() =>
        buildContainer({
          env: {
            ...requiredEnv,
            NODE_ENV: 'development',
            IMPLEMENTATION_CONTACT_RECIPIENT: recipient,
          },
        }),
      ).toThrow('IMPLEMENTATION_CONTACT_RECIPIENT')
    },
  )

  it('retains an injected stub email instance and its outbox in tests', async () => {
    const email = createStubEmail()
    const container = buildContainer({
      env: { ...requiredEnv, NODE_ENV: 'test' },
      overrides: { email },
    })

    expect(container.email).toBe(email)
    await email.send({
      to: 'ops@example.test',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
    })
    expect(email.outbox).toHaveLength(1)
    expect(email.outbox[0]?.to).toBe('ops@example.test')
  })
})
