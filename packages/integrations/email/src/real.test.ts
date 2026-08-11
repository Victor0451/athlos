import { describe, expect, it, vi } from 'vitest'
import { createRealEmail } from './real.ts'

const config = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  auth: { user: 'mailer', pass: 'secret' },
  from: 'noreply@example.test',
}

describe('createRealEmail', () => {
  it('returns only the message ID acknowledged by the SMTP transport', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: 'smtp-ack-123' }) }
    const email = createRealEmail({ ...config, transport })

    await expect(
      email.send({
        to: 'ops@example.test',
        subject: 'Implementation inquiry',
        html: '<p>Inquiry</p>',
        text: 'Inquiry',
        context: { eventId: 'evt-1' },
      }),
    ).resolves.toEqual({ messageId: 'smtp-ack-123' })
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: config.from,
      to: 'ops@example.test',
      subject: 'Implementation inquiry',
      html: '<p>Inquiry</p>',
      text: 'Inquiry',
    })
  })

  it.each([{ messageId: 'pending-real-123' }, { messageId: '' }, {}])(
    'rejects a fabricated or absent SMTP acknowledgement: %o',
    async (result) => {
      const email = createRealEmail({
        ...config,
        transport: { sendMail: vi.fn().mockResolvedValue(result) },
      })

      await expect(
        email.send({
          to: 'ops@example.test',
          subject: 'Subject',
          html: '<p>Body</p>',
          text: 'Body',
        }),
      ).rejects.toThrow('SMTP acknowledgement')
    },
  )

  it('rejects when SMTP does not acknowledge before the configured timeout', async () => {
    const email = createRealEmail({
      ...config,
      timeoutMs: 10,
      transport: { sendMail: vi.fn().mockImplementation(() => new Promise(() => undefined)) },
    })

    await expect(
      email.send({ to: 'ops@example.test', subject: 'Subject', html: '<p>Body</p>', text: 'Body' }),
    ).rejects.toThrow('SMTP_TIMEOUT')
  })
})
