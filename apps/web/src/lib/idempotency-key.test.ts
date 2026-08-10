import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOpaqueIdempotencyKey } from './idempotency-key'

describe('generateOpaqueIdempotencyKey', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses secure random bytes when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    const key = generateOpaqueIdempotencyKey()

    expect(key).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('still returns a bounded opaque key when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)

    const key = generateOpaqueIdempotencyKey()

    expect(key).toMatch(/^[a-z0-9]+-[a-z0-9]{28}$/)
    expect(key.length).toBeLessThanOrEqual(128)
  })
})
