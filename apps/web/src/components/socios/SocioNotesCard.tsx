'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NotepadText, Pencil, Trash2, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/use-auth'
import {
  NOTE_MAX_LENGTH,
  type SocioNote,
  createSocioNote,
  deleteSocioNote,
  listSocioNotes,
  updateSocioNote,
} from '@/lib/api/socios'
import { OPERATORS_QUERY_KEY, getOperatorNames, type OperatorSummary } from '@/lib/api/operators'
import { OperatorChip } from './OperatorChip'

/**
 * SocioNotesCard — operator-authored free-form notes attached to a
 * socio (PR 8b.4 + PR 8b.5 B.4).
 *
 * Pattern (per `4-UI-Style-Gorriti-Premium.md`):
 *   - Principal card living between the page header and the tab
 *     strip, so notes are immediately visible on entry to the ficha.
 *   - Card title row (icon tile + h2 + subtitle), same shape used
 *     by the Datos personales / Contacto / Cuenta panels.
 *   - Each note row carries the author (resolved to `username ·
 *     ROLE` via `<OperatorChip>` since PR 8b.5 B.4), the body, and
 *     the timestamp. Edit/Delete buttons are gated by
 *     `note.operator_id === caller.id || caller.role === 'ADMIN'`
 *     — matches the backend's permission rule.
 *
 * The card manages its own data flow via React Query:
 *   - `notesQuery` reads /socios/:id/notes on mount and after any
 *     write via `invalidateQueries(['socio-notes', id])`.
 *   - `createMutation`, `updateMutation`, `deleteMutation` keep the
 *     cache in sync and roll back optimistic updates on error.
 *   - `operatorsQuery` (PR 8b.5 B.4) reads `/api/v1/operators`
 *     for the union of author ids; the deterministic key
 *     `['operators', sortedIds.join(',')]` (design D8) is shared
 *     with `AuditTab` so both surfaces hit one fetch when their
 *     id sets overlap.
 *
 * No data-testids are reused from any other component — the card
 * sits in its own DOM subtree (rendered above the tabs), so query
 * selectors inside tests can scope by `parent.getByTestId`.
 */

export const SOCIO_NOTES_QUERY_KEY = (socioId: string) => ['socio-notes', socioId] as const

interface SocioNotesCardProps {
  socioId: string
}

