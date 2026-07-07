'use client'

import { FileText, Trash2 } from 'lucide-react'
import { attachmentFileUrl, type AttachmentRow } from '@/lib/api/attachments'
import { Badge } from '@/components/ui/Badge'

/**
 * AttachmentCard — single row in the Legajo tab grid (PR 8c.2).
 *
 * Pure presentation. The parent (`LegajoTab`) owns the data flow +
 * preview modal state; this component just renders one attachment
 * and fires the two callbacks (`onPreview` for body click,
 * `onDelete` for the trash icon).
 *
 * Visual rules (per design.md §8):
 *   - Image MIMEs: `<img src={attachmentFileUrl(...)} loading="lazy">` thumbnail.
 *   - PDF MIMEs: Lucide `FileText` icon + filename. (PDF preview
 *     lives in `AttachmentPreviewModal` per locked decision —
 *     no inline first-page thumbnail in v1.)
 *   - Each card carries: filename + category badge + description (if
 *     any) + uploader + date + size.
 *
 * The card body is a button-like region (cursor-pointer + role +
 * tabIndex) so keyboard users can `Enter`/`Space` to preview.
 */

const CATEGORY_LABEL: Record<AttachmentRow['category'], string> = {
  dni: 'DNI',
  comprobante: 'Comprobante',
  foto: 'Foto',
  contrato: 'Contrato',
  otro: 'Otro',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

interface AttachmentCardProps {
  attachment: AttachmentRow
  onPreview: () => void
  onDelete: () => void
}

export function AttachmentCard({ attachment, onPreview, onDelete }: AttachmentCardProps) {
  const isImage = attachment.mime_type.startsWith('image/')
  const isPdf = attachment.mime_type === 'application/pdf'
  const fileUrl = attachmentFileUrl(attachment.socio_id, attachment.id)

  return (
    <div
      data-testid={`attachment-card-${attachment.id}`}
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPreview()
        }
      }}
      aria-label={`Adjunto ${attachment.filename}`}
      className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border border-ink-100 bg-surface-elevated p-4 transition-colors duration-fast hover:border-accent/50 hover:bg-surface"
    >
      {/* Thumbnail / icon region */}
      <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-md bg-surface-sunken">
        {isImage ? (
          <img
            data-testid={`attachment-card-img-${attachment.id}`}
            src={fileUrl}
            alt={`Vista previa de ${attachment.filename}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : isPdf ? (
          <div
            data-testid={`attachment-card-pdf-icon-${attachment.id}`}
            className="flex flex-col items-center gap-1 text-ink-500"
          >
            <FileText className="h-12 w-12" aria-hidden="true" />
            <span className="font-display text-[10px] font-semibold uppercase tracking-widest">
              PDF
            </span>
          </div>
        ) : (
          <FileText className="h-12 w-12 text-ink-500" aria-hidden="true" />
        )}

        {/* Delete button — absolute top-right, hidden until hover. */}
        <button
          type="button"
          data-testid={`attachment-card-delete-${attachment.id}`}
          aria-label={`Eliminar ${attachment.filename}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface/90 text-ink-500 opacity-0 transition-opacity duration-fast hover:bg-danger hover:text-white focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Metadata */}
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p
            data-testid={`attachment-card-filename-${attachment.id}`}
            className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-ink-900"
          >
            {attachment.filename}
          </p>
          <Badge
            dataTestid={`attachment-card-category-${attachment.id}`}
            variant="default"
            className="shrink-0"
          >
            {CATEGORY_LABEL[attachment.category]}
          </Badge>
        </div>

        {attachment.description ? (
          <p
            data-testid={`attachment-card-description-${attachment.id}`}
            className="font-body text-xs text-ink-500 line-clamp-2"
          >
            {attachment.description}
          </p>
        ) : null}

        <div className="flex items-center justify-between font-body text-[11px] text-ink-500">
          <span data-testid={`attachment-card-date-${attachment.id}`}>
            {formatDate(attachment.uploaded_at)}
          </span>
          <span data-testid={`attachment-card-size-${attachment.id}`}>
            {formatSize(attachment.size_bytes)}
          </span>
        </div>
      </div>
    </div>
  )
}
