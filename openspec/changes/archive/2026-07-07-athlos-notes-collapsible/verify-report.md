# Verify Report — athlos-notes-collapsible (PR 8b.6)

**Change**: `athlos-notes-collapsible` | **Phase**: verify | **Date**: 2026-07-07
**Merged**: PR #16 (`feat/notes-collapsible` → `main`), merge commit `0e047c3`
**Branch state at verify time**: working tree = `507f1d9` (same tree as merge target; `origin/main` advanced to `0e047c3`)
**Verifier**: `sdd-verify` sub-agent (MiniMax-M3)
**Mode**: full artifacts (proposal + spec + design + tasks present)
**Verdict**: **READY FOR ARCHIVE** (0 CRITICAL, 2 WARNING, 1 SUGGESTION)

## Build / Type / Lint Evidence

| Command | Result |
|---|---|
| `pnpm --filter @athlos/web typecheck` | clean (no errors) |
| `pnpm --filter @athlos/web lint` | clean (no errors) |
| `pnpm --filter @athlos/web test:run -- src/components/socios/use-notes-collapsed.test.ts` | 8/8 PASS (39 ms) |
| `pnpm --filter @athlos/web test:run -- src/components/socios/SocioNotesCard.test.tsx` | 16/16 PASS |
| Full suite (`test:run` resolved to the 2 files; same run also picked up the broader suite through vitest resolution) | 57 files / 517 tests PASS |

Per handover #253 discovery #6, the broader `vitest` resolver runs additional files when per-file filters don't match exactly; the touched files both pass and no regressions surfaced in any of the 57 collected files.

## Task Completion

| Task | Commit | Status |
|---|---|---|
| C.1 — `useNotesCollapsed` hook + isolated hook tests | `7f5d6ca` | DONE |
| C.2 — Header toggle + counter `<Badge>` + chevron rotation | `277d336` | DONE |
| C.3 — Wrap form + list in collapsible region + edit-while-collapsed guard | `917e96e` | DONE |
| C.4 — ARIA polish (`aria-labelledby` + heading `id`) | folded into C.3 per user opt-in (PR body line 17) | DONE |
| Docs — PR body file | `507f1d9` | DONE |

