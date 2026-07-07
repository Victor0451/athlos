# Toast Notifications Specification

> Synced from change `athlos-toast-primitivo` (2026-07-07).

## Purpose

The web console exposes a project-wide toast primitive so every mutation in the Socios module signals success and error consistently via a thin wrapper around sonner, mounted once globally inside the root layout. Critical errors additionally keep their existing inline error blocks so modal context and form state are preserved — toasts are additive feedback, never a substitute for persistent inline errors.

## Requirements

### Requirement: `notify` Wrapper API

The system SHALL expose `notify(kind: 'success' | 'error' | 'info', message: string, opts?: NotifyOptions): string` from `apps/web/src/components/ui/Toast.tsx` AND re-export it from `apps/web/src/lib/notifications.ts`. `NotifyOptions` SHALL accept an optional `description` string and an optional `duration` number (milliseconds). The helper SHALL return a string id usable for future dismiss-by-id flows.

#### Scenario: Success toast

- **WHEN** `notify('success', 'Socio guardado')` is called after hydration
- **THEN** a toast renders with the message "Socio guardado"
- **AND** the toast element carries `role="status"`
- **AND** the function returns a non-empty string id

#### Scenario: Error toast

- **WHEN** `notify('error', 'No se pudo guardar')` is called
- **THEN** a toast renders with the message
- **AND** the toast element carries `role="alert"`

#### Scenario: Info toast

- **WHEN** `notify('info', 'Cargando…')` is called
- **THEN** a toast renders with the message
- **AND** the toast element carries `role="status"`

#### Scenario: Defaults applied without caller args

- **WHEN** `notify('success', 'Hecho')` is called with no `opts`
- **THEN** the rendered toast uses `position='top-right'`, `theme='light'`, `closeButton`, and `richColors`
- **AND** auto-dismisses after ~4000 ms

### Requirement: Global `<ToasterMount />` Mount

The system SHALL render a `<ToasterMount />` (a dedicated `'use client'` component) exactly once, mounted inside the root `apps/web/src/app/layout.tsx` AFTER `<AuthProvider>` and inside `<body>`.

#### Scenario: Single mount renders one portal

- **WHEN** `<ToasterMount />` is rendered once inside the root layout
- **THEN** exactly one sonner `<Toaster>` portal attaches to `document.body` after hydration

#### Scenario: Mount placed after `<AuthProvider>`

- **WHEN** the root layout is rendered
- **THEN** `<ToasterMount />` SHALL appear as a later sibling of `<AuthProvider>` in the React tree
- **AND** shall live inside `<body>`

#### Scenario: SSR does not throw

- **WHEN** the root layout is rendered on the server
- **THEN** no client-only API (`window`, `document`) is referenced at render time
- **AND** no hydration mismatch warning is emitted

### Requirement: Locked Sonner Defaults

The system SHALL pass `position='top-right'`, `richColors`, `closeButton`, and `theme='light'` to sonner's `<Toaster>` so call sites need not pass them. The system SHALL auto-dismiss success and info toasts after ~4000 ms and error toasts after ~6000 ms.

#### Scenario: Success auto-dismiss

- **WHEN** `notify('success', msg)` fires without an explicit `duration`
- **THEN** the toast SHALL auto-dismiss after ~4000 ms

#### Scenario: Error auto-dismiss

- **WHEN** `notify('error', msg)` fires without an explicit `duration`
- **THEN** the toast SHALL auto-dismiss after ~6000 ms (NOT sticky)

#### Scenario: Theme pinned to light

- **WHEN** `<ToasterMount />` renders
- **THEN** sonner SHALL use `theme='light'` regardless of OS `prefers-color-scheme`

### Requirement: Wired Success and Error Toasts at 7 Socios Mutation Sites

The system SHALL wire `onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)` at exactly the 7 Socio mutation sites listed below, importing `notify` from `apps/web/src/lib/notifications.ts`. Existing inline error blocks SHALL be preserved at every site — toasts are additive feedback.

The 7 sites:

1. `createMutation` in `apps/web/src/app/(authed)/socios/new/page.tsx`
2. `updateMutation` in `apps/web/src/app/(authed)/socios/[id]/page.tsx`
3. `deleteMutation` in `apps/web/src/app/(authed)/socios/[id]/page.tsx`
4. `reactivateMutation` in `apps/web/src/app/(authed)/socios/[id]/page.tsx`
5. `createMutation` in `apps/web/src/components/socios/SocioNotesCard.tsx`
6. `updateMutation` in `apps/web/src/components/socios/SocioNotesCard.tsx`
7. `deleteMutation` in `apps/web/src/components/socios/SocioNotesCard.tsx`

#### Scenario: Per-site success renders success toast

- **WHEN** any of the 7 mutations resolves successfully
- **THEN** `notify('success', …)` SHALL be called with a Spanish, verb-first message
- **AND** a success toast SHALL render with `role="status"`

#### Scenario: Per-site error renders error toast AND preserves inline error block

- **WHEN** any of the 7 mutations rejects with an `ApiError`
- **THEN** `notify('error', …)` SHALL be called
- **AND** the existing inline error block (form `errorMessage` prop, `deleteError` state, or `<p role="alert">` under note textareas) SHALL remain visible
- **AND** the modal SHALL stay open so form state is preserved

#### Scenario: Sites that navigate keep their navigation behaviour

- **WHEN** `createMutation` (site 1) or `deleteMutation` (site 3) succeeds
- **THEN** the existing `router.push('/socios')` SHALL still fire AFTER the success toast
- **AND** the toast SHALL be visible long enough to be noticed (auto-dismiss ~4000 ms outlasts the route change)

### Requirement: `sonner` Dependency Pin

The system SHALL declare `"sonner": "^1.7.4"` under `dependencies` in `apps/web/package.json`, with the lockfile pinning the exact resolved version.

#### Scenario: Package manifest declares the pin

- **WHEN** `apps/web/package.json` is inspected
- **THEN** `dependencies` SHALL include `"sonner": "^1.7.4"`
- **AND** `pnpm-lock.yaml` SHALL resolve sonner to a single 1.7.x version

## Success Criteria

- [ ] `notify` exported from `components/ui/Toast.tsx` and re-exported from `lib/notifications.ts`.
- [ ] `<ToasterMount />` mounted globally in root layout AFTER `<AuthProvider>`.
- [ ] All 7 sites wire `onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)`.
- [ ] Inline error blocks preserved at all 7 sites (modal stays open on error).
- [ ] ARIA roles asserted: `role="status"` for success/info, `role="alert"` for error.
- [ ] Defaults: `top-right`, `light`, `richColors`, `closeButton`; ~4000 ms success / ~6000 ms error.
- [ ] `pnpm typecheck` + `pnpm lint` clean; full web test suite passes.