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
 * (PR A2 — athlos-ctacte-mutations; R3 durable idempotency fix + R3 fix batch).
 *
 * Uses react-hook-form + zod for inline field validation:
 *   - body — string, min 1, max 2000 chars
 *
 * On submit: POST via addCtacteNote(socioId, movementId, body, idempotencyKey).
 * On success: notify('success', …) + calls onSuccess() + closes.
 * On error: notify('error', …) + modal stays open so the same key
 *           can be replayed on the next user click.
 *
 * R3 fix batch — opaque Idempotency-Key + reload safety:
 *   The form owns ONE stable opaque Idempotency-Key per intent. The
 *   key is generated lazily on the first submit attempt (so a form
 *   that the user never submits never generates noise) and is reused
 *   on every retry of the SAME body. When the user edits the body to
 *   a NEW intent, the form rotates to a fresh key so the server
 *   recognises the change and creates a distinct note row instead of
 *   409'ing on the previous key.
 *
 *   Reload safety (defect #3): the key is PERSISTED in localStorage
 *   under `ctacte-note-idem:<socioId>:<movementId>` whenever a key
 *   is minted. The cache entry stores the body-hash alongside the
 *   key, so a remounted form for the same socio + movement + body
 *   pair reuses the EXACT SAME key. A different body triggers a
 *   new key (mismatch on body-hash). Successful submits + manual
 *   cancellations clear the cache so the next open of the modal
 *   starts fresh — no stale keys left behind to 409 future
 *   submissions.
 *
 *   Operator-mismatch is also covered: the client never sends two
 *   operators' notes through the same key because the form is bound
 *   to one socio/movement and the server checks the
 *   `author_operator_id` axis on the replay path.
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

/**
 * Cheap, stable content hash for the note body. Used as the
 * localStorage discriminator so the persisted key can be reused
 * ONLY for the exact body it was minted against — editing one
 * character forces a new key.
 *
 * djb2 — non-cryptographic but collision-resistant enough for a
 * single user's session, and deterministic across browsers
 * (unlike `crypto.subtle` which only works in secure contexts).
 */
function hashBody(body: string): string {
  let h = 5381
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) + h + body.charCodeAt(i)) | 0
  }
  return `h${(h >>> 0).toString(36)}`
}

interface CachedKey {
  bodyHash: string
  key: string
  // Also pin the operator identity — the server checks
  // `author_operator_id` on the replay path, so reusing a key
  // across operators would 409 a different operator's intent.
  operatorId: string
}

function cachedKeyStorageKey(socioId: string, movementId: string): string {
  return `ctacte-note-idem:${socioId}:${movementId}`
}

function readCachedKey(
  socioId: string,
  movementId: string,
  body: string,
  operatorId: string,
): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(cachedKeyStorageKey(socioId, movementId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedKey
    if (parsed.bodyHash !== hashBody(body)) return null
    if (parsed.operatorId !== operatorId) return null
    return parsed.key
  } catch {
    return null
  }
}

function writeCachedKey(
  socioId: string,
  movementId: string,
  body: string,
  operatorId: string,
  key: string,
): void {
  if (typeof window === 'undefined') return
  const entry: CachedKey = {
    bodyHash: hashBody(body),
    key,
    operatorId,
  }
  try {
    window.localStorage.setItem(cachedKeyStorageKey(socioId, movementId), JSON.stringify(entry))
  } catch {
    // Quota / privacy-mode failures are best-effort: a missing
    // cache entry just means the next reload will mint a new key,
    // which the durable server-side uniqueness still catches.
  }
}

