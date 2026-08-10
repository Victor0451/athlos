'use client'

import { useEffect, useRef, type RefObject } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'
import { visibleNavigation } from '@/lib/navigation'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export default function MobileDrawer({ open, onClose, triggerRef }: MobileDrawerProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const closeRef = useRef<HTMLButtonElement>(null)
  const links = visibleNavigation(user)

  useEffect(() => {
    if (!open) return
    const background = document.querySelector<HTMLElement>('[data-mobile-drawer-background]')
    const previousOverflow = document.body.style.overflow
    background?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const controls = [
        closeRef.current,
        ...Array.from(document.querySelectorAll('[data-mobile-drawer-link]')),
      ].filter((control): control is HTMLElement => control !== null)
      const current = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && current === 0) {
        event.preventDefault()
        controls.at(-1)?.focus()
      } else if (!event.shiftKey && current === controls.length - 1) {
        event.preventDefault()
        controls[0]?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      background?.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus()
    }
  }, [open, onClose, triggerRef])

  if (!open) return null
  return (
    <>
      <button
        aria-label="Cerrar panel de navegación"
        className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        data-testid="mobile-drawer-overlay"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Navegación principal"
        aria-modal="true"
        className="fixed inset-y-0 left-0 z-50 w-72 bg-night-900 p-4 text-white lg:hidden"
        id="mobile-navigation"
        role="dialog"
      >
        <button ref={closeRef} type="button" onClick={onClose}>
          Cerrar navegación
        </button>
        <nav aria-label="Secciones" className="mt-4">
          {links.map((item) => (
            <Link
              key={item.href}
              aria-current={
                pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined
              }
              data-mobile-drawer-link="true"
              href={item.href}
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  )
}
