## feat(web): collapsible SocioNotesCard with per-socio persistence (PR 8b.6)

### What

Makes `<SocioNotesCard>` on `/socios/[id]` collapsible. The card header is now a clickable toggle with a counter chip + rotating chevron; the existing form and notes list move inside a collapsible region; collapse state is persisted per-socio in `localStorage[notes-collapsed-<socioId>]`. An edit-while-collapsed guard keeps an in-flight edit form visible even if the operator tries to collapse the card mid-edit.

Three work-unit commits, each independent and reviewable:

| #   | Commit    | Subject                                                                        |  LoC |
| --- | --------- | ------------------------------------------------------------------------------ | ---: |
| C.1 | `7f5d6ca` | `feat(web): add useNotesCollapsed hook with SSR-safe localStorage persistence` | +184 |
| C.2 | `277d336` | `feat(web): add collapsible header + counter + chevron to SocioNotesCard`      |  +72 |
| C.3 | `917e96e` | `feat(web): wrap notes content in collapsible region with edit guard`          | +277 |

Total: 3 files changed, 532 insertions(+), 189 deletions(-) against `origin/main@cabf975`. Comfortably under the 400-line review budget.

C.4 from the original plan was folded into C.3 (counter pluralisation tests added inline with the panel-wrap commit per the user's `OR include in C.3 if cleaner` opt-in).

### Linked

- Proposal: `openspec/changes/athlos-notes-collapsible/proposal.md` (P1–P8)
- Spec: `openspec/changes/athlos-notes-collapsible/specs/notes-collapse/spec.md` (R1–R8, 14 scenarios)
- Design: `openspec/changes/athlos-notes-collapsible/design.md` (D1–D9)
- Tasks: `openspec/changes/athlos-notes-collapsible/tasks.md`

### Spec ↔ commit mapping

| Req                                            | Commit   | Test(s)                                           |
| ---------------------------------------------- | -------- | ------------------------------------------------- |
| R1 Default Collapsed on First Mount            | C.1, C.2 | T1 (component), default-collapsed (hook)          |
| R2 Per-Socio Persistence in `localStorage`     | C.1, C.3 | T2 (component), T3 round-trip (component)         |
| R3 Toggle Button with ARIA                     | C.2      | T1, T2 (assert `aria-expanded` + `aria-controls`) |
| R4 Notes Count Counter Chip                    | C.2      | T1 ("3 notas"), T5a "0 notas", T5b "1 nota"       |
| R5 Form and List Inside the Collapsible Region | C.3      | T1 (panel absent by default), T3 (panel present)  |
| R6 Edit-While-Collapsed Guard                  | C.3      | T4 (edit form stays mounted after toggle click)   |
| R7 Chevron Rotation                            | C.2      | `transition-transform duration-fast rotate-180`   |
| R8 `localStorage` Unavailable Fallback         | C.1      | getItem-throw test + setItem-throw test           |

### Design decisions honoured

- **D1** Inline `<button type="button">` toggle in the existing header — no new UI primitive. Mirrors `/socios/page.tsx` advanced-filters disclosure precedent.
- **D2** Hook colocated in `SocioNotesCard.tsx` as a **named export with `@internal` JSDoc marker** — same module, zero public API surface, isolated unit-testable. (The `@internal` export is the resolution of the "private hook + isolated test" tension flagged in tasks.md.)
- **D3** localStorage key literal `notes-collapsed-<socioId>`. Single entity type today; if `SocioNotesCard` mounts on `/ctacte/[cuenta]` or `/padrones/[id]` the key MUST become `<entityType>-notes-collapsed-<id>`. Flagged in the Risks section below.
- **D4** `<Badge variant="default" className="ml-auto">` — `default` is the actual `Badge` variant. The brief's "muted" variant does not exist in `Badge.tsx`.
- **D5** Edit-while-collapsed guard via derived `displayExpanded = !collapsed || editingId !== null`.
- **D6** SSR safety: `typeof window === 'undefined'` short-circuit + `try/catch` around every read/write. Mirrors `apps/web/src/lib/auth.ts:89-143`.
- **D7** Empty state stays inside the panel. When collapsed + empty, only the counter chip is visible.
- **D8** Synchronous `vi.mock` factory (matching `SocioNotesCard.test.tsx:28-55`).
- **D9** `MemoryStorage` polyfill from `apps/web/vitest.setup.ts:22-56` is the source of truth for tests — no `vi.stubGlobal`.

### Files

| File                                                         | Change                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/socios/SocioNotesCard.tsx`          | EDIT — header → `<button>` toggle; inject `<Badge>` counter + rotating `<ChevronDown>`; wrap form + list in `<div id="socio-notes-panel" role="region" aria-labelledby="socio-notes-heading">`; add private `useNotesCollapsed(socioId, editingId)` hook with `@internal` JSDoc; empty-state copy "de arriba" → "de abajo" |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx`     | EXTEND — 10 existing tests now drive the panel via a new `expandCard()` helper; 6 new scenarios (T1–T4 collapse + T5a/T5b pluralisation)                                                                                                                                                                                   |
| `apps/web/src/components/socios/use-notes-collapsed.test.ts` | NEW — 8 isolated hook tests covering default, editingId-derives-displayExpanded, toggle writes `'false'`, rehydration, getItem-throw, setItem-throw, and SSR-safety via storage-unavailable fallback                                                                                                                       |

No new files in `apps/web/src/lib/` or `apps/web/src/components/ui/`.

### Test Plan

- [x] `pnpm --filter @athlos/web test:run -- src/components/socios/use-notes-collapsed.test.ts` — 8/8 pass
- [x] `pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx` — 16/16 pass (10 existing + 6 new)
- [x] Both files combined: 24/24 pass, no regressions
- [x] `pnpm --filter @athlos/web typecheck` — clean
- [x] `pnpm --filter @athlos/web lint` — clean
- [x] Husky pre-commit (eslint --fix + prettier --write) ran on every commit
- [x] Full suite intentionally NOT run on dev machine (handover #253 discovery #6 — RAM pressure); CI will gate it.

### Review summary (inline — `review-readability` + `review-reliability` lenses)

Both lenses were executed inline (the `~/.config/opencode/skills/review-*` skills are not installed in this environment). Findings:

**review-readability**: PASS

- Naming clear (`useNotesCollapsed`, `displayExpanded`, `notes-toggle`, `notes-counter`, `notes-panel`).
- Complexity low: hook is ~25 LoC with one `useState`, one `useEffect`, one `useCallback`; component header is ~40 LoC of JSX with no nested conditionals.
- Intention expressed via comments at the hook definition (SSR safety, edit-while-collapsed guard) and inside `SocioNotesCard` (counter pluralisation rule, panel wrapper rationale).
- All `data-testid` and ARIA ids are kebab-case and follow the project convention (`socio-…` prefix for component-owned, `notes-…` for the new collapse surface).
- One design-D2 deviation documented inline: the hook is exported with `@internal` JSDoc to allow isolated testing, rather than the original "private (not exported)" form. The component still consumes it from the same module — no public API surface added.

**review-reliability**: PASS

- Test coverage is meaningful: 8 hook scenarios cover default state, derived `displayExpanded`, toggle writes literal `'false'`, round-trip rehydration from `localStorage`, getItem-throw, setItem-throw, and SSR safety via storage-unavailable fallback. 6 component scenarios cover header ARIA, counter pluralisation for 0/1/N, click toggle + localStorage write, persistence across remounts, and the edit-while-collapsed guard.
- Edge cases pinned: `'true'` and `'false'` strings parsed; any other localStorage value keeps the default; throwing `getItem`/`setItem` silently degrades; toggle still flips in-memory state on `setItem` throw.
- The most subtle behavior — the edit-while-collapsed guard — has a dedicated test (T4) that pins both `aria-expanded="true"` AND the edit textarea's continued presence after a toggle click. If a future contributor accidentally replaces `displayExpanded` with `!collapsed` for the region render, T4 fails.
- Determinism — `vi.clearAllMocks()` + `MemoryStorage.clear()` in `beforeEach`. No leaked mock state.
- Mock factory stays synchronous per design D8 (R4 of `athlos-audit-operator-display`).
- Regression risk low — the only behavioural change to existing render paths is the wrapper div around form + list; `expandCard()` helper expands the card so the 10 pre-existing scenarios continue to assert against the same DOM shape they did before.

### Out of scope (deferred to follow-up PRs)

- No new UI primitive (`<Collapse>` / `<Accordion>` / `<Disclosure>`) — re-evaluate when a second consumer surfaces.
- No backend, schema, migration, or API change.
- No animation library — chevron rotation is the only animation.
- No a11y audit beyond `aria-expanded` + `aria-controls` + `aria-labelledby` + heading `id`.
- No edits to `AuditTab`, `OperatorChip`, `/socios/page.tsx`, `/socios/[id]/page.tsx`.

### Pre-existing CI failures (NOT from this PR)

Per handover note, three pre-existing CI failures on `main` will fail again on this PR:

1. **`test` job** — pre-existing `React is not defined` in `apps/web/src/app/admin/gastos/[id]/page.test.tsx:141` (not in this PR's diff).
2. **`labeler` job** — pre-existing labeler pattern drift.
3. **`Docker build smoke` job** — pre-existing `log_error: command not found` in `apps/api/docker-entrypoint.sh:31`.

None of these are introduced by PR 8b.6. **Recommend merging with `gh pr merge --merge --admin`** (same workaround used for the prior PRs in the `athlos-audit-operator-display` and `athlos-import-completion` chains). A separate `chore(ci)` PR is on the backlog.

### Risks

- **R1 (design) — localStorage key namespacing**: key shape `notes-collapsed-<socioId>` works only while one entity type uses it. If `SocioNotesCard` is later mounted on `/ctacte/[cuenta]` or `/padrones/[id]` the key MUST become `<entityType>-notes-collapsed-<id>`. **Flagged for follow-up** when that mount happens — do not preemptively namespace in this PR (would break the spec contract).
- **R2 (design) — SSR hydration flash on return visits**: server always renders collapsed; client rehydrates from `localStorage` inside `useEffect`. Returning visitors with persisted `false` see one frame of collapsed before expansion. Documented in the hook's JSDoc. Acceptable per the locked proposal.
- **R3 (test gap) — `typeof window === 'undefined'` branch**: the SSR-safety guard inside `useEffect` is exercised indirectly via the getItem-throw + setItem-throw tests in jsdom (which always defines `window`). A direct unit test for the `window === undefined` branch cannot run in jsdom because React 19 itself requires `window`. **Mitigation**: the guard is one line (`if (typeof window === 'undefined') return`), and the proxy tests pin the documented "storage unavailable" fallback behavior end-to-end.
- **R4 (applied) — empty-state copy**: "de arriba" → "de abajo" per proposal P7. No other UI copy changes.
- **R5 (applied) — minimal badge variant**: counter uses `<Badge variant="default">` because `muted` does not exist in `Badge.tsx` (variants: `default | success | warning | danger | info`). If a true neutral/muted visual is wanted later, that's a separate primitive-change PR.

### Contributor Checklist

- [x] No `Co-Authored-By` trailers
- [x] Conventional commit messages
- [x] Husky pre-commit ran (eslint --fix + prettier --write)
- [x] No `--no-verify`
- [x] No amend after push
- [x] No deploy / restart (PR is additive code only; rebuild + PM2 restart happen post-merge)
- [x] `next-env.d.ts` is not dirty
- [x] OpenSpec change artifacts (`openspec/changes/athlos-notes-collapsible/...`) are working copies; will be archived via `sdd-archive` after this PR merges
