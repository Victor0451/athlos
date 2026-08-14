'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BellRing, KeyRound, LogOut, User } from 'lucide-react'
import { useAuth } from '@/lib/use-auth'

export default function PersonalMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { logout } = useAuth()
  const router = useRouter()

  async function signOut() {
    await logout()
    router.push('/login')
  }

  function closeMenu() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        closeMenu()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onClickOutside)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
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
          ref={menuRef}
          id="personal-menu"
          className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-ink-100 bg-surface p-1 shadow-md"
        >
          <div className="divide-y divide-ink-100">
            <div className="pb-1">
              <Link
                href="/account"
                onClick={closeMenu}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-surface-sunken"
              >
                <User aria-hidden="true" className="h-4 w-4" />
                Mi cuenta
              </Link>
              <Link
                href="/account/password"
                onClick={closeMenu}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-surface-sunken"
              >
                <KeyRound aria-hidden="true" className="h-4 w-4" />
                Cambiar contraseña
              </Link>
              <Link
                href="/account/preferences"
                onClick={closeMenu}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-surface-sunken"
              >
                <BellRing aria-hidden="true" className="h-4 w-4" />
                Preferencias de notificaciones
              </Link>
            </div>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  closeMenu()
                  void signOut()
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-surface-sunken"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
