# Tasks: Collapsible SocioNotesCard (PR 8b.6)

**Change**: `athlos-notes-collapsible`
**Scope**: 1 source file edit + 2 test file extensions (1 isolated hook test, 1 component test extension)
**Spec**: `openspec/changes/athlos-notes-collapsible/specs/notes-collapse/spec.md`
**Design**: `openspec/changes/athlos-notes-collapsible/design.md`
**Proposal**: `openspec/changes/athlos-notes-collapsible/proposal.md`

## Review Workload Forecast

- PR single estimated changed lines: ~120
- 400-line budget risk: LOW (well under)
- Chained PRs recommended: No
- Decision needed before apply: No
- Notes: single-PR slice, ~80–150 LoC, no `size:exception` needed

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low
```

## Dependency Graph

```
C.1 hook (useNotesCollapsed + isolated test)
   │
   ▼
C.2 header toggle + counter Badge + chevron rotation
   │
   ▼
C.3 wrap form + list in collapsible region + edit-while-collapsed guard
   │
   ▼
C.4 ARIA polish (aria-labelledby + heading id)
```

Each commit leaves the repo green (typecheck + lint + test of touched file).

## Work-Unit Commit Table (PR single)

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| C.1    | `useNotesCollapsed(socioId, editingId)` hook + isolated hook test file | ~40–60 | RED→GREEN |
| C.2    | Header toggle + counter `<Badge>` + chevron rotation in `SocioNotesCard.tsx` | ~30–50 | RED→GREEN |
| C.3    | Wrap list + form in collapsible region + edit-while-collapsed guard | ~30–50 | RED→GREEN |
| C.4    | ARIA polish + accessibility sweep (`aria-labelledby` + heading `id`) | ~10–20 | test-extend |

Total: ~110–180 LoC. Each commit ≤ ~80 LoC. TDD-paired (test in same commit as behavior).

### Hook exportability note (applies to C.1)

Design D2 calls the hook "private (not exported)". To allow an isolated hook test file (C.1) we export the hook as a **named export with `@internal` JSDoc marker** (e.g. `/** @internal — exported for unit tests only */`). This is a non-behavioral change: the component continues to consume the hook from the same module. No public API surface added. Update D2's note in the design file if the apply phase prefers the comment marker approach.

## Task List

### Task C.1 — `useNotesCollapsed` hook + isolated hook test
- **File(s):**
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — add `useEffect`, `useCallback` to React imports; define `useNotesCollapsed(socioId: string, editingId: string | null)` at the bottom of the file as a named export with `@internal` JSDoc marker.
  - `apps/web/src/components/socios/useNotesCollapsed.test.tsx` (NEW) — isolated hook tests using `renderHook` from `@testing-library/react`.
- **Behavior:** SSR-safe localStorage-backed collapse state. Returns `{ collapsed: boolean, toggle: () => void, displayExpanded: boolean }`. Default `collapsed = true` (first mount and SSR). `useEffect([socioId])` rehydrates from `localStorage['notes-collapsed-<socioId>']`; only `'true' | 'false'` parsed; anything else keeps default. `toggle` flips state, mirrors to `localStorage.setItem(KEY, String(next))` inside `try/catch`. `displayExpanded = !collapsed || editingId !== null`.
- **Tests added (RED):**
  - `useNotesCollapsed` returns `collapsed: true`, `displayExpanded: false` when no editingId and no persisted state.
  - `displayExpanded` becomes `true` when `editingId` is non-null even with `collapsed: true`.
  - `act(() => result.current.toggle())` flips `collapsed` to `false` and writes exactly the string `'false'` to `globalThis.localStorage.getItem('notes-collapsed-' + SOCIO_ID)`.
  - Re-mounting the hook with a pre-seeded `localStorage` entry `'false'` returns `collapsed: false` post-effect (use `act` + `waitFor` to let the effect fire).
  - `localStorage.getItem` throw on mount keeps default `collapsed: true` silently.
  - `localStorage.setItem` throw on toggle still flips the in-memory state.
  - `editingId` changing from non-null → null causes `displayExpanded` to revert to `!collapsed`.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/useNotesCollapsed.test.tsx
  ```
- **Commit:** `feat(web): add useNotesCollapsed hook with SSR-safe localStorage persistence`

