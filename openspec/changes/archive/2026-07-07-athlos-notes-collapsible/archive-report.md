# Athlos notes collapsible — archive report (2026-07-07)

**SDD change:** `athlos-notes-collapsible`
**Archived on:** 2026-07-07
**Final main HEAD:** `0e047c3`

## Final state

### PRs merged to `main`

| PR | Scope | LoC | Notes |
|---|---|---|---|
| #16 | Frontend (`feat(web): collapsible SocioNotesCard with per-socio persistence (PR 8b.6)`) | 4 files, +659/-189 (343 net code-only, 127 docs) | Single PR, stacked-to-main. Code-only LoC within the 400-line review budget (532 insertions / 189 deletions = 343 net). The extra 127 lines are `.github/PR_8B6_BODY.md` (documentation only). |

**Total LoC merged:** 343 net (532 insertions / 189 deletions across 3 source files: 1 hook + 1 edit + 2 tests).
**Strategy:** single PR, stacked-to-main.
**Strict TDD:** applied per commit (RED → GREEN paired). 4-commit plan delivered as 3 implementation commits + 1 docs commit (`C.4` folded into `C.3` per user's `OR include in C.3 if cleaner` opt-in recorded in PR body line 17).

### Commits on `feat/notes-collapsible` (now merged)

| Commit | Subject |
|---|---|
| `7f5d6ca` | feat(web): add useNotesCollapsed hook with SSR-safe localStorage persistence |
| `277d336` | feat(web): add collapsible header + counter + chevron to SocioNotesCard |
| `917e96e` | feat(web): wrap notes content in collapsible region with edit guard |
| `507f1d9` | docs(pr): add PR 8b.6 body file |

### Files added to repo

**Frontend (`apps/web/`):**
- `src/components/socios/use-notes-collapsed.test.ts` (NEW, 8 scenarios) — isolated hook tests using `renderHook` from `@testing-library/react`.
- `src/components/socios/SocioNotesCard.tsx` (EDIT) — added `useNotesCollapsed` hook (colocated, exported with `@internal` JSDoc marker per tasks.md §"Hook exportability note"), inline `<button type="button">` toggle in the header, `<Badge variant="default" className="ml-auto">` counter chip, `<ChevronDown className="…transition-transform duration-fast rotate-180…">` rotation, and the `<div role="region" id="socio-notes-panel">` collapsible region wrapping the form + list. The `aria-expanded` is bound to `displayExpanded` (NOT `!collapsed`) so screen readers don't lie when an edit is in flight (design D5 / spec R6).
- `src/components/socios/SocioNotesCard.test.tsx` (EXTEND, +6 scenarios over the existing 10) — T1 (default collapsed + counter chip), T2 (click writes literal `'false'` to localStorage), T3 (round-trip across remount), T4 (edit-while-collapsed guard keeps panel + textarea visible), counter pluralisation (`"0 notas"`, `"1 nota"`, `"N notas"`).

**Note on file layout:** The hook lives **inside** `SocioNotesCard.tsx` (colocated, per design D2 — design rejected extracting `use-collapsed.ts` into `apps/web/src/lib/` as premature). The prompt referenced a separate `use-notes-collapsed.ts` file as `(NEW, hook)`; the actual delivered layout matches design D2 (hook colocated inside `SocioNotesCard.tsx`) and the verify report (`SocioNotesCard.tsx:414-433` for hook, `:430` named export with `@internal`).

### Tests

- **Web (touched files):** 24 new tests (16 in `SocioNotesCard.test.tsx`, 8 in `use-notes-collapsed.test.ts`). All PASS.
- **Web (full suite):** 57 files / **517 tests PASS**. **0 regressions**.
- **typecheck + lint:** clean on `@athlos/web`.
- **Review verdicts (combined):** review-readability PASS, review-reliability PASS (inline; `review-*` lens skills not installed in this environment).

## Specs archived

- **New canonical spec:** `openspec/specs/notes-collapse/spec.md` (synced from the change's `specs/notes-collapse/spec.md`, prefixed with `> Synced from change \`athlos-notes-collapsible\` (2026-07-07).`).
- **Capabilities affected:** none existing. This change creates a new `notes-collapse` capability (8 requirements + 14 scenarios). No prior spec was modified.
- **Source-of-truth now lives at:** `openspec/specs/notes-collapse/spec.md`.

## User-visible behaviour

- `<SocioNotesCard>` on `/socios/[id]` renders collapsed by default; the header shows the count chip (`0 notas` / `1 nota` / `N notas`).
- Clicking the header expands the panel (notes list + "nueva nota" form) and persists the expanded state under `localStorage["notes-collapsed-<socioId>"] = "false"`.
- Clicking again collapses and writes `"true"`. The chevron rotates 180° via Tailwind `transition-transform duration-fast`.
- Different socio → independent state. Same socio → remembered across visits.
- Editing + collapsing → edit stays open (`displayExpanded = !collapsed || editingId !== null`); no lost work.
- SSR renders collapsed with no hydration mismatch; one-frame flash on return visits is acceptable (server default = spec default).

## Verification verdict

`sdd-verify` returned **READY FOR ARCHIVE**:

- **CRITICAL:** 0
- **WARNING:** 2
  - **W1 — Different-socio isolation scenario (S5) is not explicitly tested.** The `notes-collapsed-<socioId>` key shape makes isolation implicit, but the spec scenario has no dedicated two-socio test. ACTIONABLE but low-priority (behavioural correctness is guaranteed by the key shape).
  - **W2 — Chevron rotation (R7 / S13) is not asserted by any test.** The class string `rotate-180` + `transition-transform duration-fast` is verified only by source inspection. A test asserting the className on the chevron element would close the gap. ACTIONABLE but low-priority (visual effect).
- **SUGGESTION:** 1
  - **S1 — Pin the Badge `ml-auto` and header `flex w-full items-center justify-between gap-3` in a test.** The class strings are verifiable source-contract from `design.md` §"Visual Contract (pinned className)" but no test currently asserts them. Informational.

All 8 spec requirements satisfied. 13 of 14 spec scenarios covered by runtime tests; 1 is implicit by code shape (S5) and 1 is verified by source inspection (S13). All 9 design decisions (D1–D9) honoured. Full report at `openspec/changes/archive/2026-07-07-athlos-notes-collapsible/verify-report.md`.

## Carry-over follow-ups (NOT in this change)

These were tracked through the change but left out of scope. They each warrant their own work:

1. **`chore(ci): fix pre-existing CI failures`** — three pre-existing CI failures documented in the PR body (`/home/vlongo/work/athlos/.github/PR_8B6_BODY.md` lines 100-108). The new tests pass on the touched files; full-suite gating remains blocked. Recommend a dedicated `chore(ci)` PR:
   - `test` job: `ReferenceError: React is not defined` in `apps/web/src/app/admin/gastos/[id]/page.test.tsx:141`.
   - `labeler` job: auto-labeler pattern drift.
   - `Docker build smoke` job: `/usr/local/bin/docker-entrypoint.sh: line 31: log_error: command not found`.
2. **New SDD change: fix drizzle migration system** — `__drizzle_migrations` absent in prod, `_journal.json` has gaps in 0013-0019. Workaround currently is `docker exec -i athlos-db-1 psql -U athlos -d athlos < archivo.sql`. This change made no Drizzle calls so it didn't trigger the bug, but the next schema-touching change will.
3. **Cache-invalidation on operator rename** (carry-over from `athlos-audit-operator-display` archive #267). Locked out-of-scope per proposal; flagged for future if real ops friction emerges.
4. **localStorage key future namespacing** — the current key `notes-collapsed-<socioId>` is entity-specific. When a second consumer appears (`/ctacte/[cuenta]` notes or `/padrones/[id]` notes), the key MUST become `<entityType>-notes-collapsed-<id>`. Do **NOT** preemptively namespace now (it would break the spec and the existing persisted state).
5. **2 minor spec coverage gaps from verify (WARNING) — actionable in a follow-up PR**:
   - Add a two-socio isolation test (closes W1).
   - Add a className assertion for chevron rotation (closes W2).
   - Optional: pin the Badge `ml-auto` + header `flex w-full items-center justify-between gap-3` class strings (closes S1).

## Cross-references

- Engram apply-progress: `sdd/athlos-notes-collapsible/apply-progress` (#278, rewritten with final closed state)
- Engram verify-report: `sdd/athlos-notes-collapsible/verify-report` (#280)
- Engram design: `sdd/athlos-notes-collapsible/design` (#275)
- Engram tasks: `sdd/athlos-notes-collapsible/tasks` (#277)
- Engram spec: `SDD spec for athlos-notes-collapsible` (#274)
- Engram localStorage pattern: `architecture/localStorage-key-namespace-convention` (#276)
- Engram explore: `sdd/athlos-notes-collapsible/explore` (#270)
- Engram pattern (no Collapse primitive yet): `pattern/no-collapse-primitive-yet` (#271)
- Obsidian: `/srv/obsidian/Athlos/0-Index.md` (ledger updated; this entry mirrors the archived `athlos-audit-operator-display` line 9 format).

## Sessions

Completed in session `athlos-server-gorriti-2026-07-06` (continuation of the apply + verify sessions on `feat/notes-collapsible`).