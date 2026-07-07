# Proposal: Collapsible SocioNotesCard

## Why

The Notes panel currently occupies visual real estate on `/socios/[id]` even when operators are not focused on notes. Most visits target the socio profile / balance, not the note stream. A collapse lets operators de-prioritise notes without losing visibility — a counter chip keeps the count glanceable while collapsed.

## What changes

- 1 new hook `useNotesCollapsed(socioId)` colocated in `SocioNotesCard.tsx` (~15 LoC; SSR-safe localStorage).
- Inline toggle in the existing card header — no new component file, no new primitive.
- Counter `<Badge>` pushed right via `ml-auto`, next to a rotating `<ChevronDown>`.
- List and "Nueva nota" form move inside a collapsible region.
- 4 new scenarios appended to `SocioNotesCard.test.tsx` (existing `vi.mock` factories stay synchronous).

## Scope

**In:** `apps/web/src/components/socios/SocioNotesCard.tsx` (edit); `SocioNotesCard.test.tsx` (extend).

**Out:** no new UI primitive (`<Collapse>`/`<Accordion>`/`<Disclosure>`); no animation library; no backend, schema, migration, or API change; no edits to `AuditTab`, `OperatorChip`, `/socios/page.tsx`.

## Approach

- Default collapsed on first mount; `localStorage[notes-collapsed-<socioId>]` is the source of truth post-hydration.
- SSR renders collapsed; client hydrates inside `useEffect`. One-frame flash on return visits is acceptable (server default = spec default).
- Toggle: `<button type="button" aria-expanded={!collapsed} aria-controls="socio-notes-panel" onClick={toggle}>` wrapping the existing header row.
- Chevron rotates 180° on expand via Tailwind `transition-transform duration-fast`.
- Counter: `<Badge variant="default" className="ml-auto">{count} nota{count !== 1 ? 's' : ''}</Badge>`.
- Edit-while-collapsed guard: derived `displayExpanded = !collapsed || editingId !== null`.
- Persistence read-on-mount + write-on-toggle inside `try/catch`; mirrors `lib/auth.ts:89-143`.
- Empty-state copy: "de arriba" → "de abajo" (form now sits below the toggle).

## Capabilities

**New:** None — purely UI.
**Modified:** None at spec level. No `openspec/specs/` delta required.

## User-visible behaviour

- First visit: card collapsed (counter visible). Click header → expand → list + form. Click again → collapse (form hidden).
- Different socio → independent state. Same socio → remembered.
- Editing + collapsing → edit stays open (no lost work).
- Counter re-renders on add/delete via existing props.

## Risks & mitigations

- **SSR hydration flash** — acceptable; server default matches spec default; noted in hook comment.
- **ARIA correctness** — asserted by 2 of the 4 new scenarios.
- **Counter shifts header layout** — header flex → `justify-between gap-3` keeps title left-anchored.
- **localStorage unavailable** (private mode, quota) — `try/catch` falls back to default collapsed.
- **Future reuse on `/ctacte`/`padrones`** will need a namespaced key — acceptable for this slice.

## Rollback plan

Additive inside `SocioNotesCard.tsx`. Revert restores the flat card. No DB, no API, no migration.

## Dependencies

None new. Reuses `<Badge>`, the `lib/auth.ts` SSR-safe localStorage pattern, Tailwind tokens (`--ink-150`, `--surface-page`, `duration-fast`), Lucide `ChevronDown`.

## Open questions

None. See `sdd/athlos-notes-collapsible/explore` (#270).

## Success criteria

- [ ] Card collapsed on first visit; counter chip visible.
- [ ] Per-socio persistence via `notes-collapsed-<socioId>`.
- [ ] `aria-expanded` + `aria-controls="socio-notes-panel"` correct on toggle.
- [ ] Edit-while-collapsed guard works (open edit → collapse → textarea still visible).
- [ ] 4 new test scenarios added; existing tests still pass.
- [ ] `pnpm typecheck` + `pnpm lint` clean.
- [ ] Visual contract matches Gorriti Premium (chevron rotation, badge style, `justify-between` header).
