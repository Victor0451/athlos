# Tasks: Toast primitive (Sonner) wired to Socios mutations (PR 8b.7)

**Change**: `athlos-toast-primitivo`
**Scope**: 3 new files + 7 edits, ~390 LoC, 5 work-unit commits, single PR
**Spec**: `openspec/changes/athlos-toast-primitivo/specs/toast-notifications/spec.md` + `openspec/changes/athlos-toast-primitivo/specs/ui-design/spec.md` (delta)
**Design**: `openspec/changes/athlos-toast-primitivo/design.md`
**Proposal**: `openspec/changes/athlos-toast-primitivo/proposal.md`

## Review Workload Forecast

- PR single estimated changed lines: ~390
- 400-line budget risk: LOW (design says ~390, on the upper edge)
- Chained PRs recommended: No
- Decision needed before apply: No (well under 400 even if minor creep)
- Notes: single-PR slice; commits C.1–C.5; if actual diff exceeds 400, split C.5 (notes) into C.5a and C.5b rather than the bigger commits.

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low
```

## Dependency Graph

```
C.1 wrapper (Toast.tsx + lib/notifications.ts + Toast.test.tsx + sonner dep)
   │
   ▼
C.2 mount <ToasterMount /> in root layout + ESLint no-restricted-imports rule
   │
   ▼
C.3 site 1 (socios/new createMutation)
   │
   ▼
C.4 sites 2/3/4 (socios/[id] update / delete / reactivate)
   │
   ▼
C.5 sites 5/6/7 (SocioNotesCard create / update / delete note)
```

Each commit leaves the repo green (typecheck + lint + per-file test).

## Work-Unit Commit Table (PR single)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| C.1    | `Toast.tsx` wrapper + `Toast.test.tsx` + `lib/notifications.ts` re-export + `apps/web/package.json` (`sonner ^1.7.4` + lockfile) | ~80–190 | RED→GREEN |
| C.2    | Mount `<ToasterMount />` in root `app/layout.tsx` (after `<AuthProvider>`, inside `<body>`) + repo-root `eslint.config.cjs` `no-restricted-imports` block | ~20–30 | mount assertion (test file in C.1) |
| C.3    | Wire `createMutation` in `socios/new/page.tsx` (site 1) + test extension (`page.test.tsx`) | ~30–50 | RED→GREEN |
| C.4    | Wire 3 page-level mutations (`updateMutation`, `deleteMutation`, `reactivateMutation`) in `socios/[id]/page.tsx` (sites 2/3/4) + test extension | ~80–120 | RED→GREEN |
| C.5    | Wire 3 note mutations (`createMutation`, `updateMutation`, `deleteMutation`) in `SocioNotesCard.tsx` (sites 5/6/7) + test extension | ~80–120 | RED→GREEN |

Total: ~290–510 LoC (mid-point ~390, matching design). Each commit ≤ ~190 LoC. TDD-paired (test in same commit as behavior). If actual diff exceeds 400, apply phase splits C.5 into C.5a (createNote + updateNote) and C.5b (deleteNote) rather than touching the bigger commits.

### Mock factory convention (applies to C.3 / C.4 / C.5)

Design D8 + spec R4 resolution: synchronous `vi.mock` form, matching the actual codebase pattern. Apply copy-pastes per test file:

```ts
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(() => 'toast-1') }))
import { notify } from '@/lib/notifications'
// … drive mutation …
expect(notify).toHaveBeenCalledWith('success', 'Socio creado')
```

## Task List

### Task C.1 — Sonner wrapper, mount component, re-export, and unit tests
- **File(s):**
  - `apps/web/src/components/ui/Toast.tsx` (NEW, `'use client'`) — exports `NotifyKind`, `NotifyOptions`, `notify(kind, message, opts)`, `<ToasterMount />`. Holds the locked `TOAST_DEFAULTS` constant (design §3) verbatim. Renders `<Toaster>` with `position='top-right'`, `richColors`, `closeButton`, `theme='light'`, and a `classNames.toast` slot stamping `athlos-toast athlos-toast--<kind>`. Mounts a `useEffect` that walks `document.querySelectorAll('[data-sonner-toast]')` and stamps `role={roleByKind[kind]}` (success/info → `status`, error → `alert`).
  - `apps/web/src/components/ui/Toast.test.tsx` (NEW) — unit tests for the wrapper and the mount.
  - `apps/web/src/lib/notifications.ts` (NEW) — re-export of `notify` + `NotifyKind` + `NotifyOptions` from `@/components/ui/Toast`. NO logic, mirrors `lib/auth.ts` shape.
  - `apps/web/package.json` — add `"sonner": "^1.7.4"` under `dependencies`. Run `pnpm install` to update `pnpm-lock.yaml`.
- **Behavior:** Calling `notify('success' | 'info' | 'error', message, opts?)` renders a toast via sonner with the locked defaults (top-right, light, richColors, closeButton), `role="status"` for success/info, `role="alert"` for error, auto-dismiss ~4000 ms (success/info) / ~6000 ms (error), and returns a non-empty string id. The function never imports sonner directly at the call site — re-exported via `lib/notifications.ts`.
- **Tests added (RED):**
  - `notify('success', 'X')` returns a non-empty string id.
  - After `notify('success', 'X')`, a rendered `<li>` with `data-sonner-toast` exists in `document` and carries `role="status"`.
  - After `notify('info', 'X')`, the rendered `<li>` carries `role="status"`.
  - After `notify('error', 'X')`, the rendered `<li>` carries `role="alert"`.
  - `<ToasterMount />` renders exactly one sonner portal; `document.querySelectorAll('[data-sonner-toast]')` is empty before any `notify()` call.
  - With `vi.useFakeTimers()`, a success toast is still in document after `vi.advanceTimersByTime(3999)` and gone after `vi.advanceTimersByTime(4001)`.
  - With `vi.useFakeTimers()`, an error toast is still in document after `vi.advanceTimersByTime(5999)` and gone after `vi.advanceTimersByTime(6001)`.
  - `notify('success', 'X', { description: 'Y' })` renders the description under the title (assert via `screen.getByText('Y')`).
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ui/Toast.test.tsx
  ```
