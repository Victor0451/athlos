import puppeteer, { type Browser } from 'puppeteer'
import { Semaphore } from './semaphore.ts'

/**
 * Puppeteer wrapper for the PDF form-emit endpoint.
 *
 * Holds a singleton Chromium browser (launched once via `init()`,
 * idempotent — concurrent `init()` calls share the same promise so
 * only one launch happens per process). Each `generate(html)` call:
 *
 *   1. Acquires a slot in the semaphore (cap `maxConcurrent`, default 3)
 *   2. Opens a new page, sets the HTML, calls `page.pdf({ format: 'A4',
 *      printBackground: true })`
 *   3. Closes the page in `finally` (no leaks on errors)
 *   4. Releases the semaphore slot in `finally`
 *
 * Launch args are pinned to the triple required for Alpine-based
 * Docker (per design §6):
 *
 *   --disable-dev-shm-usage  (Docker /dev/shm is only 64 MB on Alpine)
 *   --no-sandbox             (Alpine runs as root in the container)
 *   --disable-setuid-sandbox  (paired with --no-sandbox)
 *
 * The default Chromium executable comes from `puppeteer`'s bundled
 * download. In the Docker runner the production override sets
 * `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` so the
 * system package (smaller image) is used instead of the bundled one.
 */

export interface PdfGenerator {
  init(): Promise<void>
  generate(html: string): Promise<Buffer>
  close(): Promise<void>
}

export interface CreatePdfGeneratorOptions {
  /** Maximum concurrent `page.pdf()` calls. Default 3. */
  maxConcurrent?: number
  /**
   * Puppeteer launch options. Defaults are the Alpine-friendly triple
   * pinned by design §6. Tests inject a mock browser via `launch`.
   */
  launchOptions?: Parameters<typeof puppeteer.launch>[0]
}

const DEFAULT_LAUNCH_ARGS = [
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
] as const

export function createPdfGenerator(opts: CreatePdfGeneratorOptions = {}): PdfGenerator {
  const maxConcurrent = opts.maxConcurrent ?? 3
  const semaphore = new Semaphore(maxConcurrent)
  let browser: Browser | null = null
  let initPromise: Promise<void> | null = null

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args: [...DEFAULT_LAUNCH_ARGS],
    ...opts.launchOptions,
  }

  async function init(): Promise<void> {
    if (browser) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      browser = await puppeteer.launch(launchOptions)
    })()
    return initPromise
  }

  async function generate(html: string): Promise<Buffer> {
    await init()
    if (!browser) {
      throw new Error('puppeteer browser not initialized')
    }
    return semaphore.acquire(async () => {
      const page = await browser!.newPage()
      try {
        await page.setContent(html, { waitUntil: 'networkidle0' })
        const pdf = await page.pdf({ format: 'A4', printBackground: true })
        // puppeteer types `page.pdf()` as `Promise<Buffer>` but newer
        // typings return `Uint8Array<ArrayBufferLike>`; coerce to a
        // real Buffer so callers can rely on `.byteLength` / concat.
        return Buffer.from(pdf)
      } finally {
        await page.close()
      }
    })
  }

  async function close(): Promise<void> {
    if (browser) {
      const b = browser
      browser = null
      initPromise = null
      await b.close()
    }
  }

  return { init, generate, close }
}
