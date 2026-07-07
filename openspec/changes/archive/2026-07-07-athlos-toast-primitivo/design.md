# Design: Toast primitive (Sonner) wired to Socios mutations

**Change**: `athlos-toast-primitivo` | **Phase**: design | **Date**: 2026-07-07 | **Scope**: 3 new files + 6 edits, ~250–400 LoC

## Technical Approach

Ship a thin project wrapper around sonner (`^1.7.4`) so every Socio mutation (create / update / dar-baja / reactivar + 3 notes) signals success + error consistently via a global toast portal mounted once in the root layout, while the existing inline error blocks and modal context are preserved. The wrapper exposes a single `notify(kind, message, opts)` helper so call sites never import sonner directly and the library is swappable in one file. Mirrors the project's `lib/auth.ts` import-ergonomics pattern. No backend, no schema, no API, no `ConfirmDialog`, no `EmptyState`, no dark-mode toggle — the global `<ToasterMount />` keeps future modules (`/ctacte`, `/padrones`) ready to adopt.

## Architecture Decisions

| # | Decision | Choice | Alt rejected | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Wrapper location | `apps/web/src/components/ui/Toast.tsx` (client component) | `apps/web/src/lib/toast.ts` | Lives next to the other UI primitives (`Modal`, `Badge`, `Tabs`, `Monogram`); re-exported from `lib/notifications.ts` for ergonomic imports (`@/lib/notifications`). Symmetric with `Modal` primitive + `lib/auth.ts` re-export pattern. |
| D2 | Import surface for call sites | `import { notify } from '@/lib/notifications'` (re-export only, zero logic) | Import directly from `@/components/ui/Toast` | Matches `lib/auth.ts` precedent — single canonical ergonomic import path; the wrapper file owns ALL defaults. |
| D3 | Mount point | Single `<ToasterMount />` inside `<body>` AFTER `<AuthProvider>` in root `app/layout.tsx` | Per-route mount; mount before providers | One portal covers every authenticated route; placing it after `<AuthProvider>` guarantees the toaster lives in the same client boundary as auth-gated UI (so future auth-aware toasts, if ever needed, see the same context). Verified against current layout.tsx lines 13–24. |
| D4 | ESLint guard against wrapper bypass | `no-restricted-imports` rule on `apps/web/src/**/*.{ts,tsx}` blocking `from 'sonner'` with a fix-message pointing at the wrapper | Rely on PR review; add a codeowners rule | Mechanical prevention beats review-only; one-line rule + one-line message; matches the project's flat ESLint config style. |
| D5 | ARIA role delivery | Wrapper sets `role` via sonner's `classNames` slot — `toastOptions={{ classNames: { toast: (kind) => \`athlos-toast athlos-toast--${kind}\` } }}` AND the wrapper maps kind → role and tags the rendered `<li>` via a custom CSS selector + a one-shot `Effect` that injects `role="status"` / `role="alert"` after mount (per the `description` / `className` slots sonner exposes for v1.7.x) | Render our own portal | Sonner 1.7.x exposes a `containerAriaLabel` (the region label) and applies `aria-live="polite"` on the region container by default; per-toast `role` must be set through the `classNames` slot using a data attribute the wrapper reads, then a small DOM touch attaches the role. Verified via sonner docs (`sonner.emilkowal.ski/toaster`). |
| D6 | Auto-dismiss durations | `4000ms` success / `info`, `6000ms` error — NOT sticky | Sticky errors; `5000ms` flat | Matches the locked proposal + the spec delta to `ui-design/spec.md`; overwrites the previous `5s / sticky` prose at line 264. |
| D7 | Theme pin | `theme='light'` literal on `<Toaster>` (overrides sonner's `theme='system'` default) | `theme='system'` | No dark-mode toggle exists in the design system; pins the visual contract to the light palette so OS preference never switches the toast palette. |
| D8 | Test mock factory form | Synchronous `vi.mock('@/lib/notifications', factory)` | Async `(importOriginal) => …` | Per `athlos-notes-collapsible` design D8 + the R4 resolution in `athlos-audit-operator-display` design (#263), the actual codebase pattern is SYNCHRONOUS. Apply follows the code, not the handover note. |
| D9 | Navigation-after-toast (sites 1 + 3) | Keep existing `router.push('/socios')` order INSIDE `onSuccess` AFTER the `notify('success', …)` call. Do NOT add `setTimeout` wrapper by default. | `setTimeout(router.push, 16)` | Sonner renders into a top-level `document.body` portal; the portal survives same-tree route changes in Next 16 (root layout doesn't unmount). Apply adds the `setTimeout` wrapper ONLY IF a test demonstrates the toast is cut short. |
| D10 | Per-site messages | Stable Spanish verb-first strings (table in §7) | Generic `Operación exitosa` | Verb-first copy matches the existing inline copy (`'Socio creado'`, `'Nota agregada'` etc. in `AuditTab.tsx:69-80`) so the toast + audit timeline read identically. |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/components/ui/Toast.tsx` | Create | `'use client'` component exporting `<ToasterMount />` + `notify(kind, message, opts)`. ~60 LoC. |
| `apps/web/src/components/ui/Toast.test.tsx` | Create | Unit tests: ARIA role per kind, mount contract, default durations, return id shape. ~120 LoC. |
| `apps/web/src/lib/notifications.ts` | Create | Re-export `notify` + types from `@/components/ui/Toast`. ~5 LoC. |
| `apps/web/package.json` | Modify | Add `"sonner": "^1.7.4"` under `dependencies`. |
| `eslint.config.cjs` (repo root) | Modify | Add `no-restricted-imports` rule scoped to `apps/web/src/**/*.{ts,tsx}` blocking `sonner`. |
| `apps/web/src/app/layout.tsx` | Modify | Insert `<ToasterMount />` inside `<body>` AFTER `<AuthProvider>` (final line). |
| `apps/web/src/app/(authed)/socios/new/page.tsx` | Modify | Wire `createMutation` (site 1) with `onSuccess`/`onError`. |
| `apps/web/src/app/(authed)/socios/[id]/page.tsx` | Modify | Wire `updateMutation` (2), `deleteMutation` (3), `reactivateMutation` (4). |
| `apps/web/src/components/socios/SocioNotesCard.tsx` | Modify | Wire `createMutation` (5), `updateMutation` (6), `deleteMutation` (7). |
| `apps/web/src/app/(authed)/socios/new/page.test.tsx` | Extend | Add toast assertions (mock `@/lib/notifications`). |
| `apps/web/src/app/(authed)/socios/[id]/page.test.tsx` | Extend | Add toast assertions for sites 2/3/4. |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx` | Extend | Add toast assertions for sites 5/6/7 (file already extends in PR 8b.6; append new `describe('toast wiring', …)`). |

No CSS tokens added (reuses existing Tailwind utilities). No backend/DB changes.

## Interfaces / Contracts (source of truth for apply)

```ts
// apps/web/src/components/ui/Toast.tsx
'use client'

export type NotifyKind = 'success' | 'error' | 'info'

export interface NotifyOptions {
  /** Override auto-dismiss duration (ms). Omit to use the kind default. */
  durationMs?: number
  /** Optional id for future dismiss-by-id flows. */
  id?: string
  /** Optional secondary line under the title. */
  description?: string
}

export function notify(
  kind: NotifyKind,
  message: string,
  opts?: NotifyOptions,
): string

export function ToasterMount(): JSX.Element

// apps/web/src/lib/notifications.ts (re-export, NO logic)
export { notify } from '@/components/ui/Toast'
export type { NotifyKind, NotifyOptions } from '@/components/ui/Toast'
```

```ts
// Locked constants (Toast.tsx) — verbatim:
const TOAST_DEFAULTS = {
  position: 'top-right',
  richColors: true,
  closeButton: true,
  theme: 'light',
  duration: { success: 4000, info: 4000, error: 6000 },
  roleByKind: { success: 'status', info: 'status', error: 'alert' },
} as const
```

`notify()` reads `TOAST_DEFAULTS`, picks the kind-specific role, and forwards to `sonner.toast.success | .error | .info(message, { description, duration, id })`. `<ToasterMount />` returns `<Toaster {...TOAST_DEFAULTS} toastOptions={{ classNames: { toast: 'athlos-toast' } }} />` and mounts a tiny `useEffect` that sets `role={roleByKind[kind]}` on each toast `<li>` after render (sonner's `classNames` slot is the only first-party hook for per-toast attributes in 1.7.x). Both functions live in the same `'use client'` file.

### Mount point — pinned

```tsx
// apps/web/src/app/layout.tsx (lines 13-24 today)
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-surface text-ink-700 font-body antialiased">
        <NuqsAdapter>
          <QueryProvider>
            <AuthProvider>
              {children}
              <ToasterMount />   {/* ← INSERT HERE, line 22 */}
            </AuthProvider>
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  )
}
```

Imports add: `import { ToasterMount } from '@/components/ui/Toast'`.

### ARIA contract — pinned

| Kind | Rendered `<li>` `role` | Container default |
|------|------------------------|-------------------|
| `success` | `status` | `aria-live="polite"` (sonner default) |
| `info` | `status` | `aria-live="polite"` (sonner default) |
| `error` | `alert` | `aria-live="polite"` (sonner default; the `<li role="alert">` upgrade is what makes it assertive) |

Mechanism: `<ToasterMount />` registers a `useEffect` that walks `document.querySelectorAll('[data-sonner-toast]')` after each render and stamps `role` from a `data-kind` attribute the wrapper sets via the `classNames` slot mapping `athlos-toast--<kind>` → `data-kind="<kind>"`. Tests assert the rendered `<li>`'s `role`, not the class name.

### ESLint rule — pinned (paste into repo-root `eslint.config.cjs`)

Insert as a NEW config block (3rd entry) in the `tseslint.config(...)` array, AFTER the second config block (line 22–45) and BEFORE `prettierConfig`:

```js
{
  files: ['apps/web/src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'sonner',
            message:
              "Use `import { notify } from '@/lib/notifications'` instead of importing sonner directly. The wrapper at apps/web/src/components/ui/Toast.tsx owns all defaults.",
          },
        ],
      },
    ],
  },
},
```

## Mutation Site Wiring (pinned strings)

| # | File / Mutation | Success message | Error message |
|---|-----------------|-----------------|----------------|
| 1 | `socios/new/page.tsx` → `createMutation` | `'Socio creado'` | `'No se pudo crear el socio'` |
| 2 | `socios/[id]/page.tsx` → `updateMutation` | `'Socio actualizado'` | `'No se pudo actualizar el socio'` |
| 3 | `socios/[id]/page.tsx` → `deleteMutation` | `'Socio dado de baja'` | `'No se pudo dar de baja el socio'` |
| 4 | `socios/[id]/page.tsx` → `reactivateMutation` | `'Socio reactivado'` | `'No se pudo reactivar el socio'` |
| 5 | `SocioNotesCard.tsx` → `createMutation` | `'Nota creada'` | `'No se pudo crear la nota'` |
| 6 | `SocioNotesCard.tsx` → `updateMutation` | `'Nota actualizada'` | `'No se pudo actualizar la nota'` |
| 7 | `SocioNotesCard.tsx` → `deleteMutation` | `'Nota eliminada'` | `'No se pudo eliminar la nota'` |

Apply preserves all 7 inline error blocks (`new-socio-error`, `socio-delete-error`, `socio-note-new-error`, `socio-note-edit-…-error` `<p role="alert">`). The toast is additive feedback.

## Navigation-after-toast (sites 1 + 3)

The `router.push('/socios')` call stays INSIDE `onSuccess`, fired AFTER `notify('success', …)`. No `setTimeout` wrapper by design (D9). The apply phase verifies with a test that the toast portal survives the route change; if a regression appears, the wrapper is added in that commit only.

## Data Flow

    Mutation resolves ─┐                                          ┌─→ Sonner <Toaster> (document.body portal)
                      ├─→ onSuccess → notify('success', msg) ────┤
    Mutation rejects ─┤                                          │
                      └─→ onError   → notify('error',   msg) ────┘
                                                                       role="status"|"alert" stamped
                                                                       via classNames → data-kind → useEffect

    RootLayout `<body>` ──┬─ <NuqsAdapter> ── <QueryProvider> ── <AuthProvider>
                          │                                              └─ <ToasterMount />   (NEW)
                          └─ pages (any authed route)

    `lib/notifications.ts` (re-export) ──→ `components/ui/Toast.tsx` (notify + ToasterMount + sonner internals)

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (NEW) | `Toast.tsx` | Render `<ToasterMount />` once, then call `notify('success'|'info'|'error', msg)`. Assert rendered `<li>` carries `role="status"` for success/info, `role="alert"` for error. Assert return value is a non-empty string. Assert default duration by reading sonner's runtime attribute (asserted via `vi.useFakeTimers` + `vi.advanceTimersByTime`). |
| Unit (extend) | `new/page.test.tsx` (site 1) | Mock `@/lib/notifications` synchronously (D8). On create success → assert `notify('success', 'Socio creado')`. On create rejection → assert `notify('error', 'No se pudo crear el socio')`. |
| Unit (extend) | `[id]/page.test.tsx` (sites 2/3/4) | Same mock pattern. Cover update + delete + reactivate paths; success + error × 3 mutations = 6 assertions + the existing `router.push` assertion stays. |
| Unit (extend) | `SocioNotesCard.test.tsx` (sites 5/6/7) | Append a new `describe('toast wiring', …)` block. Same mock pattern. 6 assertions for the 3 note mutations × {success, error}. |
| Build/CI | `pnpm --filter @athlos/web typecheck` + `pnpm --filter @athlos/web lint` + per-file `pnpm --filter @athlos/web test:run -- <file>` (RAM constraint per handover #253). Local pass required before push. |

Mock factory skeleton (apply phase copy-pastes per file):

```ts
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(() => 'toast-1') }))
import { notify } from '@/lib/notifications'
// … drive mutation …
expect(notify).toHaveBeenCalledWith('success', 'Socio creado')
```

## Migration / Rollout

No migration required. Additive change; revert removes the dep + wrapper + mount + 7 wirings. No DB, no API, no schema, no migration. Sonner renders into a portal that is mounted on first client paint of the root layout; existing routes see the toast immediately on next page load.

## Rollback

Single PR fully revertible. The `pnpm remove sonner` step is the only friction; the rest is mechanical `git revert`.

## PR Shape

| Commit | Scope | Files |
|--------|-------|-------|
| **C.1** — Wrapper + tests | NEW: `Toast.tsx`, `Toast.test.tsx`, `lib/notifications.ts`; EDIT: `apps/web/package.json` (dep + lockfile) | ~190 LoC |
| **C.2** — Mount + ESLint rule | EDIT: `app/layout.tsx`, `eslint.config.cjs` | ~25 LoC |
| **C.3** — Wire SocioForm createMutation | EDIT: `socios/new/page.tsx`, `socios/new/page.test.tsx` | ~25 LoC |
| **C.4** — Wire page-level 3 mutations | EDIT: `socios/[id]/page.tsx`, `socios/[id]/page.test.tsx` | ~75 LoC |
| **C.5** — Wire SocioNotesCard 3 note mutations | EDIT: `SocioNotesCard.tsx`, `SocioNotesCard.test.tsx` | ~75 LoC |

Single PR (`athlos-toast-primitivo`). Estimated total ~390 LoC — at the upper end of the 400-line review budget but inside it. No chained PRs needed; no `size:exception` required. The 7 mutation sites each gain exactly 2 lines (`onSuccess: () => notify(...)` + `onError: () => notify(...)`), keeping the diff scannable.

## Open Questions

None. Proposal #284 + spec #285 + the source-file scan + the sonner 1.7.4 docs (verified via context7) resolve every ambiguity:

- Wrapper API shape pinned in §3 (`Interfaces`).
- Constants block pinned in §3 (`TOAST_DEFAULTS`).
- Mount point pinned in §3 (`Mount point`).
- ESLint rule text pinned in §3 (`ESLint rule`).
- Per-site messages pinned in §3 (`Mutation Site Wiring`).
- Navigation-after-toast ordering pinned in §3 + D9.
- Mock factory form pinned in D8 (synchronous, matching actual codebase pattern).

Apply phase has zero ambiguity.