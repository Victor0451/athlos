'use client'

import { useEffect, useRef, type RefObject } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { useAuth } from '@/lib/use-auth'
import { visibleNavigation } from '@/lib/navigation'
import { useFeatureConfig } from '@/lib/features'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export default function MobileDrawer({ open, onClose, triggerRef }: MobileDrawerProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const { cashEnabled } = useFeatureConfig()
  const closeRef = useRef<HTMLButtonElement>(null)
  const links = visibleNavigation(user, { cashEnabled })

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
        <button
          ref={closeRef}
          aria-label="Cerrar navegación"
          className="rounded-md p-2 text-ink-300 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-night-900"
          type="button"
          onClick={onClose}
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <nav aria-label="Secciones" className="mt-4">
          <ul className="space-y-1">
            {links.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <li key={item.href}>
                  <Link
                    aria-current={isActive ? 'page' : undefined}
                    className={[
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                      isActive
                        ? 'border-l-2 border-accent bg-night-800 text-white pl-[10px]'
                        : 'border-l-2 border-transparent text-ink-300 hover:text-white hover:bg-night-800',
                    ].join(' ')}
                    data-mobile-drawer-link="true"
                    href={item.href}
                    onClick={onClose}
                  >
                    <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}