### Task C.2 — Header toggle + counter Badge + chevron rotation
- **File(s):**
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — replace the existing `<header>` with a `<button type="button" data-testid="notes-toggle" aria-expanded={displayExpanded} aria-controls="socio-notes-panel" onClick={toggle}>` wrapping the icon-tile + h2 + subtitle. Add `<Badge variant="default" dataTestid="notes-counter" className="ml-auto">{count} nota{count !== 1 ? 's' : ''}</Badge>` and `<ChevronDown className="h-4 w-4 shrink-0 text-ink-500 transition-transform duration-fast ${displayExpanded ? 'rotate-180' : ''}" aria-hidden="true" />`. Header flex becomes `flex items-center justify-between gap-3`.
  - `apps/web/src/components/socios/SocioNotesCard.test.tsx` — append T1 + T2 scenarios from design §"Component diff".
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — add `ChevronDown` to `lucide-react` import; add `Badge` import from `@/components/ui/Badge`.
- **Behavior:** Card header is now a clickable toggle. The counter Badge shows the current `notes.length` pluralised as `0 notas` / `1 nota` / `N notas`. The chevron rotates 180° when `displayExpanded` via `transition-transform duration-fast`. Toggle click flips state and persists.
- **Tests added (RED):**
  - T1: `screen.getByTestId('notes-toggle')` has `aria-expanded="false"`, `screen.getByTestId('notes-counter')` text is `"0 notas"`, `screen.queryByTestId('notes-panel')` is NOT in document.
  - T2: `fireEvent.click(notes-toggle)` flips `aria-expanded="true"` and renders `notes-panel`. Pin `globalThis.localStorage.getItem('notes-collapsed-' + SOCIO_ID)` to exactly `'false'`.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx
  ```
- **Commit:** `feat(web): collapsible SocioNotesCard header with counter chip and chevron`

### Task C.3 — Wrap form + list in collapsible region + edit-while-collapsed guard
- **File(s):**
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — wrap the existing `<form>` (lines 188–227) and the entire notes-list/empty/loading conditional (lines 230–371) in `{displayExpanded ? <div role="region" id="socio-notes-panel" data-testid="notes-panel" aria-labelledby="socio-notes-heading" className="mt-6 space-y-6">…</div> : null}`. Rephrase empty-state copy: "de arriba" → "de abajo".
  - `apps/web/src/components/socios/SocioNotesCard.test.tsx` — append T3 + T4 scenarios from design §"Component diff".
- **Behavior:** When `displayExpanded` is true, the entire form + notes list region renders inside the `<div role="region" id="socio-notes-panel">`. When false, nothing inside renders. The guard `displayExpanded = !collapsed || editingId !== null` means an open edit textarea is never hidden.
- **Tests added (RED):**
  - T3 (round-trip): Render, click toggle (expands), `unmount()`, re-render with no clicks. Assert `aria-expanded="true"` and `notes-panel` is in document. Pin `localStorage` entry remains `'false'` before remount.
  - T4 (edit-while-collapsed guard): Seed one note. Render. `fireEvent.click(notes-edit-<id>)` to start edit. `fireEvent.click(notes-toggle)` to collapse. Assert `screen.getByTestId('notes-panel')` is STILL in document AND `screen.getByTestId('socio-note-edit-form-<id>')` textarea is visible.
  - Empty-state copy check: when expanded and `notes.length === 0`, `screen.getByTestId('socio-notes-empty')` text contains "de abajo" (not "de arriba").
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx
  ```
- **Commit:** `feat(web): wrap SocioNotesCard body in collapsible region with edit guard`

### Task C.4 — ARIA polish (aria-labelledby + heading id)
- **File(s):**
  - `apps/web/src/components/socios/SocioNotesCard.tsx` — add `id="socio-notes-heading"` to the existing `<h2>` (line 179). No new ARIA — the region already carries `aria-labelledby` from C.3.
  - `apps/web/src/components/socios/SocioNotesCard.test.tsx` — extend T1 + T2 assertions (or append 2 new micro-scenarios) to pin ARIA correctness:
    - `<h2 id="socio-notes-heading">` is in document.
    - The panel region's `aria-labelledby` attribute equals `"socio-notes-heading"`.
    - The toggle's `aria-controls` equals `"socio-notes-panel"` in both states.