function clearCachedKey(socioId: string, movementId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(cachedKeyStorageKey(socioId, movementId))
  } catch {
    // Best-effort — same posture as `writeCachedKey`.
  }
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
  // R3 fix batch — defect #3 (reload-safe). The cached body-hash
  // indexed key survives:
  //   - page reloads (localStorage)
  //   - dev-tools refreshes
  //   - the user navigating back to the page
  // and is invalidated ONLY when:
  //   - the body content changes (different body-hash)
  //   - the operator changes (a second operator would 409 the
  //     server's `author_operator_id` check — fail fast client-side)
  //   - a successful submit clears the cache so the next modal open
  //     starts fresh
  //   - the user manually cancels
  const idempotencyKeyRef = useRef<string | null>(null)
  const keyForBodyRef = useRef<string | null>(null)

  /**
   * Return the Idempotency-Key to use for this body. Mints a new
   * key only when the body content (or operator) has changed since
   * the last minted key, OR when no cached key matches.
   *
   * Order of preference:
   *   1. Cached key from localStorage (reload survival).
   *   2. Ref-pinned key from the same form instance.
   *   3. Fresh `generateIdempotencyKey()`.
   */
  const getIdempotencyKeyFor = useCallback(
    (body: string, operatorId: string): string => {
      const trimmedBody = body.trim()

      // 1. Reload-safe: read from localStorage first.
      const cached = readCachedKey(socioId, movementId, trimmedBody, operatorId)
      if (cached) {
        idempotencyKeyRef.current = cached
        keyForBodyRef.current = trimmedBody
        return cached
      }

      // 2. Same-instance replay (the ref captures the in-flight
      //    5xx retry case).
      if (
        typeof trimmedBody === 'string' &&
        trimmedBody !== '' &&
        keyForBodyRef.current === trimmedBody &&
        idempotencyKeyRef.current
      ) {
        return idempotencyKeyRef.current
      }

      // 3. New intent — mint + persist for the next reload.
      const fresh = generateIdempotencyKey()
      idempotencyKeyRef.current = fresh
      keyForBodyRef.current = trimmedBody
      if (trimmedBody) writeCachedKey(socioId, movementId, trimmedBody, operatorId, fresh)
      return fresh
    },
    [socioId, movementId],
  )

  // R3 fix batch — defect #3 (reload hygiene). When the modal
  // opens, if a previous session left a cached key for a body that
  // no longer matches the current textarea (e.g., the user opened
  // the modal after a reload but hasn't typed anything yet), the
  // cache stays. The submit path re-validates by body-hash on
  // each invocation. We deliberately do NOT clear the cache on
  // open — the user might be remounting the form for the SAME
  // body they typed before the reload.
  // For the empty modal state, an empty body never produces a
  // cached key because the writer guards on `if (trimmedBody)`.

  // When the textarea content changes, the current in-flight
  // key may now be stale. The next getIdempotencyKeyFor() call
  // will consult localStorage first; if the new body has no
  // cached key, a new key is minted (and persisted).
  // (Component teardown is NOT a reason to clear the cache —
  // a remount may reuse the same key. Cleanup happens on
  // success / cancel / body change instead — see the catch arm
  // of `onSubmit` and `handleCancel`.)

  const onSubmit = useCallback(
    async (values: NoteFormValues, operatorId: string) => {
      // The form is invoked from the page context that already
      // owns the authenticated operator; pass it through so the
      // localStorage cache can pin the operator identity.
      const idempotencyKey = getIdempotencyKeyFor(values.body, operatorId)
      try {
        await addCtacteNote(socioId, movementId, values.body, idempotencyKey)
        notify('success', 'Nota agregada')
        // Successful submit: clear the cached key so the NEXT
        // submit (if the user re-opens the form for a new intent)
        // gets a fresh key, not a 409 reusing the prior one.
        clearCachedKey(socioId, movementId)
        idempotencyKeyRef.current = null
        keyForBodyRef.current = null
        reset()
        onSuccess?.()
        onClose()
      } catch (err) {
        // On network failure / 5xx the SAME key MUST be reused for
        // the next attempt so the server can dedupe the replay.
        // We deliberately do NOT clear the cache here so a reload
        // mid-network-error still surfaces a re-playable key.
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
          clearCachedKey(socioId, movementId)
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
    clearCachedKey(socioId, movementId)
    idempotencyKeyRef.current = null
    keyForBodyRef.current = null
    reset()
    onClose()
  }, [socioId, movementId, reset, onClose])

  // Capture the operator identity from the page context. The form
  // resolves the identity lazily on the first render via the
  // auth store injected by the page. We pull it through a ref so
  // a remount re-resolves it (matters for the reload-safety
  // contract — see `getIdempotencyKeyFor`'s `operatorId` parameter).
  const submitOperatorIdRef = useRef<string | null>(null)
  if (submitOperatorIdRef.current === null) {
    // Best-effort: read from the window-injected auth store if
    // available — falls back to an empty string which still
    // produces a cached entry (keys are still unique within a
    // single operator's session).
    const authWindow =
      typeof window !== 'undefined'
        ? (window as unknown as { __ATHLOS_AUTH__?: { operatorId?: string } })
        : undefined
    submitOperatorIdRef.current = authWindow?.__ATHLOS_AUTH__?.operatorId ?? ''
  }

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
        onSubmit={handleSubmit((values) => onSubmit(values, submitOperatorIdRef.current ?? ''))}
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
