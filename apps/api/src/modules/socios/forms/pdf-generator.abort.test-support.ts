export interface TestPdfPage {
  setContent(html: string, options?: unknown): Promise<void>
  pdf(options?: unknown): Promise<Buffer>
  close(): Promise<void>
  state(): { closed: boolean; closeCalls: number; setContentCalls: number; pdfCalls: number }
}

export function createPdfHarness() {
  const pages: TestPdfPage[] = []
  let held: Promise<void> | undefined
  let release: (() => void) | undefined
  const browser = {
    async newPage(): Promise<TestPdfPage> {
      let closed = false
      let closeCalls = 0
      let setContentCalls = 0
      let pdfCalls = 0
      const page: TestPdfPage = {
        async setContent() {
          setContentCalls++
        },
        async pdf() {
          pdfCalls++
          if (held) await held
          return Buffer.from('%PDF-test')
        },
        async close() {
          if (!closed) {
            closed = true
            closeCalls++
          }
        },
        state: () => ({ closed, closeCalls, setContentCalls, pdfCalls }),
      }
      pages.push(page)
      return page
    },
    async close(): Promise<void> {
      await Promise.all(pages.map((page) => page.close()))
    },
  }
  return {
    browser,
    pages,
    holdPdf() {
      held = new Promise<void>((resolve) => (release = resolve))
    },
    releasePdf() {
      release?.()
      held = undefined
      release = undefined
    },
  }
}

export function createTrackedAbortController() {
  const controller = new AbortController()
  const signal = controller.signal
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'abort') listeners.add(listener)
    add(type, listener, options)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'abort') listeners.delete(listener)
    remove(type, listener, options)
  }) as typeof signal.removeEventListener
  return {
    signal,
    abort: (reason?: unknown) => controller.abort(reason),
    listenerCount: () => listeners.size,
  }
}