- **Commit:** `feat(web): sonner toast wrapper with ARIA roles and locked defaults`

### Task C.2 — Mount `<ToasterMount />` globally + ESLint no-restricted-imports rule
- **File(s):**
  - `apps/web/src/app/layout.tsx` — add `import { ToasterMount } from '@/components/ui/Toast'`. Insert `<ToasterMount />` as the last child of `<AuthProvider>` (today line 22, after `{children}`). Root layout stays a server component; only `Toast.tsx` carries `'use client'`.
  - `eslint.config.cjs` (repo root) — add a NEW `tseslint.config(...)` entry (3rd, BEFORE `prettierConfig`) with `files: ['apps/web/src/**/*.{ts,tsx}']` and the `no-restricted-imports` rule blocking `from 'sonner'` (verbatim text from design §3, with the "use `import { notify } from '@/lib/notifications'`" fix-message).
  - `apps/web/src/components/ui/Toast.test.tsx` (extend) — append a mount-contract scenario asserting the global mount renders the portal (no per-test mount needed beyond the C.1 setup).
- **Behavior:** Exactly one sonner portal attaches to `document.body` after hydration of the root layout, in any authed route. The ESLint rule fails any future `import … from 'sonner'` in `apps/web/src/**/*.{ts,tsx}` with a fix-message pointing at the wrapper.
- **Tests added (RED/test-extend):**
  - (test-extend) Mount-contract: render the root layout in a test harness (or render `<NuqsAdapter><QueryProvider><AuthProvider><ToasterMount /></AuthProvider></QueryProvider></NuqsAdapter>`), assert one `[data-sonner-toaster]` portal exists in `document.body`.
  - (lint smoke) `pnpm --filter @athlos/web lint` exits 0 with the new rule active; add a temporary `import 'sonner'` line in a scratch file under `apps/web/src/__lint_smoke__/ts.ts` to confirm the rule fires, then remove the scratch file. Documented in the commit body, not committed.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/ui/Toast.test.tsx
  ```
- **Commit:** `feat(web): mount ToasterMount globally and forbid sonner direct imports`

### Task C.3 — Wire SocioForm `createMutation` (site 1) with toast
- **File(s):**
  - `apps/web/src/app/(authed)/socios/new/page.tsx` — add `import { notify } from '@/lib/notifications'`. Extend the `createMutation` options with `onSuccess: () => { notify('success', 'Socio creado') ; /* existing router.push('/socios') stays AFTER notify */ }` and `onError: () => notify('error', 'No se pudo crear el socio')`. Inline `errorMessage` block stays untouched.
  - `apps/web/src/app/(authed)/socios/new/page.test.tsx` (extend) — add the synchronous `vi.mock('@/lib/notifications', () => ({ notify: vi.fn(() => 'toast-1') }))` at the top; on create success assert `expect(notify).toHaveBeenCalledWith('success', 'Socio creado')` AND that `router.push('/socios')` was still called (existing assertion); on create rejection assert `expect(notify).toHaveBeenCalledWith('error', 'No se pudo crear el socio')` AND that the inline `errorMessage` is still rendered.
- **Behavior:** A successful create of a Socio shows a top-right success toast "Socio creado" AND navigates to `/socios`. A failed create shows an error toast "No se pudo crear el socio" AND keeps the modal/form open with the existing inline error visible. `router.push` happens AFTER `notify('success', …)` (no `setTimeout` wrapper by default — D9; add one only if the new test demonstrates a cut-short toast).
- **Tests added (RED):**
  - Create success: `notify` called with `('success', 'Socio creado')`; toast `role="status"`; `router.push('/socios')` still called.
  - Create error: `notify` called with `('error', 'No se pudo crear el socio')`; toast `role="alert"`; modal still open; inline error message still rendered.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/app/\(authed\)/socios/new/page.test.tsx
  ```
