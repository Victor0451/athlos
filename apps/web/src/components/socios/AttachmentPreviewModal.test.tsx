import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * AttachmentPreviewModal tests (PR 8c.2 — frontend of athlos-socio-legajo).
 *
 * Pins the contract per design.md §8:
 *   - Renders nothing when `attachment === null`.
 *   - Reuses the project's `<Modal size="2xl">` primitive.
 *   - Image: inline `<img>` of the file URL.
 *   - PDF: download `<a download>` link (no inline PDF preview in v1 —
 *     per locked decision, the PDF preview experience is "icon +
 *     download", deferring inline first-page thumbnail).
 *   - Close button fires `onClose`.
 */

vi.mock('@/lib/api/attachments', () => ({
  attachmentFileUrl: (socioId: string, attachmentId: string) =>
    `/api/v1/socios/${socioId}/attachments/${attachmentId}/file`,
  uploadAttachment: vi.fn(),
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))

const { AttachmentPreviewModal } = await import('./AttachmentPreviewModal')

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

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const ATTACHMENT_ID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'

function makeRow(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: ATTACHMENT_ID,
    socio_id: SOCIO_ID,
    filename: 'dni.pdf',
    description: 'DNI frente',
    category: 'dni',
    mime_type: 'application/pdf',
    size_bytes: 4096,
    storage_path: `socios/${SOCIO_ID}/${ATTACHMENT_ID}.pdf`,
    storage_sha256: 'a'.repeat(64),
    uploaded_by: '00000000-0000-4000-8000-000000000001',
    uploaded_at: '2026-07-07T12:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

describe('AttachmentPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when attachment is null', () => {
    const { container } = render(<AttachmentPreviewModal attachment={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a full-size <img> for image MIME types', () => {
    const row = makeRow({ filename: 'foto.jpg', mime_type: 'image/jpeg' })
    render(<AttachmentPreviewModal attachment={row} onClose={() => {}} />)

    const img = screen.getByTestId(`preview-modal-img-${ATTACHMENT_ID}`) as HTMLImageElement
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe(
      `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}/file`,
    )
  })

  it('renders a download <a> for PDF MIME types (no inline preview)', () => {
    const row = makeRow({ filename: 'comprobante.pdf', mime_type: 'application/pdf' })
    render(<AttachmentPreviewModal attachment={row} onClose={() => {}} />)

    const link = screen.getByTestId(`preview-modal-pdf-link-${ATTACHMENT_ID}`) as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(
      `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}/file`,
    )
    expect(link.getAttribute('download')).toBe('comprobante.pdf')
  })

  it('shows the filename + category badge in the modal title area', () => {
    const row = makeRow({ filename: 'dni.pdf', mime_type: 'application/pdf', category: 'dni' })
    render(<AttachmentPreviewModal attachment={row} onClose={() => {}} />)

    expect(screen.getByTestId(`preview-modal-filename-${ATTACHMENT_ID}`)).toHaveTextContent(
      'dni.pdf',
    )
    expect(screen.getByTestId(`preview-modal-category-${ATTACHMENT_ID}`)).toHaveTextContent('DNI')
  })

  it('fires onClose when the modal close button is clicked', () => {
    const onClose = vi.fn()
    const row = makeRow()
    render(<AttachmentPreviewModal attachment={row} onClose={onClose} />)

    fireEvent.click(screen.getByTestId(`preview-modal-close-${ATTACHMENT_ID}`))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows description when provided', () => {
    const row = makeRow({ description: 'Cuota de julio 2026' })
    render(<AttachmentPreviewModal attachment={row} onClose={() => {}} />)
    expect(screen.getByTestId(`preview-modal-description-${ATTACHMENT_ID}`)).toHaveTextContent(
      'Cuota de julio 2026',
    )
  })
})
