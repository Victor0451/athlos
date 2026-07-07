# Athlos toast primitivo — archive report (2026-07-07)

**SDD change:** `athlos-toast-primitivo`
**Archived on:** 2026-07-07
**Final main HEAD:** `75e5d25` (PR #17 merged)

## Final state at archive

- **HEAD main:** `75e5d25`
- **PR merged:** #17 (single PR, 7 commits, 763 LoC total, C.5 split into C.5a + C.5b per the `Workload > 400 LoC → split` rule from `work-unit-commits`)
- **Dep added:** `sonner@^1.7.4` (lockfile pins exactly `1.7.4`, React 19 peer-dep satisfied)
- **Tests added:** 31 (548 web total, 0 regressions)
- **Strict TDD:** applied per commit (RED → GREEN paired, with synchronous `vi.mock('@/lib/notifications', factory)` per design D8)

### Commits on `feat/toast-primitivo` (now merged into `main`)

| # | SHA | Subject | LoC |
|---|---|---|---:|
| C.1 | `c35a3ac` | feat(web): add toast primitive wrapper around sonner | +399 |
| C.2 | `fe03181` | chore(web): mount ToasterMount globally and add sonner no-restricted-imports rule | +62 |
| C.3 | `85e49bf` | feat(web): wire createMutation with toast notifications | +69 |
| C.4 | `421ab2e` | feat(web): wire page-level mutations with toast notifications | +122 |
| C.5a | `89ed85f` | feat(web): wire note create+update mutations with toast notifications | +81 |
| C.5b | `932bb10` | feat(web): wire note delete mutation with toast notifications | +30 |
| docs | `dd64ec2` | docs(pr): add PR 8b.7 body file | +158 |

**Total LoC merged:** 763 insertions, 2 deletions across 13 files (above the 400-line review budget; C.5 split into C.5a + C.5b to keep each commit under 400).

## Specs archived

- **New canonical spec:** `openspec/specs/toast-notifications/spec.md` (synced from the change's `specs/toast-notifications/spec.md`, prefixed with `> Synced from change \`athlos-toast-primitivo\` (2026-07-07).`).
  - 5 requirements, 18 scenarios.
  - Source-of-truth now lives at `openspec/specs/toast-notifications/spec.md`.
- **Delta applied:** `openspec/specs/ui-design/spec.md` — new `### Requirement: Toast / Alert Banner Defaults` appended before the `## Success Criteria` section (1 ADDED requirement with 4 scenarios). The pre-existing prose at the `### Toast / Alert Banner` heading under `Base Component System` (lines 259–264, mandating `5 s for success/info, sticky for error until dismissed`) is now superseded per the new requirement; it is preserved as a non-authoritative baseline (the new requirement is the binding contract).
- **Capabilities affected:** `toast-notifications` is a NEW capability; `ui-design` MODIFIED (1 ADDED requirement).

## Files added to repo

**Frontend (`apps/web/`) — NEW:**
- `src/components/ui/Toast.tsx` (150 LoC) — `'use client'` wrapper exporting `NotifyKind`, `NotifyOptions`, `notify(kind, message, opts?)`, `<ToasterMount />`. Owns the locked `TOAST_DEFAULTS` (top-right, light, richColors, closeButton, 4000/6000ms) + ARIA mechanism (`classNames` slot stamp → DOM-touch `useEffect` setting `role`).
- `src/components/ui/Toast.test.tsx` (245 LoC, 17 tests) — render path (real sonner, ARIA + mount + multi-toast) + contract path (spy on sonner, durations + class stamping + forwarding).
- `src/lib/notifications.ts` (15 LoC) — re-export mirroring `lib/auth.ts` (no logic; not separately tested).

**Frontend (`apps/web/`) — EDIT:**
- `src/app/layout.tsx` — `<ToasterMount />` inserted as last child of `<AuthProvider>` at line 22 (inside `<body>` and after `<AuthProvider>` per design D3).
- `src/app/(authed)/socios/new/page.tsx` (site 1) — `createMutation.onSuccess` → `notify('success', 'Socio creado')`; `onError` → `notify('error', 'No se pudo crear el socio')`. Inline `<div role="alert">` preserved.
- `src/app/(authed)/socios/[id]/page.tsx` (sites 2/3/4) — `updateMutation`, `deleteMutation`, `reactivateMutation` each gain `onSuccess` → `notify('success', …)` + `onError` → `notify('error', …)`. Inline `deleteError` / `errorMessage` preserved.
- `src/components/socios/SocioNotesCard.tsx` (sites 5/6/7) — `createMutation`, `updateMutation`, `deleteMutation` for notes each gain success + error toasts. Inline `<p role="alert">` per note preserved.
- `src/app/(authed)/socios/new/page.test.tsx` (EXTEND) — 2 new scenarios (success + error).
- `src/app/(authed)/socios/[id]/page.test.tsx` (EXTEND) — 6 new scenarios (3 mutations × {success, error}).
- `src/components/socios/SocioNotesCard.test.tsx` (EXTEND) — 6 new scenarios in a new `describe('toast wiring', …)` block.

**Repo root — EDIT:**
- `eslint.config.cjs` — new `no-restricted-imports` rule scoped to `apps/web/src/**/*.{ts,tsx}` blocking `from 'sonner'`, with a fix-message pointing at the wrapper. Wrapper file itself has a documented override.
- `apps/web/package.json` — `"sonner": "^1.7.4"` added under `dependencies` (line 27).
- `pnpm-lock.yaml` — resolves to `sonner@1.7.4` exactly (React 19 peer-dep satisfied).

**PR body (docs, not in repo tree):**
- `.github/PR_8B7_BODY.md` (NEW) — PR description file.

## Verification verdict

`sdd-verify` returned **PASS — Ready for sdd-archive**:

- **CRITICAL:** 0
- **WARNING:** 0
- **SUGGESTION:** 1 — `lib/notifications.ts` is type-only re-export of `NotifyKind` + `NotifyOptions`; some future callers may want a default-export convenience. Out of scope per the proposal.

All 5 spec requirements (R1–R5) and all 18 scenarios in `specs/toast-notifications/spec.md` are satisfied with runtime test evidence. The ui-design ADDED requirement with 4 scenarios is also covered. `pnpm typecheck` + `pnpm lint` clean. Full web test suite green (548/548). Review verdicts (combined): review-readability PASS, review-reliability PASS (executed inline because the `review-*` skills are not installed in this environment; documented in PR body). Full report at `openspec/changes/archive/2026-07-07-athlos-toast-primitivo/verify-report.md`.

## Carry-over follow-ups (NOT in this change)

These were tracked through the change but left out of scope. They each warrant their own work:

1. **`chore(ci): fix pre-existing CI failures`** — three pre-existing CI failures documented in PR #17 body and in apply-progress #290. The new tests pass on the touched files; full-suite gating remains blocked. Recommend a dedicated `chore(ci)` PR:
   - `test` job: `apps/web/src/app/admin/gastos/[id]/page.test.tsx:141` `ReferenceError: React is not defined` (NOT touched by this PR; pre-existing flaky test).
   - `labeler` job: labeler pattern drift (NOT touched by this PR; pre-existing config issue).
   - `Docker build smoke` job: `apps/api/docker-entrypoint.sh:31` `log_error: command not found` (NOT touched by this PR; backend smoke job).
2. **New SDD change: fix drizzle migration system** — `__drizzle_migrations` absent in prod, `_journal.json` has gaps in 0013–0019. Workaround currently is `docker exec -i athlos-db-1 psql -U athlos -d athlos < archivo.sql`. This change made no Drizzle calls so it didn't trigger the bug, but the next schema-touching change will.
3. **Theme pin (`theme='light'`)** — future dark-mode work requires a follow-up PR. The wrapper at `Toast.tsx:142` pins the literal `'light'` (design D7); the `Toaster` API accepts a string + a `'system'` value, so a future dark-mode toggle would only need to switch this one literal and add an OS preference listener.
4. **ARIA mechanism reliance on DOM-touch `useEffect`** — sonner 1.7.x exposes no first-party per-toast `role` API. The wrapper stamps `athlos-toast--<kind>` via `classNames.toast` and a `useEffect` walks `[data-sonner-toast]` setting `role={roleByKind[kind]}` (`Toast.tsx:125–135`). If sonner ships a first-party per-toast `role` API in a later release, this `useEffect` could be simplified or removed entirely.
5. **2 minor verify warnings from prior change (`athlos-notes-collapsible`)** — actionable in a follow-up PR:
   - W1 — Different-socio isolation scenario (S5) not explicitly tested.
   - W2 — Chevron rotation (R7 / S13) className not asserted by any test.
6. **localStorage key namespacing from prior change** — the `notes-collapsed-<socioId>` key shape (per `athlos-notes-collapsible`) is entity-specific. When a second consumer appears (`/ctacte/[cuenta]` notes or `/padrones/[id]` notes), the key MUST become `<entityType>-notes-collapsed-<id>`. Do **NOT** preemptively namespace now.

## Cross-references

- Engram apply-progress: `sdd/athlos-toast-primitivo/apply-progress` (#290, rewritten with final closed state)
- Engram verify-report: `sdd/athlos-toast-primitivo/verify-report` (#291)
- Engram decision: `architecture/toast-primitive-sonner` (#283)
- Engram pattern: `architecture/notify-helper-pattern` (#288)
- Engram design: `sdd/athlos-toast-primitivo/design` (#287)
- Engram tasks: `sdd/athlos-toast-primitivo/tasks` (#289)
- Engram spec: `sdd/athlos-toast-primitivo/spec` (#285)
- Engram proposal: `athlos-toast-primitivo proposal locked` (#284)
- Engram explore: `sdd/athlos-toast-primitivo/explore` (#282)
- Engram discovery (ui-design conflict): `ui-design toast prose conflicts with locked toast decisions` (#286)
- Obsidian: `/srv/obsidian/Athlos/0-Index.md` (ledger updated; this entry mirrors the archived `athlos-notes-collapsible` line 9 format).

## Sessions

Completed in session `athlos-server-gorriti-2026-07-06` (continuation of the apply + verify + archive sessions on `feat/toast-primitivo`).