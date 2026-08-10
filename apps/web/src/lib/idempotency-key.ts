/** Generate an opaque key without requiring `crypto.randomUUID()` support. */
export function generateOpaqueIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto

  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Some browsers expose randomUUID but reject it outside secure contexts.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6]! & 0x0f) | 0x40
      bytes[8] = (bytes[8]! & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    } catch {
      // Fall through if the browser's secure random source is unavailable.
    }
  }

  // Last-resort uniqueness for restricted webviews that expose no Web Crypto API.
  const random = Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x1_0000_0000))
    .map((value) => value.toString(36).padStart(7, '0'))
    .join('')
  return `${Date.now().toString(36)}-${random}`
}
