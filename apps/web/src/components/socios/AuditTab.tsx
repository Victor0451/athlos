'use client'

import { useQuery } from '@tanstack/react-query'
import { CircleX, History, Pencil, Pin, Plus, StickyNote, Trash2 } from 'lucide-react'
import type { AuditEvent } from '@/lib/api/socios'
import { getSocioAudit } from '@/lib/api/socios'

/**
 * AuditTab — chronologic timeline of audit_events for a socio
 * (PR 8b.4). Renders inside the existing `<Tabs>` panel of
 * `/socios/[id]`.
 *
 * Each entry shows: action icon + label + actor + timestamp +
 * (when applicable) a per-field diff between `old_value` and
 * `new_value`. The diff is computed by comparing the JSON keys of
 * the two snapshots — see `computeFieldDiff()` below.
 *
 * Action vocabulary rendered:
 *   SOCIO_CREATED       → "Socio creado"   + new_value summary
 *   SOCIO_UPDATED       → "Socio editado"  + per-field diff
 *   SOCIO_DELETED       → "Socio dado de baja" + old_value summary
 *   SOCIO_NOTE_CREATED  → "Nota agregada"  + note body
 *   SOCIO_NOTE_UPDATED  → "Nota editada"  + before/after bodies
 *   SOCIO_NOTE_DELETED  → "Nota eliminada" + deleted body
 *
 * The timeline is read-only — it never writes back. Operators who
 * need to edit/delete a note use the `<SocioNotesCard>` (which
 * emits SOCIO_NOTE_* events that show up here automatically).
 */

export const SOCIO_AUDIT_QUERY_KEY = (socioId: string) => ['socio-audit', socioId] as const

interface AuditTabProps {
  socioId: string
}

/** Action → icon component. Tailwind classes from the icon's
 *  container are scoped to a 28px circle. */
function ActionIcon({ action }: { action: string }): React.ReactNode {
  const wrap = (icon: React.ReactNode) => (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft">
      {icon}
    </div>
  )
  switch (action) {
    case 'SOCIO_CREATED':
      return wrap(<Plus className="h-4 w-4 text-accent" aria-hidden="true" />)
    case 'SOCIO_UPDATED':
      return wrap(<Pencil className="h-4 w-4 text-accent" aria-hidden="true" />)
    case 'SOCIO_DELETED':
      return wrap(<CircleX className="h-4 w-4 text-accent" aria-hidden="true" />)
    case 'SOCIO_NOTE_CREATED':
      return wrap(<StickyNote className="h-4 w-4 text-accent" aria-hidden="true" />)
    case 'SOCIO_NOTE_UPDATED':
      return wrap(<Pencil className="h-4 w-4 text-accent" aria-hidden="true" />)
    case 'SOCIO_NOTE_DELETED':
      return wrap(<Trash2 className="h-4 w-4 text-accent" aria-hidden="true" />)
    default:
      return wrap(<History className="h-4 w-4 text-accent" aria-hidden="true" />)
  }
}

/** Human label per action. Stable Spanish copy. */
function actionLabel(action: string): string {
  switch (action) {
    case 'SOCIO_CREATED':
      return 'Socio creado'
    case 'SOCIO_UPDATED':
      return 'Socio editado'
    case 'SOCIO_DELETED':
      return 'Socio dado de baja'
    case 'SOCIO_NOTE_CREATED':
      return 'Nota agregada'
    case 'SOCIO_NOTE_UPDATED':
      return 'Nota editada'
    case 'SOCIO_NOTE_DELETED':
      return 'Nota eliminada'
    default:
      return action
  }
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
    second: '2-digit',
  }).format(d)
}

function shortOperatorId(id: string | null): string {
  if (!id) return 'sistema'
  return id.slice(0, 8)
}

/* ── Field-level diff (SOCIO_UPDATED only) ─────────────────────── */

/** Labels rendered in the diff. Mirrors the wire DTO. */
const FIELD_DIFF_LABEL: Record<string, string> = {
  numero_socio: 'N° Socio',
  nombre: 'Nombre',
  apellido: 'Apellido',
  dni: 'DNI',
  fecha_alta: 'Fecha de alta',
  estado: 'Estado',
  categoria: 'Categoría',
  direccion: 'Dirección',
  telefono: 'Teléfono',
  email: 'Email',
}

