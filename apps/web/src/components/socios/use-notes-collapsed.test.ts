import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * useNotesCollapsed — isolated hook unit tests (PR 8b.6, task C.1).
 *
 * The hook is exported from `./SocioNotesCard` with an `@internal`
 * JSDoc marker; this file owns the unit-level coverage of its SSR-safe
 * localStorage persistence contract. The component-level coverage
 * (toggle button, ARIA, edit-while-collapsed guard) lives in
 * `SocioNotesCard.test.tsx`.
 *
 * `MemoryStorage` polyfill (from `apps/web/vitest.setup.ts`) is
 * installed on `globalThis.localStorage` and cleared between tests,
 * so each `it(...)` starts from an empty storage.
 */

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const STORAGE_KEY = `notes-collapsed-${SOCIO_ID}`

const { useNotesCollapsed } = await import('./SocioNotesCard')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useNotesCollapsed', () => {
  it('defaults to collapsed with no persisted state and no editing id', () => {
    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    expect(result.current.collapsed).toBe(true)
    expect(result.current.displayExpanded).toBe(false)
    expect(typeof result.current.toggle).toBe('function')
  })

  it('derives displayExpanded=true when editingId is non-null even with collapsed:true', () => {
    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, 'note-7'))

    expect(result.current.collapsed).toBe(true)
    expect(result.current.displayExpanded).toBe(true)
  })

  it('reverts displayExpanded to !collapsed when editingId flips from non-null to null', () => {
    const { result, rerender } = renderHook(
      ({ editingId }: { editingId: string | null }) => useNotesCollapsed(SOCIO_ID, editingId),
      { initialProps: { editingId: 'note-7' as string | null } },
    )

    expect(result.current.displayExpanded).toBe(true)

    rerender({ editingId: null })

    expect(result.current.displayExpanded).toBe(false)
    expect(result.current.collapsed).toBe(true)
  })

  it('toggle flips collapsed to false and writes the literal string "false" to localStorage', () => {
    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(false)
    expect(result.current.displayExpanded).toBe(true)
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('rehydrates collapsed=false from localStorage on mount', async () => {
    globalThis.localStorage.setItem(STORAGE_KEY, 'false')

    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    await waitFor(() => {
      expect(result.current.collapsed).toBe(false)
    })
    expect(result.current.displayExpanded).toBe(true)
  })

  it('rehydrates collapsed=true from localStorage when persisted "true"', async () => {
    globalThis.localStorage.setItem(STORAGE_KEY, 'true')

    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    // Initial state already matches — assert it stays collapsed after the effect fires.
    expect(result.current.collapsed).toBe(true)

    await waitFor(() => {
      expect(result.current.collapsed).toBe(true)
    })
    expect(result.current.displayExpanded).toBe(false)
  })

  it('keeps default collapsed when localStorage.getItem throws on mount', async () => {
    const getItemSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('quota')
    })

    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    expect(result.current.collapsed).toBe(true)
    expect(result.current.displayExpanded).toBe(false)

    // Let the effect run; it should silently swallow the throw.
    await waitFor(() => {
      expect(getItemSpy).toHaveBeenCalled()
    })

    expect(result.current.collapsed).toBe(true)
  })

  it('still flips in-memory state when localStorage.setItem throws on toggle', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    const { result } = renderHook(() => useNotesCollapsed(SOCIO_ID, null))

    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(false)
    expect(result.current.displayExpanded).toBe(true)
  })
})
