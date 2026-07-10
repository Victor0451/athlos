'use client'

import { useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '@/components/ui/Modal'
import { notify } from '@/lib/notifications'
import { addCtacteNote } from '@/lib/api/ctacte-mutations'

/**
 * CtacteNoteForm — modal body for adding a note to a cuenta-corriente movement
 * (PR A2 — athlos-ctacte-mutations).
 *
 * Uses react-hook-form + zod for inline field validation:
 *   - body — string, min 1, max 2000 chars
 *
 * On submit: POST via addCtacteNote(socioId, movementId, body).
 * On success: notify('success', …) + calls onSuccess() + closes.
 * On error: notify('error', …) + modal stays open.
 *
 * No role gate — any authenticated operator may add a note.
 */

const noteSchema = z.object({
  body: z
    .string()
    .min(1, 'La nota no puede estar vacía')
    .max(2000, 'La nota no puede superar los 2000 caracteres'),
})

type NoteFormValues = z.infer<typeof noteSchema>

const NOTE_MAX_LENGTH = 2000

interface CtacteNoteFormProps {
  open: boolean
  socioId: string
  movementId: string
  onSuccess?: () => void
  onClose: () => void
}

export function CtacteNoteForm({
  open,
  socioId,
  movementId,
  onSuccess,
  onClose,
}: CtacteNoteFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { body: '' },
    mode: 'onSubmit',
  })

  const onSubmit = useCallback(
    async (values: NoteFormValues) => {
      try {
        await addCtacteNote(socioId, movementId, values.body)
        notify('success', 'Nota agregada')
        reset()
        onSuccess?.()
        onClose()
      } catch {
        notify('error', 'No se pudo agregar la nota. Intentá de nuevo.')
      }
    },
    [socioId, movementId, reset, onSuccess, onClose],
  )

  const handleCancel = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  return (
    <Modal
      open={open}
      title="Agregar Nota"
      dataTestid="ctacte-note-modal"
      footer={
        <>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-[10px] border border-ink-200 bg-surface px-4 py-2 font-display text-sm font-semibold text-ink-700 transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="ctacte-note-form"
            disabled={isSubmitting}
            className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando…' : 'Guardar nota'}
          </button>
        </>
      }
    >
      <form
        id="ctacte-note-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="note-body" className="sr-only">
            Cuerpo de la nota
          </label>
          <textarea
            id="note-body"
            rows={5}
            maxLength={NOTE_MAX_LENGTH}
            placeholder="Escribí una nota sobre este movimiento…"
            aria-invalid={Boolean(errors.body) || undefined}
            aria-describedby={errors.body ? 'note-body-error' : 'note-body-hint'}
            {...register('body')}
            className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-900 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
          />
          {errors.body ? (
            <p id="note-body-error" role="alert" className="text-sm text-danger">
              {errors.body.message}
            </p>
          ) : (
            <p id="note-body-hint" className="text-xs text-ink-500">
              Máx. {NOTE_MAX_LENGTH} caracteres
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
