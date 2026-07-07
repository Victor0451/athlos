# Verify Report — `athlos-toast-primitivo` (PR #17, merged at main HEAD `75e5d25`)

**Change:** `athlos-toast-primitivo`
**Phase:** verify
**Date:** 2026-07-07
**PR:** #17 (MERGED) → `75e5d25 Merge pull request #17 from Victor0451/feat/toast-primitivo`
**Verdict:** **PASS** — all 5 spec requirements and all 18 spec scenarios are satisfied with runtime test evidence. Ready for `sdd-archive`.

---

## Summary

All 5 requirements from `specs/toast-notifications/spec.md` and all 18 scenarios are satisfied by the merged implementation. The `ui-design` delta (1 ADDED requirement with 4 scenarios) is also covered. 67 tests directly exercise the toast surface (17 in `Toast.test.tsx` + 9 in `socios/new/page.test.tsx` + 19 in `socios/[id]/page.test.tsx` + 22 in `SocioNotesCard.test.tsx`). `pnpm typecheck` and `pnpm lint` are clean. No CRITICAL, no WARNING. One SUGGESTION noted (separate from spec).

## Completeness Table

| Artifact | Status | Evidence |
|---|---|---|
| `proposal.md` | Present | 69 lines |
| `specs/toast-notifications/spec.md` (NEW) | Present | 5 requirements, 18 scenarios |
| `specs/ui-design/spec.md` (delta) | Present | 1 ADDED requirement, 4 scenarios |
| `design.md` | Present | 229 lines |
| `tasks.md` | Present | 7 commits (C.1, C.2, C.3, C.4, C.5a, C.5b, docs) |
| `Toast.tsx` wrapper (NEW) | Present | 150 LoC |
| `Toast.test.tsx` (NEW) | Present | 245 LoC, 17 tests |
| `lib/notifications.ts` re-export (NEW) | Present | 15 LoC |
| `app/layout.tsx` mount | Wired | `<ToasterMount />` at line 22 |
| `eslint.config.cjs` rule | Wired | `no-restricted-imports` for sonner |
| `apps/web/package.json` | Wired | `"sonner": "^1.7.4"` at line 27 |
| `pnpm-lock.yaml` | Pinned | `sonner@1.7.4` exact |

## Build / Type / Lint Evidence

| Command | Result |
|---|---|
| `pnpm --filter @athlos/web typecheck` | **PASS** (clean — no output) |
| `pnpm --filter @athlos/web lint` | **PASS** (clean — no output) |

## Test Evidence

| File | Tests | Result | Coverage |
|---|---|---|---|
| `src/components/ui/Toast.test.tsx` | 17 | **PASS** (1.29s) | Wrapper API + ARIA + mount + durations + class stamping + id/description forwarding |
| `src/app/(authed)/socios/new/page.test.tsx` | 9 | **PASS** (1.83s) | Site 1 wiring: `notify('success', 'Socio creado')` + `notify('error', 'No se pudo crear el socio')` |
| `src/app/(authed)/socios/[id]/page.test.tsx` | 19 | **PASS** (2.51s) | Sites 2/3/4 wiring + inline error preserved + `router.push` ordering |
| `src/components/socios/SocioNotesCard.test.tsx` | 22 | **PASS** (2.01s) | Sites 5/6/7 wiring + inline error preserved |

Full suite: **548 / 548 passed (58 files)** in 68.71s when invoked without a file filter.

Note: `src/lib/notifications.test.ts` does not exist — the file is a pure re-export module (mirrors `lib/auth.ts`) with no logic to test. The wrapper is fully covered by `Toast.test.tsx`.

## Spec Compliance Matrix — toast-notifications

### Requirement R1: `notify` Wrapper API

`notify(kind: 'success' | 'error' | 'info', message, opts?)` exported from `apps/web/src/components/ui/Toast.tsx` AND re-exported from `apps/web/src/lib/notifications.ts`. `NotifyOptions` accepts optional `description`, `durationMs`, `id`. Returns a non-empty string id.
- **Status:** **PASS**
- **Evidence:**
  - `apps/web/src/components/ui/Toast.tsx:44` `export type NotifyKind = (typeof KIND_VALUES)[number]`
  - `apps/web/src/components/ui/Toast.tsx:46-53` `export interface NotifyOptions { durationMs?; id?; description? }`
  - `apps/web/src/components/ui/Toast.tsx:73` `export function notify(kind: NotifyKind, message: string, opts?: NotifyOptions): string`
  - `apps/web/src/lib/notifications.ts:14-15` `export { notify } from '@/components/ui/Toast'`
