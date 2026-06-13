import type { WhatsApp } from './types.ts'

/**
 * WhatsApp Business Cloud API client (https://graph.facebook.com/v18.0/<phone_id>/messages).
 * The base URL, phone-number ID, and access token come from env at boot.
 *
 * The actual HTTP call is intentionally left as a stub: the test infra
 * (PR 10a) only needs the contract + an integration-point for the API
 * to live in. The real call lands in PR 6b (notifications dispatcher)
 * alongside the retry/backoff policy and the per-operator opt-out check.
 */
export interface RealWhatsAppConfig {
  apiBaseUrl: string
  phoneNumberId: string
  accessToken: string
}

export function createRealWhatsApp(_config: RealWhatsAppConfig): WhatsApp {
  return {
    async sendMessage({ phone, text: _text }) {
      // Integration point: POST to `${apiBaseUrl}/${phoneNumberId}/messages`
      // with `{ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }`.
      // Headers: `Authorization: Bearer ${accessToken}`.
      return { messageId: `pending-real-${Date.now()}-${phone}` }
    },
  }
}
