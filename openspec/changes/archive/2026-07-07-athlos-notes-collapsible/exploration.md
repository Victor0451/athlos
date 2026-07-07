# Exploration: `athlos-notes-collapsible`

## Current State

`SocioNotesCard` (`apps/web/src/components/socios/SocioNotesCard.tsx`) is a
**flat card** rendered between the page header and the tab strip on
`/socios/[id]`. It is always fully expanded:

- Title row (`<header>`): icon tile (`NotepadText`) + `h2 "Notas del operador"` + subtitle.
- **"Nueva nota" form** (`<form data-testid="socio-note-new-form">`) — textarea
  + charcount + "Agregar nota" submit button — sits between the header and the
  list. Empty state currently says "Usá el **formulario de arriba** para empezar",
  so the design assumes the form is always visible.
- Notes list (`<ul data-testid="socio-notes-list">`): skeleton / empty /
  notes. Each note row has author chip (`<OperatorChip>`), timestamp, body
  (or edit textarea), and per-note edit/delete buttons gated by
  `note.operator_id === user.operator_id || user.role === 'ADMIN'`.
- Data flow is local to the card (3 mutations + 2 queries; no lifted state).
- All strings inside the card are `es-AR` ("Notas del operador", "Agregar nota",
  "Guardando…", "Cancelar", etc.).

Locked product decisions (this change):

| # | Decision | Frozen value |
|---|----------|--------------|
| 1 | Scope | `SocioNotesCard.tsx` ONLY |
| 2 | Default state | **collapsed** on first mount |
| 3 | Persistence | per-socio in `localStorage`, key `notes-collapsed-<socioId>` |
| 4 | "Nueva nota" placement | **inside** the collapse — to add, user must expand first |
| 5 | Visual contract | Gorriti Premium (page header pattern at `/socios/[id]`) |

## Affected Areas

- `apps/web/src/components/socios/SocioNotesCard.tsx` — sole source file. The
  header `<header>` becomes a clickable toggle button; the entire form + list
  become the collapsed region.
- `apps/web/src/components/socios/SocioNotesCard.test.tsx` — must extend the
  existing test suite with collapse-state tests (initial = collapsed, click
  toggles, persistence roundtrip, "Nueva nota" not present when collapsed).
  The existing `vi.mock` factories stay synchronous (design R4 of
  `athlos-audit-operator-display` — `lib/api/socios`, `lib/api/operators`,
  `lib/use-auth` are all mocked synchronously today, lines 28–55).
- No backend change. No OpenSpec capability spec change. The change touches
  one delta only.

## Codebase Scan Findings

### Existing collapse precedent
There is **no** `Collapse` / `Accordion` / `Disclosure` primitive in
`apps/web/src/components/ui/`. The only inline collapsible in the codebase is
the **advanced filters** disclosure on the `/socios` list page
(`apps/web/src/app/(authed)/socios/page.tsx` lines 112–119, 363–386):

- `useState` for `showAdvanced` (no persistence).
- Toggle button uses `aria-expanded` + `aria-controls="<id>"`.
- Collapsed region rendered as `{showAdvanced ? <div id=…>…</div> : null}`.
- No animation; appearance is instant.
- The id matches `aria-controls` so AT can locate the panel.

This is the inline-collapse pattern that ships today. We replicate the same
shape; persistence + counter chip are the only additions.

### localStorage precedent
Only one writer today: `apps/web/src/lib/auth.ts` (lines 89–143). The pattern is:

- `typeof window === 'undefined'` short-circuit (SSR safety).
- `try { … } catch { /* degrade silently */ }` around `getItem` / `setItem` /
  `removeItem` (private mode, quota exceeded, SSR).
- Module-scope hydration on import (acceptable here too if we make the hook
  module-scope, but a `useState`-seeded `useEffect` is simpler and more
  idiomatic in React 19).

### Token + visual primitives

