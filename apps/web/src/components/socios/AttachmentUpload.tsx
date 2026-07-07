'use client'

import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileText, Upload } from 'lucide-react'
import {
  type AttachmentCategory,
  type AttachmentRow,
  uploadAttachment,
} from '@/lib/api/attachments'
import { notify } from '@/lib/notifications'

/**
 * AttachmentUpload — drag-and-drop + classic file picker for
 * per-socio attachments (PR 8c.2).
 *
 * UX (per locked decision in design.md §8):
 *   - Drop zone (border-accent on drag-over) + classic `<input type="file">` picker.
 *   - Client-side MIME + size validation BEFORE the API call.
 *     Inline error message on rejection (no toast — this is a
 *     synchronous UX gate, not a network error).
 *   - Category + optional description.
 *   - On success: notify('success', 'Archivo subido') + onUploadComplete()
 *     so the parent can refetch its query.
 *   - On API error: notify('error', 'No se pudo subir el archivo').
 *
 * The drop-zone visual state (`isDragOver`) toggles via `dragenter`
 * + `dragleave` events. jsdom's DragEvent support is partial — the
 * test file asserts the `drop` handler receives a file list rather
 * than dispatching full DataTransfer events.
 *
 * Drag-and-drop caveat (design R3 of critical tasks): jsdom drops
 * are partial. If a user reports drag-and-drop broken in real
 * browsers, the fallback is to wrap the drop handler with a
 * try/catch around `e.dataTransfer.files`.
 */

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]

const CATEGORY_OPTIONS: ReadonlyArray<{ value: AttachmentCategory; label: string }> = [
  { value: 'dni', label: 'DNI' },
  { value: 'comprobante', label: 'Comprobante' },
  { value: 'foto', label: 'Foto' },
  { value: 'contrato', label: 'Contrato' },
  { value: 'otro', label: 'Otro' },
]

interface AttachmentUploadProps {
  socioId: string
  /** Called after a successful upload so the parent can refetch. */
  onUploadComplete: () => void
}

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `Tipo de archivo no permitido (${file.type || 'desconocido'}). Permitidos: imágenes JPEG/PNG/WEBP/GIF y PDF.`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `El archivo supera el límite de 10 MB.`
  }
  return null
}

export function AttachmentUpload({ socioId, onUploadComplete }: AttachmentUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [category, setCategory] = useState<AttachmentCategory>('dni')
  const [description, setDescription] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const uploadMutation = useMutation({
    mutationFn: ({ file }: { file: File }) =>
      uploadAttachment(socioId, file, {
        category,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      }),
    onSuccess: (_row: AttachmentRow) => {
      notify('success', 'Archivo subido')
      setDescription('')
      setValidationError(null)
      onUploadComplete()
    },
    onError: () => {
      notify('error', 'No se pudo subir el archivo')
    },
  })

  const handleFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || files.length === 0) return
      const file = files[0]
      if (!file) return
      const error = validateFile(file)
      if (error) {
        setValidationError(error)
        return
      }
      setValidationError(null)
      uploadMutation.mutate({ file })
    },
    [uploadMutation],
  )

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files)
    // Reset so re-selecting the same file still fires onChange.
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const dt = e.dataTransfer
    handleFiles(dt ? Array.from(dt.files) : null)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    // preventDefault is required to allow the drop event.
    e.preventDefault()
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
  }

  function handlePickerClick() {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        data-testid="attachment-upload-dropzone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        role="region"
        aria-label="Zona para arrastrar y soltar archivos"
        className={`relative rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors duration-fast ${
          isDragOver
            ? 'border-accent bg-accent-soft'
            : 'border-ink-200 bg-surface-sunken/40 hover:border-ink-300'
        }`}
      >
        {isDragOver ? (
          <div data-testid="attachment-upload-dropzone-active" className="space-y-2">
            <Upload className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
            <p className="font-display text-sm font-semibold text-accent">Soltá el archivo acá</p>
          </div>
        ) : (
          <div className="space-y-2">
            <FileText className="mx-auto h-8 w-8 text-ink-300" aria-hidden="true" />
            <p className="font-display text-sm font-semibold text-ink-700">
              Arrastrá un archivo o usá el botón
            </p>
            <p className="font-body text-xs text-ink-500">
              Imágenes (JPEG, PNG, WEBP, GIF) o PDF · máximo 10 MB
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          data-testid="attachment-upload-input"
          type="file"
          accept={ALLOWED_MIME_TYPES.join(',')}
          onChange={handleInputChange}
          disabled={uploadMutation.isPending}
          className="sr-only"
        />
      </div>

      {/* Category + description + submit */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr_auto]">
        <div>
          <label
            htmlFor="attachment-upload-category"
            className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Categoría
          </label>
          <select
            id="attachment-upload-category"
            data-testid="attachment-upload-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as AttachmentCategory)}
            disabled={uploadMutation.isPending}
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="attachment-upload-description"
            className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500"
          >
            Descripción (opcional)
          </label>
          <input
            id="attachment-upload-description"
            data-testid="attachment-upload-description"
            type="text"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={uploadMutation.isPending}
            placeholder="Ej: DNI frente y dorso"
            className="mt-1 block w-full rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            data-testid="attachment-upload-picker-button"
            onClick={handlePickerClick}
            disabled={uploadMutation.isPending}
            className="inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {uploadMutation.isPending ? 'Subiendo…' : 'Elegir archivo'}
          </button>
        </div>
      </div>

      {/* Inline error (client-side validation OR API error). API
          errors additionally fire a toast — this block is the
          always-visible, always-near-the-control feedback. */}
      {validationError ? (
        <p
          role="alert"
          data-testid="attachment-upload-error"
          className="rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-xs text-danger"
        >
          {validationError}
        </p>
      ) : null}
      {uploadMutation.isError ? (
        <p
          role="alert"
          data-testid="attachment-upload-error"
          className="rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-xs text-danger"
        >
          {uploadMutation.error instanceof Error
            ? uploadMutation.error.message
            : 'No se pudo subir el archivo.'}
        </p>
      ) : null}
    </div>
  )
}