- **Commit:** `feat(web): wire SocioForm create mutation to toast notifications`

### Task C.4 — Wire 3 page-level mutations (sites 2/3/4) with toast
- **File(s):**
  - `apps/web/src/app/(authed)/socios/[id]/page.tsx` — add `import { notify } from '@/lib/notifications'`. Extend each of `updateMutation`, `deleteMutation`, `reactivateMutation` with `onSuccess` → `notify('success', '<message>')` and `onError` → `notify('error', '<message>')`. Existing inline `deleteError` block, `updateErrorMessage`, and `reactivateError` stay untouched. For `deleteMutation` (site 3) `onSuccess` keeps the existing `router.push('/socios')` call AFTER `notify('success', 'Socio dado de baja')` — no `setTimeout` wrapper (D9).
  - `apps/web/src/app/(authed)/socios/[id]/page.test.tsx` (extend) — synchronous `vi.mock('@/lib/notifications', () => ({ notify: vi.fn(() => 'toast-1') }))`; assert per-mutation success + error toast messages (6 assertions, 2 per mutation). For site 3 success, also assert `router.push('/socios')` still fires after the toast.
- **Behavior:** Updating a Socio shows "Socio actualizado" / "No se pudo actualizar el socio". Dar de baja shows "Socio dado de baja" then navigates to `/socios`; on error, "No se pudo dar de baja el socio" and the inline `deleteError` stays. Reactivar shows "Socio reactivado" / "No se pudo reactivar el socio". All three preserve their existing inline error blocks.
- **Tests added (RED):**
  - Update success: `notify` called with `('success', 'Socio actualizado')`.
  - Update error: `notify` called with `('error', 'No se pudo actualizar el socio')`; inline error stays.
  - Delete success: `notify` called with `('success', 'Socio dado de baja')`; `router.push('/socios')` called AFTER.
  - Delete error: `notify` called with `('error', 'No se pudo dar de baja el socio')`; `deleteError` inline block visible.
  - Reactivate success: `notify` called with `('success', 'Socio reactivado')`.
  - Reactivate error: `notify` called with `('error', 'No se pudo reactivar el socio')`; inline error stays.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/app/\(authed\)/socios/\[id\]/page.test.tsx
  ```
- **Commit:** `feat(web): wire page-level socio mutations to toast notifications`

### Task C.5 — Wire 3 note mutations (sites 5/6/7) with toast
- **File(s):**
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — add `import { notify } from '@/lib/notifications'`. Extend each of `createMutation` (note), `updateMutation` (note edit), `deleteMutation` (note) with `onSuccess` → `notify('success', '<message>')` and `onError` → `notify('error', '<message>')`. The existing `<p role="alert">` under each note textarea (`socio-note-new-error`, `socio-note-edit-…-error`) stays untouched.
  - `apps/web/src/components/socios/SocioNotesCard.test.tsx` (extend) — append a new `describe('toast wiring', …)` block; synchronous `vi.mock('@/lib/notifications', () => ({ notify: vi.fn(() => 'toast-1') }))`. 6 assertions (2 per note mutation × 3 mutations). On note error, assert the inline `<p role="alert">` for that note is still visible.
- **Behavior:** Creating a note shows "Nota creada" / "No se pudo crear la nota". Editing a note shows "Nota actualizada" / "No se pudo actualizar la nota". Deleting a note shows "Nota eliminada" / "No se pudo eliminar la nota". The 3 inline `<p role="alert">` error blocks stay visible on error; the form/textarea remains usable.
- **Tests added (RED):**
  - Create note success: `notify` called with `('success', 'Nota creada')`.
  - Create note error: `notify` called with `('error', 'No se pudo crear la nota')`; inline `<p role="alert">` for new note visible.
  - Update note success: `notify` called with `('success', 'Nota actualizada')`.
  - Update note error: `notify` called with `('error', 'No se pudo actualizar la nota')`; inline `<p role="alert">` for that note's edit form visible.
  - Delete note success: `notify` called with `('success', 'Nota eliminada')`.
  - Delete note error: `notify` called with `('error', 'No se pudo eliminar la nota')`; inline error stays.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx
  ```
