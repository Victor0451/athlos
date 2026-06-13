import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  ApiError,
  BusinessError,
  ErrorCode,
  TechnicalError,
  mapZodErrors,
  redact,
  throwIfInvalid,
} from './index.ts'

describe('ApiError', () => {
  it('BusinessError maps status from the code', () => {
    const e = BusinessError(ErrorCode.NOT_FOUND, 'socio not found')
    expect(e.code).toBe(ErrorCode.NOT_FOUND)
    expect(e.statusCode).toBe(404)
    expect(e.isBusiness).toBe(true)
    expect(e.message).toBe('socio not found')
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toBeInstanceOf(Error)
  })

  it('TechnicalError always returns 500 and is not business', () => {
    const cause = new Error('db down')
    const e = TechnicalError(ErrorCode.INTERNAL_ERROR, 'oops', cause)
    expect(e.statusCode).toBe(500)
    expect(e.isBusiness).toBe(false)
    expect((e as Error & { cause?: unknown }).cause).toBe(cause)
  })

  it('passes details through to the client when present', () => {
    const e = BusinessError(ErrorCode.VALIDATION_ERROR, 'bad', [{ field: 'a', message: 'x' }])
    expect(e.details).toEqual([{ field: 'a', message: 'x' }])
  })
})

describe('status code mapping', () => {
  it('maps all spec codes to the right HTTP status', () => {
    const cases: Array<[ErrorCode, number]> = [
      [ErrorCode.VALIDATION_ERROR, 400],
      [ErrorCode.INVALID_CREDENTIALS, 401],
      [ErrorCode.TOKEN_EXPIRED, 401],
      [ErrorCode.TOKEN_INVALID, 401],
      [ErrorCode.INSUFFICIENT_PERMISSIONS, 403],
      [ErrorCode.NOT_FOUND, 404],
      [ErrorCode.CONFLICT, 409],
      [ErrorCode.APPROVAL_LINK_EXPIRED, 410],
      [ErrorCode.APPROVAL_ALREADY_USED, 410],
      [ErrorCode.ACCOUNT_LOCKED, 423],
      [ErrorCode.SERVICE_UNAVAILABLE, 503],
      [ErrorCode.INTERNAL_ERROR, 500],
    ]
    for (const [code, expected] of cases) {
      const e = BusinessError(code, 'x')
      expect(e.statusCode, `${code} → ${expected}`).toBe(expected)
    }
  })
})

describe('mapZodErrors', () => {
  it('flattens issues with the surface prefix', () => {
    const schema = z.object({ email: z.string().email() })
    const result = schema.safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
    if (result.success) return
    const body = mapZodErrors(result.error, 'body')
    const query = mapZodErrors(result.error, 'query')
    expect(body[0]?.field).toBe('body.email')
    expect(query[0]?.field).toBe('query.email')
    expect(body[0]?.message).toBeTruthy()
  })
})

describe('throwIfInvalid', () => {
  const schema = z.object({ name: z.string() })

  it('returns parsed data on success', () => {
    const out = throwIfInvalid(schema, { name: 'x' })
    expect(out).toEqual({ name: 'x' })
  })

  it('throws BusinessError(VALIDATION_ERROR) with field details', () => {
    let caught: unknown
    try {
      throwIfInvalid(schema, { name: 42 }, 'body')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    const err = caught as ApiError
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(err.statusCode).toBe(400)
    expect(Array.isArray(err.details)).toBe(true)
  })
})

describe('redact', () => {
  it('redacts default fields case-insensitively', () => {
    const input = {
      username: 'vlongo',
      Password: 'hunter2',
      AUTHORIZATION: 'Bearer x',
      nested: { dni: '123', name: 'v' },
    }
    const out = redact(input)
    expect(out).toMatchObject({
      username: 'vlongo',
      Password: '[REDACTED]',
      AUTHORIZATION: '[REDACTED]',
      nested: { dni: '[REDACTED]', name: 'v' },
    })
  })

  it('walks arrays recursively', () => {
    const out = redact([{ token: 'a' }, { token: 'b' }])
    expect(out).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }])
  })

  it('passes primitives, null, undefined through unchanged', () => {
    expect(redact('x')).toBe('x')
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
    expect(redact(42)).toBe(42)
  })

  it('accepts a custom field set', () => {
    const out = redact({ apiKey: 'k', name: 'v' }, new Set(['apikey']))
    expect(out).toEqual({ apiKey: '[REDACTED]', name: 'v' })
  })
})
