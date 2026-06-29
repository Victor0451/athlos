/**
 * CSV export utility (TASK-027, PR 8b.2).
 *
 * Two pure functions:
 *   - `toCSV(rows, columns)` — builds an RFC 4180 CSV string from
 *     a typed list of rows + a column definition. Pure (no DOM,
 *     no I/O) so it's trivially testable in isolation.
 *   - `downloadCSV(filename, csv)` — wires the CSV string to a
 *     hidden anchor + `.click()` + `URL.revokeObjectURL` cleanup
 *     so the browser triggers a download.
 *
 * Used by the ctacte list + detail pages (PR 8b.2) and will be
 * re-used by the padron list (PR 8b.3). The function is generic
 * over `T` so any caller can describe their own column shape.
 *
 * RFC 4180 quoting rules (per `https://www.rfc-editor.org/rfc/rfc4180`):
 *   - Fields containing commas, double quotes, or line breaks MUST
 *     be enclosed in double quotes
 *   - Embedded double quotes are escaped by doubling: `He said ""hi""`
 *   - Records are separated by CRLF
 */

export interface CsvColumn<T> {
  /** Stable column key — the property of `T` to read. */
  key: keyof T
  /** Human-readable header text for the first row. */
  label: string
}

/** Characters that force a field to be quoted in the CSV output. */
const NEEDS_QUOTE = /[",\r\n]/

/**
 * `toCSV(rows, columns)` — builds the CSV body string.
 *
 * Returns `'<header1>,<header2>,...\r\n<row1>\r\n<row2>...'` with
 * RFC 4180 quoting + CRLF separators. Empty `rows` returns just
 * the header line (still terminated with CRLF so downstream
 * parsers don't trip on a trailing empty record).
 */
export function toCSV<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const lines: string[] = [header]
  for (const row of rows) {
    const fields = columns.map((c) => {
      const raw = row[c.key]
      return escapeCell(raw == null ? '' : String(raw))
    })
    lines.push(fields.join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * Internal: escape a single CSV cell. Wraps the value in double
 * quotes when it contains a comma, double quote, or line break;
 * doubles any embedded double quotes per RFC 4180 §2.7.
 */
function escapeCell(value: string): string {
  if (!NEEDS_QUOTE.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * `downloadCSV(filename, csv)` — triggers a browser download of
 * the CSV body. Browser-only (uses `URL.createObjectURL` and a
 * hidden anchor `.click()`); does nothing useful in Node tests
 * unless those globals are stubbed.
 *
 * The anchor is appended to `document.body`, clicked, then removed
 * + the blob URL revoked — this avoids leaking the Blob into
 * memory and keeps the DOM clean (no visible flash of the link).
 */
export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