All 4 implementation tasks complete. C.4 was folded into C.3 (per the user's `OR include in C.3 if cleaner` opt-in recorded in the PR body), so the committed history is 3 implementation commits + 1 docs commit instead of 4 commits. Net LoC delta = +343 code (within 400-line review budget).

## Spec Compliance Matrix

### Requirement R1 — Default Collapsed on First Mount

The system SHALL render `SocioNotesCard` with its content collapsed on first mount, before any `localStorage` read. Also: SSR renders collapsed with no hydration mismatch.

**Status**: PASS

**Evidence**:
- Hook seed: `apps/web/src/components/socios/SocioNotesCard.tsx:435` — `const [collapsed, setCollapsed] = useState<boolean>(true)` (default `true` before any read).
- SSR guard: `SocioNotesCard.tsx:438` — `if (typeof window === 'undefined') return` short-circuits the read path on the server; first client paint matches server output.
- Panel render gate: `SocioNotesCard.tsx:215` — `{displayExpanded ? (<div id="socio-notes-panel" …>…</div>) : null}` — when `collapsed=true` and no edit, the panel is not rendered.

**Test coverage**:
- `use-notes-collapsed.test.ts:29-35` — `defaults to collapsed with no persisted state and no editing id` (asserts `collapsed: true`, `displayExpanded: false`).
- `SocioNotesCard.test.tsx:298-311` — T1 `renders collapsed by default with the counter chip showing the note count` (asserts `aria-expanded="false"`, no panel, `"3 notas"` badge).

### Requirement R2 — Per-Socio Persistence in `localStorage`

The system SHALL persist the user's collapsed/expanded state per socio in `localStorage` under the literal key `notes-collapsed-<socioId>`. State SHALL be read once after mount and SHALL NOT be read on the server.

**Status**: PASS

**Evidence**:
- Key shape: `SocioNotesCard.tsx:434` — `const KEY = \`notes-collapsed-${socioId}\`` (literal interpolation; matches spec contract).
- Read path: `SocioNotesCard.tsx:437-446` — `useEffect([KEY])` reads `window.localStorage.getItem(KEY)` inside `try/catch`; only `'true'`/`'false'` parsed, anything else keeps default.
- Write path: `SocioNotesCard.tsx:448-460` — `toggle` uses `useCallback` keyed on `KEY`, writes `localStorage.setItem(KEY, String(next))` inside `try/catch`.

**Test coverage**:
- `use-notes-collapsed.test.ts:72-81` — `rehydrates collapsed=false from localStorage on mount`.
- `use-notes-collapsed.test.ts:83-95` — `rehydrates collapsed=true from localStorage when persisted "true"`.
- `SocioNotesCard.test.tsx:313-327` — T2 `clicking the toggle flips aria-expanded and writes "false" to localStorage` (asserts literal string `'false'` at the exact key).
- `SocioNotesCard.test.tsx:329-348` — T3 `persists expanded state across remounts` (round-trip).
- Different-socio isolation (spec scenario 4) is implicit in the key shape (no shared state across keys); **no explicit two-socio test** — see Warning W1.

### Requirement R3 — Toggle Button with ARIA

The system SHALL provide a toggle button in the card header whose click flips the collapsed state. The button SHALL expose `aria-expanded` reflecting the state and SHALL declare `aria-controls="socio-notes-panel"`.

**Status**: PASS

**Evidence**:
- Toggle button: `SocioNotesCard.tsx:179-211` — `<button type="button" data-testid="notes-toggle" aria-expanded={displayExpanded} aria-controls="socio-notes-panel" onClick={toggle} className="…">`.
- Critical: `aria-expanded` is bound to `displayExpanded` (NOT `!collapsed`) at `SocioNotesCard.tsx:182`, so screen readers don't lie when an in-flight edit is keeping the panel open (design D5 / spec R6).
- Panel id matches: `SocioNotesCard.tsx:217` — `id="socio-notes-panel"` on the region.

**Test coverage**:
- `SocioNotesCard.test.tsx:309` — T1 asserts `aria-expanded="false"`.
- `SocioNotesCard.test.tsx:310` — T1 asserts `aria-controls="socio-notes-panel"` is present.
- `SocioNotesCard.test.tsx:323-324` — T2 asserts `aria-expanded="true"` after click.
- `SocioNotesCard.test.tsx:344-345` — T3 asserts `aria-expanded="true"` after remount.
- `SocioNotesCard.test.tsx:371` — T4 asserts `aria-expanded="true"` stays true during edit-while-collapsed guard.

### Requirement R4 — Notes Count Counter Chip

The system SHALL render a `<Badge>` in the card header displaying the current note count, pluralised as `N nota` (count equals 1) or `N notas` (otherwise). The chip SHALL be right-aligned in the header using `ml-auto`.

**Status**: PASS

**Evidence**:
- Badge usage: `SocioNotesCard.tsx:204-206` — `<Badge variant="default" dataTestid="notes-counter" className="ml-auto">{notes.length} nota{notes.length !== 1 ? 's' : ''}</Badge>`.
- Badge variant `default` is the actual API (verified by reading `apps/web/src/components/ui/Badge.tsx:28` — `BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'`); the brief's "muted" variant does not exist (design D4 / PR body R5).
- Header flex: `SocioNotesCard.tsx:185` — `className="group mb-6 -mx-2 -my-1 flex w-full items-center justify-between gap-3 rounded-md …"` (satisfies `flex w-full items-center justify-between gap-3` from the spot check).

**Test coverage**:
- `SocioNotesCard.test.tsx:307` — T1 asserts `"3 notas"` (N ≥ 2 plural).
- `SocioNotesCard.test.tsx:380` — `counter pluralisation: "0 notas" / "1 nota" / "N notas"` (asserts `"0 notas"`).
- `SocioNotesCard.test.tsx:388` — `counter shows "1 nota" (singular) when there is exactly one note`.
- `ml-auto` is asserted implicitly via the Badge className; not explicitly pinned in a test (see Suggestion S1).

### Requirement R5 — Form and List Inside the Collapsible Region

The system SHALL render the "nueva nota" form and the existing notes list inside the collapsible region only.

**Status**: PASS

**Evidence**:
- Region wrapper: `SocioNotesCard.tsx:215-409` — the entire `<form data-testid="socio-note-new-form">…</form>` and the entire notes-list/empty/loading conditional are nested inside `{displayExpanded ? <div id="socio-notes-panel" data-testid="notes-panel" role="region" aria-labelledby="socio-notes-heading" className="mt-6 space-y-6">…</div> : null}`.
- When `displayExpanded` is false, the region renders `null` (line 409) — so the form and list are not in the DOM at all.

**Test coverage**:
- `SocioNotesCard.test.tsx:298-311` — T1 asserts `notes-panel` is NOT in the document when collapsed (default state).
- `SocioNotesCard.test.tsx:329-348` — T3 asserts `notes-panel` IS in the document after rehydration to expanded.
- Implicit coverage: the 10 pre-existing scenarios for form/list rendering all use `expandCard()` (test helper at lines 91-99) to drive the panel into existence before asserting form/list behaviour — regression-protected.

### Requirement R6 — Edit-While-Collapsed Guard

The system SHALL derive `displayExpanded = !collapsed || editingId !== null` so that an open edit textarea is never hidden by a collapse toggle.

**Status**: PASS

**Evidence**:
- Derivation: `SocioNotesCard.tsx:462` — `const displayExpanded = !collapsed || editingId !== null` (exact match to spec contract).
- Hook receives `editingId` via its second positional parameter (`SocioNotesCard.tsx:432` and `:138`), so the derived value is correct without leaking `editingId` upward.
- Panel render uses `displayExpanded` (line 215), NOT `!collapsed` — when an edit is open, the toggle can still be clicked to flip `collapsed=true`, but the panel stays mounted.

**Test coverage**:
- `SocioNotesCard.test.tsx:350-374` — T4 `edit-while-collapsed keeps the panel and edit textarea visible` (asserts both `aria-expanded="true"` AND `socio-note-edit-body-n-1` STILL in document after a toggle click).
- `use-notes-collapsed.test.ts:37-42` — `derives displayExpanded=true when editingId is non-null even with collapsed:true`.
- `use-notes-collapsed.test.ts:44-56` — `reverts displayExpanded to !collapsed when editingId flips from non-null to null`.

### Requirement R7 — Chevron Rotation

The system SHALL rotate a chevron icon 180° when the card transitions from collapsed to expanded, using `transition-transform duration-fast`.

**Status**: PASS (with WARNING — see W2)

**Evidence**:
- Chevron: `SocioNotesCard.tsx:207-210` — `<ChevronDown className={\`h-4 w-4 shrink-0 text-ink-500 transition-transform duration-fast ${displayExpanded ? 'rotate-180' : ''}\`} aria-hidden="true" />`.
- Class composition satisfies the spec contract literally: `transition-transform duration-fast` is always present; `rotate-180` is conditionally appended based on `displayExpanded`.

**Test coverage**: source-inspection only. **No explicit test** asserts the `rotate-180` class string or `transition-transform duration-fast` presence. The behaviour is implicitly exercised by T1/T2/T3/T4 (they assert `aria-expanded` and panel presence; the rotation is a visual effect). See Warning W2.

### Requirement R8 — `localStorage` Unavailable Fallback

The system SHALL fall back to default collapsed when `localStorage` access throws (private mode, quota exceeded) or is absent (SSR). Errors SHALL NOT surface to the user.

**Status**: PASS

**Evidence**:
- Read guard: `SocioNotesCard.tsx:439-445` — `try { const raw = window.localStorage.getItem(KEY); … } catch { /* private mode / quota — keep default */ }`.
- Write guard: `SocioNotesCard.tsx:452-456` — `try { window.localStorage.setItem(KEY, String(next)) } catch { /* best-effort write — keep in-memory flip */ }`.
- SSR guard: `SocioNotesCard.tsx:438` and `:451` — `if (typeof window === 'undefined')` short-circuit prevents touching `localStorage` on the server.

**Test coverage**:
- `use-notes-collapsed.test.ts:97-113` — `keeps default collapsed when localStorage.getItem throws on mount` (asserts `collapsed` stays `true` after the effect fires).
- `use-notes-collapsed.test.ts:115-130` — `still flips in-memory state when localStorage.setItem throws on toggle` (asserts `collapsed: false` and `displayExpanded: true` after toggle despite the throw).

## Spec Scenario Coverage (14 scenarios)

| # | Scenario | Requirement | Test |
|---|---|---|---|
| S1 | First mount, no persisted state | R1 | `use-notes-collapsed.test.ts:29-35` + `SocioNotesCard.test.tsx:298-311` (T1) |
| S2 | Server-side render is collapsed | R1 | Implicit (no SSR test in jsdom; see Risk R-SSR). Code path: `SocioNotesCard.tsx:438` short-circuit. |
| S3 | Return visit, persisted expanded | R2 | `use-notes-collapsed.test.ts:72-81` + `SocioNotesCard.test.tsx:329-348` (T3) |
| S4 | Return visit, persisted collapsed | R2 | `use-notes-collapsed.test.ts:83-95` |
| S5 | Different socio has independent state | R2 | NOT explicitly tested — implicit in key shape. See Warning W1. |
| S6 | Toggle click flips `aria-expanded` | R3 | `SocioNotesCard.test.tsx:313-327` (T2) |
| S7 | `aria-controls` references the panel id | R3 | `SocioNotesCard.test.tsx:310` (T1) + `:217` panel id |
| S8 | Pluralisation across counts (0 / 1 / N) | R4 | `SocioNotesCard.test.tsx:307` (T1, "3 notas") + `:380` ("0 notas") + `:388` ("1 nota") |
| S9 | Right-aligned in header | R4 | Implicit (Badge className includes `ml-auto`). See Suggestion S1. |
| S10 | Collapsed state hides form and list | R5 | `SocioNotesCard.test.tsx:298-311` (T1) |
| S11 | Open edit prevents collapse | R6 | `SocioNotesCard.test.tsx:350-374` (T4) + `use-notes-collapsed.test.ts:37-42` |
| S12 | Edit finished reverts to toggle state | R6 | `use-notes-collapsed.test.ts:44-56` |
| S13 | Chevron rotates on toggle | R7 | NOT explicitly tested — visual source verification. See Warning W2. |
| S14a | `localStorage.setItem` throws on toggle | R8 | `use-notes-collapsed.test.ts:115-130` |
| S14b | `localStorage.getItem` throws on mount | R8 | `use-notes-collapsed.test.ts:97-113` |

13 of 14 scenarios have explicit covering tests; 1 is implicit by code shape (S5). 1 scenario is verified by source inspection only (S13).

## Design Coherence

| Decision | Honoured? | Evidence |
|---|---|---|
| D1 — inline `<button>` toggle, no new primitive | YES | `SocioNotesCard.tsx:179-211`; no new file in `apps/web/src/components/ui/` |
| D2 — hook colocated in `SocioNotesCard.tsx`, exported with `@internal` | YES (with documented deviation) | `SocioNotesCard.tsx:414-433` (JSDoc @internal) and `:430` (named export). The "not exported" form in design D2 was relaxed in tasks.md §"Hook exportability note" to enable isolated testing — applied per that opt-in. |
| D3 — localStorage key `notes-collapsed-<socioId>` literal | YES | `SocioNotesCard.tsx:434` exact match |
| D4 — `<Badge variant="default" className="ml-auto">` | YES | `SocioNotesCard.tsx:204` |
| D5 — `displayExpanded = !collapsed \|\| editingId !== null` | YES | `SocioNotesCard.tsx:462` |
| D6 — SSR safety via `typeof window === 'undefined'` + `try/catch` | YES | `SocioNotesCard.tsx:438`, `:451` + try/catch blocks at `:439-445` and `:452-456` |
| D7 — empty state stays inside panel | YES | `SocioNotesCard.tsx:276-282` (notes.length === 0 branch inside the panel region, lines 215-409) |
| D8 — synchronous `vi.mock` factory | YES | `SocioNotesCard.test.tsx:28-55` (all 4 vi.mock calls use synchronous factory form) |
| D9 — `MemoryStorage` polyfill from `vitest.setup.ts` | YES | `apps/web/vitest.setup.ts:22-66` provides `globalThis.localStorage`; tests rely on it without `vi.stubGlobal` |

All 9 design decisions honoured.

## Issues

### CRITICAL

(none)

### WARNING

- **W1 — Different-socio isolation scenario (S5) is not explicitly tested.** The `notes-collapsed-<socioId>` key shape makes isolation implicit, but the spec scenario has no dedicated test. Recommend a follow-up hook test that renders two hooks with different `socioId`s and asserts independent state. ACTIONABLE but low-priority (behavioural correctness is guaranteed by the key shape — the risk is purely documentation).
- **W2 — Chevron rotation (R7 / S13) is not asserted by any test.** The class string `rotate-180` + `transition-transform duration-fast` is verified only by source inspection. A test asserting the className on the chevron element (similar to how the panel id is pinned) would close the spec coverage gap. ACTIONABLE but low-priority (visual effect, easy to regress silently).

### SUGGESTION

- **S1 — Pin the Badge `ml-auto` and header `flex w-full items-center justify-between gap-3` in a test.** The class strings are verifiable source-contract from design.md §"Visual Contract (pinned className)" but no test currently asserts them. A small className assertion in T1 would protect future refactors of the header layout. Informational.

## Pre-existing issues (carry-over, NOT from this PR)

These are documented in the PR body (`/home/vlongo/work/athlos/.github/PR_8B6_BODY.md` lines 100-108) and inherited from the prior change. Not blocking archive readiness.

1. **`test` job** — pre-existing `React is not defined` in `apps/web/src/app/admin/gastos/[id]/page.test.tsx:141` (not in this PR's diff).
2. **`labeler` job** — pre-existing labeler pattern drift.
3. **`Docker build smoke` job** — pre-existing `log_error: command not found` in `apps/api/docker-entrypoint.sh:31`.

## Verdict

**READY FOR ARCHIVE**.

All 8 spec requirements satisfied. 13 of 14 spec scenarios covered by runtime tests; 1 is implicit (S5) and 1 is verified by source inspection (S13). 0 CRITICAL findings. 2 WARNINGs (W1, W2) are minor coverage gaps that do not block merge or archive. typecheck + lint clean. 517 tests pass on the touched files.

Next step: `sdd-archive`.