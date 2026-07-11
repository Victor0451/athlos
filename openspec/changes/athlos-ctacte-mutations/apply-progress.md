# Apply Progress — athlos-ctacte-mutations R3 (canonical evidence)

## 1. Cited GitHub CI run/job IDs, commit SHA, conclusion

| Commit | Run ID | Test job ID | Conclusion |
|---|---|---|---|
| `b6e4c48` | 29124944790 | 86468369748 | success |
| `197f052` | 29126449069 | 86472962739 | success |
| `989aff5` | 29128096424 | 86477863625 | success |
| `8f10270` | 29130326003 | 86484303316 | failure |
| `04eda01` | 29130348331 | 86484371404 | failure |
| `61a810c` | — | — | MISSING |
| `01864fa` | 29132238452 | 86489623768 | success |
| `fce97d2` | 29132917216 | 86491643393 | success |
| `d0937ff` | 29133082673 | 86492127664 | success |

## 2. Immutable commit IDs and git diff file/stat scope

| Commit | Files | + | − |
|---|---|---|---|
| `eccdbd0` | 5 | 337 | 3 |
| `76297bd` | 4 | 296 | 15 |
| `6f3b7ad` | 3 | 91 | 56 |
| `287b993` | 5 | 611 | 43 |
| `e689684` | 8 | 272 | 16 |
| `198e5d8` | 3 | 105 | 7 |
| `2d43a24` | 5 | 592 | 159 |
| `ca24e9c` | 2 | 300 | 25 |
| `8f10270` | 1 | 554 | 0 |
| `61a810c` | 1 | 540 | 226 |
| `b6e4c48` | 2 | 124 | 66 |
| `197f052` | 1 | 215 | 1 |
| `989aff5` | 3 | 166 | 7 |
| `04eda01` | 1 | 57 | 0 |
| `01864fa` | 1 | 191 | 1 |
| `fce97d2` | 1 | 77 | 38 |
| `d0937ff` | 1 | 22 | 13 |
| `d675e79` | 1 | 98 | 796 |

## 3. Per-commit strict-TDD evidence

| Commit | RED | GREEN |
|---|---|---|
| `eccdbd0` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `76297bd` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `6f3b7ad` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `287b993` | MISSING | GREEN at `197f052` (run 29126449069, job 86472962739) |
| `e689684` | MISSING | GREEN at `197f052` (run 29126449069, job 86472962739) |
| `198e5d8` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `2d43a24` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `ca24e9c` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `8f10270` | failure at `8f10270` (run 29130326003, job 86484303316) | MISSING |
| `61a810c` | MISSING | GREEN at `01864fa` (run 29132238452, job 86489623768), GREEN at `d0937ff` (run 29133082673, job 86492127664) |

## 4. R5 status

R5: pending unverified

---

# Apply Progress — athlos-ctacte-mutations R4 (canonical evidence)

