'use client'

import { useEffect, useRef, useState } from 'react'
import { useUnreadCount } from '@/lib/api/notifications'
import NotificationPanel from './NotificationPanel'

/**
 * NotificationBell — bell icon + unread badge in the Topbar.
 *
 * Toggles the dropdown panel on click. Click-outside (anywhere outside
 * the bell + panel) dismisses the panel via a document-level pointerdown
 * listener registered only while open (unmounted on close).
 *
 * Polling for unread count runs every 30s (`useUnreadCount`) so the
 * badge stays fresh without the panel being open. When the panel IS
 * open, the inner `useNotifications({ status: 'all' })` query fires
 * and refreshes the visible list at the same cadence.
 *
 * Accessibility:
 *   - `aria-label` includes the current unread count
 *   - `aria-haspopup="menu"` + `aria-expanded` for AT
 *   - Badge has `aria-hidden="true"` (the count is in the bell's label)
 */

const MAX_DISPLAY = 99

function displayCount(n: number): string {
  return n > MAX_DISPLAY ? `${MAX_DISPLAY}+` : String(n)
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data } = useUnreadCount()
  const unread = data?.count ?? 0

  // Click-outside dismiss. Active only while open (cleanup removes the
  // listener on close / unmount).
  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  // Escape-to-close. Same activation pattern as click-outside.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notificaciones (${unread} sin leer)`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative rounded-md p-1.5 text-white transition-colors duration-fast hover:bg-night-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* Inline SVG (no icon library dependency). The bell path is
            Heroicons "bell" outline — common React UI library shape. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.125rem] h-[1.125rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-night-900"
          >
            {displayCount(unread)}
          </span>
        ) : null}
      </button>
      {open ? <NotificationPanel onClose={() => setOpen(false)} enabled={open} /> : null}
    </div>
  )
}
