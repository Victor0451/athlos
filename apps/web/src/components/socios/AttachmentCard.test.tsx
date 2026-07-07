import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * AttachmentCard tests (PR 8c.2 — frontend of athlos-socio-legajo).
 *
 * Pins the rendering rules per design.md §8:
 *   - Image MIME → `<img src={attachmentFileUrl(...)} loading="lazy">` thumbnail.
 *   - PDF MIME → Lucide `FileText` icon + filename + (no inline preview here).
 *   - Click on the card body fires `onPreview`. Delete button fires `onDelete`.
 *   - Renders category `<Badge>` + filename + uploader + date + size.
 */

vi.mock('@/lib/api/attachments', () => ({
  attachmentFileUrl: (socioId: string, attachmentId: string) =>
    `/api/v1/socios/${socioId}/attachments/${attachmentId}/file`,
  uploadAttachment: vi.fn(),
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))

const { AttachmentCard } = await import('./AttachmentCard')

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
    description: null,
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

describe('AttachmentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('image attachments', () => {
    it('renders an <img> thumbnail with loading="lazy" for image MIMEs', () => {
      const row = makeRow({
        filename: 'foto.jpg',
        mime_type: 'image/jpeg',
        category: 'foto',
      })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)

      const img = screen.getByTestId(`attachment-card-img-${ATTACHMENT_ID}`) as HTMLImageElement
      expect(img.tagName).toBe('IMG')
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('src')).toBe(
        `/api/v1/socios/${SOCIO_ID}/attachments/${ATTACHMENT_ID}/file`,
      )
      expect(img.getAttribute('alt')).toContain('foto.jpg')
    })

    it('renders the category badge with the human label', () => {
      const row = makeRow({ category: 'comprobante' })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)
      expect(screen.getByTestId(`attachment-card-category-${ATTACHMENT_ID}`)).toHaveTextContent(
        'Comprobante',
      )
    })

    it('renders the description when provided', () => {
      const row = makeRow({ description: 'DNI frente y dorso' })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)
      expect(screen.getByTestId(`attachment-card-description-${ATTACHMENT_ID}`)).toHaveTextContent(
        'DNI frente y dorso',
      )
    })

    it('omits the description element when description is null', () => {
      const row = makeRow({ description: null })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)
      expect(
        screen.queryByTestId(`attachment-card-description-${ATTACHMENT_ID}`),
      ).not.toBeInTheDocument()
    })
  })

  describe('PDF attachments', () => {
    it('renders a FileText icon (NOT an <img>) for PDF MIMEs', () => {
      const row = makeRow({ mime_type: 'application/pdf', category: 'dni' })
      const { container } = render(
        <AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />,
      )
      // No <img> for PDFs (the locked design says icon + filename).
      expect(
        container.querySelector(`[data-testid="attachment-card-img-${ATTACHMENT_ID}"]`),
      ).toBeNull()
      expect(screen.getByTestId(`attachment-card-pdf-icon-${ATTACHMENT_ID}`)).toBeInTheDocument()
    })

    it('renders the filename as the PDF label', () => {
      const row = makeRow({ filename: 'comprobante-2026-07.pdf', mime_type: 'application/pdf' })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)
      expect(screen.getByTestId(`attachment-card-filename-${ATTACHMENT_ID}`)).toHaveTextContent(
        'comprobante-2026-07.pdf',
      )
    })
  })

  describe('interactions', () => {
    it('fires onPreview when the card body is clicked', () => {
      const onPreview = vi.fn()
      const row = makeRow()
      render(<AttachmentCard attachment={row} onPreview={onPreview} onDelete={() => {}} />)

      fireEvent.click(screen.getByTestId(`attachment-card-${ATTACHMENT_ID}`))
      expect(onPreview).toHaveBeenCalledTimes(1)
    })

    it('fires onDelete (not onPreview) when the delete button is clicked', () => {
      const onPreview = vi.fn()
      const onDelete = vi.fn()
      const row = makeRow()
      render(<AttachmentCard attachment={row} onPreview={onPreview} onDelete={onDelete} />)

      fireEvent.click(screen.getByTestId(`attachment-card-delete-${ATTACHMENT_ID}`))
      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onPreview).not.toHaveBeenCalled()
    })
  })

  describe('metadata row', () => {
    it('renders uploader + date + size in human-readable form', () => {
      const row = makeRow({
        size_bytes: 1024 * 1024 + 200 * 1024, // 1.2 MB
      })
      render(<AttachmentCard attachment={row} onPreview={() => {}} onDelete={() => {}} />)
      // The exact date format is locale-dependent; assert via the
      // testid presence + a partial match (year always present).
      expect(screen.getByTestId(`attachment-card-date-${ATTACHMENT_ID}`)).toHaveTextContent(/2026/)
      expect(screen.getByTestId(`attachment-card-size-${ATTACHMENT_ID}`)).toHaveTextContent(/MB|KB/)
    })
  })
})