- **Test coverage:** `apps/web/src/components/ui/Toast.test.tsx:97-101` (returns non-empty string id) + `:155-180` (forwards duration/options correctly via spy path).

### Requirement R2: Global `<ToasterMount />` Mount

Single `<ToasterMount />` (dedicated `'use client'` component) mounted inside root `apps/web/src/app/layout.tsx` AFTER `<AuthProvider>` and inside `<body>`.
- **Status:** **PASS**
- **Evidence:**
  - `apps/web/src/components/ui/Toast.tsx:118` `export function ToasterMount(): ReactElement` (returns the `<Toaster>`)
  - `apps/web/src/app/layout.tsx:7` `import { ToasterMount } from '@/components/ui/Toast'`
  - `apps/web/src/app/layout.tsx:20-23` `<AuthProvider>` opens at line 20, `{children}` at line 21, `<ToasterMount />` at line 22, `</AuthProvider>` at line 23 — mount is INSIDE `<AuthProvider>` (later sibling of `{children}`) and INSIDE `<body>`.
- **Test coverage:** `apps/web/src/components/ui/Toast.test.tsx:65-89` (mounts inside AuthProvider + QueryClientProvider chain; sonner section reachable in document.body).

### Requirement R3: Locked Sonner Defaults

`<Toaster>` receives `position='top-right'`, `richColors`, `closeButton`, `theme='light'`. `notify()` forwards `duration: 4000` for success/info, `duration: 6000` for error.
- **Status:** **PASS**
- **Evidence:**
  - `apps/web/src/components/ui/Toast.tsx:138-148` `<Toaster position="top-right" richColors closeButton theme="light" toastOptions={...}>`
  - `apps/web/src/components/ui/Toast.tsx:55-59` `DEFAULT_DURATION_MS = { success: 4000, info: 4000, error: 6000 }`
  - `apps/web/src/components/ui/Toast.tsx:74` `const duration = opts?.durationMs ?? DEFAULT_DURATION_MS[kind]`
- **Test coverage:** `apps/web/src/components/ui/Toast.test.tsx:154-180` (spy path: success duration=4000, error duration=6000, info duration=4000, explicit durationMs override honoured).

### Requirement R4: Wired Success and Error Toasts at 7 Socios Mutation Sites

`onSuccess` → `notify('success', …)` and `onError` → `notify('error', …)` at all 7 sites, importing `notify` from `@/lib/notifications`. Inline error blocks preserved.
- **Status:** **PASS**
- **Evidence (all 7 sites, all using `@/lib/notifications`):**
  1. `apps/web/src/app/(authed)/socios/new/page.tsx:10` import + `:66, 71` `createMutation` onSuccess `notify('success', 'Socio creado')` / onError `notify('error', 'No se pudo crear el socio')`. Inline `<div role="alert" data-testid="new-socio-error">` preserved at lines 121-131.
  2. `apps/web/src/app/(authed)/socios/[id]/page.tsx:38` import + `:168, 174` `updateMutation` onSuccess `notify('success', 'Socio actualizado')` / onError `notify('error', 'No se pudo actualizar el socio')`. Inline `errorMessage` prop wired at `:552`.
  3. `apps/web/src/app/(authed)/socios/[id]/page.tsx:181, 187` `deleteMutation` onSuccess `notify('success', 'Socio dado de baja')` / onError `notify('error', 'No se pudo dar de baja el socio')`. Inline `deleteError` state preserved at `:188-192` + rendered block at `:606-614`.
  4. `apps/web/src/app/(authed)/socios/[id]/page.tsx:199, 205` `reactivateMutation` onSuccess `notify('success', 'Socio reactivado')` / onError `notify('error', 'No se pudo reactivar el socio')`.
  5. `apps/web/src/components/socios/SocioNotesCard.tsx:18` import + `:91, 97` `createMutation` onSuccess `notify('success', 'Nota creada')` / onError `notify('error', 'No se pudo crear la nota')`. Inline `<p role="alert" data-testid="socio-note-new-error">` preserved at `:252-262`.
  6. `apps/web/src/components/socios/SocioNotesCard.tsx:105, 112` `updateMutation` onSuccess `notify('success', 'Nota actualizada')` / onError `notify('error', 'No se pudo actualizar la nota')`. Inline `<p role="alert">` preserved at `:377-386`.
  7. `apps/web/src/components/socios/SocioNotesCard.tsx:119, 124` `deleteMutation` onSuccess `notify('success', 'Nota eliminada')` / onError `notify('error', 'No se pudo eliminar la nota')`.
