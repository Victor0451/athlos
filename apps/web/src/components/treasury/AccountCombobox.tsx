'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchAllEligibleAccounts,
  normalizedAccount,
  type AccountChartItem,
} from '@/lib/api/account-chart'

interface AccountComboboxProps {
  selected: AccountChartItem | null
  onSelect: (account: AccountChartItem) => void
  disabled?: boolean
}

/** Search box + 4rem list + paddings, used to decide whether to flip the dropdown upward. */
const DROPDOWN_ESTIMATED_HEIGHT = 340

/**
 * erpgw-style account combobox: a select-like button that opens the full eligible-account
 * list with an always-visible search box (client-side, diacritics-insensitive) and keyboard
 * navigation. Replaces the old "type then press search" picker, which read as a dead input.
 *
 * The dropdown renders in a portal with fixed positioning anchored to the trigger:
 * inside a scrollable modal it would otherwise be clipped below the fold, and the operator
 * would have to scroll the modal (closing the dropdown in the process) just to reach it.
 * The fixed panel is re-anchored on any scroll/resize, and pointerdown outside BOTH the
 * trigger and the panel closes it — the panel's own scrollbar keeps it open.
 */
export function AccountCombobox({ selected, onSelect, disabled }: AccountComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<AccountChartItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [placement, setPlacement] = useState<{
    left: number
    width: number
    top?: number
    bottom?: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const filtered = useMemo(() => {
    if (!accounts) return []
    const needle = normalizedAccount(query.trim())
    if (!needle) return accounts
    return accounts.filter((account) =>
      normalizedAccount(`${account.code} ${account.name}`).includes(needle),
    )
  }, [accounts, query])

  useEffect(() => {
    if (!open || accounts !== null || loading) return
    setLoading(true)
    setError('')
    fetchAllEligibleAccounts()
      .then(setAccounts)
      .catch(() => setError('No se pudieron cargar las cuentas.'))
      .finally(() => setLoading(false))
  }, [open, accounts, loading])

  useEffect(() => {
    if (!open) return
    // Keep the fixed panel glued to the trigger while any ancestor (e.g. the modal body)
    // scrolls — capture phase catches every scroll container.
    const reposition = () => {
      const anchor = rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const flipUp = spaceBelow < DROPDOWN_ESTIMATED_HEIGHT && rect.top > DROPDOWN_ESTIMATED_HEIGHT
      setPlacement({
        left: rect.left,
        width: rect.width,
        ...(flipUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      })
    }
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  const openDropdown = () => {
    if (disabled) return
    setQuery('')
    setOpen(true)
  }

  const choose = (account: AccountChartItem) => {
    onSelect(account)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length === 0) return
      setHighlight((current) => {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        return (current + delta + filtered.length) % filtered.length
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const account = filtered[highlight]
      if (account) choose(account)
    }
  }

  return (
    // Keyboard handling lives on the portal panel only: React propagates portal events
    // through the React tree, so a handler here would fire twice per keypress (panel →
    // root through the portal boundary). The trigger is a native button and needs none.
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="mt-1 block w-full rounded border border-ink-200 bg-surface p-2 text-left text-ink-900 disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
      >
        {selected ? `${selected.code} — ${selected.name}` : 'Seleccione una cuenta'}
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={dropdownRef}
            className="z-[60] rounded border border-ink-100 bg-surface shadow-lg"
            style={{
              position: 'fixed',
              left: placement.left,
              width: placement.width,
              top: placement.top,
              bottom: placement.bottom,
            }}
            data-testid="account-combobox-dropdown"
            onKeyDown={onKeyDown}
          >
            <div className="border-b border-ink-100 p-2">
              <input
                className="block w-full rounded border border-ink-200 p-2"
                placeholder="Buscar cuenta…"
                value={query}
                // The autofocus is intentional: the dropdown opens only through a click or
                // keyboard selection on the trigger, both user-initiated.
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <ul
              id={listId}
              role="listbox"
              aria-label="Cuentas elegibles"
              className="max-h-64 overflow-y-auto py-1"
            >
              {loading && <li className="px-3 py-2 text-sm text-ink-500">Cargando cuentas…</li>}
              {error && (
                <li className="px-3 py-2 text-sm" role="alert">
                  {error}
                </li>
              )}
              {!loading && !error && filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-ink-500">Sin cuentas para la búsqueda.</li>
              )}
              {!loading &&
                !error &&
                filtered.map((account, index) => (
                  <li key={account.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected?.code === account.code}
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        index === highlight ? 'bg-accent/10' : ''
                      } ${selected?.code === account.code ? 'font-medium' : ''}`}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(account)}
                    >
                      {account.code} — {account.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
