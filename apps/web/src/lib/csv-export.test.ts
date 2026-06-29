import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CSV export tests (TASK-027, PR 8b.2).
 *
 * Covers the contract from `lib/csv-export.ts`:
 *   - `toCSV(rows, columns)` — pure function. Returns the CSV body
 *     as an RFC 4180 string. Header row + one row per item.
 *   - `downloadCSV(filename, csv)` — triggers a browser download
 *     via a Blob + hidden anchor + `.click()` + URL.revokeObjectURL.
 *
 * The `toCSV` function is exported separately so the test can
 * assert on the CSV body without simulating a DOM download. The
 * `downloadCSV` side is tested by stubbing `URL.createObjectURL` /
 * `revokeObjectURL` and capturing the anchor passed to
 * `document.body.appendChild` — that's the same anchor that
 * receives `.click()`, so we can inspect both its attributes AND
 * verify the click was triggered.
 *
 * Used by both the ctacte list (`Download as CSV` on the list of
 * cuentas) and the ctacte detail (`Download as CSV` on the
 * movements ledger). Generic over the row shape so the padron list
 * (PR 8b.3) can re-use it without duplication.
 */

const { toCSV, downloadCSV } = await import('./csv-export')

interface SampleRow {
  id: string
  socio: string
  monto: string
}

const SAMPLE_COLUMNS = [
  { key: 'id' as const, label: 'ID' },
  { key: 'socio' as const, label: 'Socio' },
  { key: 'monto' as const, label: 'Monto' },
]

const SAMPLE_ROWS: SampleRow[] = [
  { id: '1', socio: 'García, Juan', monto: '1500.00' },
  { id: '2', socio: 'Pérez, Ana', monto: '-250.50' },
]

describe('csv-export', () => {
  describe('toCSV()', () => {
    it('emits the header row from column labels', () => {
      const csv = toCSV<SampleRow>(SAMPLE_ROWS, SAMPLE_COLUMNS)
      const firstLine = csv.split('\r\n')[0]
      expect(firstLine).toBe('ID,Socio,Monto')
    })

    it('emits one CSV row per item with values in column order', () => {
      const csv = toCSV<SampleRow>(SAMPLE_ROWS, SAMPLE_COLUMNS)
      const lines = csv.split('\r\n')
      // header + 2 rows + trailing empty after final CRLF
      expect(lines[0]).toBe('ID,Socio,Monto')
      // Comma inside socio is escaped by quoting → "García, Juan"
      expect(lines[1]).toBe('1,"García, Juan",1500.00')
      expect(lines[2]).toBe('2,"Pérez, Ana",-250.50')
    })

    it('quotes values that contain commas, quotes, or newlines', () => {
      const rows: SampleRow[] = [
        { id: '1', socio: 'García, Juan', monto: '1500.00' },
        { id: '2', socio: 'O"Hara', monto: '500.00' },
        { id: '3', socio: 'Línea\nrota', monto: '0.00' },
      ]
      const csv = toCSV<SampleRow>(rows, SAMPLE_COLUMNS)
      // Comma → quoted
      expect(csv).toContain('"García, Juan"')
      // Quote → doubled + quoted
      expect(csv).toContain('"O""Hara"')
      // Newline → quoted (the row spans 2 lines when split by '\n')
      expect(csv).toContain('"Línea\nrota"')
    })

    it('returns just the header row (with trailing CRLF) when rows is empty', () => {
      const csv = toCSV<SampleRow>([], SAMPLE_COLUMNS)
      expect(csv).toBe('ID,Socio,Monto\r\n')
    })

    it('ends the body with CRLF (RFC 4180) so spreadsheet parsers do not trim the last cell', () => {
      const csv = toCSV<SampleRow>(SAMPLE_ROWS, SAMPLE_COLUMNS)
      expect(csv.endsWith('\r\n')).toBe(true)
    })
  })

  describe('downloadCSV()', () => {
    let createObjectURLMock: ReturnType<typeof vi.fn>
    let revokeObjectURLMock: ReturnType<typeof vi.fn>
    // The DOM spy types are too narrow to express via generics here
    // (vi.spyOn constrains `K` to keys of `T`), so we widen via
    // `ReturnType<typeof vi.fn>` — the captured-call assertions
    // are what matter, not the spy type itself.
    let appendChildSpy: ReturnType<typeof vi.fn>
    let removeChildSpy: ReturnType<typeof vi.fn>
    let protoClickSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      createObjectURLMock = vi.fn(() => 'blob:mock-url')
      revokeObjectURLMock = vi.fn()
      // URL.createObjectURL / revokeObjectURL are static methods on
      // the global URL. vi.stubGlobal replaces the URL constructor
      // with a plain object that exposes only what we use.
      vi.stubGlobal('URL', {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      })

      // Spy on appendChild / removeChild WITHOUT replacing the
      // implementation — we need the real DOM behavior so the
      // anchor exists in the document for `removeChild` to find it.
      // We capture the calls so we can inspect the anchor's attributes.
      appendChildSpy = vi.spyOn(document.body, 'appendChild') as unknown as ReturnType<typeof vi.fn>
      removeChildSpy = vi.spyOn(document.body, 'removeChild') as unknown as ReturnType<typeof vi.fn>
      protoClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click') as unknown as ReturnType<
        typeof vi.fn
      >
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('creates a Blob with the CSV body and the correct MIME type', () => {
      downloadCSV('test.csv', 'a,b,c\r\n1,2,3\r\n')

      expect(createObjectURLMock).toHaveBeenCalledTimes(1)
      const blob = createObjectURLMock.mock.calls[0]?.[0] as Blob
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('text/csv;charset=utf-8')
    })

    it('appends a hidden anchor with the blob URL + filename to document.body', () => {
      downloadCSV('movimientos-2026-06.csv', 'a,b\r\n1,2\r\n')

      expect(appendChildSpy).toHaveBeenCalledTimes(1)
      const anchor = appendChildSpy.mock.calls[0]?.[0] as HTMLAnchorElement
      expect(anchor.tagName).toBe('A')
      expect(anchor.href).toBe('blob:mock-url')
      expect(anchor.download).toBe('movimientos-2026-06.csv')
      // Anchor must NOT be visible in the DOM (hidden from the user).
      expect(anchor.style.display).toBe('none')
    })

    it('invokes .click() on the hidden anchor so the browser triggers the download', () => {
      downloadCSV('test.csv', 'a,b\r\n1,2\r\n')

      expect(protoClickSpy).toHaveBeenCalledTimes(1)
    })

    it('removes the anchor from document.body after the click to keep the DOM clean', () => {
      downloadCSV('test.csv', 'a,b\r\n1,2\r\n')

      expect(removeChildSpy).toHaveBeenCalledTimes(1)
      const removed = removeChildSpy.mock.calls[0]?.[0] as HTMLAnchorElement
      const appended = appendChildSpy.mock.calls[0]?.[0] as HTMLAnchorElement
      // Same node — round-trip is consistent.
      expect(removed).toBe(appended)
    })

    it('revokes the object URL after the click to free the Blob', () => {
      downloadCSV('test.csv', 'a,b\r\n1,2\r\n')

      expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
    })
  })
})
