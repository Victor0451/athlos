'use client'

import { useRouter } from 'next/navigation'
import type { PadronRow as PadronRowData } from '@/lib/api/padrones'

/**
 * PadronRow — one clickable row in a padron roster (TASK-028, PR 8b.3).
 *
 * Renders a single `PadronRow` (one inscripcion) as a stacked-list
 * card. Used by both the `/padrones` list page (after the operator
 * picks disciplina + ejercicio) and the `/padrones/[id]` detail page
 * (the deep-link view of the same roster). Extracting the row into
 * its own component keeps the page-level markup focused on the form
 * + pagination shell and lets us swap row content (badge variants,
 * row layout) in one place.
 *
 * The whole card is a `<button>` so it's keyboard-accessible (Enter
 * / Space) and announces as a single accessible name. Clicking
 * navigates to `/socios/<socioId>` — drilling into the member's
 * profile is the natural next step ("who is this socio enrolled in
 * the padron?"). The detail page itself does not surface any
 * write affordances (PR 8b.3 is read-only per the orchestrator brief).
 *
 * Estado badge colour map mirrors the existing tokens: `success`
 * for the active lifecycle, `warning` for pending paperwork,
 * `danger` for withdrawals. Unknown values fall back to `info`
 * so a new server-side lifecycle state doesn't crash the row.
 */

const ESTADO_LABEL: Record<string, string> = {
  activa: 'Activa',
  pendiente: 'Pendiente',
  baja: 'Baja',
}

/** Tailwind classes per estado variant — kept inline so the row
 * is fully self-contained (no StatusBadge import). */
const ESTADO_CLASS: Record<string, string> = {
  activa: 'bg-success/10 text-success',
  pendiente: 'bg-warning/10 text-warning',
  baja: 'bg-danger/10 text-danger',
}

function badgeClasses(estado: string): string {
  return ESTADO_CLASS[estado] ?? 'bg-info/10 text-info'
}

function estadoLabel(estado: string): string {
  return ESTADO_LABEL[estado] ?? estado
}

export interface PadronRowProps {
  row: PadronRowData
}

export function PadronRow({ row }: PadronRowProps) {
  const router = useRouter()

  function onClick() {
    router.push('/socios/' + row.socioId)
  }

  return (
    <li data-testid={`padron-row-${row.socioId}`}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Ver perfil de ${row.apellido}, ${row.nombre}`}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex flex-col gap-0.5">
          <span className="font-display text-sm font-semibold text-ink-900">
            {row.apellido}, {row.nombre}
          </span>
          <span className="font-mono text-xs text-ink-500">DNI {row.dni}</span>
        </span>
        <span className="flex items-center gap-3">
          <span
            className={[
              'inline-flex items-center rounded-full px-2 py-0.5',
              'font-display text-[10px] font-semibold uppercase tracking-widest',
              badgeClasses(row.estado),
            ].join(' ')}
            data-testid={`padron-estado-${row.socioId}`}
          >
            {estadoLabel(row.estado)}
          </span>
          <span className="font-mono text-xs text-ink-500">N° {row.numeroSocio}</span>
        </span>
      </button>
    </li>
  )
}