function formatTimestamp(iso: string): string {
  // es-AR short date+time. The server emits ISO with seconds + Z.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// `shortOperatorId` was removed in PR 8b.5 B.4 — the author span now
// renders `<OperatorChip>` instead of the legacy `Operador 00000000-…`
// short-UUID form. If a future surface needs the UUID-short form,
// reintroduce it here.

export function SocioNotesCard({ socioId }: SocioNotesCardProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')

  const notesQuery = useQuery({
    queryKey: SOCIO_NOTES_QUERY_KEY(socioId),
    queryFn: () => listSocioNotes(socioId),
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: (body: string) => createSocioNote(socioId, body),
    onSuccess: () => {
      setDraft('')
      queryClient.invalidateQueries({ queryKey: ['socio-notes', socioId] })
      queryClient.invalidateQueries({ queryKey: ['socio-audit', socioId] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      updateSocioNote(socioId, noteId, body),
    onSuccess: () => {
      setEditingId(null)
      setEditingDraft('')
      queryClient.invalidateQueries({ queryKey: ['socio-notes', socioId] })
      queryClient.invalidateQueries({ queryKey: ['socio-audit', socioId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteSocioNote(socioId, noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socio-notes', socioId] })
      queryClient.invalidateQueries({ queryKey: ['socio-audit', socioId] })
    },
  })

  const notes = notesQuery.data ?? []

  // Resolve author ids → operator summaries for the chip helper
  // (PR 8b.5 B.4). Sorted id list → deterministic TanStack Query
  // key (design D8) so AuditTab and SocioNotesCard share a cache
  // entry when their id sets match.
  const sortedOperatorIds = useMemo(() => {
    const ids = notes.map((note) => note.operator_id).filter((id): id is string => id !== null)
    return Array.from(new Set(ids)).sort()
  }, [notes])

  const operatorsQuery = useQuery({
    queryKey: OPERATORS_QUERY_KEY(sortedOperatorIds),
    queryFn: () => getOperatorNames(sortedOperatorIds),
    enabled: sortedOperatorIds.length > 0,
    staleTime: 30_000,
  })

  const operatorMap = useMemo(
    () => new Map((operatorsQuery.data ?? []).map((o) => [o.id, o] as [string, OperatorSummary])),
    [operatorsQuery.data],
  )

  const isAuthorOrAdmin = (note: SocioNote): boolean => {
    if (!user) return false
    if (user.role === 'ADMIN') return true
    return note.operator_id === user.operator_id
  }

  function handleSubmitDraft(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    createMutation.mutate(trimmed)
  }

  function handleStartEdit(note: SocioNote) {
    setEditingId(note.id)
    setEditingDraft(note.body)
  }

  function handleCancelEdit() {
    setEditingId(null)
    setEditingDraft('')
    updateMutation.reset()
  }

  function handleSaveEdit(noteId: string) {
    const trimmed = editingDraft.trim()
    if (trimmed.length === 0) return
    updateMutation.mutate({ noteId, body: trimmed })
  }

  return (
    <section
      aria-label="Notas del operador"
      data-testid="socio-notes-card"
      className="rounded-xl border border-ink-150 bg-surface p-8 shadow-sm"
    >
      {/* Card title row — same pattern as Datos personales / Contacto. */}
      <header className="mb-6 flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-accent-soft p-2.5">
          <NotepadText className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900">Notas del operador</h2>
          <p className="font-body text-sm text-ink-500">
            Memos libres para registrar contexto del socio (llamadas, casos familiares,
            seguimientos). Cada nota queda asentada en la auditoría.
          </p>
        </div>
      </header>

      {/* New note form */}
      <form onSubmit={handleSubmitDraft} className="mb-6" data-testid="socio-note-new-form">
        <label htmlFor="socio-note-new-body" className="sr-only">
          Nueva nota
        </label>
        <textarea
          id="socio-note-new-body"
          data-testid="socio-note-new-body"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="Escribí una nota sobre este socio…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={createMutation.isPending}
          className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
        />
        {createMutation.isError ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-xs text-danger"
            data-testid="socio-note-new-error"
          >
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : 'No se pudo guardar la nota.'}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-body text-xs text-ink-500" data-testid="socio-note-charcount">
            {draft.length} / {NOTE_MAX_LENGTH}
          </span>
          <button
            type="submit"
            data-testid="socio-note-new-submit"
            disabled={createMutation.isPending || draft.trim().length === 0}
            className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? 'Guardando…' : 'Agregar nota'}
          </button>
        </div>
      </form>

      {/* Notes list */}
      {notesQuery.isPending ? (
        <ul data-testid="socio-notes-list" aria-busy="true" className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="space-y-2 rounded-lg border border-ink-100 p-4">
              <div className="h-3 w-32 animate-pulse rounded bg-surface-sunken" />
              <div className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-sunken" />
            </li>
          ))}
        </ul>
      ) : notes.length === 0 ? (
        <p
          data-testid="socio-notes-empty"
          className="rounded-md border border-dashed border-ink-200 px-4 py-8 text-center font-body text-sm text-ink-500"
        >
          Aún no hay notas para este socio. Usá el formulario de arriba para empezar.
        </p>
      ) : (
        <ul data-testid="socio-notes-list" className="space-y-3">
          {notes.map((note) => {
            const isEditing = editingId === note.id
            const canEdit = isAuthorOrAdmin(note)
            return (
              <li
                key={note.id}
                data-testid={`socio-note-${note.id}`}
                className="rounded-lg border border-ink-100 bg-surface-elevated p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft">
                      <UserRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div
                        className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500"
                        data-testid={`socio-note-author-${note.id}`}
                      >
                        <OperatorChip operatorId={note.operator_id} operators={operatorMap} />
                      </div>
                      <div className="font-body text-xs text-ink-500">
                        <span data-testid={`socio-note-created-${note.id}`}>
                          {formatTimestamp(note.created_at)}
                        </span>
                        {note.updated_at !== note.created_at ? (
                          <span
                            className="ml-2 italic"
                            data-testid={`socio-note-updated-${note.id}`}
                          >
                            · editado {formatTimestamp(note.updated_at)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {canEdit && !isEditing ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(note)}
                        aria-label="Editar nota"
                        data-testid={`socio-note-edit-${note.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-700"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              '¿Eliminar esta nota? La acción queda registrada en la auditoría pero no puede deshacerse.',
                            )
                          ) {
                            deleteMutation.mutate(note.id)
                          }
                        }}
                        aria-label="Eliminar nota"
                        data-testid={`socio-note-delete-${note.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <div data-testid={`socio-note-edit-form-${note.id}`}>
                    <textarea
                      data-testid={`socio-note-edit-body-${note.id}`}
                      rows={3}
                      maxLength={NOTE_MAX_LENGTH}
                      value={editingDraft}
                      onChange={(e) => setEditingDraft(e.target.value)}
                      disabled={updateMutation.isPending}
                      className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-surface-sunken"
                    />
                    {updateMutation.isError ? (
                      <p
                        role="alert"
                        className="mt-2 rounded-md border border-danger bg-danger/10 px-3 py-2 font-body text-xs text-danger"
                      >
                        {updateMutation.error instanceof Error
                          ? updateMutation.error.message
                          : 'No se pudo guardar la edición.'}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        data-testid={`socio-note-edit-cancel-${note.id}`}
                        className="rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
                      >
                        <X className="mr-1 inline-block h-3.5 w-3.5" aria-hidden="true" />
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(note.id)}
                        data-testid={`socio-note-edit-save-${note.id}`}
                        disabled={updateMutation.isPending || editingDraft.trim().length === 0}
                        className="rounded-[10px] bg-night-900 px-3 py-1.5 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="font-body text-sm text-ink-700 whitespace-pre-wrap break-words"
                    data-testid={`socio-note-body-${note.id}`}
                  >
                    {note.body}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
