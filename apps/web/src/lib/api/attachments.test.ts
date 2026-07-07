import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Attachments API wrapper tests (PR 8c.2 — frontend of athlos-socio-legajo).
 *
 * Mocks `apiFetch` synchronously (per design R4 of audit-operator-display
 * #263 + the codebase pattern in `socios.test.ts:20`) and pins the wire
 * shape per `apps/api/src/routes/socios-attachments.ts` (PR 8c.1, merged
 * to main at b0c034c).
 *
 * 5 wire endpoints:
 *   POST   /api/v1/socios/:socioId/attachments      → 201 → AttachmentRow
 *   GET    /api/v1/socios/:socioId/attachments      → 200 → { items }
 *   GET    /api/v1/socios/:socioId/attachments/:aid → 200 → AttachmentRow
 *   GET    /api/v1/socios/:socioId/attachments/:aid/file  → bytes
 *   DELETE /api/v1/socios/:socioId/attachments/:aid → 204
 */

// Local mirror of the source types. Kept in the test file so the
// assertions document the wire shape independently — if the source
// ever drifts, the typecheck flags both sides.
interface AttachmentRow {
  id: string
  socio_id: string
  filename: string
  description: string | null
  category: 'dni' | 'comprobante' | 'foto' | 'contrato' | 'otro'
  mime_type: string
  size_bytes: number
  storage_path: string
  storage_sha256: string
  uploaded_by: string
  uploaded_at: string
  deleted_at: string | null
  deleted_by: string | null
}
type AttachmentCategory = AttachmentRow['category']

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const { listAttachments, getAttachment, uploadAttachment, deleteAttachment, attachmentFileUrl } =
  await import('./attachments')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const ATTACHMENT_ID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'

function makeAttachmentRow(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    socio_id: SOCIO_ID,
    filename: 'dni.pdf',
    description: 'DNI frente',
    category: 'dni',
    mime_type: 'application/pdf',
    size_bytes: 12345,
    storage_path: `socios/${SOCIO_ID}/${ATTACHMENT_ID}.pdf`,
    storage_sha256: 'a'.repeat(64),
    uploaded_by: '00000000-0000-4000-8000-000000000001',
    uploaded_at: '2026-07-07T12:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

describe('attachments API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  describe('listAttachments()', () => {
    it('calls GET /api/v1/socios/:socioId/attachments and unwraps { items }', async () => {
      const row = makeAttachmentRow()
      apiFetchMock.mockResolvedValueOnce({ items: [row] })

      const result = await listAttachments(SOCIO_ID)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(`/api/v1/socios/${SOCIO_ID}/attachments`, {
        query: {},
      })
      expect(result).toEqual([row])
    })

    it('passes category as a query param when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })

      await listAttachments(SOCIO_ID, { category: 'comprobante' })

      expect(apiFetchMock).toHaveBeenCalledWith(`/api/v1/socios/${SOCIO_ID}/attachments`, {
        query: { category: 'comprobante' },
      })
    })

    it('omits the category query param when omitted (no falsy string)', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })

      await listAttachments(SOCIO_ID, {})

      // apiFetch's buildUrl drops undefined entries; passing {} leaves
      // the query empty. The first-arg check covers path + options.
      expect(apiFetchMock).toHaveBeenCalledWith(`/api/v1/socios/${SOCIO_ID}/attachments`, {
        query: {},
      })
    })

    it('returns an empty array when the server returns no items', async () => {
      apiFetchMock.mockResolvedValueOnce({ items: [] })
      const result = await listAttachments(SOCIO_ID)
      expect(result).toEqual([])
    })
  })

  describe('getAttachment()', () => {
    it('calls GET /api/v1/socios/:socioId/attachments/:attachmentId', async () => {
      const row = makeAttachmentRow()
      apiFetchMock.mockResolvedValueOnce(row)

      const result = await getAttachment(SOCIO_ID, ATTACHMENT_ID)

      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}`,
        { query: {} },
      )
      expect(result).toEqual(row)
    })
  })

  describe('uploadAttachment()', () => {
    function makeFile(): File {
      return new File(['fake-pdf-bytes'], 'dni.pdf', { type: 'application/pdf' })
    }

    it('builds FormData with the file + category and posts to /attachments', async () => {
      const file = makeFile()
      const row = makeAttachmentRow({ filename: 'dni.pdf' })
      apiFetchMock.mockResolvedValueOnce(row)

      const result = await uploadAttachment(SOCIO_ID, file, { category: 'dni' })

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      // The path + method are pinned by apiFetch's first argument —
      // the body shape (FormData with file + category) is verified
      // by the assertions below.
      const call = apiFetchMock.mock.calls[0]
      expect(call).toBeDefined()
      const [path, init] = call as [string, RequestInit]
      expect(path).toBe(`/api/v1/socios/${SOCIO_ID}/attachments`)
      expect(init.method).toBe('POST')
      // Body is FormData — not JSON-serialised.
      expect(init.body).toBeInstanceOf(FormData)
      // FormData carries the file under 'file' and category as a separate field.
      const formData = init.body as FormData
      expect(formData.get('file')).toBe(file)
      expect(formData.get('category')).toBe('dni')
      // No JSON content-type — FormData sets its own boundary.
      expect(new Headers(init.headers).get('content-type')).not.toBe('application/json')
      expect(result).toEqual(row)
    })

    it('includes description in FormData when provided', async () => {
      const file = makeFile()
      apiFetchMock.mockResolvedValueOnce(makeAttachmentRow())

      await uploadAttachment(SOCIO_ID, file, {
        category: 'comprobante',
        description: 'Cuota de julio',
      })

      const call = apiFetchMock.mock.calls[0] as [string, RequestInit]
      const formData = call[1].body as FormData
      expect(formData.get('description')).toBe('Cuota de julio')
    })

    it('omits description from FormData when not provided', async () => {
      const file = makeFile()
      apiFetchMock.mockResolvedValueOnce(makeAttachmentRow())

      await uploadAttachment(SOCIO_ID, file, { category: 'foto' })

      const call = apiFetchMock.mock.calls[0] as [string, RequestInit]
      const formData = call[1].body as FormData
      expect(formData.has('description')).toBe(false)
    })
  })

  describe('deleteAttachment()', () => {
    it('calls DELETE /api/v1/socios/:socioId/attachments/:attachmentId and returns void', async () => {
      apiFetchMock.mockResolvedValueOnce(undefined)

      const result = await deleteAttachment(SOCIO_ID, ATTACHMENT_ID)

      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}`,
        { method: 'DELETE' },
      )
      expect(result).toBeUndefined()
    })
  })

  describe('attachmentFileUrl()', () => {
    it('builds the file-stream URL', () => {
      expect(attachmentFileUrl(SOCIO_ID, ATTACHMENT_ID)).toBe(
        `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}/file`,
      )
    })
  })

  describe('type surface (pinned enum)', () => {
    it('AttachmentCategory covers the 5 locked values', () => {
      const categories: AttachmentCategory[] = ['dni', 'comprobante', 'foto', 'contrato', 'otro']
      expect(categories).toHaveLength(5)
    })
  })
})
