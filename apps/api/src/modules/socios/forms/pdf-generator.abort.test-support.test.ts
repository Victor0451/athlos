import { describe, expect, it } from 'vitest'
import {
  createPdfHarness,
  createTrackedAbortController,
} from './pdf-generator.abort.test-support.ts'
describe('PDF abort test support', () => {
  it('exposes page cleanup and controlled render settlement', async () => {
    const harness = createPdfHarness()
    harness.holdPdf()
    const page = await harness.browser.newPage()
    const render = page.pdf()
    await Promise.resolve()
    expect(page.state().pdfCalls).toBe(1)
    harness.releasePdf()
    await expect(render).resolves.toEqual(Buffer.from('%PDF-test'))
    await page.close()
    await page.close()
    expect(page.state()).toMatchObject({ closed: true, closeCalls: 1 })
  })
  it('tracks abort listener cleanup without shared state', () => {
    const first = createTrackedAbortController()
    const second = createTrackedAbortController()
    const listener = () => undefined
    first.signal.addEventListener('abort', listener)
    expect([first.listenerCount(), second.listenerCount()]).toEqual([1, 0])
    first.signal.removeEventListener('abort', listener)
    expect(first.listenerCount()).toBe(0)
  })
})
