# Exploration: `athlos-toast-primitivo`

## Current State

There is **no** toast / notification primitive in the codebase. The seven
mutations in the Socios module currently signal feedback through three
different inline patterns (all Spanish, all `role="alert"`):

| Mutation | File | Current feedback | Mutation site |
|---|---|---|---|
| Create socio | `apps/web/src/app/(authed)/socios/new/page.tsx:116-126` | `<div role="alert">` block above the form | `createMutation.onSuccess → router.push('/socios')` |
| Edit socio | `apps/web/src/components/socios/SocioForm.tsx:401-409` | `errorMessage` prop renders inside the form | `updateMutation.onSuccess → setEditOpen(false)` |
| Dar baja socio | `apps/web/src/app/(authed)/socios/[id]/page.tsx:595-603` | `<p role="alert">` inside the Delete modal (`deleteError` state) | `deleteMutation.onSuccess → router.push('/socios')` |
| Reactivar socio | (none today — silent success) | nothing | `reactivateMutation.onSuccess → setConfirmReactivateOpen(false)` |
| Create note | `apps/web/src/components/socios/SocioNotesCard.tsx:239-249` | `<p role="alert">` under the textarea | `createMutation.onSuccess → setDraft('')` |
| Edit note | `SocioNotesCard.tsx:364-373` | `<p role="alert">` under the edit textarea | `updateMutation.onSuccess → setEditingId(null)` |
| Delete note | (none on success; uses `window.confirm()` for the confirm) | only `updateMutation.isError` rendered inline | `deleteMutation.onSuccess → invalidateQueries` |

All seven mutation flows live inside `@tanstack/react-query`'s
`useMutation({ onSuccess, onError })` hooks. Success handlers do
invalidation + local state reset. Error handlers (`deleteMutation` only)
push to inline state. The remaining five mutations don't even wire
`onError` — they let the error propagate to the form via the
`useMutation` cache and rely on the form's `errorMessage` prop.

**Why this hurts UX** (from `pending/work-after-pr-8b4` #254 §4):
> "Toast — feedback post-mutation. Hoy crear/editar/borrar navega
> inmediatamente sin confirmar; un toast verde de 'Socio guardado' es un
> detalle pequeño pero importante."

The user gets NO acknowledgment after a successful Reactivar, Create
note, or Delete note. After Edit / Dar baja / Create socio, the only
signal is the route change or modal close — easy to miss.

Locked product decisions (this change, frozen):

| # | Decision | Frozen value |
|---|----------|--------------|
| 1 | Library | **sonner** (~10 kB, themeable, React 19 / Next 16 compatible) |
| 2 | Position | **top-right** |
| 3 | Coverage (this PR) | SociOS only: create / edit / dar-baja / reactivar / create-note / edit-note / delete-note |
| 4 | Critical errors | toast + **modal remains open with error shown inline** (form state preserved) |
| 5 | Non-critical errors | toast only (auto-dismiss, longer duration) |
| 6 | Success variant | toast only (auto-dismiss ~4 s) |
| 7 | Future consumers | `<Toaster>` left mounted for /ctacte and /padrones, but DO NOT wire those modules in this PR |

## Affected Areas

- `apps/web/src/app/layout.tsx` — root layout (server component) gains
  `<ToasterMount />` (a new tiny client component) inside `<body>` AFTER
  the `<AuthProvider>` so the toast portal mounts under the same React
  tree as the auth-gated UI.
- `apps/web/src/components/ui/Toast.tsx` (NEW) — wraps sonner's
  `<Toaster>` with the project's token-driven styling (`surface`,
  `ink-150`, `accent`, `success`, `danger`) and locked defaults
  (position `top-right`, richColors, closeButton). Plus a thin
  `notify(type, message, opts)` helper that future consumers call
  instead of importing sonner directly.
- `apps/web/src/components/ui/Toast.test.tsx` (NEW) — vitest + RTL +
  happy-dom: assert defaults render (one Toaster mounts, one toast
  appears on `notify('success', '…')`), and that the helper forwards
  `duration` + `description`.
