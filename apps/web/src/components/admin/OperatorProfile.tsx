import type { OperatorProfile as OperatorProfileData } from '@/lib/api/auth'

/**
 * OperatorProfile — read-only display of the current operator's
 * profile (TASK-039, PR 8c.2).
 *
 * Used by the settings page at `/admin/settings` (TASK-038) to
 * render the username + translated role + last login + creation
 * date + permission flags.
 *
 * Visual contract (Gorriti Premium tokens):
 *   - Container: white surface, ink-100 border, rounded-lg
 *   - username: display font, semibold, ink-900 (heading level 2)
 *   - Role: pill with accent tint
 *   - Last login / created: mono, xs, ink-500, es-AR locale
 *   - Permissions: Sí / No per flag with a label
 *
 * Pure presentation — no data fetching. The settings page owns
 * the `getMe()` call (via TanStack Query) and passes the
 * resolved profile to this component. Renders nothing when
 * `profile` is null (the parent shows a loading skeleton during
 * the fetch).
 */

const DATETIME_FMT = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const DATE_FMT = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
})

function formatTimestamp(iso: string | null): string {
  if (iso === null) return 'Nunca'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Nunca'
  return DATETIME_FMT.format(d)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return DATE_FMT.format(d)
}

/** Map operator role codes to Spanish display labels. */
const ROLE_LABELS: Record<OperatorProfileData['role'], string> = {
  ADMIN: 'Administrador',
  TESORERO: 'Tesorero',
  OPERADOR: 'Operador',
  CONSULTA: 'Consulta',
}

export interface OperatorProfileProps {
  profile: OperatorProfileData | null
}

export function OperatorProfile({ profile }: OperatorProfileProps) {
  if (!profile) return null

  const roleLabel = ROLE_LABELS[profile.role]

  return (
    <section
      role="region"
      aria-label="Perfil del operador"
      data-testid="operator-profile"
      className="rounded-lg border border-ink-100 bg-surface p-6"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Operador
          </span>
          <h2 className="font-display text-xl font-semibold text-ink-900">{profile.username}</h2>
        </div>
        <span
          data-testid="operator-role"
          className="inline-flex items-center rounded-full bg-accent/10 px-3 py-1 font-display text-xs font-semibold uppercase tracking-widest text-accent"
        >
          {roleLabel}
        </span>
      </header>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Último ingreso
          </dt>
          <dd data-testid="operator-last-login" className="mt-1 font-mono text-sm text-ink-700">
            {formatTimestamp(profile.last_login_at)}
          </dd>
        </div>
        <div>
          <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Cuenta creada
          </dt>
          <dd data-testid="operator-created-at" className="mt-1 font-mono text-sm text-ink-700">
            {formatDate(profile.created_at)}
          </dd>
        </div>
        <div>
          <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Puede reimprimir comprobantes
          </dt>
          <dd data-testid="operator-can-reprint" className="mt-1 font-body text-sm text-ink-700">
            {profile.can_reprint ? 'Sí' : 'No'}
          </dd>
        </div>
        <div>
          <dt className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Puede anular movimientos
          </dt>
          <dd data-testid="operator-can-anulate" className="mt-1 font-body text-sm text-ink-700">
            {profile.can_anulate ? 'Sí' : 'No'}
          </dd>
        </div>
      </dl>
    </section>
  )
}
