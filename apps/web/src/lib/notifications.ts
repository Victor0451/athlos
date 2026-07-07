/**
 * Canonical import surface for the toast primitive — re-exports
 * `notify` + the `NotifyKind` / `NotifyOptions` types from the
 * wrapper at `@/components/ui/Toast`. Mirrors the
 * `lib/auth.ts` precedent: callers import from `@/lib/notifications`
 * so the wrapper module (which owns every project default) is the
 * only file that ever touches sonner.
 *
 * The ESLint `no-restricted-imports` rule installed in C.2 forbids
 * `import … from 'sonner'` inside `apps/web/src`; consumers MUST
 * use this module instead.
 */

export { notify } from '@/components/ui/Toast'
export type { NotifyKind, NotifyOptions } from '@/components/ui/Toast'
