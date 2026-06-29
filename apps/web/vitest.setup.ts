import { beforeEach, expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

/**
 * Vitest setup for @athlos/web.
 *
 * Vitest 2.1 with jsdom 25 doesn't expose `localStorage` / `sessionStorage`
 * on globalThis (jsdom 25 dropped these from `window`). Rather than fight
 * the framework, we polyfill them on `globalThis` so any code — including
 * the `localStorage`/`sessionStorage` bare identifiers in test files —
 * resolves to a working in-memory implementation.
 *
 * Storage is cleared between tests so module-scope auth state is isolated.
 *
 * jest-dom matchers (`toBeInTheDocument`, etc.) are registered explicitly
 * here because `@testing-library/jest-dom/vitest` auto-registration does
 * not work reliably across vitest 2.x versions.
 */

expect.extend(matchers)

class MemoryStorage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

const localStoragePolyfill = new MemoryStorage()
const sessionStoragePolyfill = new MemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStoragePolyfill,
  writable: true,
  configurable: true,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStoragePolyfill,
  writable: true,
  configurable: true,
})

beforeEach(() => {
  localStoragePolyfill.clear()
  sessionStoragePolyfill.clear()
})

// eslint-disable-next-line no-console
console.log(
  '[vitest.setup.ts] loaded; globalThis.localStorage type:',
  typeof (globalThis as Record<string, unknown>).localStorage,
)
