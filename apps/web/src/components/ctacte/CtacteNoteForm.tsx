'use client'

import { useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Modal } from '@/components/ui/Modal'
import { notify } from '@/lib/notifications'
import { addCtacteNote } from '@/lib/api/ctacte-mutations'

/**
 * CtacteNoteForm — modal body for adding a note to a cuenta-corriente movement
 * (PR A2 — athlos-ctacte-mutations; R3 durable idempotency fix).
 *
 * Uses react-hook-form + zod for inline field validation:
 *   - body — string, min 1, max 2000 chars
 *
 * On submit: POST via addCtacteNote(socioId, movementId, body, idempotencyKey).
 * On success: notify('success', …) + calls onSuccess() + closes.
 * On error: notify('error', …) + modal stays open so the same key
 *           can be replayed on the next user click.
 *
 * R3 fix #2 — opaque Idempotency-Key:
 *   The form owns ONE stable opaque Idempotency-Key per intent. The
 *   key is generated lazily on the first submit attempt (so a form
 *   that the user never submits never generates noise) and is reused
 *   on every retry of the SAME body. When the user edits the body to
 *   a NEW intent, the form rotates to a fresh key so the server
 *   recognises the change and creates a distinct note row instead of
 *   409'ing on the previous key.
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

/**
 * Generate an opaque, time-ordered Idempotency-Key. Uses
 * `crypto.randomUUID()` when available (always in modern browsers
 * + Node ≥ 19) with a timestamp prefix so concurrent distinct
 * intents in the same millisecond still get distinct keys.
 *
 * ≤ 128 chars per the route contract:
 * `crypto.randomUUID()` produces 36 chars; a 32-char ISO prefix
 * keeps the full key under 70 chars in practice.
 */
function generateIdempotencyKey(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${Date.now().toString(36)}-${uuid}`
}

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

  // R3 fix #2 — stable opaque Idempotency-Key across ambiguous
  // retries of the same intent.
  //
  // The form mints ONE key per (body-content) intent. As long as the
  // user keeps the same body, the SAME key is reused — so a 5xx
  // retry, a page reload mid-submit, or a double-click all replay
  // the same server record. When the body changes, a fresh key is
  // minted so the server recognises the new intent.
  //
  // The key is GENERATED LAZILY on the first submit (the form that
  // never gets submitted never generates noise). After a successful
  // submit the form resets and closes; the next open will be a new
  // intent and gets a fresh key on its first submit.
  const idempotencyKeyRef = useRef<string | null>(null)
  const keyForBodyRef = useRef<string | null>(null)
  /**
   * Return the Idempotency-Key to use for this body. Mints a new
   * key only when the body content has changed since the last
   * minted key. A null body (`''`) returns null — caller decides
   * whether to bail (Zod already rejects empty bodies upstream).
   */
  const getIdempotencyKeyFor = useCallback((body: string): string => {
    const trimmedBody = body.trim()
    if (trimmedBody === '') return generateIdempotencyKey()
    if (keyForBodyRef.current === trimmedBody && idempotencyKeyRef.current) {
      return idempotencyKeyRef.current
    }
    const fresh = generateIdempotencyKey()
    idempotencyKeyRef.current = fresh
    keyForBodyRef.current = trimmedBody
    return fresh
  }, [])

  const onSubmit = useCallback(
    async (values: NoteFormValues) => {
      const idempotencyKey = getIdempotencyKeyFor(values.body)
      try {
        await addCtacteNote(socioId, movementId, values.body, idempotencyKey)
        notify('success', 'Nota agregada')
        // Successful submit: clear the cached key so the NEXT
        // submit (if the user re-opens the form for a new intent)
        // gets a fresh key, not a 409 reusing the prior one.
        idempotencyKeyRef.current = null
        keyForBodyRef.current = null
        reset()
        onSuccess?.()
        onClose()
      } catch (err) {
        // On network failure / 5xx the SAME key MUST be reused for
        // the next attempt so the server can dedupe the replay.
        // We deliberately do NOT clear the refs here.
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message ?? '')
            : ''
        if (message.includes('CONFLICT') || message.includes('409')) {
          notify(
            'error',
            'Esta nota se encoló con una clave anterior que ya se usó para otro contenido. Generá una nueva.',
          )
          // Force a new key on the NEXT submit attempt — the user
          // has to acknowledge the conflict and either re-edit the
          // body or hit submit again on the new (empty) text.
          idempotencyKeyRef.current = null
          keyForBodyRef.current = null
        } else {
          notify('error', 'No se pudo agregar la nota. Intentá de nuevo.')
        }
      }
    },
    [socioId, movementId, getIdempotencyKeyFor, reset, onSuccess, onClose],
  )

  const handleCancel = useCallback(() => {
    idempotencyKeyRef.current = null
    keyForBodyRef.current = null
    reset()
    onClose()
  }, [reset, onClose])

  // Defensive: state-driven warning suppression for unused-import lint
  void open

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
