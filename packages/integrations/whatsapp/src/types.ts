/**
 * WhatsApp integration contract. The legacy Dbf adapter and the
 * approval-link service both call `sendMessage`; the dispatcher
 * service is the only other expected consumer.
 *
 * `phone` is the international E.164 number (`+5491100000000`).
 * `text` is the body — approval-link bodies and balance reminders
 * are plain text, no media support in v1.
 */
export interface WhatsApp {
  sendMessage(input: { phone: string; text: string }): Promise<{ messageId: string }>
}
