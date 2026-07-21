import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from 'puppeteer'
import { createPdfGenerator } from './pdf-generator.ts'
import { createTrackedAbortController } from './pdf-generator.abort.test-support.ts'

/**
 * `createPdfGenerator` — puppeteer wrapper + semaphore.
 *
 * Mocks the puppeteer module so the tests run without a real Chromium
 * binary. Asserts:
 *
 *   - `puppeteer.launch()` is called with the Alpine-friendly triple
 *     (`--disable-dev-shm-usage`, `--no-sandbox`, `--disable-setuid-sandbox`)
 *   - `init()` is idempotent (one launch per process)
 *   - `setContent(html, { waitUntil: 'networkidle0' })` and
 *     `page.pdf({ format: 'A4', printBackground: true })` are called
 *   - `page.close()` runs in `finally` even when pdf throws
 *   - 4 concurrent `generate()` calls cap at 3 + queue the 4th
 */

interface MockPage {
  setContent: ReturnType<typeof vi.fn>
  pdf: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

interface MockBrowser {
  newPage: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

let pages: MockPage[]
let browserInstance: MockBrowser

vi.mock('puppeteer', () => {
  return {
    default: {
      launch: vi.fn(async () => {
        return browserInstance
      }),
    },
  }
})

beforeEach(() => {
  pages = []
  browserInstance = {
    newPage: vi.fn(async () => {
      const page: MockPage = {
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(async () => Buffer.from('%PDF-1.7 mock')),
        close: vi.fn(async () => undefined),
      }
      pages.push(page)
      return page as unknown as Page
    }),
    close: vi.fn(async () => undefined),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createPdfGenerator — launch', () => {
  it('launches puppeteer with the Alpine-friendly arg triple on init', async () => {
    const gen = createPdfGenerator()
    await gen.init()
    const puppeteer = await import('puppeteer')
    expect(puppeteer.default.launch).toHaveBeenCalledTimes(1)
    const args = (puppeteer.default.launch as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .args as string[]
    expect(args).toContain('--disable-dev-shm-usage')
    expect(args).toContain('--no-sandbox')
    expect(args).toContain('--disable-setuid-sandbox')
    await gen.close()
  })

  it('init() is idempotent: calling twice still launches only once', async () => {
    const gen = createPdfGenerator()
    await Promise.all([gen.init(), gen.init(), gen.init()])
    const puppeteer = await import('puppeteer')
    expect(puppeteer.default.launch).toHaveBeenCalledTimes(1)
    await gen.close()
  })

  it('close() shuts down the browser and clears state', async () => {
    const gen = createPdfGenerator()
    await gen.init()
    await gen.close()
    expect(browserInstance.close).toHaveBeenCalledTimes(1)
    // After close, the next generate re-launches.
    const pdf = await gen.generate('<html></html>')
    expect(pdf.subarray(0, 8).toString('utf8')).toBe('%PDF-1.7')
    await gen.close()
  })
})

describe('createPdfGenerator — generate', () => {
  it('opens a page, sets content, renders to A4 PDF, closes the page', async () => {
    const gen = createPdfGenerator()
    const pdf = await gen.generate('<html><body>x</body></html>')
    expect(pages).toHaveLength(1)
    expect(pages[0]!.setContent).toHaveBeenCalledWith('<html><body>x</body></html>', {
      waitUntil: 'networkidle0',
    })
    expect(pages[0]!.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true })
    expect(pages[0]!.close).toHaveBeenCalledTimes(1)
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 8).toString('utf8')).toBe('%PDF-1.7')
    await gen.close()
  })

  it('closes the page in finally even when page.pdf throws', async () => {
    const gen = createPdfGenerator()
    pages = [] // discard the default page factory
    browserInstance.newPage = vi.fn(async () => {
      const page: MockPage = {
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(async () => {
          throw new Error('pdf exploded')
        }),
        close: vi.fn(async () => undefined),
      }
      pages.push(page)
      return page as unknown as Page
    })
    await expect(gen.generate('<html></html>')).rejects.toThrow(/pdf exploded/)
    expect(pages[0]!.close).toHaveBeenCalledTimes(1)
    await gen.close()
  })

  it('caps concurrent generate() at maxConcurrent=3 and queues the 4th', async () => {
    const gen = createPdfGenerator({ maxConcurrent: 3 })
    let inFlight = 0
    let peak = 0
    let releaseFirstThree: (() => void) | null = null
    const firstThreeStarted = new Promise<void>((res) => {
      releaseFirstThree = res
    })
    // Custom pdf mock that blocks the first 3 calls until we say go.
    browserInstance.newPage = vi.fn(async () => {
      const blocked = pages.length < 3
      const page: MockPage = {
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(async () => {
          inFlight++
          peak = Math.max(peak, inFlight)
          if (blocked) {
            await firstThreeStarted
          }
          inFlight--
          return Buffer.from('%PDF-1.7 blocked')
        }),
        close: vi.fn(async () => undefined),
      }
      pages.push(page)
      return page as unknown as Page
    })
    const tasks = [0, 1, 2, 3].map((i) => gen.generate(`<html>${i}</html>`))
    // Yield so the first 3 tasks reach `pdf()` and block.
    await new Promise((r) => setTimeout(r, 30))
    expect(peak).toBe(3)
    // Now release the first 3.
    releaseFirstThree!()
    const results = await Promise.all(tasks)
    expect(results).toHaveLength(4)
    expect(peak).toBe(3)
    await gen.close()
  })

  it('rejects an aborted waiter before it opens a page and releases the slot for the next render', async () => {
    const gen = createPdfGenerator({ maxConcurrent: 1 })
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    browserInstance.newPage = vi.fn(async () => {
      const page: MockPage = {
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(async () => {
          if (pages.length === 1) await held
          return Buffer.from('%PDF-1.7')
        }),
        close: vi.fn(async () => undefined),
      }
      pages.push(page)
      return page as unknown as Page
    })
    const first = gen.generate('first')
    await vi.waitFor(() => expect(pages).toHaveLength(1))
    const controller = new AbortController()
    const queued = gen.generate('queued', { signal: controller.signal })
    controller.abort()
    release()
    await first
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(pages).toHaveLength(1)
    await expect(gen.generate('after')).resolves.toBeInstanceOf(Buffer)
    await gen.close()
  })

  it('closes the page and removes its listener when aborted during setContent', async () => {
    const gen = createPdfGenerator()
    const controller = createTrackedAbortController()
    let rejectContent!: (reason: unknown) => void
    browserInstance.newPage = vi.fn(async () => {
      const page: MockPage = {
        setContent: vi.fn(() => new Promise((_resolve, reject) => (rejectContent = reject))),
        pdf: vi.fn(),
        close: vi.fn(async () => rejectContent(new Error('page closed'))),
      }
      pages.push(page)
      return page as unknown as Page
    })
    const rendering = gen.generate('abort-content', { signal: controller.signal })
    await vi.waitFor(() => expect(pages[0]?.setContent).toHaveBeenCalledOnce())
    controller.abort()
    await expect(rendering).rejects.toMatchObject({ name: 'AbortError' })
    expect(pages[0]!.close).toHaveBeenCalledOnce()
    expect(controller.listenerCount()).toBe(0)
    await gen.close()
  })

  it('closes the page exactly once when aborted during pdf and observes the late rejection', async () => {
    const gen = createPdfGenerator()
    const controller = new AbortController()
    let rejectPdf!: (reason: unknown) => void
    browserInstance.newPage = vi.fn(async () => {
      const page: MockPage = {
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(() => new Promise((_resolve, reject) => (rejectPdf = reject))),
        close: vi.fn(async () => rejectPdf(new Error('page closed'))),
      }
      pages.push(page)
      return page as unknown as Page
    })
    const rendering = gen.generate('abort-me', { signal: controller.signal })
    await vi.waitFor(() => expect(pages[0]?.pdf).toHaveBeenCalledOnce())
    controller.abort()
    await expect(rendering).rejects.toMatchObject({ name: 'AbortError' })
    expect(pages[0]!.close).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await gen.close()
  })
})
