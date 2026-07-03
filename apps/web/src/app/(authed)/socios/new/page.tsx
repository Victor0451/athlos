'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSocio, type CreateSocioInput } from '@/lib/api/socios'
import SocioForm from '@/components/socios/SocioForm'
import { useAuth } from '@/lib/use-auth'

/**
 * Standalone "create socio" page — `/socios/new` (PR 8b.2 second slice).
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
        className="space-y-4 rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
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
    <div className="space-y-6">
      <nav aria-label="Acciones" className="flex items-center gap-2 text-sm">
        <Link
          href="/socios"
          data-testid="new-socio-back"
          className="font-body text-ink-500 transition-colors duration-fast hover:text-ink-700"
        >
          ← Volver al listado
        </Link>
      </nav>

      <header>
        <h1
          className="font-display text-2xl font-bold text-ink-900"
          data-testid="new-socio-heading"
        >
          Nuevo socio
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Crea un socio nuevo en la base maestra. Los campos{' '}
          <code className="font-mono">N° de socio</code> y{' '}
          <code className="font-mono">fecha de alta</code> son inmutables después.
        </p>
      </header>

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

      <section
        aria-label="Formulario de alta"
        className="rounded-lg border border-ink-100 bg-surface p-6 shadow-sm"
      >
        <SocioForm
          mode="create"
          isSubmitting={createMutation.isPending}
          onSubmit={(input) => handleSubmit(input as Parameters<typeof handleSubmit>[0])}
          onCancel={() => router.push('/socios')}
        />
      </section>
    </div>
  )
}