- **Call site count:** 14 total `notify(...)` invocations across the 3 mutation files (= 7 mutations × 2 channels). Verified via `grep -c "notify("` on the 3 files.
- **Test coverage:** `apps/web/src/app/(authed)/socios/new/page.test.tsx:220-266` (site 1), `apps/web/src/app/(authed)/socios/[id]/page.test.tsx:397-494` (sites 2/3/4, 6 assertions), `apps/web/src/components/socios/SocioNotesCard.test.tsx:401-487` (sites 5/6/7, 6 assertions in the new `describe('toast wiring')` block). Inline error preservation asserted in `[id]/page.test.tsx:447-464` (deleteError block stays on delete failure) and `SocioNotesCard.test.tsx:417-429` (socio-note-new-error stays on create failure).
- **Navigation-after-toast edge case (sites 1 + 3):** `router.push('/socios')` stays INSIDE `onSuccess` AFTER the success notify, per design D9. Confirmed at `apps/web/src/app/(authed)/socios/new/page.tsx:65-69` and `:178-185`. Per-site tests at `[id]/page.test.tsx:427-444` and `new/page.test.tsx:218-246` assert both the toast AND the navigation.

### Requirement R5: `sonner` Dependency Pin

`"sonner": "^1.7.4"` under `dependencies` in `apps/web/package.json`, with the lockfile pinning the exact resolved version.
- **Status:** **PASS**
- **Evidence:**
  - `apps/web/package.json:27` `"sonner": "^1.7.4"` inside the `dependencies` block (line 15 opens `dependencies`).
  - `pnpm-lock.yaml:4200` `sonner@1.7.4:` and `:8142` `sonner@1.7.4(react-dom@19.0.0(...))(react@19.0.0):` — single 1.7.x resolved version, React 19 peer-dep satisfied.
- **Test coverage:** N/A (static manifest check).

## Spec Compliance Matrix — ui-design delta

### Requirement: Toast / Alert Banner Defaults (ADDED)

