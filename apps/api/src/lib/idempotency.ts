import { createHash } from 'node:crypto'

const MAX_IDEMPOTENCY_KEY_LENGTH = 128

export function validateIdempotencyKey(key: string | undefined): key is string {
  return Boolean(key && key.trim() && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH)
}

export function canonicalizeIdempotencyPayload(payload: unknown): string {
  return JSON.stringify(sortPayload(payload))
}

export function createIdempotencyFingerprint(
  command: string,
  endpoint: string,
  payload: unknown,
): string {
  return createSha256Fingerprint(
    canonicalizeIdempotencyParts([command, endpoint, canonicalizeIdempotencyPayload(payload)]),
  )
}

export function createSha256Fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalizeIdempotencyParts(parts: readonly string[]): string {
  return parts.join('|')
}

function sortPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortPayload(child)]),
    )
  }
  return value
}
