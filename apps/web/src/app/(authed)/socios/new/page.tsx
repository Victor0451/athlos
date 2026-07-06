'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, UserRound } from 'lucide-react'
import { createSocio, type CreateSocioInput } from '@/lib/api/socios'
import SocioForm from '@/components/socios/SocioForm'
import { useAuth } from '@/lib/use-auth'

/**
 * Standalone "create socio" page — `/socios/new` (PR 8b.2 second slice,
 * refreshed 2026-07-06).
 *
 * The create flow ships from inside the list page's modals in PR 8b.2
 * first slice; this slice surfaces it as its own route so that
 *      - the back/forward browser buttons behave correctly
 *      - it can be deep-linked from elsewhere (e.g., a search-result
 *        "no existe, crealo" CTA in a future slice)
 *      - the form gets its own URL + breadcrumb chrome
 *
 * Same `SocioForm` from PR 8b.2 (mode='create'), wrapped in the
 * standard `useMutation` flow:
 *      - ADMIN gate at mount (redirect non-ADMIN to /socios)
 *      - success → invalidate ['socios'] + redirect to /socios
 *      - error   → render a `role="alert"` block above the form
 *
 * Visual refresh (PR 8b.3, see `2-Architecture/4-UI-Style-Gorriti-Premium.md`):
 *
 *   - Page header matches the canonical detail-page header pattern:
 *     back-circle on the LEFT (button, not link), title in
 *     `text-3xl uppercase tracking-tight` (the `hero-h1` scale).
 *
 *   - The form lives inside a **principal card** (`rounded-xl
 *     border-ink-150 shadow-sm`) with a card title row (icon tile +
 *     h2 + subtitle) — the same pattern documented as canonical for
 *     `/socios/[id]`.
 *
 *   - **Responsive**: the card uses `flex flex-col overflow-hidden`
 *     with `h-[calc(100vh-8rem)]` (top + bottom = 8rem of chrome) so
 *     it never exceeds the viewport on small monitors. The body
 *     scrolls internally (`overflow-y-auto`) so the form fields and
 *     the action buttons are reachable without zooming out the
 *     browser — the bug that motivated this refresh.
 */

export default function NewSocioPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user, isAuthenticated } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  // Gate non-ADMIN operators at mount — there's no in-page UI for them.
  // We render nothing while the redirect is in flight to avoid a flash
  // of the create form.
  useEffect(() => {
    if (isAuthenticated && !isAdmin) {
      router.replace('/socios')
    }
  }, [isAuthenticated, isAdmin, router])

  const createMutation = useMutation({
    mutationFn: (input: CreateSocioInput) => createSocio(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socios'] })
      router.push('/socios')
    },
  })

  if (!isAuthenticated || !isAdmin) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-4 rounded-lg border border-ink-100 bg-surface p-6"
        data-testid="new-socio-gate"
      >
        <p className="font-body text-sm text-ink-500">Redirigiendo al listado…</p>
      </div>
    )
  }

  function handleSubmit(input: CreateSocioInput) {
    createMutation.mutate(input)
  }

  return (
    <div className="flex h-full flex-col gap-6">
      {/* ── Header (canonical pattern: back-circle + title block) ── */}
      <header className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => router.push('/socios')}
          aria-label="Volver al listado"
          data-testid="new-socio-back"
          className="shrink-0 rounded-xl border border-ink-150 bg-surface p-3 shadow-sm transition-colors duration-fast hover:bg-surface-sunken"
        >
          <ChevronLeft className="h-5 w-5 text-ink-700" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h1
            className="font-display text-3xl font-bold uppercase tracking-tight text-ink-900"
            data-testid="new-socio-heading"
          >
            Nuevo socio
          </h1>
          <p className="mt-2 font-body text-sm text-ink-500">
            Crea un socio nuevo en la base maestra. Los campos{' '}
            <code className="font-mono">N° de socio</code> y{' '}
            <code className="font-mono">fecha de alta</code> son inmutables después.
          </p>
        </div>
      </header>

      {/* ── Inline error ── */}
      {createMutation.isError ? (
        <div
          role="alert"
          data-testid="new-socio-error"
          className="rounded-md border border-danger bg-danger/10 px-4 py-3 font-body text-sm text-danger"
        >
          {createMutation.error instanceof Error
            ? createMutation.error.message
            : 'No se pudo crear el socio. Intentá de nuevo.'}
        </div>
      ) : null}

      {/* ── Principal card (responsive: capped height, scroll interno) ──
          `h-[calc(100vh-8rem)]` deja ~128px para header + padding del
          AppShell. El body scrollea para que los inputs y los botones
          del form sean alcanzables sin zoom-out en monitores chicos. */}
      <section
        aria-label="Formulario de alta"
        data-testid="new-socio-form-card"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-ink-150 bg-surface shadow-sm"
      >
        {/* Card title row (sticky, shrink-0) */}
        <header className="flex shrink-0 items-center gap-3 border-b border-ink-100 px-8 py-5">
          <div className="shrink-0 rounded-lg bg-accent-soft p-2.5">
            <UserRound className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Datos del nuevo socio
            </h2>
            <p className="font-body text-sm text-ink-500">
              Completá los datos básicos. Los campos opcionales se pueden dejar vacíos.
            </p>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <SocioForm
            mode="create"
            isSubmitting={createMutation.isPending}
            onSubmit={(input) => handleSubmit(input as Parameters<typeof handleSubmit>[0])}
            onCancel={() => router.push('/socios')}
          />
        </div>
      </section>
    </div>
  )
}
