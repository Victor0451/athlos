'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'

export default function PersonalMenu() {
  const [open, setOpen] = useState(false)
  const { logout } = useAuth()
  const router = useRouter()

  async function signOut() {
    await logout()
    router.push('/login')
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="personal-menu"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md bg-night-800 px-3 py-1 text-sm font-medium text-white"
      >
        Menú personal
      </button>
      {open && (
        <div
          id="personal-menu"
          className="absolute right-0 z-10 mt-2 w-64 rounded-md bg-surface p-2 text-ink-900 shadow-md"
        >
          <Link href="/account" className="block rounded px-3 py-2 hover:bg-surface-sunken">
            Mi cuenta
          </Link>
          <Link
            href="/account/password"
            className="block rounded px-3 py-2 hover:bg-surface-sunken"
          >
            Cambiar contraseña
          </Link>
          <Link
            href="/account/preferences"
            className="block rounded px-3 py-2 hover:bg-surface-sunken"
          >
            Preferencias de notificaciones
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded px-3 py-2 text-left hover:bg-surface-sunken"
          >
            Salir
          </button>
        </div>
      )}
    </div>
  )
}