- **Behavior:** Screen readers can now navigate from the toggle button to the panel region via the labelled-by reference, and announce the panel as "Notas del operador, region" (the heading text).
- **Tests added (test-extend, not RED-first):**
  - T1 extension: `screen.getByRole('heading', { name: /Notas del operador/i })` has id `socio-notes-heading`.
  - T2 extension: panel `aria-labelledby` resolves to the heading id; toggle `aria-controls` resolves to the panel id.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx
  ```
- **Commit:** `feat(web): link SocioNotesCard toggle and panel via aria-labelledby`

## Apply Handoff

1. **Branch**: `git checkout -b feat/notes-collapsible` from `main`.
2. **Strict TDD**: per task — write tests first (RED), watch them fail, then implement (GREEN), then refactor before commit. The 4 commits above are TDD-paired: each commit's tests are written before the implementation lands.
3. **Per-commit verification** (run inside `apps/web`):
   - `pnpm --filter @athlos/web typecheck`
   - `pnpm --filter @athlos/web lint`
   - `pnpm --filter @athlos/web test:run -- <touched test file>` (per-file to dodge RAM constraint from handover #253 discovery #6)
4. **After all 4 commits**:
   - `pnpm --filter @athlos/web typecheck` (full)
   - `pnpm --filter @athlos/web lint` (full)
   - `pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx src/components/socios/useNotesCollapsed.test.tsx` (the two touched test files; per-file is fine for full-pass)
   - `git log --oneline -5` to review the commit story
5. **Push + PR**:
   - `git push -u origin feat/notes-collapsible`
   - `gh pr create --title "feat(web): collapsible SocioNotesCard with per-socio persistence (PR 8b.6)" --body "<body>"`
   - **PR body** should:
     - Reference the spec scenarios: R1 (Default Collapsed) → C.1 + T1; R2 (Per-Socio Persistence) → C.1 + T2/T3; R3 (Toggle ARIA) → C.2 + C.4; R4 (Counter Chip) → C.2 + T1; R5 (Form/List Inside Panel) → C.3 + T4; R6 (Edit-While-Collapsed Guard) → C.3 + T4; R7 (Chevron Rotation) → C.2; R8 (`localStorage` Fallback) → C.1 (getItem/setItem throw tests).
     - Reference design decisions D1–D9 (inline collapse, hook placement, key shape, Badge variant, edit guard, SSR safety, empty state, sync mock, MemoryStorage).
     - Call out the pre-existing CI failures context (test/labeler/Docker build smoke) from handover #253 — the new tests pass on the touched files; full-suite gating is blocked by the pre-existing flakiness and is not introduced by this PR.
   - **No deploy step** in PR (post-merge only).

## Critical Tasks (riskiest)

1. **C.1 — SSR-safe hook isolation tests**: The hook must work without `window` (server + first client paint return `collapsed: true`); the effect must rehydrate without hydration mismatch. The `renderHook` tests need `act` + `waitFor` to let the effect fire — easy to write flaky tests if `act` boundaries are missed.
2. **C.3 — Edit-while-collapsed guard test (T4)**: The derived `displayExpanded = !collapsed || editingId !== null` is the most subtle behavior. The test must (a) start edit, (b) click toggle, (c) assert panel STILL in document AND textarea visible. If the implementation accidentally uses `!collapsed` instead of `displayExpanded` for the region render, the test will catch it.
3. **C.2 — Counter pluralisation + layout regression**: Changing the header flex from `flex items-center gap-3` to `flex items-center justify-between gap-3` could visually regress other Gorriti Premium cards. Visual review required; the test pin is the `ml-auto` class on the Badge (R4 of spec).

## Risks (this task breakdown's own risks)

- **C.1 commit size risk**: ~40–60 LoC includes the hook (~15 LoC) + the isolated test file (~30–45 LoC). If the hook test file grows with more edge cases (e.g. SSR `typeof window` re-mock, multiple `editingId` flips, double-toggle persistence), it could push past 80 LoC. Mitigate by splitting hook edge cases between C.1 and a future follow-up if needed; do NOT truncate the T1–T4 component scenarios.
- **C.4 test-extend scope creep**: Adding "micro-scenarios" risks ballooning into a C.4 > 30 LoC commit if the ARIA test pin set grows. Cap C.4 at the 2 explicit assertions above; defer any additional a11y polish to a follow-up PR.
- **Test isolation**: The `MemoryStorage` polyfill (`vitest.setup.ts:22-56`) clears between tests. T3 round-trip relies on this; if a future test author adds a `vi.stubGlobal('localStorage', ...)` override it could break T3. Document the polyfill reliance in the test file's header comment.
- **Future key namespacing note**: The localStorage key `notes-collapsed-<socioId>` is entity-specific. If a future PR mounts `SocioNotesCard` on `/ctacte/[cuenta]` or `/padrones/[id]`, the key MUST become `<entityType>-notes-collapsed-<id>`. Flag this in the PR description so it lands in the project's memory; do NOT preemptively namespacing the key (it would break the spec).
- **vitest RAM pressure on full suite**: Per handover #253 discovery #6, the full web test suite can OOM. Always run per-file for the touched test files; never run the full suite on the dev machine before push — let CI do it.
