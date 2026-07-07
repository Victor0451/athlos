import { apiFetch } from '@/lib/api'

/**
 * Attachments API wrappers (PR 8c.2 — frontend of athlos-socio-legajo).
 *
 * Read + write + delete surface for per-socio file attachments. The
 * wire DTO mirrors the backend route at
 * `apps/api/src/routes/socios-attachments.ts` (PR 8c.1, merged to
 * main at b0c034c). snake_case keys on the wire (`filename`,
 * `mime_type`, `size_bytes`, `uploaded_at`, `deleted_at`, etc.) keep
 * the TypeScript types in lock-step with the server response.
 *
 * The upload uses `multipart/form-data` — handled by the
 * `apiFetch` FormData branch added in PR 8c.2 (3-line diff at
 * `apps/web/src/lib/api.ts:111`). When `body` is a `FormData`
 * instance, the wrapper skips JSON content-type serialisation and
 * passes the FormData through so the browser sets the boundary
 * (api-design spec delta §"Request/Response Content Type").
 *
 * No role gate at the call site — the backend uses `requireAuth()`
 * only (matches `notes` semantics; any authenticated operator may
 * upload / delete).
 */

/** Wire DTO for one row in `socio_attachments` (the snake_case
 *  surface returned by every attachment endpoint). */
export interface AttachmentRow {
  id: string
  socio_id: string
  filename: string
  description: string | null
  category: AttachmentCategory
  mime_type: string
  size_bytes: number
  storage_path: string
  storage_sha256: string
  uploaded_by: string
  /** ISO-8601 timestamp. */
  uploaded_at: string
  /** ISO-8601 timestamp or null if not soft-deleted. */
  deleted_at: string | null
  deleted_by: string | null
}

/** Pinned enum (mirrors the backend `pgEnum attachment_category` per
 *  design §3). */
export type AttachmentCategory = 'dni' | 'comprobante' | 'foto' | 'contrato' | 'otro'

/** Wire shape of `GET /api/v1/socios/:socioId/attachments`. */
export interface AttachmentListResponse {
  items: AttachmentRow[]
}

/**
 * `listAttachments(socioId, opts?)` — GET
 * `/api/v1/socios/:socioId/attachments`. Returns the unwrapped
 * `items` array. The optional `?category=` filter is forwarded as a
 * query param when provided.
 */
export async function listAttachments(
  socioId: string,
  opts: { category?: AttachmentCategory } = {},
): Promise<AttachmentRow[]> {
  const res = await apiFetch<AttachmentListResponse>(`/api/v1/socios/${socioId}/attachments`, {
    query: opts.category ? { category: opts.category } : {},
  })
  return res.items ?? []
}

/**
 * `getAttachment(socioId, attachmentId)` — GET
 * `/api/v1/socios/:socioId/attachments/:attachmentId`. Returns the
 * attachment metadata (NOT the bytes — use `attachmentFileUrl` for
 * the download/stream URL). Throws `ApiError(404)` if the
 * attachment is unknown or soft-deleted.
 */
export async function getAttachment(socioId: string, attachmentId: string): Promise<AttachmentRow> {
  return apiFetch<AttachmentRow>(`/api/v1/socios/${socioId}/attachments/${attachmentId}`, {
    query: {},
  })
}

/** Options for `uploadAttachment`. */
export interface UploadAttachmentOptions {
  category: AttachmentCategory
  description?: string
}

/**
 * `uploadAttachment(socioId, file, opts)` — POST
 * `/api/v1/socios/:socioId/attachments` with `multipart/form-data`.
 *
 * Builds a `FormData` with three fields:
 *   - `file`        — the raw `File` blob
 *   - `category`    — required enum value
 *   - `description` — optional, omitted when not provided
 *
 * The `apiFetch` FormData branch (added in PR 8c.2) detects the
 * `body instanceof FormData` case and skips JSON serialisation —
 * the browser sets the multipart boundary automatically.
 *
 * Returns the freshly-created `AttachmentRow` (HTTP 201).
 */
export async function uploadAttachment(
  socioId: string,
  file: File,
  opts: UploadAttachmentOptions,
): Promise<AttachmentRow> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('category', opts.category)
  if (opts.description !== undefined) {
    formData.append('description', opts.description)
  }
  return apiFetch<AttachmentRow>(`/api/v1/socios/${socioId}/attachments`, {
    method: 'POST',
    body: formData,
  })
}

/**
 * `deleteAttachment(socioId, attachmentId)` — DELETE
 * `/api/v1/socios/:socioId/attachments/:attachmentId`. Soft delete
 * server-side; returns `void` on 204.
 */
export async function deleteAttachment(socioId: string, attachmentId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/socios/${socioId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  })
}

/**
 * `attachmentFileUrl(socioId, attachmentId)` — the URL for the
 * raw-bytes endpoint. Used directly as `<img src="…">` for image
 * thumbnails/previews and `<a href="…">` for PDF downloads.
 *
 * Server-side serves with `Content-Type: <mime>` + `Content-Disposition:
 * inline; filename="…"` so the browser either renders inline
 * (images) or triggers a download dialog (PDF).
 */
export function attachmentFileUrl(socioId: string, attachmentId: string): string {
  return `/api/v1/socios/${socioId}/attachments/${attachmentId}/file`
}
