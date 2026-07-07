# Proposal: Toast primitive (Sonner) wired to Socios mutations

## Why

The Socios module has 7 mutations (create / update / dar-baja / reactivar + 3 notes) with inconsistent feedback: some sites render inline error blocks, three flow silently on success (Reactivar, Create note, Delete note), and the others signal via route change or modal close only. This change introduces a project-wide toast primitive (Sonner) wired to all 7 mutations. Critical errors also keep the inline error block + open modal — no lost form state.

## What changes

- New dep: `sonner@^1.7.4` in `apps/web/package.json`.
- New `apps/web/src/components/ui/Toast.tsx` — exports `<ToasterMount />` (client component) + `notify(kind, message, opts)`.
- New `apps/web/src/lib/notifications.ts` — re-exports `notify` (mirrors `lib/auth.ts`).
- Edit `apps/web/src/app/layout.tsx` — mount `<ToasterMount />` inside `<body>` AFTER `<AuthProvider>`.
- Wire `onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)` at the 7 mutation sites (no form changes; inline error blocks stay).
- New `Toast.test.tsx`; extend the 7 mutation-site test files with toast assertions.

## Scope

**In:** `apps/web/package.json`; `apps/web/src/components/ui/Toast.tsx` + `.test.tsx` (NEW); `apps/web/src/lib/notifications.ts` (NEW); `apps/web/src/app/layout.tsx`; `apps/web/src/app/(authed)/socios/new/page.tsx` (site 1); `apps/web/src/app/(authed)/socios/[id]/page.tsx` (sites 2/3/4); `apps/web/src/components/socios/SocioNotesCard.tsx` + its test (sites 5/6/7).

**Out:** no `<ConfirmDialog>` primitive (separate PR — replaces `window.confirm()` in `SocioNotesCard.tsx:334-341`); no `<EmptyState>` primitive; no `/ctacte` or `/padrones` wiring (global mount keeps them ready to adopt); no dark-mode toggle; no backend / schema / API change.

## Approach

- `notify(kind: 'success' | 'error' | 'info', message, opts?: { description?; duration? })` forwards to sonner's `toast.success/error/info` with locked defaults: `position: 'top-right'`, `richColors: true`, `closeButton: true`, `theme: 'light'`.
- Mount `<ToasterMount />` ONCE in root `app/layout.tsx` (client component, after `<AuthProvider>`).
- At each site the mutation gains `onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)`; existing inline error blocks stay untouched.
- Sonner pinned `^1.7.4`; lockfile pins exactly.

## Capabilities

**New:** `toast-notifications` — `notify(kind, message, opts)` API + global `<ToasterMount />` mount.

**Modified:** None.

## User-visible behaviour

After a successful create / edit / dar-baja / reactivar / note action, a small toast in the top-right confirms the action. On error, a toast appears AND the inline error block stays visible (modal open, form preserved). Auto-dismiss ~4s success, ~6s error. Critical errors persist until dismissed.

## Risks & mitigations

- **SSR safety** — `<ToasterMount />` is `'use client'`; root layout stays a server component.
- **Theme pin** — `theme="light"` documented in wrapper JSDoc; future dark-mode work is a follow-up.
- **Auto-dismiss vs "modal stays open"** — both channels coexist (toast + inline).
- **Accessibility** — assert `role="status"` for success/info, `role="alert"` for error in `Toast.test.tsx`.
- **Package-version pin** — `^1.7.4` exact in `apps/web/package.json`.
- **Wrapper bypass** — future consumers may call `toast.success()` directly; mitigated via lint naming convention.

## Rollback plan

Additive. Revert removes the dep + wrapper + mount + 7 wirings. No DB, no API, no migration. Each site independently revertible.

## Dependencies

New: `sonner@^1.7.4`. All else existing.

## Open questions

None. See `sdd/athlos-toast-primitivo/explore` (#282).

## Success criteria

- [ ] `notify()` exported from `components/ui/Toast.tsx` and re-exported from `lib/notifications.ts`.
- [ ] `<ToasterMount />` mounted globally in root layout AFTER `<AuthProvider>`.
- [ ] All 7 sites wire `onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)`.
- [ ] Inline error blocks preserved at all 7 sites.
- [ ] ARIA roles asserted (`role="status"` success/info, `role="alert"` error).
- [ ] Defaults: top-right, light, richColors on, closeButton on; ~4s success / ~6s error.
- [ ] `Toast.test.tsx` covers wrapper; 7 site tests extended.
- [ ] `pnpm typecheck` + `pnpm lint` clean; full web test suite passes.