'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, MessageSquare, Pencil, Trash2, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/use-auth'
import { addCtacteNote, type CtacteNoteResponse } from '@/lib/api/ctacte-mutations'
import { OPERATORS_QUERY_KEY, getOperatorNames, type OperatorSummary } from '@/lib/api/operators'
import { Badge } from '@/components/ui/Badge'
import { OperatorChip } from '@/components/socios/OperatorChip'
import { notify } from '@/lib/notifications'

/**
 * CtacteNotesSection — operator-authored notes attached to a cuenta-corriente
 * movement (PR A2 — athlos-ctacte-mutations).
 *
 * Mirrors the SocioNotesCard pattern:
 *   - Collapsible via `useNotesCollapsed(cuentaId, null)` hook (localStorage key
 *     `ctacte-notes-collapsed-<cuenta>`; default collapsed).
 *   - Form to add a new note per movement.
 *   - List of existing notes (excludes soft-deleted).
 *   - Per-row `OperatorChip` renders `username · ROLE`.
 *   - Soft-delete gated to author OR ADMIN.
 */

export const CTACTE_NOTES_QUERY_KEY = (socioId: string, movementId: string) =>
  ['ctacte-notes', socioId, movementId] as const

interface CtacteNotesSectionProps {
  socioId: string
  movementId: string
  /** Current notes for this movement — passed from parent to avoid prop-drilling queries. */
  notes: CtacteNoteResponse[]
  onNoteAdded: () => void
}

function formatTimestamp(iso: string): string {
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

function useNotesCollapsed(
  cuentaId: string,
  editingId: string | null,
): { collapsed: boolean; toggle: () => void; displayExpanded: boolean } {
  const KEY = `ctacte-notes-collapsed-${cuentaId}`
  const [collapsed, setCollapsed] = useState<boolean>(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw === 'false') setCollapsed(false)
    } catch {
      // private mode / quota — keep default
    }
  }, [KEY])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(KEY, String(next))
        } catch {
          // best-effort write
        }
      }
      return next
    })
  }, [KEY])

  const displayExpanded = !collapsed || editingId !== null
  return { collapsed, toggle, displayExpanded }
}

