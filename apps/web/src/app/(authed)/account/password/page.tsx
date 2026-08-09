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
    <main className="max-w-md space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink-900">Cambiar contraseña</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          Contraseña actual
          <input
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            required
            className="mt-1 block w-full rounded border border-ink-200 p-2"
          />
        </label>
        <label className="block">
          Nueva contraseña
          <input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            minLength={8}
            required
            className="mt-1 block w-full rounded border border-ink-200 p-2"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent px-4 py-2 text-accent-foreground"
        >
          Cambiar contraseña
        </button>
      </form>
    </main>
  )
}