- `apps/web/src/app/(authed)/socios/new/page.tsx` — `createMutation`:
  add `onSuccess` toast "Socio creado" and `onError` toast "No se pudo
  crear el socio". Keep the existing inline `<div role="alert">` (it
  covers the case where the operator lingers on the page after the
  error before the toast dismisses).
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — three mutations:
  - `updateMutation` (edit): `onSuccess` toast "Cambios guardados",
    `onError` toast "No se pudieron guardar los cambios" (modal stays
    open; `SocioForm`'s `errorMessage` keeps the inline copy).
  - `deleteMutation` (dar baja): `onSuccess` toast "Socio dado de baja"
    BEFORE `router.push('/socios')` so the toast can render briefly
    before navigation; existing `deleteError` state covers inline
    display when the modal stays open.
  - `reactivateMutation`: NEW `onSuccess` toast "Socio reactivado"
    (this is the biggest UX win — silent success today).
- `apps/web/src/components/socios/SocioNotesCard.tsx` — three mutations:
  - `createMutation`: `onSuccess` toast "Nota agregada".
  - `updateMutation`: `onSuccess` toast "Nota actualizada".
  - `deleteMutation`: `onSuccess` toast "Nota eliminada" (silently
    succeeds today — biggest UX win of the three note flows).
  - The existing inline error blocks under each textarea stay —
    operators editing a note are mid-task and need the error right
    there.
- `apps/web/src/lib/notifications.ts` (NEW, tiny) — re-exports the
  `notify()` helper. Symmetric with `apps/web/src/lib/auth.ts` for the
  same import ergonomics across the codebase.

No backend change. No OpenSpec capability spec change. The change
touches one delta only.

## Codebase Scan Findings

### Library landscape — sonner is the right pick (already locked)

- `apps/web/package.json:15-29` dependencies list — `sonner` is NOT
  installed today. Confirmed by `grep -r sonner` over the repo (no
  matches) and a `pnpm-lock.yaml` scan (no `sonner` resolution).
- The only "notification" surface in the codebase is
  `apps/web/src/components/notifications/` — a **bell + dropdown**
  pattern driven by server-emitted notifications (scheduler jobs,
  approvals). It is NOT a toast system; it polls `/api/v1/notifications`
  and renders a persistent panel. Sonner is the orthogonal "transient
  feedback" surface; both coexist.
- Sonner is ~10 kB, themeable, has built-in SSR-safe portal, supports
  richColors (green / red / amber tints), `closeButton`, custom
  `className` and `description` slots. React 19 + Next 16 app-router
  compatible (mounts in a `'use client'` boundary; portal attaches to
  `document.body` after hydration).

### UI primitives inventory

`apps/web/src/components/ui/` ships exactly four primitives:
**Badge, Modal, Monogram, Tabs** (confirmed by `ls`). No Toast, no
ConfirmDialog, no EmptyState. The backlog at `pending/work-after-pr-8b4`
§4 listed Toast + ConfirmDialog + EmptyState as the three missing
primitives. This change ships Toast only; the other two stay for
future slices.

### Mutation pattern (`useMutation` everywhere)

All seven mutation sites use `@tanstack/react-query`'s `useMutation`
with `mutationFn` + `onSuccess` (always wired). Five of seven don't
even have an `onError` callback. The cleanest wiring point is the
mutation hook itself: add toast calls in `onSuccess` and `onError`.
No form changes required (existing `errorMessage` props stay for
inline persistence).

### Theme

`apps/web/tailwind.config.ts` defines token aliases only — there is
**no dark-mode toggle** anywhere in the codebase. Confirmed by
`grep -r "next-themes\|prefers-color-scheme\|dark"` over `apps/web`:
no matches. The visual contract is permanently light (white surface,
`ink-700` / `ink-900` text, `night-900` for primary buttons). Sonner
must be pinned to **`theme="light"`** (NOT `system`) to avoid
following any future OS-level dark preference that could clash with
the fixed token palette.

### localStorage + SSR pattern

Already established in two places:
- `apps/web/src/lib/auth.ts:89-143` — module-scope hydration with
  `typeof window === 'undefined'` short-circuit + `try/catch`.
- `apps/web/src/components/socios/SocioNotesCard.tsx:430-463` —
  per-socio `useNotesCollapsed` hook with the same SSR-safe guards
  and a `useState`-seeded `useEffect`.

Sonner's `<Toaster>` component must be rendered inside a `'use client'`
boundary. The root layout is a server component, so we mount it via a
tiny `<ToasterMount />` client component. Sonner handles SSR correctly
(the portal attaches post-hydration; no window references at
render-time).

### Test setup (vitest)

`apps/web/vitest.setup.ts:22-56` already polyfills `globalThis.localStorage`
via `MemoryStorage` (per `sdd/athlos-notes-collapsible/design` ED10).
Sonner's portal in happy-dom works out of the box; no extra setup
needed. Existing tests use synchronous `vi.mock` factory form
(`SocioNotesCard.test.tsx:28-55`, `AuditTab.test.tsx:15-28`,
`OperatorChip.test.tsx`) — apply phase must NOT escalate to async
`importOriginal`. The new `notify()` helper should be mockable with the
same synchronous pattern.

### API contract (no change)

`apps/api/src/routes/socios.ts` already returns:
- `POST /socios` → 201 with the new DTO
- `PATCH /socios/:id` → 200 with the updated DTO
- `DELETE /socios/:id` → 200 with the updated row (`estado: 'baja'`)
- `POST /socios/:id/notes` → 201 with the new note
- `PATCH /socios/:id/notes/:noteId` → 200 with the updated note
- `DELETE /socios/:id/notes/:noteId` → 204

`apps/web/src/lib/api/socios.ts:115-221` returns typed promises via
`apiFetch<T>`; the wrapper throws `ApiError(status, code, message)` on
4xx/5xx (`apps/web/src/lib/api.ts:154-166`). The mutation hooks
already get a typed `Error` (which is actually `ApiError`) in
`onError(err)`; the toast can read `err.message` (which is formatted
as `${code}: ${message}`).

## Approaches

### Approach A — Wrap sonner in a project helper (RECOMMENDED)

Create `apps/web/src/components/ui/Toast.tsx` exporting:

```tsx
'use client'
import { Toaster, toast } from 'sonner'
export type NotifyKind = 'success' | 'error' | 'info'
export interface NotifyOpts { description?: string; duration?: number }
export function notify(kind: NotifyKind, message: string, opts: NotifyOpts = {}): void {
  const fn = kind === 'success' ? toast.success : kind === 'error' ? toast.error : toast
  fn(message, { description: opts.description, duration: opts.duration })
}
export function ToasterMount(): JSX.Element {
  return <Toaster position="top-right" richColors closeButton theme="light" ... />
}
```

Plus a tiny `apps/web/src/lib/notifications.ts` re-exporting `notify`
for import ergonomics. Mutation sites call `notify('success', 'Socio
guardado')` instead of importing sonner directly.

- Pros: single source of truth for position / theme / close-button /
  duration defaults; trivial swap-out if sonner ever has issues;
  matches the project's "thin module-scope helpers" style
  (`lib/auth.ts`, `lib/api.ts`); trivially mockable in tests.
- Cons: 5 extra lines of indirection over a direct `toast.success()`
  call. Future consumers may bypass the helper and call sonner
  directly — mitigated by lint naming convention (low-cost).
- Effort: **Low** (~40 LoC including tests).

### Approach B — Import sonner directly at every mutation site

`import { toast } from 'sonner'` at the top of each page, call
`toast.success('Socio guardado')` inline.

- Pros: zero indirection; one less file.
- Cons: position / duration / theme defaults duplicated across 7
  mutation sites; if we ever want to change them (or migrate off
  sonner) every site changes; harder to test (each test file would
  need its own `vi.mock('sonner')`).
- Effort: **Low** (~20 LoC of imports + calls, but the change is
  longer-lived).

### Recommendation

**Approach A.** The project already has the "thin shared module"
pattern (`lib/auth.ts`, `lib/api.ts`, `lib/notifications.ts` is
already a typed wrapper around `/api/v1/notifications`). Adding
`components/ui/Toast.tsx` + `lib/notifications.ts` keeps the pattern
consistent, makes the wiring 7 sites × 1 import statement, and gives
the orchestrator one place to look when reviewing the toast policy.

## Risks

- **R1 — SSR safety of sonner in Next 16 app router.** Sonner renders
  via a `createPortal` to `document.body`. In Next 16 the root layout
  is a server component; the `<Toaster>` must mount inside a `'use
  client'` boundary (`<ToasterMount />`). If the boundary is missed,
  the page errors at build time. **Mitigation:** the wrapper is a
  dedicated `'use client'` component; apply phase asserts with
  `pnpm typecheck` + a happy-dom render test that mounts the
  `<ToasterMount />` and a toast without throwing.
- **R2 — Theme decision.** Pinning `theme="light"` is correct for the
  project's fixed token palette, but it locks the design against any
  future dark-mode effort. **Mitigation:** document the decision in
  `4-UI-Style-Gorriti-Premium.md` (out of scope for this PR — note as
  follow-up).
- **R3 — Conflict between auto-dismiss and "modal stays open" rule.**
  Sonner defaults to ~4 s auto-dismiss. The locked decision says the
  modal stays open on critical errors so the operator doesn't lose
  form state. The toast fires AND the inline error renders. Both
  coexist. **Mitigation:** toast is the primary channel; the inline
  block is the persistent record. Document in `Toast.tsx` JSDoc.
- **R4 — Accessibility of the toast region.** Sonner ships an
  `aria-live="polite"` region by default but only on the toast
  container; success/error toasts need `role="status"` and
  `role="alert"` respectively for screen readers. **Mitigation:**
  use `richColors` (sonner's default with color tints) and verify
  the rendered DOM has the right ARIA roles; explicit test in
  `Toast.test.tsx`.
- **R5 — Toast lifetime across navigation (Dar baja case).**
  `deleteMutation.onSuccess` does `router.push('/socios')` immediately.
  A toast fired before the navigation might get cleared when the page
  unmounts. **Mitigation:** fire the toast synchronously in
  `onSuccess` BEFORE `router.push`; the toast portal lives at
  `document.body` and survives a same-tree route change in Next 16
  (the layout doesn't unmount, only the page children). If tests
  show the toast is cut short, defer with `setTimeout(router.push,
  16)`. Acceptable trade-off for the 3-5 person operator console.
- **R6 — Package version pin.** Sonner's API has been stable since
  1.5.x; pin a specific version (e.g., `^1.7.4`) so the apply phase
  doesn't accidentally pull a breaking release. **Mitigation:**
  `apps/web/package.json` add as `^1.7.4`; the lockfile pins exactly.

## Ready for Proposal

Yes. The 7 mutation sites are mapped, the library is locked, the
wrapping pattern matches existing project conventions, and the SSR /
theme / accessibility risks are bounded. The orchestrator should launch
`sdd-propose` next with the precondition that the proposal locks in:
- Sonner pinned to `^1.7.4` (or the exact stable available at apply
  time).
- Wrapper at `apps/web/src/components/ui/Toast.tsx` + re-export at
  `apps/web/src/lib/notifications.ts`.
- Mount via `<ToasterMount />` client component inside the root
  `app/layout.tsx` AFTER `<AuthProvider>`.
- 7 mutation sites × `{onSuccess, onError}` wiring (no form changes;
  existing inline error blocks stay).
- Tests: 1 new `Toast.test.tsx` + 7 mutation-site test extensions (one
  per `*.test.tsx`).
- Out-of-scope (future PRs): ConfirmDialog primitive (replaces the
  `window.confirm()` in `SocioNotesCard.tsx:334-341`), EmptyState
  primitive, toast wiring in `/ctacte` and `/padrones`.