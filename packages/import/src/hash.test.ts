import { describe, expect, it } from 'vitest'
import { computeHash } from './hash.ts'

/**
 * computeHash is the import pipeline's idempotency key. The tests
 * pin the canonicalization rules so a future refactor cannot
 * silently change what counts as "the same record".
 */
describe('computeHash', () => {
  it('produces a 64-char hex SHA-256 digest', () => {
    const h = computeHash({ a: 1 })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across property insertion order', () => {
    const a = computeHash({ a: 1, b: 2, c: 3 })
    const b = computeHash({ c: 3, a: 1, b: 2 })
    const c = computeHash({ b: 2, c: 3, a: 1 })
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('is stable across nested property insertion order', () => {
    const a = computeHash({ outer: { x: 1, y: 2 }, tag: 'v1' })
    const b = computeHash({ tag: 'v1', outer: { y: 2, x: 1 } })
    expect(a).toBe(b)
  })

  it('drops the derived legacyKey field', () => {
    const a = computeHash({ a: 1, legacyKey: 'X' })
    const b = computeHash({ a: 1, legacyKey: 'Y' })
    const c = computeHash({ a: 1 })
    expect(a).toBe(c)
    expect(b).toBe(c)
  })

  it('treats null and undefined as the same', () => {
    const a = computeHash({ a: 1, b: null })
    const b = computeHash({ a: 1, b: undefined })
    const c = computeHash({ a: 1 })
    expect(a).toBe(c)
    expect(b).toBe(c)
  })

  it('normalizes Date to ISO string', () => {
    const iso = '2024-06-12T10:30:00.000Z'
    const a = computeHash({ when: new Date(iso) })
    const b = computeHash({ when: iso })
    expect(a).toBe(b)
  })

  it('preserves array order (the pipeline relies on this for ctacte lines)', () => {
    const a = computeHash({ items: [1, 2, 3] })
    const b = computeHash({ items: [3, 2, 1] })
    expect(a).not.toBe(b)
  })

  it('returns a different hash when any field changes', () => {
    const a = computeHash({ a: 1, b: 2 })
    const b = computeHash({ a: 1, b: 3 })
    expect(a).not.toBe(b)
  })

  it('hashes an empty record to a known value (snapshot)', () => {
    // Pinned so the hash function is auditable: a future change to
    // canonicalization that affects the empty case would surface
    // here without forcing a full table re-import.
    expect(computeHash({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })
})