- `apps/web/src/styles/tokens.css` exposes `surface-page` (#f8fafc), `ink-150`
  (#e5e7eb). All card surfaces use `rounded-xl border border-ink-150
  bg-surface p-8 shadow-sm` (canonical, lines 56–57 of `page.tsx`).
- Tailwind aliases `rounded-xl` (12px) and `rounded-2xl` (16px) already
  resolve; no token work needed.
- `<Modal>` already accepts `rounded-xl border border-ink-150 bg-surface-elevated
  shadow-2xl` — visual harmony guaranteed by reusing the same primitive shapes.
- `<Badge>` (`apps/web/src/components/ui/Badge.tsx`) has 5 variants; **none**
  is a "counter" variant. The badge shows `text` content; a numeric count can
  render via `<Badge variant="default">{n}</Badge>` without adding a variant.

### Per-operator-edit edge case
When the operator clicks "Editar" on a note, `editingId` is set. If the card
is **collapsed while a note is being edited**, the edit form disappears. To
avoid that, the spec MUST keep the card expanded whenever `editingId !== null`
(regardless of the persisted toggle state). This is a single-line guard in
the "is collapsed?" expression.

## Approaches

### Approach A — Inline collapse in `SocioNotesCard` (RECOMMENDED)

Wrap the existing `<form>` + `<ul data-testid="socio-notes-list">` (and the
empty/skeleton branches) in a collapsible region. Header `<header>` becomes a
`<button type="button" aria-expanded={…} aria-controls="socio-notes-panel">
  … </button>` containing the icon tile + title + subtitle + a `<ChevronDown>`
  icon (rotated 180° when expanded) + a small `<Badge>` with the notes count.

- Pros: zero new primitive; matches the established inline-collapse pattern
  in `/socios/page.tsx`; smallest possible diff; reads cleanly because the
  card is a self-contained scope.
- Cons: the toggle is co-located with the card it controls — no reuse. If a
  future surface needs the same primitive, we'd extract it then.
- Effort: **Low** (~50 LoC incl. persistence hook + tests).

### Approach B — Extract `apps/web/src/components/ui/Collapse.tsx`

Build a generic disclosure primitive first, then mount `SocioNotesCard` as
its consumer.

- Pros: reusable for `CtacteTab`, future detail pages, etc.
- Cons: drifts the change into "UI primitive + consumer" scope (a second
  concern), and Gorriti Premium's style guide is **deliberately thin on
  primitives** — the only existing primitive that ships for one consumer is
  `<Modal>` (which then became useful in 3 places). We don't have that signal
  yet for collapse.
- Effort: **Medium** (~120 LoC incl. tests + 1 new file).

### Approach C — Use Radix `<Accordion>` / Headless UI `<Disclosure>`

Add a dependency.

- Pros: handles keyboard nav, animation, focus management for free.
- Cons: the project explicitly does **not** pull in Headless UI / Radix for
  Gorriti Premium — `Modal.tsx` is hand-rolled (the comment on lines 36–42
  states "No portals, no focus-trap — kept simple"). Adds bundle weight for
  a single consumer. Inconsistent with project aesthetic.
- Effort: **Medium** but **stylistically wrong**.

## Recommendation

**Approach A.** The collapse is scoped to a single card, the project
establishes the inline-collapse precedent on `/socios`, and the only
reason to extract a primitive is reuse we haven't earned. Persistence
goes in a small **component-local** hook colocated in the same file
(`useNotesCollapsed`, ~15 LoC) so we don't pollute `lib/`.

### Persistence shape

```ts
function useNotesCollapsed(socioId: string) {
  const STORAGE_KEY = `notes-collapsed-${socioId}`
  const [collapsed, setCollapsed] = useState<boolean>(true) // default collapsed
  // Hydrate after mount to avoid SSR / hydration mismatch.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw === 'false') setCollapsed(false)
      else if (raw === 'true') setCollapsed(true)
      // 'true' and missing both → collapsed; we just keep the default.
    } catch { /* private mode → keep default */ }
  }, [socioId])
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }, [socioId])
  return [collapsed, toggle] as const
}
```

The hook is keyed by `socioId`, so reopening a different socio in another
tab/mount fetches its own state. Setting is best-effort with try/catch
(matches `auth.ts` lines 127–134).

### Collapse-region composition

```
<section aria-label="Notas del operador" data-testid="socio-notes-card" …>
  <button
    type="button"
    aria-expanded={!collapsed}
    aria-controls="socio-notes-panel"
    onClick={toggle}
    className="… header layout, full-width row, focus ring …"
    data-testid="socio-notes-toggle"
  >
    <div className="shrink-0 rounded-lg bg-accent-soft p-2.5"><NotepadText … /></div>
    <div>
      <h2>Notas del operador</h2>
      <p>…subtitle…</p>
    </div>
    <Badge variant="default" className="ml-auto">{notes.length}</Badge>
    <ChevronDown
      className={`h-4 w-4 text-ink-500 transition-transform duration-fast
                  ${!collapsed ? 'rotate-180' : ''}`}
      aria-hidden="true"
    />
  </button>
  {(!collapsed || editingId !== null) ? (
    <div id="socio-notes-panel" role="region" aria-labelledby="…" …>
      {/* existing <form> + list, untouched */}
    </div>
  ) : null}
