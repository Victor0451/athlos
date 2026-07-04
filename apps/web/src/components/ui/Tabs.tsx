/**
 * Tabs — Gorriti Premium visual primitive (2026-07-02).
 *
 * Border-bottom underline pattern (per `4-UI-Style-Gorriti-Premium.md`
 * §"Aplicación a pantallas críticas" — Ctacte section). The active
 * tab has a 2px accent bottom border, ink-900 text, semibold. Inactive
 * tabs are transparent, ink-500, medium, hover to ink-700.
 *
 * Why a controlled component (instead of building the state in this
 * file)? The active tab often needs to drive content (e.g. toggling
 * which section is rendered in the detail page) and that state already
 * lives in the parent. Keeping the tabs as pure props makes the
 * parent's `useState` the single source of truth.
 *
 * Accessibility: the tablist is a `role="tablist"` with each tab as
 * `role="tab"` + `aria-selected` + `aria-controls` (pointing to the
 * `id` passed in `panelId`). The selected tab gets `tabIndex={0}`,
 * the others `tabIndex={-1}` (roving tabindex pattern). The content
 * panels are `role="tabpanel"` with matching `id` + `aria-labelledby`.
 * Keyboard nav (left/right) is handled by the parent — this file is
 * a controlled primitive.
 */
import type { ReactNode } from 'react'

interface TabItem<TKey extends string> {
  key: TKey
  label: ReactNode
  /** id of the tabpanel this tab controls (for aria-controls). */
  panelId: string
}

interface TabsProps<TKey extends string> {
  items: TabItem<TKey>[]
  activeKey: TKey
  onChange: (key: TKey) => void
  /** Optional test-id for the tablist. */
  dataTestid?: string
  /** Extra classes to merge onto the tablist nav. */
  className?: string
}

export function Tabs<TKey extends string>({
  items,
  activeKey,
  onChange,
  dataTestid,
  className = '',
}: TabsProps<TKey>) {
  return (
    <nav
      role="tablist"
      aria-label="Secciones"
      data-testid={dataTestid}
      className={`flex border-b border-ink-100 ${className}`}
    >
      {items.map((item) => {
        const active = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={active}
            aria-controls={item.panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            data-testid={`tab-${item.key}`}
            className={
              active
                ? 'border-b-2 border-accent px-4 py-2 font-display text-sm font-semibold text-ink-900'
                : 'border-b-2 border-transparent px-4 py-2 font-display text-sm font-medium text-ink-500 transition-colors duration-fast hover:text-ink-700'
            }
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