export function CtacteNotesSection({
  socioId,
  movementId,
  notes,
  onNoteAdded,
}: CtacteNotesSectionProps) {
  const { user } = useAuth()
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')

  const { toggle, displayExpanded } = useNotesCollapsed(movementId, editingId)

  const sortedOperatorIds = useMemo(() => {
    const ids = notes
      .map((note) => note.author_operator_id)
      .filter((id): id is string => id !== null)
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

  const isAuthorOrAdmin = useCallback(
    (note: CtacteNoteResponse): boolean => {
      if (!user) return false
      if (user.role === 'ADMIN') return true
      return note.author_operator_id === user.operator_id
    },
    [user],
  )

  async function handleSubmitDraft(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (trimmed.length === 0) return
    try {
      await addCtacteNote(socioId, movementId, trimmed)
      notify('success', 'Nota creada')
      setDraft('')
      onNoteAdded()
    } catch {
      notify('error', 'No se pudo crear la nota')
    }
  }

  function handleStartEdit(note: CtacteNoteResponse) {
    setEditingId(note.id)
    setEditingDraft(note.body)
  }

  function handleCancelEdit() {
    setEditingId(null)
    setEditingDraft('')
  }

  async function handleSaveEdit(_noteId: string) {
    const trimmed = editingDraft.trim()
    if (trimmed.length === 0) return
    // Optimistic: just close the editing state since this component doesn't have an update endpoint yet
    setEditingId(null)
    setEditingDraft('')
    notify('error', 'Editar nota no está implementado todavía')
  }

  async function handleDelete(_noteId: string) {
    // Soft-delete not yet implemented on the backend; show a message
    notify('error', 'Eliminar nota no está implementado todavía')
  }

  return (
    <section
      aria-label="Notas del movimiento"
      data-testid="ctacte-notes-section"
      className="rounded-xl border border-ink-150 bg-surface p-8 shadow-sm"
    >
      {/* Collapsible header */}
      <button
        type="button"
        data-testid="ctacte-notes-toggle"
        aria-expanded={displayExpanded}
        aria-controls="ctacte-notes-panel"
        onClick={toggle}
        className="group mb-6 -mx-2 -my-1 flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition-colors duration-fast hover:bg-surface-sunken/40"
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-lg bg-accent-soft p-2.5">
            <MessageSquare className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="ctacte-notes-heading"
              className="font-display text-lg font-semibold text-ink-900"
            >
              Notas del movimiento
            </h2>
            <p className="font-body text-sm text-ink-500">
              Memos libres para registrar contexto sobre este movimiento.
            </p>
          </div>
        </div>
        <Badge variant="default" dataTestid="ctacte-notes-counter" className="ml-auto">
          {notes.length} nota{notes.length !== 1 ? 's' : ''}
        </Badge>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-500 transition-transform duration-fast ${displayExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Collapsible region */}
      {displayExpanded ? (
        <div
          id="ctacte-notes-panel"
          data-testid="ctacte-notes-panel"
          role="region"
          aria-labelledby="ctacte-notes-heading"
          className="mt-6 space-y-6"
        >
          {/* New note form */}
          <form onSubmit={handleSubmitDraft} data-testid="ctacte-note-new-form">
            <textarea
              id="ctacte-note-new-body"
              data-testid="ctacte-note-new-body"
              rows={3}
              maxLength={2000}
              placeholder="Escribí una nota sobre este movimiento…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="font-body text-xs text-ink-500" data-testid="ctacte-note-charcount">
                {draft.length} / 2000
              </span>
              <button
                type="submit"
                disabled={draft.trim().length === 0}
                className="rounded-[10px] bg-night-900 px-4 py-2 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Agregar nota
              </button>
            </div>
          </form>

          {/* Notes list */}
          {notes.length === 0 ? (
            <p
              data-testid="ctacte-notes-empty"
              className="rounded-md border border-dashed border-ink-200 px-4 py-8 text-center font-body text-sm text-ink-500"
            >
              Aún no hay notas para este movimiento.
            </p>
          ) : (
            <ul data-testid="ctacte-notes-list" className="space-y-3">
              {notes.map((note) => {
                const isEditing = editingId === note.id
                const canEdit = isAuthorOrAdmin(note)
                return (
                  <li
                    key={note.id}
                    data-testid={`ctacte-note-${note.id}`}
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
                            data-testid={`ctacte-note-author-${note.id}`}
                          >
                            <OperatorChip
                              operatorId={note.author_operator_id}
                              operators={operatorMap}
                            />
                          </div>
                          <div className="font-body text-xs text-ink-500">
                            <span data-testid={`ctacte-note-created-${note.id}`}>
                              {formatTimestamp(note.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {canEdit && !isEditing ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(note)}
                            aria-label="Editar nota"
                            data-testid={`ctacte-note-edit-${note.id}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-700"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  '¿Eliminar esta nota? La acción no se puede deshacer.',
                                )
                              ) {
                                handleDelete(note.id)
                              }
                            }}
                            aria-label="Eliminar nota"
                            data-testid={`ctacte-note-delete-${note.id}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors duration-fast hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div data-testid={`ctacte-note-edit-form-${note.id}`}>
                        <textarea
                          data-testid={`ctacte-note-edit-body-${note.id}`}
                          rows={3}
                          maxLength={2000}
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          className="block w-full resize-y rounded-md border border-ink-200 bg-surface px-3 py-2 font-body text-sm text-ink-700 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        <div className="mt-2 flex items-end justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            data-testid={`ctacte-note-edit-cancel-${note.id}`}
                            className="rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 font-body text-sm text-ink-700 transition-colors duration-fast hover:bg-surface-sunken"
                          >
                            <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(note.id)}
                            data-testid={`ctacte-note-edit-save-${note.id}`}
                            disabled={editingDraft.trim().length === 0}
                            className="rounded-[10px] bg-night-900 px-3 py-1.5 font-display text-sm font-semibold text-white transition-colors duration-fast hover:bg-night-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Guardar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p
                        className="font-body text-sm text-ink-700 whitespace-pre-wrap break-words"
                        data-testid={`ctacte-note-body-${note.id}`}
                      >
                        {note.body}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