</section>
```

### Visual + animation choices

- **Animation**: a single Tailwind `transition-transform duration-fast` on
  the chevron (matches the project's "fast" transition utility already in
  use across the codebase, e.g. `page.tsx:293, 369, 521, 570`). No panel
  height animation — that introduces jank and the project's Modal pattern
  intentionally avoids content animations.
- **Counter chip**: `<Badge variant="default" className="ml-auto">N</Badge>` —
  uses the existing default variant; no new badge variant required. The
  existing `Badge` component accepts `className` for layout (`Badge.tsx:46`).
- **Edit-during-collapse guard**: the `editingId !== null` part of the
  condition above prevents an operator from clicking Edit, then accidentally
  collapsing the card while their textarea is in flight. Saving still works
  (submit handler unchanged).
- **"Nueva nota" form placement**: lives inside the panel (decision 4). The
  empty-state copy already says "Usá el formulario de arriba" — under the
  collapse default this becomes visible only on first expand. Acceptable
  copy edit: rephrase the empty-state line to "Usá el formulario de abajo
  para empezar" (or "expandé la sección" if we keep it inside the panel).

### Accessibility

- `<button>` for the toggle (already focusable, keyboard-activable).
- `aria-expanded={!collapsed}` (string `"true"`/`"false"`, not boolean —
  React passes booleans through correctly but the precedent on line 366 of
  `/socios/page.tsx` uses the boolean form).
- `aria-controls="socio-notes-panel"` paired with `id="socio-notes-panel"`.
- `role="region"` on the panel for screen-reader landmark navigation
  (pre-existing `aria-label` on the outer `<section>` is preserved).
- Live region: the existing `aria-busy` on the loading `<ul>` stays.
  Optionally, when the toggle flips, announce the state change with
  `aria-live="polite"` on a visually-hidden `<span>` ("Notas expandidas" /
  "Notas colapsadas"). Low priority.

## Risks

1. **SSR hydration mismatch** — `useState(true)` then hydrating from
   localStorage in `useEffect` produces a one-frame flash on the first paint
   (server renders collapsed, client may flip to expanded if the persisted
   value is `false`). Acceptable because the server-side default matches the
   spec's "collapsed on first mount" rule; the flash is a no-op for first
   visits. Document in the hook comment.
2. **ARIA correctness** — `aria-controls` must reference the panel `id`;
   `aria-expanded` must flip on every toggle. The mock `@testing-library`
   tests must assert both. Reuse the `aria-expanded` precedent from
   `/socios/page.tsx:366`.
3. **Counter chip styling drift** — adding `className="ml-auto"` to push the
   badge right requires care; the existing header is `flex items-center
   gap-3` with no `justify-between`. We must switch the header to
   `flex items-center justify-between gap-3` (or add `flex-1` to the title
   block) to keep the title left-anchored. Visual diff required in design
   review.
4. **Scope creep to consumers** — `SocioNotesCard` is mounted only on
   `/socios/[id]` today, so the change is single-file. If the team plans to
   surface the same card on `/ctacte/[cuenta]` or `/padrones/[id]`
   (already backlog item #2 in `pending/work-after-pr-8b4`), the persistence
   key shape must hold across multiple entities — naming it
   `notes-collapsed-<entityType>-<id>` is safer than the locked decision of
   `notes-collapsed-<socioId>`. **Call this out to the user in the propose
   phase** — the locked key is fine while the card lives only on socio, but
   any future generalisation must namespace by entity.
5. **Edit-while-collapsed edge case** — if `editingId !== null` is not
   explicitly excluded from the collapse condition, clicking "Editar nota"
   and then the toggle closes the card with an open textarea. Guard is
   required (see "Recommendation").

## Ready for Proposal

**Yes** — once the locked decisions are confirmed in `sdd-propose`, the
scope is unambiguous: one file, one new local hook, ≤6 new test cases, and
the visual contract is already validated by the existing `/socios` page
collapse precedent.