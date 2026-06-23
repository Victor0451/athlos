import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as dotenv from 'dotenv'

vi.mock('dotenv')

describe('loadEnv', () => {
  const originalNodeEnv = process.env['NODE_ENV']

  beforeEach(() => {
    delete process.env['NODE_ENV']
    vi.mocked(dotenv.config).mockClear()
  })

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv
    vi.resetModules()
  })

  it('does NOT load dotenv when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production'
    const { loadEnv } = await import('../src/env')
    loadEnv()
    expect(dotenv.config).not.toHaveBeenCalled()
  })

  it('loads dotenv when NODE_ENV=development', async () => {
    process.env['NODE_ENV'] = 'development'
    const { loadEnv } = await import('../src/env')
    loadEnv()
    expect(dotenv.config).toHaveBeenCalledTimes(1)
  })

  it('loads dotenv when NODE_ENV is unset', async () => {
    delete process.env['NODE_ENV']
    const { loadEnv } = await import('../src/env')
    loadEnv()
    expect(dotenv.config).toHaveBeenCalledTimes(1)
  })

  it('loads dotenv when NODE_ENV=test', async () => {
    process.env['NODE_ENV'] = 'test'
    const { loadEnv } = await import('../src/env')
    loadEnv()
    expect(dotenv.config).toHaveBeenCalledTimes(1)
  })
})
