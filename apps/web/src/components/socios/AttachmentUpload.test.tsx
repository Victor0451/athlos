import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * AttachmentUpload tests (PR 8c.2 — frontend of athlos-socio-legajo).
 *
 * Pins the locked UX contract per design.md §8:
 *   - Drag-and-drop zone + classic file picker both supported.
 *   - Client-side MIME + size validation BEFORE the API call.
 *   - On success: notify('success', 'Archivo subido') + onUploadComplete.
 *   - On error: notify('error', 'No se pudo subir el archivo').
 *   - 10 MB cap (mirrors the backend `STORAGE_MAX_FILE_SIZE_BYTES`).
 *
 * Drag-and-drop caveat (design R3 of critical tasks): jsdom's
 * DragEvent support is partial — we assert on the `onFiles`
 * callback via a synthetic file drop rather than dispatching full
 * DragEvents. The picker path uses real `<input type="file">` change
 * events which DO round-trip through jsdom.
 */

const uploadAttachmentMock = vi.fn()
const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock-1')

vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

vi.mock('@/lib/api/attachments', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  attachmentFileUrl: vi.fn(),
}))

const { AttachmentUpload } = await import('./AttachmentUpload')

const SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeFile(name: string, type: string, sizeBytes: number): File {
  // jsdom doesn't fully model File.size — pad with a Uint8Array so
  // the File.size reflects our intent.
  const buf = new Uint8Array(sizeBytes)
  return new File([buf], name, { type })
}

function renderUpload(onUploadComplete = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return {
    onUploadComplete,
    ...render(
      <QueryClientProvider client={client}>
        <AttachmentUpload socioId={SOCIO_ID} onUploadComplete={onUploadComplete} />
      </QueryClientProvider>,
    ),
  }
}

