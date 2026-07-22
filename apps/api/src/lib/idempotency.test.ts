import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeIdempotencyPayload,
  createIdempotencyFingerprint,
  validateIdempotencyKey,
} from './idempotency.ts'

describe('idempotency primitives', () => {
  it('canonicalizes equivalent payloads and produces a stable SHA-256 fingerprint', () => {
    const firstPayload = { account: 'principal', range: { to: '2026-07-31', from: '2026-07-01' } }
    const reorderedPayload = {
      range: { from: '2026-07-01', to: '2026-07-31' },
      account: 'principal',
    }
    const expectedCanonicalPayload =
      '{"account":"principal","range":{"from":"2026-07-01","to":"2026-07-31"}}'
    const expectedFingerprint = createHash('sha256')
      .update(`create|/api/v1/padrones/inscripciones|${expectedCanonicalPayload}`)
      .digest('hex')

    expect(canonicalizeIdempotencyPayload(firstPayload)).toBe(expectedCanonicalPayload)
    expect(canonicalizeIdempotencyPayload(reorderedPayload)).toBe(expectedCanonicalPayload)
    expect(
      createIdempotencyFingerprint('create', '/api/v1/padrones/inscripciones', firstPayload),
    ).toBe(expectedFingerprint)
    expect(
      createIdempotencyFingerprint('create', '/api/v1/padrones/inscripciones', reorderedPayload),
    ).toBe(expectedFingerprint)
  })

  it('isolates command and endpoint while distinguishing changed payloads', () => {
    const payload = { estado: 'activa' }
    const fingerprint = createIdempotencyFingerprint('create', '/padrones/1', payload)

    expect(createIdempotencyFingerprint('baja', '/padrones/1', payload)).not.toBe(fingerprint)
    expect(createIdempotencyFingerprint('create', '/padrones/2', payload)).not.toBe(fingerprint)
    expect(createIdempotencyFingerprint('create', '/padrones/1', { estado: 'baja' })).not.toBe(
      fingerprint,
    )
  })

  it('accepts only non-blank keys within the one to 128 character boundary', () => {
    expect(validateIdempotencyKey('a')).toBe(true)
    expect(validateIdempotencyKey('a'.repeat(128))).toBe(true)
    expect(validateIdempotencyKey(undefined)).toBe(false)
    expect(validateIdempotencyKey('')).toBe(false)
    expect(validateIdempotencyKey('   ')).toBe(false)
    expect(validateIdempotencyKey('a'.repeat(129))).toBe(false)
  })
})
