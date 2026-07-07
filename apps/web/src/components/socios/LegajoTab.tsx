'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { deleteAttachment, listAttachments, type AttachmentRow } from '@/lib/api/attachments'
import { AttachmentUpload } from './AttachmentUpload'
import { AttachmentCard } from './AttachmentCard'
import { AttachmentPreviewModal } from './AttachmentPreviewModal'
import { notify } from '@/lib/notifications'

/**
 * LegajoTab — per-socio attachments grid (PR 8c.2 — frontend of
 * athlos-socio-legajo).
 *
 * Mirrors the `AuditTab` shape: TanStack `useQuery` reads the
 * attachment list, renders the upload region + a grid of
 * `<AttachmentCard>` rows (or an inline empty state), and manages
 * the preview modal state locally.
 *
 * Data flow:
 *   - `attachmentsQuery` reads `/api/v1/socios/:id/attachments` via
 *     the client wrapper. Cache key `['socio-attachments', socioId]`
 *     so the upload mutation can invalidate it on success.
 *   - `deleteMutation` calls `deleteAttachment()` + invalidates the
 *     same query on success. The confirm step uses `window.confirm()`
 *     (per `SocioNotesCard.tsx:348` precedent — simple, no new
 *     primitive needed for v1).
 *   - Preview modal state is local — the parent only needs to mount
 *     this tab inside the existing tab panel.
 *
 * The empty state matches `audit-tab-empty` (Pin icon + heading +
 * body-sm) so the operator gets a consistent "nothing here yet"
 * surface across tabs.
 *
 * Toasts (via `notify()` from `athlos-toast-primitivo`) fire on
 * upload/delete success/error.
 */

export const SOCIO_ATTACHMENTS_QUERY_KEY = (socioId: string) =>
  ['socio-attachments', socioId] as const

interface LegajoTabProps {
  socioId: string
}

export function LegajoTab({ socioId }: LegajoTabProps) {
  const queryClient = useQueryClient()
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null)

  const attachmentsQuery = useQuery({
    queryKey: SOCIO_ATTACHMENTS_QUERY_KEY(socioId),
    queryFn: () => listAttachments(socioId, {}),
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(socioId, attachmentId),
    onSuccess: () => {
      notify('success', 'Archivo eliminado')
      queryClient.invalidateQueries({ queryKey: ['socio-attachments', socioId] })
      queryClient.invalidateQueries({ queryKey: ['socio-audit', socioId] })
    },
    onError: () => {
      notify('error', 'No se pudo eliminar el archivo')
    },
  })

  function handleDeleteClick(attachment: AttachmentRow) {
    const confirmed = window.confirm(
      `¿Eliminar el archivo "${attachment.filename}"? La acción queda registrada en la auditoría.`,
    )
    if (!confirmed) return
    deleteMutation.mutate(attachment.id)
  }

  function handleUploadComplete() {
    // AttachmentUpload's onSuccess already calls notify + invalidates
    // via the queryClient ref; this callback is a safety net for the
    // case where a caller bypasses the mutation (none today, but
    // documented for the future API).
    queryClient.invalidateQueries({ queryKey: ['socio-attachments', socioId] })
  }

  if (attachmentsQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="legajo-tab-loading"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-lg border border-ink-100 bg-surface-elevated"
          />
        ))}
        <span className="sr-only">Cargando archivos…</span>
      </div>
    )
  }

  if (attachmentsQuery.isError) {
    return (
      <div
        role="alert"
        data-testid="legajo-tab-error"
        className="rounded-md border border-danger bg-danger/10 px-4 py-3 font-body text-sm text-danger"
      >
        No pudimos cargar los archivos del socio.{' '}
        {attachmentsQuery.error instanceof Error ? `(${attachmentsQuery.error.message})` : ''}
      </div>
    )
  }

  const attachments = attachmentsQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Upload region — always visible so the operator can add files
          regardless of whether the list is empty or populated. */}
      <AttachmentUpload socioId={socioId} onUploadComplete={handleUploadComplete} />

      {/* Grid + empty state */}
      {attachments.length === 0 ? (
        <div
          data-testid="legajo-tab-empty"
          className="rounded-md border border-dashed border-ink-200 px-4 py-12 text-center"
        >
          <Pin className="mx-auto mb-3 h-8 w-8 text-ink-300" aria-hidden="true" />
          <p className="font-display text-sm font-semibold text-ink-700">Sin archivos</p>
          <p className="mt-1 font-body text-xs text-ink-500">
            Subí el primer archivo para empezar el legajo del socio.
          </p>
        </div>
      ) : (
        <div
          data-testid="legajo-tab-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onPreview={() => setPreviewAttachment(attachment)}
              onDelete={() => handleDeleteClick(attachment)}
            />
          ))}
        </div>
      )}

      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  )
}
