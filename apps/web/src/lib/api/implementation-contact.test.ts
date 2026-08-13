import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { submitImplementationInquiry } from './implementation-contact'

const fetchMock = vi.fn()
const inquiry = { name: 'A', organization: 'C', role: 'R', email: 'a@b.c', primaryProblem: 'P' }
const response = (status: number, body: unknown) => ({ ok: true, status, json: async () => body })

describe('submitImplementationInquiry', () => {
  beforeEach(() => (fetchMock.mockReset(), vi.stubGlobal('fetch', fetchMock)))
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a received 202 response instead of treating it as sent', async () => {
    fetchMock.mockResolvedValue(response(202, { status: 'received' }))

    await expect(submitImplementationInquiry(inquiry)).rejects.toThrow('Inquiry unavailable')
  })

  it('accepts a sent 200 response', async () => {
    fetchMock.mockResolvedValue(response(200, { status: 'sent' }))

    await expect(submitImplementationInquiry(inquiry)).resolves.toEqual({ status: 'sent' })
  })
})
