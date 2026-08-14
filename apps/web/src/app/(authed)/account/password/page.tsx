'use client'

import { useState } from 'react'
import { changePassword } from '@/lib/api/auth'

export default function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      setMessage('Contraseña actualizada.')
    } catch {
      setError('No se pudo cambiar la contraseña. Verificá los datos e intentá de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <main className="max-w-md space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Seguridad</p>
        <h1 className="font-display text-2xl font-bold text-ink-900">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-ink-500">
          Actualizá las credenciales de acceso del operador.
        </p>
      </header>
      <form
        onSubmit={submit}
        className="space-y-4 rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
      >
        <label className="block text-sm font-medium text-ink-700">
          Contraseña actual
          <input
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            required
            className="mt-1 block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="block text-sm font-medium text-ink-700">
          Nueva contraseña
          <input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            minLength={8}
            required
            className="mt-1 block min-h-11 w-full rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-danger bg-surface p-3 text-sm">
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="rounded-lg border border-success bg-success-soft p-3 text-sm text-success"
          >
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-sm font-semibold text-accent-foreground transition-colors duration-fast hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Cambiar contraseña
        </button>
      </form>
    </main>
  )
}