The locked visual / behavioural contract: `top-right`, `success/info/error`, `theme='light'`, close button, ~4000ms / ~6000ms auto-dismiss (NOT sticky), ARIA `role="status"` (success/info) + `role="alert"` (error). Wrapper is the single entry point.
- **Status:** **PASS**
- **Evidence:** Same as R1 + R2 + R3 + ARIA evidence above. The OLD prose at `openspec/specs/ui-design/spec.md:259-264` (`5s / sticky`, `warning` variant) is explicitly superseded per the delta line 18 of `openspec/changes/athlos-toast-primitivo/specs/ui-design/spec.md` — this is a documented design tradeoff (see discovery #286).
- **Test coverage:** All four ui-design delta scenarios covered by the same Toast.test.tsx render-path tests as R1/R3 (`:103-150`).

## ARIA Coverage Matrix

| Kind | Spec role | Implementation | Test assertion |
|---|---|---|---|
| `success` | `role="status"` | `Toast.tsx:36` `ROLE_BY_KIND.success = 'status'`; stamped via `:125-135` useEffect reading `athlos-toast--success` className | `Toast.test.tsx:103-110` (renders `<li>` with `role="status"` after effect) |
| `info` | `role="status"` | `Toast.tsx:37` `ROLE_BY_KIND.info = 'status'`; same mechanism | `Toast.test.tsx:121-128` |
| `error` | `role="alert"` | `Toast.tsx:38` `ROLE_BY_KIND.error = 'alert'`; same mechanism | `Toast.test.tsx:112-119` |
| Multiple concurrent | mixed | Stamped independently per toast | `Toast.test.tsx:139-150` (3 toasts → 2 `status` + 1 `alert`) |

ARIA mechanism: sonner 1.7.x has no first-party per-toast `role` API. Wrapper stamps `athlos-toast--<kind>` class via the `classNames.toast` slot (`Toast.tsx:86`) and a `useEffect` in `<ToasterMount />` (`Toast.tsx:125-135`) walks `[data-sonner-toast]` and sets `role` + `data-kind` after render. Test `Toast.test.tsx:54-90` mounts the real `<ToasterMount />` to verify the live behavior.

## Correctness Table (Spec ↔ Implementation)

| Spec requirement | Implementation location | Match |
|---|---|---|
| `notify(kind, msg, opts?) → string` | `Toast.tsx:73-105` | YES |
| `NotifyOptions.{description?, durationMs?, id?}` | `Toast.tsx:46-53` | YES |
| Re-export from `lib/notifications.ts` | `lib/notifications.ts:14-15` | YES |
| `<ToasterMount />` after `<AuthProvider>` in `app/layout.tsx` | `layout.tsx:22` (inside `<AuthProvider>` at `:20-23`) | YES |
| `position='top-right'` | `Toast.tsx:139` | YES |
| `richColors` | `Toast.tsx:140` | YES |
| `closeButton` | `Toast.tsx:141` | YES |
| `theme='light'` | `Toast.tsx:142` | YES |
| Success/info ~4000ms | `Toast.tsx:55-58` + `:74` | YES |
| Error ~6000ms | `Toast.tsx:58` + `:74` | YES |
| 7 mutation sites wired | 14 `notify(...)` calls across 3 files | YES |
| Inline error blocks preserved | Confirmed at all 7 sites (see R4 evidence) | YES |
| `role="status"` for success/info | `Toast.tsx:36-37` + `:132` | YES |
| `role="alert"` for error | `Toast.tsx:38` + `:132` | YES |
| `sonner@^1.7.4` | `package.json:27` + `pnpm-lock.yaml:4200, 8142` | YES |
| ESLint rule blocks direct sonner imports | `eslint.config.cjs:51-67` (with wrapper override at `:71-76`) | YES |

## Design Coherence Table

| Design decision | Implementation status |
|---|---|
| D1: Wrapper at `components/ui/Toast.tsx` + re-export at `lib/notifications.ts` | Met |
| D2: Call sites import from `@/lib/notifications` | Met |
| D3: Mount inside `<body>` after `<AuthProvider>` | Met |
| D4: ESLint `no-restricted-imports` rule | Met (with the documented wrapper override) |
| D5: ARIA via `classNames` slot + DOM-touch `useEffect` | Met |
| D6: 4000ms / 6000ms durations | Met |
| D7: `theme='light'` literal | Met |
| D8: Synchronous `vi.mock('@/lib/notifications', factory)` | Met — all 3 mutation test files use the synchronous factory pattern (e.g. `socios/new/page.test.tsx:42-45`) |
| D9: Navigation-after-toast: `router.push` AFTER notify, no `setTimeout` | Met |
| D10: Spanish verb-first copy | Met (string-for-string match against design §7 table) |

## Pre-existing CI failures (NOT from this PR)

Documented in apply-progress #290 — these failures were already on `main` before PR #17 was merged:

1. **`test` job** — `apps/web/src/app/admin/gastos/[id]/page.test.tsx:141` `React is not defined` (NOT touched by this PR; pre-existing flaky test).
2. **`labeler` job** — labeler pattern drift (NOT touched by this PR; pre-existing config issue).
3. **`Docker build smoke` job** — `apps/api/docker-entrypoint.sh:31` `log_error: command not found` (NOT touched by this PR; backend smoke job).

Local runs of the 4 toast-surface test files via `pnpm --filter @athlos/web exec vitest run <file>` and the full web suite via `pnpm --filter @athlos/web test:run` both pass clean — **no failures introduced by this PR**.

## Issues

- **CRITICAL:** None.
- **WARNING:** None.
- **SUGGESTION:**
  - `src/lib/notifications.ts` re-exports `NotifyKind` and `NotifyOptions` as type-only. Some future callers may want a default-export convenience (`import notify from '@/lib/notifications'`) — not needed today, but easy to add if a third surface (e.g. ctacte / padrones / admin) starts importing this. Out of scope per the proposal §"Out of scope".

## Final Verdict

**PASS** — All 5 spec requirements (R1–R5) and all 18 scenarios in `specs/toast-notifications/spec.md` are satisfied with runtime test evidence. The ui-design ADDED requirement with 4 scenarios is also covered. Typecheck + lint clean. Full web test suite green (548/548).

**Ready for `sdd-archive`.**