Branch: `fix/ctacte-mutations-r4` (6 commits on top of `origin/main` at `e935b5b`).
The PR has not yet been pushed and a GitHub workflow run does not
exist for the R4 branch yet, so no CI run IDs / job IDs are recorded
here. All evidence below is local-reproduction per the team's
per-file Vitest mandate (handover #253 RAM constraint) plus the
cross-package typecheck / lint commands. The team convention is to
record local reproduction as the only canonical evidence until the
PR lands in `main` and starts producing workflow runs.

## R4.1 — Commit-by-commit strict-TDD evidence (RED then GREEN same commit)

| Commit | File(s) | RED command + result | GREEN command + result |
|---|---|---|---|
| `849c593` | `api.ts` + `applyFieldErrors.ts` (foundation) | n/a — foundation commit has no own RED; the 9 component RED tests all reference the new helper. Verified GREEN on every subsequent component commit. | `pnpm --filter @athlos/web typecheck` exit 0 |
| `8055be8` | `CtactePaymentForm.tsx` + `CtactePaymentForm.field-errors.test.tsx` | `pnpm --filter @athlos/web test:run -- src/components/ctacte/CtactePaymentForm.field-errors.test.tsx` → 3/4 fail with `Unable to find role="alert"` | same command + `CtactePaymentForm.test.tsx` → 4/4 + 8/8 pass; `pnpm --filter @athlos/web typecheck` exit 0; `pnpm --filter @athlos/web lint` exit 0 |
| `a279e9d` | `CtacteDebitForm.tsx` + `CtacteDebitForm.field-errors.test.tsx` | same per-file Vitest pattern → 3/4 fail with `Unable to find role="alert"` | same command, 4/4 pass; `CtacteDebitForm.test.tsx` 7/7 still pass; typecheck exit 0 |
| `f121400` | `CtacteNoteForm.tsx` + `CtacteNoteForm.field-errors.test.tsx` | same per-file Vitest pattern → 1/2 fail with `Unable to find role="alert"` | same command, 2/2 pass; `CtacteNoteForm.test.tsx` 11/11 still pass; typecheck exit 0 |
| `5ab3ec2` | `CtacteComprobanteButton.tsx` + `CtacteComprobanteButton.field-errors.test.tsx` | same per-file Vitest pattern → 2/3 fail (cap-range + from-field) | after discarding contradictory `from > to` case, 2/2 pass; `CtacteComprobanteButton.test.tsx` 7/7 still pass; typecheck exit 0; lint exit 0 |

## R4.2 — Targeted sequential sweep across `src/components/ctacte/`

Command (post-commit, after the 5 implementation commits):

```
pnpm --filter @athlos/web test:run -- src/components/ctacte/
```

Result: `Test Files  75 passed (75)` | `Tests  690 passed (690)`. No
regression introduced by the R4 wiring; sibling component suites and
unrelated pages all stay GREEN.

## R4.3 — Cross-package typecheck after the R4 commits

```
pnpm --filter @athlos/web typecheck   → exit 0
pnpm --filter @athlos/api typecheck   → exit 0
pnpm --filter @athlos/db  typecheck   → exit 0
pnpm --filter @athlos/audit typecheck → exit 0
pnpm --filter @athlos/web lint        → exit 0
```

## R4.4 — Discarded partial test case

The previous-session draft included a `from > to` server-field test
case in `CtacteComprobanteButton.field-errors.test.tsx`. It was
unreachable because the form's pre-existing client-side validator
(`if (from && to && from > to) newErrors.to = …; return;`) blocks
the request before `apiFetchBlob` runs. The form's pre-existing test
suite (`CtacteComprobanteButton.test.tsx > shows inline error when
from > to`) asserts this behaviour and PASSES throughout the R4
wiring. The discarded case was replaced with a comment that
explains why Pago / Débito / Nota sibling tests cover the array-shape
react-hook-form path end-to-end, and the remaining two comprobante
cases here cover the cap-range object shape + no-field fallback.

## R4.5 — Out-of-scope confirmation

- No `R5` work (evidence reconciliation): explicitly deferred to a future PR.
- No deploy / no production container touch.
- No migration apply.
- No new branches created; no merges performed.
- `CtacteTab.tsx` (sibling inside `/socios/[id]`) left untouched.
- `openspec/changes/athlos-ctacte-canonical-pattern/exploration.md` (a stale scratch artefact from a sibling change) is left untouched — it is not part of the R4 diff or branch.

## R4.6 — PR boundary

- Mode: single PR (`fix/ctacte-mutations-r4` → `main`)
- Diff vs `origin/main`: 8 files, +327 / -7
- Budget risk: Low (well under the 400-line guard)
- Work-unit commits: 6 commits, 5 for implementation (foundation + 4 components), 1 for SDD evidence. Each implementation commit is one behavior per the `work-unit-commits` skill and bundles RED + GREEN per the team's strict-TDD convention.

## R4.7 — Net green counts after R4 wiring

| Suite | Tests | Status |
|---|---:|---|
| `CtactePaymentForm.test.tsx` | 8 | pass |
| `CtactePaymentForm.field-errors.test.tsx` | 4 | pass (3 RED before, 4 GREEN after) |
| `CtacteDebitForm.test.tsx` | 7 | pass |
| `CtacteDebitForm.field-errors.test.tsx` | 4 | pass (3 RED before, 4 GREEN after) |
| `CtacteNoteForm.test.tsx` | 11 | pass |
| `CtacteNoteForm.field-errors.test.tsx` | 2 | pass (1 RED before, 2 GREEN after) |
| `CtacteComprobanteButton.test.tsx` | 7 | pass |
| `CtacteComprobanteButton.field-errors.test.tsx` | 2 | pass (2 RED before, 2 GREEN after + 1 contradictory case discarded) |
| Full `src/components/ctacte/` folder | 690 | pass (no regressions across the 75 test files in the folder) |