- **Commit:** `feat(web): wire SocioNotesCard note mutations to toast notifications`

## Apply Handoff

1. **Branch**: `git checkout -b feat/toast-primitivo` from `origin/main` (HEAD `b33046c`).
2. **Strict TDD**: per task — write tests first (RED), watch them fail, then implement (GREEN), then refactor before commit. The 5 commits above are TDD-paired: each commit's tests are written before the implementation lands.
3. **Per-commit verification** (run inside the workspace root):
   - `pnpm --filter @athlos/web typecheck`
   - `pnpm --filter @athlos/web lint`
   - `pnpm --filter @athlos/web test:run -- <touched test file>` (per-file to dodge RAM constraint from handover #253 discovery #6)
4. **After all 5 commits**:
   - `pnpm --filter @athlos/web typecheck` (full)
   - `pnpm --filter @athlos/web lint` (full)
   - `pnpm --filter @athlos/web test:run -- src/components/ui/Toast.test.tsx src/app/\(authed\)/socios/new/page.test.tsx src/app/\(authed\)/socios/\[id\]/page.test.tsx src/components/socios/SocioNotesCard.test.tsx` (per-file to stay within RAM budget; do NOT run the full web suite on the dev machine)
   - `git log --oneline -7` to review the commit story
5. **Push + PR**:
   - `git push -u origin feat/toast-primitivo`
   - `gh pr create --title "feat(web): toast notifications primitive via sonner (PR 8b.7)" --body "<body>"`
   - **PR body** should:
     - Reference the spec: `openspec/changes/athlos-toast-primitivo/specs/toast-notifications/spec.md` (5 requirements, 18 scenarios) and the `ui-design` delta (1 ADDED requirement, 4 scenarios).
     - Reference design decisions D1–D10 (wrapper location, import surface, mount point, ESLint rule, ARIA mechanism, durations, theme pin, sync mock, navigation order, Spanish verb-first copy).
     - List the 5 commits: C.1 wrapper + tests, C.2 mount + lint rule, C.3 site 1, C.4 sites 2/3/4, C.5 sites 5/6/7.
     - Per-commit review summary: 4-line `onSuccess`/`onError` additions at each of the 7 sites, additive inline error blocks preserved, ARIA via `classNames` slot + DOM-touch `useEffect`, no `setTimeout` wrapper around `router.push` (D9).
     - Pre-existing CI failures context (test/labeler/Docker build smoke — none from this PR). Document that the full web test suite is gated by CI, not by the dev machine, per handover #253 RAM note.
   - **No deploy step** in PR (post-merge only).
   - The user will merge with `--admin`; pre-existing CI failures will reappear on this PR as expected.

## Critical Tasks (riskiest)

1. **C.1 — ARIA role coverage on the rendered `<li>`**: Sonner 1.7.x exposes no first-party per-toast `role` API. The wrapper relies on `classNames.toast` stamping a kind class, a `data-kind` attribute, and a `useEffect` that walks `[data-sonner-toast]` to set `role` after mount. Tests must assert the rendered `<li>`'s `role` directly (not the class name), and they may need `act` + `waitFor` to let the effect run before the assertion. If the effect timing is wrong, tests are flaky; if the classNames slot mapping is wrong, the role never lands. This is the most novel piece of the entire PR.
2. **C.2 — ESLint rule installation site**: The `no-restricted-imports` rule belongs in the repo-root `eslint.config.cjs` (flat config), NOT in a per-app ESLint file. It must be a NEW `tseslint.config(...)` entry (3rd, after the second existing config block, before `prettierConfig`) with a `files: ['apps/web/src/**/*.{ts,tsx}']` filter. Easy to put in the wrong file or to omit the `files` filter (which would apply the rule repo-wide and break unrelated tests).
3. **C.4 — Navigation-after-toast edge case (sites 1 + 3)**: Both `createMutation` (C.3) and `deleteMutation` (C.4, site 3) call `router.push('/socios')` after a successful toast. Sonner renders into a top-level `document.body` portal that survives same-tree route changes in Next 16 (root layout doesn't unmount), so the toast SHOULD remain visible. Apply MUST add a test that drives a success and then asserts the toast is still in the document AFTER the `router.push` resolves. If the test demonstrates a cut-short toast, wrap `router.push` with `setTimeout(…, 16)` in THAT commit only. Do not preemptively add the wrapper.

## Risks (this task breakdown's own risks)

- **C.1 commit size risk**: ~80–190 LoC is the largest single commit. The wrapper itself is ~60 LoC, the test file is ~120 LoC. If a new edge case (e.g. SSR re-mock, description-aria pair, dismiss-by-id) is added to the test file during RED, C.1 could grow past 200 LoC. Mitigate by deferring non-aria/non-duration scenarios to a follow-up PR; the spec's 5 requirements already cover the must-haves.
- **C.2 ESLint rule installation site**: As noted in the critical tasks, putting the `no-restricted-imports` rule in the wrong file or omitting the `files` filter is the easiest place to introduce a CI failure that is invisible locally. Apply must verify the rule is repo-root, that the existing two config blocks are unchanged, and that `prettierConfig` stays last.
- **Sonner `^1.7.4` peer dependency on React 19**: The lockfile must resolve to a 1.7.x version that lists React 19 in its peerDependencies. `pnpm install` with `^1.7.4` resolves to 1.7.4 (verified on the npm registry per the design). If the lockfile resolves to a different 1.7.x with a different peer range, the install could fail or warn loudly. Apply must check `pnpm-lock.yaml` after the install and document the resolved version in the C.1 commit body.
- **ARIA assertion reliability**: Sonner's `classNames.toast` stamp + `useEffect` DOM touch is timing-sensitive. Tests may need `act` + `waitFor` to let the effect fire before asserting the `<li>`'s `role`. A flaky ARIA test is the most likely source of CI noise. Mitigate by asserting the class-name stamp first (synchronous) and only then asserting the role (post-effect); both should pass, but the synchronous assertion guarantees the classNames slot is wired even if the effect is still pending.
- **LoC budget creep across C.3–C.5**: The 7 sites each gain 2–4 lines (one `import` line shared, 2 lines per mutation for `onSuccess`/`onError`). If the test extensions in C.3/C.4/C.5 add extra coverage beyond the 2 scenarios per site (e.g. router-order assertions, modal-still-open assertions, inline-error visibility assertions), the commits could push past the 400-line budget cumulatively. Apply must cap each test extension at the scenarios listed above; any extra coverage is a follow-up PR.