/** Keys ignored in the diff UI. `id` / timestamps are stable
 *  infrastructure metadata — surfacing them in the diff would be
 *  noise. */
const FIELD_DIFF_SKIP = new Set(['id', 'created_at', 'updated_at', 'deleted_at'])

interface FieldDiff {
  key: string
  before: unknown
  after: unknown
}

function computeFieldDiff(before: unknown, after: unknown): FieldDiff[] {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return []
  }
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const out: FieldDiff[] = []
  for (const key of keys) {
    if (FIELD_DIFF_SKIP.has(key)) continue
    const beforeVal = b[key]
    const afterVal = a[key]
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      out.push({ key, before: beforeVal, after: afterVal })
    }
  }
  return out
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/* ── Note-event bodies ─────────────────────────────────────────── */

interface NoteShape {
  body?: string
}

function readNote(v: unknown): NoteShape | null {
  if (!v || typeof v !== 'object') return null
  const n = v as Record<string, unknown>
  if (typeof n.body !== 'string') return null
  return { body: n.body }
}

/* ── Socio summary (for CREATE / DELETE) ───────────────────────── */

const SOCIO_SUMMARY_KEYS = ['numero_socio', 'nombre', 'apellido', 'dni', 'estado'] as const

function renderSocioSummary(snap: unknown): React.ReactNode {
  if (!snap || typeof snap !== 'object') return null
  const s = snap as Record<string, unknown>
  const rows: Array<[string, string]> = []
  for (const k of SOCIO_SUMMARY_KEYS) {
    if (s[k] !== undefined && s[k] !== null) {
      rows.push([FIELD_DIFF_LABEL[k] ?? k, String(s[k])])
    }
  }
  if (rows.length === 0) return null
  return (
    <dl
      className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="audit-snapshot-summary"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2">
          <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            {label}
          </dt>
          <dd className="font-body text-sm text-ink-700">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ── Per-event body renderer ───────────────────────────────────── */

function EventBody({ event }: { event: AuditEvent }) {
  switch (event.action) {
    case 'SOCIO_CREATED':
      return (
        <div className="space-y-2">
          <p className="font-body text-sm text-ink-500">
            El socio fue dado de alta con los siguientes datos:
          </p>
          {renderSocioSummary(event.new_value)}
        </div>
      )
    case 'SOCIO_UPDATED': {
      const diffs = computeFieldDiff(event.old_value, event.new_value)
      if (diffs.length === 0) {
        return (
          <p className="font-body text-sm text-ink-500">Sin cambios visibles (sólo timestamps).</p>
        )
      }
      return (
        <ul data-testid="audit-diff" className="space-y-2 border-l-2 border-ink-100 pl-4">
          {diffs.map(({ key, before, after }) => (
            <li key={key} data-testid={`audit-diff-field-${key}`}>
              <div className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500">
                {FIELD_DIFF_LABEL[key] ?? key}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span
                  className="rounded bg-surface-sunken px-2 py-0.5 font-mono text-xs text-ink-500 line-through"
                  data-testid={`audit-diff-before-${key}`}
                >
                  {renderValue(before)}
                </span>
                <span aria-hidden="true" className="font-display text-ink-300">
                  →
                </span>
                <span
                  className="rounded bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent"
                  data-testid={`audit-diff-after-${key}`}
                >
                  {renderValue(after)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )
    }
    case 'SOCIO_DELETED':
      return (
        <div className="space-y-2">
          <p className="font-body text-sm text-ink-500">
            El socio fue dado de baja con estos datos al momento de la baja:
          </p>
          {renderSocioSummary(event.old_value)}
        </div>
      )
    case 'SOCIO_NOTE_CREATED': {
      const note = readNote(event.new_value)
      if (!note) return null
      return (
        <blockquote
          data-testid="audit-note-body"
          className="border-l-2 border-accent bg-accent-soft/50 px-3 py-2 font-body text-sm text-ink-700 whitespace-pre-wrap"
        >
          {note.body}
        </blockquote>
      )
    }
    case 'SOCIO_NOTE_UPDATED': {
      const before = readNote(event.old_value)
      const after = readNote(event.new_value)
      return (
        <div className="space-y-2">
          {before ? (
            <div>
              <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Antes
              </div>
              <p
                data-testid="audit-note-before"
                className="mt-1 border-l-2 border-ink-100 bg-surface-sunken px-3 py-2 font-body text-sm text-ink-700 line-through whitespace-pre-wrap"
              >
                {before.body}
              </p>
            </div>
          ) : null}
          {after ? (
            <div>
              <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Después
              </div>
              <p
                data-testid="audit-note-after"
                className="mt-1 border-l-2 border-accent bg-accent-soft/50 px-3 py-2 font-body text-sm text-ink-700 whitespace-pre-wrap"
              >
                {after.body}
              </p>
            </div>
          ) : null}
        </div>
      )
    }
    case 'SOCIO_NOTE_DELETED': {
      const note = readNote(event.old_value)
      if (!note) return null
      return (
        <blockquote
          data-testid="audit-note-body-deleted"
          className="border-l-2 border-danger bg-danger/5 px-3 py-2 font-body text-sm text-ink-500 line-through whitespace-pre-wrap"
        >
          {note.body}
        </blockquote>
      )
    }
    default:
      return null
  }
}

/* ── Component ─────────────────────────────────────────────────── */

export function AuditTab({ socioId }: AuditTabProps) {
  const query = useQuery({
    queryKey: SOCIO_AUDIT_QUERY_KEY(socioId),
    queryFn: () => getSocioAudit(socioId),
    staleTime: 15_000,
  })

  if (query.isPending) {
    return (
      <div role="status" aria-live="polite" data-testid="audit-tab-loading" className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-7 w-7 animate-pulse rounded-full bg-surface-sunken" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
              <div className="h-12 w-full animate-pulse rounded bg-surface-sunken" />
            </div>
          </div>
        ))}
        <span className="sr-only">Cargando auditoría…</span>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div
        role="alert"
        data-testid="audit-tab-error"
        className="rounded-md border border-danger bg-danger/10 px-4 py-3 font-body text-sm text-danger"
      >
        No pudimos cargar la auditoría del socio.{' '}
        {query.error instanceof Error ? `(${query.error.message})` : ''}
      </div>
    )
  }

  const events = query.data ?? []

  if (events.length === 0) {
    return (
      <div
        data-testid="audit-tab-empty"
        className="rounded-md border border-dashed border-ink-200 px-4 py-12 text-center"
      >
        <Pin className="mx-auto mb-3 h-8 w-8 text-ink-300" aria-hidden="true" />
        <p className="font-display text-sm font-semibold text-ink-700">
          Aún no hay eventos registrados
        </p>
        <p className="mt-1 font-body text-xs text-ink-500">
          Los cambios al socio y a sus notas aparecerán aquí a medida que sucedan.
        </p>
      </div>
    )
  }

  return (
    <ol
      data-testid="audit-tab-list"
      className="relative space-y-4 border-l-2 border-dashed border-ink-150 pl-6"
    >
      {events.map((event) => (
        <li key={event.id} data-testid={`audit-event-${event.id}`} className="relative">
          {/* Connector dot at the timeline */}
          <span
            className="absolute -left-[calc(1.5rem+5px)] top-2 inline-flex h-3 w-3 rounded-full border-2 border-surface bg-accent"
            aria-hidden="true"
          />
          <div className="rounded-lg border border-ink-100 bg-surface-elevated p-4">
            <div className="mb-2 flex items-start gap-2">
              <ActionIcon action={event.action} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="font-display text-sm font-semibold text-ink-900"
                    data-testid={`audit-event-action-${event.id}`}
                  >
                    {actionLabel(event.action)}
                  </span>
                  <span
                    className="font-body text-xs text-ink-500"
                    data-testid={`audit-event-actor-${event.id}`}
                  >
                    por operador {shortOperatorId(event.operator_id)}
                  </span>
                </div>
                <div
                  className="font-mono text-[11px] text-ink-500"
                  data-testid={`audit-event-time-${event.id}`}
                >
                  {formatTimestamp(event.created_at)}
                </div>
              </div>
            </div>
            <EventBody event={event} />
          </div>
        </li>
      ))}
    </ol>
  )
}