describe('AttachmentUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyMock.mockReturnValue('toast-mock-1')
  })

  describe('rendering', () => {
    it('renders the drop zone + file picker', async () => {
      renderUpload()
      expect(screen.getByTestId('attachment-upload-dropzone')).toBeInTheDocument()
      expect(screen.getByTestId('attachment-upload-picker-button')).toBeInTheDocument()
    })

    it('renders the category selector with the 5 locked values', async () => {
      renderUpload()
      const select = screen.getByTestId('attachment-upload-category') as HTMLSelectElement
      const opts = Array.from(select.querySelectorAll('option')).map((o) => o.value)
      expect(opts).toEqual(['dni', 'comprobante', 'foto', 'contrato', 'otro'])
    })

    it('renders the description input as optional', async () => {
      renderUpload()
      const input = screen.getByTestId('attachment-upload-description') as HTMLInputElement
      expect(input.tagName).toBe('INPUT')
      // No required attribute — description is optional.
      expect(input.required).toBe(false)
    })
  })

  describe('client-side validation', () => {
    it('rejects disallowed MIME types WITHOUT calling the API', async () => {
      renderUpload()
      // Force the file into the picker via the hidden <input>.
      const file = makeFile('virus.exe', 'application/x-msdownload', 1024)
      const input = screen.getByTestId('attachment-upload-input') as HTMLInputElement
      // jsdom: setting .files via Object.defineProperty
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)

      await waitFor(() => {
        expect(screen.getByTestId('attachment-upload-error')).toHaveTextContent(/tipo/i)
      })
      expect(uploadAttachmentMock).not.toHaveBeenCalled()
      // No toast on client-side validation — only inline error.
      expect(notifyMock).not.toHaveBeenCalled()
    })

    it('rejects files larger than 10 MB WITHOUT calling the API', async () => {
      renderUpload()
      // 10 MB + 1 byte. Use a small real allocation — we only need
      // File.size to be set, jsdom reads it via the underlying File.
      const file = makeFile('huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)
      const input = screen.getByTestId('attachment-upload-input') as HTMLInputElement
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)

      await waitFor(() => {
        expect(screen.getByTestId('attachment-upload-error')).toHaveTextContent(/10\s*MB/i)
      })
      expect(uploadAttachmentMock).not.toHaveBeenCalled()
      expect(notifyMock).not.toHaveBeenCalled()
    })
  })

  describe('file picker', () => {
    it('uploads the picked file + category + description on change', async () => {
      const onUploadComplete = vi.fn()
      uploadAttachmentMock.mockResolvedValueOnce({ id: 'a-1' })
      renderUpload(onUploadComplete)

      // Set description + category.
      fireEvent.change(screen.getByTestId('attachment-upload-description'), {
        target: { value: 'DNI frente' },
      })
      const categorySelect = screen.getByTestId('attachment-upload-category') as HTMLSelectElement
      fireEvent.change(categorySelect, { target: { value: 'dni' } })

      // Pick a valid file via the hidden input.
      const file = makeFile('dni.pdf', 'application/pdf', 4096)
      const input = screen.getByTestId('attachment-upload-input') as HTMLInputElement
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)

      await waitFor(() => {
        expect(uploadAttachmentMock).toHaveBeenCalledWith(
          SOCIO_ID,
          file,
          expect.objectContaining({ category: 'dni', description: 'DNI frente' }),
        )
      })
      await waitFor(() => {
        expect(notifyMock).toHaveBeenCalledWith('success', 'Archivo subido')
      })
      await waitFor(() => {
        expect(onUploadComplete).toHaveBeenCalledTimes(1)
      })
    })

    it('fires error toast on upload failure', async () => {
      uploadAttachmentMock.mockRejectedValueOnce(new Error('QUOTA_EXCEEDED'))
      renderUpload()

      const file = makeFile('dni.pdf', 'application/pdf', 4096)
      const input = screen.getByTestId('attachment-upload-input') as HTMLInputElement
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)

      await waitFor(() => {
        expect(notifyMock).toHaveBeenCalledWith('error', 'No se pudo subir el archivo')
      })
    })
  })

  describe('drag-and-drop', () => {
    it('processes a file dropped on the dropzone', async () => {
      const onUploadComplete = vi.fn()
      uploadAttachmentMock.mockResolvedValueOnce({ id: 'a-2' })
      renderUpload(onUploadComplete)

      const file = makeFile('foto.jpg', 'image/jpeg', 8192)
      const dropzone = screen.getByTestId('attachment-upload-dropzone')

      // Simulate a drop event with a DataTransfer containing the file.
      // jsdom doesn't fully wire DataTransfer, but our handler reads
      // .files off the event's dataTransfer — we mock that.
      const dataTransfer = { files: [file] }
      fireEvent.drop(dropzone, { dataTransfer })

      await waitFor(() => {
        expect(uploadAttachmentMock).toHaveBeenCalledWith(
          SOCIO_ID,
          file,
          expect.objectContaining({ category: 'dni' }),
        )
      })
      await waitFor(() => {
        expect(notifyMock).toHaveBeenCalledWith('success', 'Archivo subido')
      })
      expect(onUploadComplete).toHaveBeenCalled()
    })

    it('toggles the dragover visual state via dragenter / dragleave', async () => {
      renderUpload()
      const dropzone = screen.getByTestId('attachment-upload-dropzone')

      // Initial: not in drag-over state (assert via testid on
      // a child element that only renders in drag-over).
      expect(screen.queryByTestId('attachment-upload-dropzone-active')).not.toBeInTheDocument()

      fireEvent.dragEnter(dropzone, { dataTransfer: { files: [] } })
      await waitFor(() => {
        expect(screen.getByTestId('attachment-upload-dropzone-active')).toBeInTheDocument()
      })

      fireEvent.dragLeave(dropzone, { dataTransfer: { files: [] } })
      await waitFor(() => {
        expect(screen.queryByTestId('attachment-upload-dropzone-active')).not.toBeInTheDocument()
      })
    })
  })
})
