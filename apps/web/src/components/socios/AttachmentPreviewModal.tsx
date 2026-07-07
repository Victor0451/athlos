'use client'

import { Download, FileText, X } from 'lucide-react'
import { attachmentFileUrl, type AttachmentRow } from '@/lib/api/attachments'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

/**
 * AttachmentPreviewModal — full-size preview / download surface for
 * the Legajo tab (PR 8c.2).
 *
 * Renders the project's `<Modal size="2xl">` primitive. The body
 * branches on the attachment's MIME type:
 *   - Image: inline `<img>` of the file URL (full-size).
 *   - PDF:   download `<a download>` link (no inline PDF preview in
 *            v1 — per locked decision, the PDF preview experience
 *            is "icon + download", deferring inline first-page
 *            thumbnail).
 *
 * The parent (`LegajoTab`) owns the open/close state and passes
 * `attachment: null` when the modal should be hidden. When
 * `attachment === null`, the modal renders nothing.
 *
 * The Modal primitive owns its layout (sticky header + scrollable
 * body + sticky footer) and accessibility (`role="dialog"` +
 * `aria-modal`); we just feed it the right title + body content.
 */

const CATEGORY_LABEL: Record<AttachmentRow['category'], string> = {
  dni: 'DNI',
  comprobante: 'Comprobante',
  foto: 'Foto',
  contrato: 'Contrato',
  otro: 'Otro',
}

interface AttachmentPreviewModalProps {
  attachment: AttachmentRow | null
  onClose: () => void
}

export function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  if (!attachment) return null

  const fileUrl = attachmentFileUrl(attachment.socio_id, attachment.id)
  const isImage = attachment.mime_type.startsWith('image/')
  const isPdf = attachment.mime_type === 'application/pdf'

  return (
    <Modal
      open={true}
      size="2xl"
      dataTestid={`preview-modal-${attachment.id}`}
      title={
        <span className="flex items-center gap-2">
          <span data-testid={`preview-modal-filename-${attachment.id}`}>{attachment.filename}</span>
          <Badge dataTestid={`preview-modal-category-${attachment.id}`} variant="default">
            {CATEGORY_LABEL[attachment.category]}
          </Badge>
        </span>
      }
      footer={
        <button
          type="button"
          data-testid={`preview-modal-close-${attachment.id}`}
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Cerrar
        </button>
      }
    >
      <div className="space-y-4">
        {attachment.description ? (
          <p
            data-testid={`preview-modal-description-${attachment.id}`}
            className="rounded-md border border-ink-100 bg-surface-sunken/40 px-3 py-2 font-body text-sm text-ink-500"
          >
            {attachment.description}
          </p>
        ) : null}

        {isImage ? (
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md bg-surface-sunken">
            <img
              data-testid={`preview-modal-img-${attachment.id}`}
              src={fileUrl}
              alt={attachment.filename}
              className="max-h-[70vh] max-w-full object-contain"
            />
          </div>
        ) : isPdf ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-ink-200 bg-surface-sunken/40 px-6 py-12 text-center">
            <FileText className="h-16 w-16 text-ink-500" aria-hidden="true" />
            <p className="font-display text-sm font-semibold text-ink-700">
              Vista previa no disponible para PDF
            </p>
            <p className="max-w-md font-body text-xs text-ink-500">
              La previsualización inline de PDF queda fuera del alcance de v1. Descargá el archivo
              para abrirlo localmente.
            </p>
            <a
              data-testid={`preview-modal-pdf-link-${attachment.id}`}
              href={fileUrl}
              download={attachment.filename}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Descargar {attachment.filename}
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-md border border-dashed border-ink-200 bg-surface-sunken/40 px-6 py-12">
            <FileText className="h-12 w-12 text-ink-500" aria-hidden="true" />
          </div>
        )}
      </div>
    </Modal>
  )
}
