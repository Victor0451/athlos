'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { login } from '@/lib/auth'

/**
 * Login page (`/login`).
 *
 * Per `web-frontend/spec.md` (Operator Login and Logout):
 *   - 40/60 split (dark left panel with brand + escudo, right panel with form)
 *   - react-hook-form + zod validation (zodResolver wires schema → RHF errors)
 *   - On 200 → router.push('/dashboard')
 *   - On 429 ACCOUNT_LOCKED → "Cuenta bloqueada — vuelva a intentar en N minutos"
 *   - On 401 INVALID_CREDENTIALS → "Usuario o contraseña incorrectos"
 *   - Submit button disabled while the request is in flight
 *
 * This is a Client Component because react-hook-form + useRouter are
 * both client-only APIs. The Next.js first-party proxy at
 * `app/api/auth/login/route.ts` (PR 8a.2) forwards the request to the
 * Fastify API so the refresh cookie stays first-party.
 */

const loginSchema = z.object({
  username: z.string().min(1, 'Ingresá tu usuario'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
})

type LoginFormValues = z.infer<typeof loginSchema>

interface AuthError extends Error {
  code?: string
  retryAfterMinutes?: number
}

function isAuthError(value: unknown): value is AuthError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string'
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
    mode: 'onSubmit',
  })

  async function onSubmit(values: LoginFormValues) {
    setSubmitError(null)
    try {
      await login(values.username, values.password)
      router.push('/dashboard')
    } catch (err) {
      if (isAuthError(err) && err.code === 'ACCOUNT_LOCKED') {
        const minutes = err.retryAfterMinutes ?? 15
        setSubmitError(`Cuenta bloqueada — vuelva a intentar en ${minutes} minutos`)
      } else if (isAuthError(err) && err.code === 'INVALID_CREDENTIALS') {
        setSubmitError('Usuario o contraseña incorrectos')
      } else {
        setSubmitError('No se pudo iniciar sesión. Intentá de nuevo.')
      }
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[2fr_3fr]">
      {/* Left panel — institutional branding */}
      <section className="bg-night-900 text-white px-8 py-12 flex flex-col justify-between">
        <div className="flex items-center gap-3">
          <img src="/escudo.jpg" alt="Escudo Club Atlético Gorriti" className="h-10 w-10" />
          <span className="font-display text-sm tracking-widest uppercase text-ink-200">
            Club Atlético Gorriti
          </span>
        </div>

        <div>
          <h1 className="font-display text-5xl font-bold leading-tight">Athlos</h1>
          <p className="mt-3 text-ink-200 text-lg">Consola de operaciones</p>
          <p className="mt-6 text-ink-500 text-sm max-w-md">
            Gestión integral de socios, cuenta corriente, padrones,_scheduler y aprobaciones. Acceso
            restringido al personal autorizado.
          </p>
        </div>

        <p className="text-xs text-ink-300">v0.5.8 · Gorriti Premium</p>
      </section>

      {/* Right panel — login form */}
      <section className="bg-surface px-8 py-12 flex items-center justify-center">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="w-full max-w-sm space-y-6"
          noValidate
          aria-label="Formulario de inicio de sesión"
        >
          <header>
            <h2 className="font-display text-2xl font-bold text-ink-900">Iniciar sesión</h2>
            <p className="mt-1 text-sm text-ink-500">Ingresá tus credenciales para continuar.</p>
          </header>

          <div className="space-y-2">
            <label htmlFor="username" className="block text-sm font-medium text-ink-700">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              {...register('username')}
              aria-invalid={Boolean(errors.username) || undefined}
              aria-describedby={errors.username ? 'username-error' : undefined}
              className="w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
            {errors.username && (
              <p id="username-error" role="alert" className="text-sm text-danger">
                {errors.username.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium text-ink-700">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={Boolean(errors.password) || undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              className="w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
            />
            {errors.password && (
              <p id="password-error" role="alert" className="text-sm text-danger">
                {errors.password.message}
              </p>
            )}
          </div>

          {submitError && (
            <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-danger">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-accent px-4 py-2 font-medium text-accent-foreground transition-colors duration-fast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Ingresando…' : 'Ingresar'}
          </button>

          <p className="text-center text-xs text-ink-500">
            ¿Problemas para ingresar? Contactá al administrador del sistema.
          </p>
        </form>
      </section>
    </main>
  )
}
