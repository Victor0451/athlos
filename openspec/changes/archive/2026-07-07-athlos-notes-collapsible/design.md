# Design: Collapsible SocioNotesCard

**Change**: `athlos-notes-collapsible` | **Phase**: design | **Date**: 2026-07-07 | **Scope**: 1 file edit + 1 test extension (~80–150 LoC)

## Technical Approach

Make the existing `<SocioNotesCard>` on `/socios/[id]` collapsible via an inline `<button>` wrapping the header row. Persistence is per-socio via a colocated hook `useNotesCollapsed(socioId)` that mirrors the `lib/auth.ts:89-143` SSR-safe `localStorage` pattern (`typeof window === 'undefined'` short-circuit + `try/catch` around read/write). The list and the "nueva nota" form both move inside a `<div role="region" id="socio-notes-panel">` rendered only when `displayExpanded === true`. A `<Badge>` counter chip stays visible in the header so operators retain glanceable count when collapsed. No new UI primitive, no backend change, no schema — pure UI; the proposal confirms no OpenSpec capability delta is required, this design only documents the file-level implementation contract.

## Architecture Decisions

| # | Decision | Choice | Alt rejected | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Collapse mechanism | Inline `<button type="button">` wrapping the existing header row, mirroring the `/socios/page.tsx:112-119, 363-386` advanced-filters disclosure | Extract `<Collapse>`/`<Accordion>` primitive; add Radix `Disclosure` | Only one consumer; project pattern is thin hand-rolled primitives (Modal precedent), and the existing inline disclosure is the established precedent. Re-evaluate when a second consumer ships. |
| D2 | Persistence hook location | Co-located private `useNotesCollapsed` inside `SocioNotesCard.tsx` (not exported) | New `apps/web/src/lib/use-collapsed.ts` | One consumer today; promote to a shared hook only when the second surfaces. Matches the explore D6 decision. |
| D3 | localStorage key shape | Literal `notes-collapsed-<socioId>` (single entity type only) | Namespace by entity type up front | Only one consumer today (per R4 of explore #270). When a second consumer appears the key MUST become `<entityType>-notes-collapsed-<id>` — flag in the next PR that mounts `SocioNotesCard` elsewhere. |
| D4 | Counter badge | `<Badge variant="default" className="ml-auto">` — the `muted` variant requested in the prompt does not exist in `Badge.tsx` (only `default \| success \| warning \| danger \| info`); follow the actual API + the proposal's `variant="default"` | Add a `muted` variant | Don't widen the primitive for one tag. If a true "muted/neutral" visual variant is later wanted, that's a separate primitive-change PR. |
| D5 | Edit-while-collapsed guard | Derived `displayExpanded = !collapsed \|\| editingId !== null` in the component (the hook returns `{ collapsed, toggle, displayExpanded }` where `displayExpanded` is computed inside the hook with `editingId` lifted via dependency) | Hide the toggle while editing; force-save before collapse | Preserves operator's typed work; matches the user's locked product decision from explore #270. |
| D6 | SSR safety | Hook returns `collapsed: true` on server + first client paint (`typeof window === 'undefined'` short-circuit on every read/write); `useEffect` reads localStorage post-mount and rehydrates | Defer rendering until after `useEffect` | First-paint must match server output to avoid React hydration warnings; flash on return visits is the only acceptable alternative and is documented. |
| D7 | Empty state | Keep the existing `socio-notes-empty` block inside the panel (only rendered when `displayExpanded`); the `Badge` already says `0 notas` so users always see "no notes" even when collapsed | Replace with a different copy in the badge | Counter chip + standard empty copy is consistent with the rest of the app and avoids two divergent empty messages. |
| D8 | Test mock pattern | **Synchronous** `vi.mock` factory, matching `SocioNotesCard.test.tsx:28-55` (NOT the async `importOriginal` form from handover note #253) | Async `(importOriginal) => …` form | Resolve the long-standing ambiguity in design R4 of `athlos-audit-operator-display`: the ACTUAL code is synchronous; apply must follow the code, not the outdated handover note. |
| D9 | localStorage in tests | Use the existing `MemoryStorage` polyfill on `globalThis.localStorage` already installed by `apps/web/vitest.setup.ts:22-56`; `beforeEach` already clears it | `vi.stubGlobal('localStorage', …)` per test | One source of truth, no test pollution. Tests that span mounts must rely on storage state set inside the same test. |

### Hook contract (source of truth)

```ts
function useNotesCollapsed(socioId: string): {
  collapsed: boolean
  toggle: () => void
  displayExpanded: boolean
}
```

- `collapsed` — user's persisted preference. Default `true`. Read once from `localStorage[notes-collapsed-<socioId>]` inside a `useEffect([socioId])`. Values: `'true' | 'false' | null`; anything else keeps the default.
- `toggle` — `useCallback` keyed on `socioId`. Flips state, mirrors to `localStorage.setItem(KEY, String(next))` inside `try/catch`.
- `displayExpanded` — computed every render as `!collapsed || editingId !== null`. `editingId` is the existing `useState<string|null>` in the component (the hook receives it via a closure from its caller; or equivalently the component computes `displayExpanded` inline — the apply phase picks whichever stays cleanest, see "Hook wiring" below).

**Hook wiring** (pinned): the hook receives `(socioId, editingId)` so the returned `displayExpanded` is correct without leaking `editingId` upward. Final signature applied:

```ts
function useNotesCollapsed(
  socioId: string,
  editingId: string | null,
): { collapsed: boolean; toggle: () => void; displayExpanded: boolean }
```

(Extend type, not contract behaviour, from D5.)

### Component diff — `apps/web/src/components/socios/SocioNotesCard.tsx`

1. **Imports**: add `useEffect, useCallback` (already have `useState`); add `ChevronDown` to the `lucide-react` import; add `Badge` from `@/components/ui/Badge`.
2. **Hook (private, bottom of file or just under `formatTimestamp`)**: define `useNotesCollapsed(socioId, editingId)` per the contract above.
3. **Header JSX (lines 174–185)**: replace the `<header>` with a `<button type="button" data-testid="notes-toggle" aria-expanded={displayExpanded} aria-controls="socio-notes-panel" onClick={toggle} className="…clickable-header…">` wrapping the existing icon-tile + `<h2>` + subtitle, then a `<Badge variant="default" className="ml-auto" dataTestid="notes-counter">{notes.length} nota{notes.length !== 1 ? 's' : ''}</Badge>`, then `<ChevronDown className={\`h-4 w-4 transition-transform duration-fast ${displayExpanded ? 'rotate-180' : ''}\`} aria-hidden="true" />`. Header flex container becomes `flex items-center justify-between gap-3`; inner row inside the button uses the existing icon-tile + title cluster (no `ml-auto` on it — `Badge` is the `ml-auto` element).
4. **Panel region (new, wraps the existing form + list)**: when `displayExpanded`, render `<div role="region" id="socio-notes-panel" data-testid="notes-panel" aria-labelledby="socio-notes-heading" className="mt-6">` containing the existing `<form>` (lines 188–227) and the entire notes-list / empty / loading conditional (lines 230–371). When not `displayExpanded`, render `null`.
5. **Empty branch retention**: the `notes.length === 0` branch stays inside the panel — when expanded and empty, the existing `data-testid="socio-notes-empty"` "Aún no hay notas…" copy renders (D7). When collapsed and empty, only the counter chip is visible.
6. **No other behavioural changes**: data flow, mutations, edit/delete gating, operator lookup, charcount, error rendering are untouched.

### Component diff — `apps/web/src/components/socios/SocioNotesCard.test.tsx`

**Mock factory stays synchronous** (D8). No additional `vi.mock` entries needed — the hook reads `globalThis.localStorage` directly, which `vitest.setup.ts:22-56` already polyfills and clears between tests.

Append 4 new `it(...)` blocks to the existing `describe('SocioNotesCard', …)`:

| # | Scenario | Asserts |
|---|----------|---------|
| T1 | "Renders collapsed by default" | `screen.getByTestId('notes-toggle')` has `aria-expanded="false"`. `screen.getByTestId('notes-counter')` text = `"0 notas"` (no notes seeded). `screen.queryByTestId('notes-panel')` is NOT in document. |
| T2 | "Clicking the toggle expands and writes localStorage" | Find `notes-toggle`, `fireEvent.click`. Assert `aria-expanded="true"` and `screen.getByTestId('notes-panel')` present. Read `globalThis.localStorage.getItem('notes-collapsed-' + SOCIO_ID)` and pin **exactly** to the string `'false'`. |
| T3 | "Persists expanded state across mounts" | First render + click → expanded. `unmount()`. Second render with no clicks → still expanded (`aria-expanded="true"`, panel present). Pin localStorage entry still `'false'` before remount. |
| T4 | "Edit-while-collapsed keeps panel open" | Seed one note. Render. Start edit (`fireEvent.click` the edit button). Collapse the card (`fireEvent.click(notes-toggle)`). Assert `screen.getByTestId('notes-panel')` is STILL in document AND the per-note `data-testid="socio-note-edit-form-…"` textarea is visible. (Hooks `displayExpanded = !collapsed \|\| editingId !== null`.) |

`renderCard()` already clears `localStoragePolyfill` via the global `beforeEach`; T3 must write the state via the click path (not `localStorage.setItem` directly) so the test asserts both halves of round-trip.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/components/socios/SocioNotesCard.tsx` | Modify | Wrap header `<header>` in `<button>` toggle, inject `Badge` counter + rotating `ChevronDown`, wrap form + list in `<div id="socio-notes-panel" role="region">`, add private `useNotesCollapsed` hook. |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx` | Extend | Append 4 new scenarios (T1–T4) to the existing describe. Existing tests untouched. |

No NEW files. No backend/DB changes. No CSS tokens added (reuses `ink-150`, `surface-page`, `duration-fast`).

## Visual Contract (pinned className)

| Element | className (pinned) |
|---------|--------------------|
| Toggle `<button>` (replaces header) | `"group flex w-full items-center justify-between gap-3 rounded-md text-left transition-colors duration-fast hover:bg-surface-sunken/40"` |
| Header inner cluster (icon tile + `<h2>` + subtitle) | `"flex items-center gap-3"` (unchanged from current line 174) |
| Counter `<Badge>` | `<Badge variant="default" dataTestid="notes-counter" className="ml-auto">{count} nota{N ? 's' : ''}</Badge>` (D4: `default` is the actual API) |
| Chevron `<ChevronDown>` | `` `h-4 w-4 shrink-0 text-ink-500 transition-transform duration-fast ${displayExpanded ? 'rotate-180' : ''}` ``, `aria-hidden="true"` |
| Panel region `<div>` | `"mt-6 space-y-6"` (note: list internally uses its own `space-y-3`; outer wrapper is for the form + list stack) |
| Toggle `<button>` internal padding | `"px-2 py-1 -mx-2 -my-1"` so the hover surface extends slightly past the existing header text without changing the card shell padding |

Header `<h2>` keeps `id="socio-notes-heading"` so `aria-labelledby` on the region resolves. Card outer shell (`rounded-xl border border-ink-150 bg-surface p-8 shadow-sm`) is unchanged.

## ARIA Contract (pinned)

| Element | Attribute | Value |
|---------|-----------|-------|
| Toggle `<button>` | `aria-expanded` | `{displayExpanded}` (NOT `!collapsed` — uses the derived value so screen readers don't lie when an edit is in flight) |
| Toggle `<button>` | `aria-controls` | `"socio-notes-panel"` (literal) |
| Toggle `<button>` | `data-testid` | `"notes-toggle"` |
| Panel region `<div>` | `id` | `"socio-notes-panel"` (literal) |
| Panel region `<div>` | `role` | `"region"` |
| Panel region `<div>` | `aria-labelledby` | `"socio-notes-heading"` |
| Panel region `<div>` | `data-testid` | `"notes-panel"` |
| Heading `<h2>` | `id` | `"socio-notes-heading"` |
| Chevron | `aria-hidden` | `"true"` |

The existing outer `<section aria-label="Notas del operador">` (line 169) is preserved as the page landmark; `<h2 id>` is added to the heading (line 179) without changing its visible text.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Component unit (extend) | T1–T4 above | Existing `renderCard()` harness; rely on `MemoryStorage` polyfill from `vitest.setup.ts`; synchronous mock factories preserved (D8). |
| Existing regression | All 11 prior scenarios must continue to pass | No edits to the existing `it(...)` blocks; the form/list render path is unchanged inside the new region wrapper. |
| Build/CI | `pnpm --filter @athlos/web typecheck` + `pnpm --filter @athlos/web test:run -- SocioNotesCard.test.tsx` (per-file to dodge RAM constraint noted in handover #253 discovery #6) | Local pass required before push. |

## SSR Safety (D6 details)

1. **Hook on the server**: `typeof window === 'undefined'` short-circuits the `useEffect` body and the `toggle` write path. State stays at `useState(true)` seed → `collapsed: true`, `displayExpanded: !!(editingId !== null)`.
2. **First client paint**: identical to the server output (state hasn't been touched). React diff = no hydration warning.
3. **Post-mount effect**: `useEffect([socioId])` reads `localStorage.getItem(KEY)`. `'false'` → `setCollapsed(false)` triggers a re-render to the expanded layout. `'true'` or `null` → no re-render. Any throw → default is kept silently.
4. **Toggle write**: `localStorage.setItem(KEY, String(next))` inside `try/catch`. Failures degrade silently to in-memory state.
5. **Flash**: returning visitors with persisted `false` see one frame of collapsed before the effect paints expanded. Acceptable; documented in the hook's JSDoc.

## localStorage Key Pin (D3)

- **Key**: `` `notes-collapsed-${socioId}` `` — literal `<socioId>` interpolation.
- **Value**: string `'true'` or `'false'`. NOT JSON. NOT numeric. Pin exactly in tests.
- **Future-namespacing note**: when a second consumer appears (e.g. `useCtacteCollapsed(cuentaId)` or `usePadronCollapsed(padronId)`), the key MUST become `<entityType>-notes-collapsed-<id>`. For now only one consumer — flag in the next PR that mounts `SocioNotesCard` outside `/socios/[id]`.

## Out of Scope (re-affirmed)

- No new UI primitive (`<Collapse>`/`<Accordion>`/`<Disclosure>`).
- No backend, no schema, no migration, no API change.
- No animation library; the chevron rotation is the only animation.
- No a11y audit beyond `aria-expanded` + `aria-controls` + `aria-labelledby`. No focus trap, no keyboard nav beyond the button's native behaviour.
- No edits to `AuditTab`, `OperatorChip`, `/socios/page.tsx`, `/socios/[id]/page.tsx`.

## Migration / Rollout

No migration required. Single-PR rollout: revert the two files to restore the flat card.

## Rollback

Additive inside `SocioNotesCard.tsx`. Reverting the file removes the toggle, the badge, the panel wrapper, and the hook. No DB, no API, no migration. Test file extension rollback = remove the 4 appended `it(...)` blocks.

## PR Shape

- **One PR**. 1 file edit + 1 test file extension. Estimated ~80–150 LoC total (component edit ~60–110, tests ~30–50). Comfortably under the 400-line review budget; `size:exception` NOT needed.

## Open Questions

None. Proposal #272 + spec #274 + the source-file scan resolve every ambiguity.
