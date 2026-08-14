'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, MessageSquare, Plus, Trash2, UserRound } from 'lucide-react'
import { deleteCtacteNote, type CtacteNoteResponse } from '@/lib/api/ctacte-mutations'
import { OPERATORS_QUERY_KEY, getOperatorNames, type OperatorSummary } from '@/lib/api/operators'
import { Badge } from '@/components/ui/Badge'
import { OperatorChip } from '@/components/socios/OperatorChip'
import { CtacteNoteForm } from '@/components/ctacte/CtacteNoteForm'
import { notify } from '@/lib/notifications'
import { useAuth } from '@/lib/use-auth'

/**
 * CtacteNotesSection — operator-authored notes attached to a cuenta-corriente
 * movement (PR A2 — athlos-ctacte-mutations; R3 hardening).
 *
 * Mirrors the SocioNotesCard pattern:
 *   - Collapsible via `useNotesCollapsed(cuentaId, null)` hook (localStorage
 *     key `ctacte-notes-collapsed-<cuenta>`; default collapsed). R3 fix:
 *     the key MUST be the cuenta (socioId), not the movementId, so the
 *     collapse state persists across movements on the same cuenta and
 *     stays isolated across cuentas.
 *   - Form to add a new note per movement.
 *   - List of existing notes (excludes soft-deleted).
 *   - Per-row `OperatorChip` renders `username · ROLE`.
 *   - Per-row soft-delete gated to author OR ADMIN (R3 authorization).
 */

export const CTACTE_NOTES_QUERY_KEY = (socioId: string, movementId: string) =>
  ['ctacte-notes', socioId, movementId] as const

interface CtacteNotesSectionProps {
  socioId: string
  movementId: string
  /** Current notes for this movement — passed from parent to avoid prop-drilling queries. */
  notes: CtacteNoteResponse[]
  isLoading: boolean
  error: string | null
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

/**
 * `useNotesCollapsed` — per-cuenta collapsible state for the notes card.
 *
 * R3 invariant: the localStorage key MUST be scoped to the cuenta
 * (`ctacte-notes-collapsed-<cuenta>`), NOT to the movement id. The
 * account-level collapse preference is a property of the cuenta, not
 * of the individual movement; per-movement keys made the toggle
 * appear "broken" because switching movements reset the state.
 *
 * Exported for unit tests so the persistence rules can be pinned
 * independently of the section component.
 */
export function useNotesCollapsed(
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
  isLoading,
  error,
  onNoteAdded,
}: CtacteNotesSectionProps) {
  const [showNoteForm, setShowNoteForm] = useState(false)
  const { toggle, displayExpanded } = useNotesCollapsed(socioId, null)
  const { user } = useAuth()
  const currentOperatorId = user?.operator_id ?? null
  const currentRole = user?.role ?? null

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

  /**
   * R3 authorization gate: only the original author OR an ADMIN may
   * delete a note. Mirrors the server-side `canDeleteCtacteNote` rule
   * in `apps/api/src/modules/socios/ctacte_movement_notes.ts`.
   */
  const canDeleteNote = useCallback(
    (note: CtacteNoteResponse): boolean => {
      if (!currentOperatorId) return false
      if (currentRole === 'ADMIN') return true
      return note.author_operator_id === currentOperatorId
    },
    [currentOperatorId, currentRole],
  )

  async function handleDeleteClick(note: CtacteNoteResponse) {
    if (!canDeleteNote(note)) {
      notify('error', 'No tiene permiso para borrar esta nota')
      return
    }
    try {
      await deleteCtacteNote(socioId, movementId, note.id)
      notify('success', 'Nota eliminada')
      onNoteAdded()
    } catch {
      notify('error', 'No se pudo eliminar la nota')
    }
  }

  function handleNoteFormSuccess() {
    setShowNoteForm(false)
    onNoteAdded()
  }

  function handleNoteFormClose() {
    setShowNoteForm(false)
  }

  return (
    <section
      aria-label="Notas del movimiento"
      data-testid="ctacte-notes-section"
      className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
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
          className="mt-4 space-y-4"
        >
          {isLoading ? (
            <div
              data-testid="ctacte-notes-loading"
              role="status"
              className="animate-pulse rounded bg-surface-sunken"
            >
              <span className="sr-only">Cargando notas</span>
              <div className="h-16" aria-hidden="true" />
            </div>
          ) : error ? (
            <p
              data-testid="ctacte-notes-error"
              role="alert"
              className="rounded-lg border border-danger bg-surface p-3 text-sm"
            >
              {error}
            </p>
          ) : (
            <>
              {/* New note modal trigger (R3): the production add-note
                  surface is the movement-scoped CtacteNoteForm modal,
                  so it is reachable from the row action on
                  /ctacte/[cuenta] (per verify-report R3 findings). */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-ink-500">
                  Registre una nota sobre este movimiento. Cada nota queda asentada en la auditoría.
                </p>
                <button
                  type="button"
                  data-testid="ctacte-note-new-trigger"
                  onClick={() => setShowNoteForm(true)}
                  className="min-h-11 shrink-0 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover disabled:opacity-60"
                >
                  <Plus className="-ml-0.5 mr-1 inline h-4 w-4" aria-hidden="true" />
                  Agregar nota
                </button>
              </div>

              {/* Notes list */}
              {notes.length === 0 ? (
                <p
                  data-testid="ctacte-notes-empty"
                  className="px-4 py-4 text-center text-sm text-ink-500"
                >
                  Todavía no hay notas para este movimiento.
                </p>
              ) : (
                <ul
                  data-testid="ctacte-notes-list"
                  className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-surface"
                >
                  {notes.map((note) => {
                    const deletable = canDeleteNote(note)
                    return (
                      <li key={note.id} data-testid={`ctacte-note-${note.id}`} className="p-4">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft">
                              <UserRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <div
                                data-testid={`ctacte-note-author-${note.id}`}
                                className="font-mono text-xs text-ink-500"
                              >
                                <OperatorChip
                                  operatorId={note.author_operator_id}
                                  operators={operatorMap}
                                />
                              </div>
                              <div className="font-mono text-xs text-ink-500">
                                <span data-testid={`ctacte-note-created-${note.id}`}>
                                  {formatTimestamp(note.created_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                          {deletable ? (
                            <button
                              type="button"
                              data-testid={`ctacte-note-delete-${note.id}`}
                              aria-label="Eliminar nota"
                              onClick={() => handleDeleteClick(note)}
                              className="shrink-0 rounded-md p-1.5 text-ink-500 transition-colors duration-fast hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>

                        <p
                          className="whitespace-pre-wrap break-words text-sm text-ink-700"
                          data-testid={`ctacte-note-body-${note.id}`}
                        >
                          {note.body}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Movement-scoped add-note modal (R3). Mounted here so the
          production /ctacte/[cuenta] row action has a real
          CtacteNoteForm path (the modal was previously dead code). */}
      <CtacteNoteForm
        open={showNoteForm}
        socioId={socioId}
        movementId={movementId}
        onSuccess={handleNoteFormSuccess}
        onClose={handleNoteFormClose}
      />
    </section>
  )
}
