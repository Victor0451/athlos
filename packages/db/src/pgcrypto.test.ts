import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { ensurePgcrypto } from './pgcrypto.ts'

function makePool(createExtension: () => Promise<unknown>, extension = { rowCount: 1 }) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockImplementationOnce(createExtension)
      .mockResolvedValueOnce(extension)
      .mockResolvedValueOnce({}),
  } as unknown as Pick<Pool, 'query'>
}

describe('ensurePgcrypto', () => {
  it('accepts a concurrent creation only after pgcrypto is present', async () => {
    const pool = makePool(() => Promise.reject({ code: '23505' }))

    await expect(ensurePgcrypto(pool)).resolves.toBeUndefined()
    expect(pool.query).toHaveBeenCalledWith("SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'")
  })

  it('propagates errors other than the concurrent extension conflict', async () => {
    const error = { code: '42501' }
    const pool = makePool(() => Promise.reject(error))

    await expect(ensurePgcrypto(pool)).rejects.toBe(error)
  })

  it('rejects a concurrent conflict when pgcrypto is still absent', async () => {
    const pool = makePool(() => Promise.reject({ code: '23505' }), { rowCount: 0 })

    await expect(ensurePgcrypto(pool)).rejects.toThrow('pgcrypto extension was not installed')
  })
})
