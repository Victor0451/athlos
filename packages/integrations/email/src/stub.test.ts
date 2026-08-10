import { describe, expect, it } from 'vitest'
import { createStubEmail } from './stub.ts'

describe('createStubEmail', () => {
  it('records each message in the injected instance-owned outbox', async () => {
    const stub = createStubEmail()

    await stub.send({
      to: 'ops@example.test',
      subject: 'Implementation inquiry',
      html: '<p>Inquiry</p>',
      text: 'Inquiry',
      context: { eventId: 'evt-1' },
    })

    expect(stub.outbox).toEqual([
      {
        to: 'ops@example.test',
        subject: 'Implementation inquiry',
        html: '<p>Inquiry</p>',
        text: 'Inquiry',
        context: { eventId: 'evt-1' },
        sentAt: expect.any(Date),
      },
    ])
  })

  it('keeps outboxes isolated between stub instances', async () => {
    const first = createStubEmail()
    const second = createStubEmail()

    await first.send({ to: 'first@example.test', subject: 'One', html: 'One', text: 'One' })

    expect(first.outbox).toHaveLength(1)
    expect(second.outbox).toEqual([])
  })
})
