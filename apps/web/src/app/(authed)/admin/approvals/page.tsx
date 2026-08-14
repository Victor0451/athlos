'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'

/**
 * Approvals list page — `/admin/approvals` (TASK-035, PR 8c.2).
 *
 * ADMIN-only landing page for the approval queue. Per design.md
 * §8 ("Approvals queue: API has no list-pending-tokens endpoint —
 * defer to Phase 9 backend slice and ship public decision page
 * only in 8c.2"), the v0.5.x backend exposes only the public-
 * by-token routes (`GET /api/v1/approval/:token` +
 * `POST /api/v1/approval/:token`). There is no
 * `GET /api/v1/approvals` (plural) list endpoint.
 *
 * Until the Phase 9 backend slice lands the list endpoint, this
 * page renders the "Próximamente" placeholder (deferred features
 * per the `web-frontend/spec.md` Cross-Slice Disabled Feature
 * Placeholders scenario). It also surfaces a "deep-link" form so
 * an ADMIN with a known token URL can still navigate to the
 * detail page (`/admin/approvals/[token]`) — the read-only escape
 * hatch that does NOT depend on the future list endpoint.
 *
 * State management:
 *   - The role gate (`useAuth().user?.role === 'ADMIN'`) controls
 *     the entire page render. Non-ADMIN operators see "Sin
 *     permisos" copy + no fetch fires.
 *   - The deep-link form is plain React state — no router.query
 *     mutation, just `router.push()` on submit.
 */

export default function ApprovalsListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [tokenInput, setTokenInput] = useState('')

  // Role gate first (no fetch fires if not ADMIN — placeholder
  // never queries regardless).
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Administración</p>
          <h1 className="font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
          <p className="mt-1 text-sm text-ink-500">
            Revisión y seguimiento de decisiones operativas.
          </p>
        </header>
        <div
          role="alert"
          data-testid="approvals-no-permission"
          className="rounded-lg border border-danger bg-surface p-3 text-sm"
        >
          <p className="font-display font-semibold text-ink-900">Sin permisos</p>
          <p className="mt-1 text-ink-500">
            Esta sección es exclusiva para operadores con rol ADMIN.
          </p>
        </div>
      </div>
    )
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (trimmed.length === 0) return
    router.push(`/admin/approvals/${encodeURIComponent(trimmed)}`)
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Administración</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Aprobaciones</h1>
        <p className="mt-1 text-sm text-ink-500">
          Cola de tokens de aprobación pendientes. Por ahora, ingrese un token conocido para revisar
          su detalle.
        </p>
      </header>

      <section
        aria-label="Próximamente"
        data-testid="approvals-placeholder"
        className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
      >
        <p className="font-display text-base font-semibold text-ink-900">Próximamente</p>
        <p className="mt-2 font-body text-sm text-ink-500">
          La cola de tokens pendientes se habilita en una próxima versión, junto con el ejecutor de
          aprobaciones (anulaciones y órdenes de pago).
        </p>
      </section>

      <section
        aria-label="Abrir token específico"
        data-testid="approvals-deeplink"
        className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
      >
        <h2 className="font-display text-base font-semibold text-ink-900">
          Abrir un token específico
        </h2>
        <p className="mt-1 font-body text-sm text-ink-500">
          Si tiene un enlace de aprobación (de WhatsApp o correo electrónico), pegue el token aquí
          para abrir el detalle.
        </p>
        <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="approvals-token-input" className="sr-only">
            Token de aprobación
          </label>
          <input
            id="approvals-token-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="token…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            data-testid="approvals-token-input"
            className="min-h-11 min-w-0 flex-1 rounded-md border border-ink-200 bg-surface px-3 py-2 font-mono text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button
            type="submit"
            disabled={tokenInput.trim().length === 0}
            data-testid="approvals-token-submit"
            className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Abrir
          </button>
        </form>
      </section>
    </div>
  )
}
