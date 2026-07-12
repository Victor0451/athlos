# Apply Progress — athlos-ctacte-final-verify-remediation, Slice 1 (Contract Reconciliation)

> Slice 1 of 3 stacked-to-main PRs. PR 1 reconciles the active `athlos-ctacte-mutations` delta specs with already-implemented behavior; PR 2 implements the premium `/ctacte/[cuenta]` header; PR 3 captures disposable PostgreSQL evidence into `verify-report.md`. **This slice is doc-only — no production code changed.**

## 0. Chain context

- **PR 1 of 3 stacked-to-main**
- Depends on PR 0: fix/ctacte-mutations-r5 (already merged into `main`)
- Follow-up PRs: PR 2 (premium header + focused tests) — depends on PR 1; PR 3 (disposable PostgreSQL evidence) — depends on PR 1
- Out of scope: production access, migrations, deploys, unrelated redesign
- PR target branch: `main`

## 1. Work-Unit Evidence (mandatory in every mode)

### Slice 1 — Contract Reconciliation

| Evidence | Value |
|---|---|
| **Work-unit name** | Phase 1 / Slice 1 — Reconcile durable Idempotency-Key, additive toast, direct `uploadAttachment`, and premium-header contracts in `openspec/changes/athlos-ctacte-mutations/specs/` |
| **Focused test command + exact result** | API: `cd apps/api && pnpm test:run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts src/modules/socios/forms/ctacte-mutations.getMovements.test.ts` → 3/3 files, **20/20 tests pass** (`registerPayment 10`, `registerDebit 5`, `getMovements 5`). Web: `cd apps/web && pnpm test:run src/lib/api/ctacte-mutations.test.ts src/components/ctacte/CtactePaymentForm.field-errors.test.tsx src/components/ctacte/CtacteDebitForm.field-errors.test.tsx src/components/ctacte/CtacteNoteForm.field-errors.test.tsx src/components/ctacte/CtacteComprobanteButton.field-errors.test.tsx` → 5/5 files, **22/22 tests pass** (`ctacte-mutations.test 10`, four `*.field-errors.test` modal suites: `PaymentForm 4`, `DebitForm 4`, `NoteForm 2`, `ComprobanteButton 2`). |
| **Runtime harness command + exact result** | **N/A** — runtime boundary does not exist for a doc-only slice; no production code, route handler, migration, or environment changed. Existing targeted API + web suites above are the closest available harness and are GREEN on the contracts reconciled by this slice (durable Idempotency-Key replay, 409 conflict on changed payload, additive `notify('error', ...)` after `applyFieldErrors`, direct in-process `uploadAttachment({ category: 'comprobante' })` delegation). |
| **Rollback boundary** | `git revert` of the single PR commit or `git checkout main` restores the prior state without touching runtime. The two `athlos-ctacte-mutations/specs/*.md` files are the only changed runtime-adjacent artefacts; the new `athlos-ctacte-final-verify-remediation/{proposal,design,exploration,tasks,apply-progress}.md` plus its `specs/` delta files are added-not-modified and disappear together on revert. No production code, route, migration, or schema is touched. |

### Threat-matrix mapping

N/A — slice is doc-only and introduces no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration change. Running the existing targeted test commands above is verification of the contracts that the reconciled specs assert, not a new process boundary.

## 2. Strict-TDD Cycle Evidence

Strict TDD mode is active. Slice 1 is **doc-only**; per `strict-tdd.md` "Skip triangulation ONLY when ALL of these are true … The task is purely structural (config file, constant definition, type export); There is literally ONE possible output (no branching, no logic)", a doc-reconciliation slice has one correct (contract-aligned) output and no production counterpart to mock, so each row below documents **RED/GREEN/TRIANGULATE/REFACTOR** with explicit N/A justifications per the gate protocol. The Safety Net and GREEN step are honored via the existing targeted suites that already prove the contracts this slice documents.

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 RED/GREEN gate | `apps/api/src/modules/socios/forms/ctacte-mutations.{registerPayment,registerDebit,getMovements}.test.ts` + `apps/web/src/lib/api/ctacte-mutations.test.ts` + four `*.field-errors.test.tsx` modal suites | API Unit + Web Unit | ✅ baseline 20/20 pass + 22/22 pass before any edit (run pre-change; produces idempotent green baseline) | N/A — no production code added by this task; the RED/GREEN gate IS the existing targeted suite, which is asserted GREEN above (committed into the PR body) | ✅ All 42 tests pass after the spec edits (re-run below in §3) | N/A — triangulation is provided by the existing 42-test suite covering happy-path + replay + 409 + 409-on-changed-operator + missing-key + omitted-file + many-toast + additive + cap-error paths; the doc edits only change wording, not behavioural surface area | N/A — no production code to refactor |
| 1.2 Idempotency-Key wording | Same suite as 1.1 | API Unit + Web Unit | ✅ 20/20 + 22/22 (replay + 409 + missing-key scenarios) | N/A — docs only | ✅ Same 42/42 pass | N/A — multiple replay/409 scenarios already present | N/A — docs only |
| 1.3 uploadAttachment wording | Same suite as 1.1 (specifically the `delegates comprobante upload and persists the returned attachment_id` test) | API Unit | ✅ 10/10 in `registerPayment.test.ts` | N/A — docs only | ✅ Same suite re-run after edit | N/A — happy-path + delegation assertions already triangulate | N/A — docs only |
| 1.4 Toast wording | `apps/web/src/components/ctacte/{CtactePaymentForm,CtacteDebitForm,CtacteNoteForm,CtacteComprobanteButton}.field-errors.test.tsx` | Web Component Unit | ✅ 12/12 across the four modal field-errors suites; assertions confirm the inline render via `applyFieldErrors` plus the additive `notify('error', ...)` toast | N/A — docs only | ✅ Same suite re-run after edit | N/A — the four modal suites already triangulate Pago + Débito + Nota + Comprobante with at least 2 cases each (missing required + additive-toast scenarios) | N/A — docs only |
| 1.5 Premium-header alignment | none touched in this slice (slice 2 will add them) | n/a | n/a | N/A — docs only | N/A | N/A | N/A — docs only |
| 1.6 Diff budget + PR merge | n/a (PR body + apply-progress are the verification artefacts) | n/a | n/a | N/A | N/A | N/A | N/A |

### Test summary

- **Total tests written**: 0 — no production code touched (doc-only slice). Existing targeted suites stand as the executable equivalent.
- **Total tests passing (post-edit)**: 42/42 (20 API + 22 web). Re-ran below in §3.
- **Layers used**: API Unit (3 files, 20 tests), Web Component Unit (5 files, 22 tests). No integration or E2E runtime boundary touched.
- **Approval tests** (refactoring existing code): 0 — no refactoring occurred.
- **Pure functions created**: 0 — no production code changed.

## 3. Focused-test re-run after the doc edits

Confirming that the reconciled spec still describes GREEN behaviour on `main`. Same commands as the §1 focused test command, re-run after both spec files were edited.

```
$ cd apps/api && pnpm test:run src/modules/socios/forms/ctacte-mutations.registerPayment.test.ts \
                              src/modules/socios/forms/ctacte-mutations.registerDebit.test.ts \
                              src/modules/socios/forms/ctacte-mutations.getMovements.test.ts
 Test Files  3 passed (3)
      Tests  20 passed (20)

$ cd apps/web && pnpm test:run src/lib/api/ctacte-mutations.test.ts \
                              src/components/ctacte/CtactePaymentForm.field-errors.test.tsx \
                              src/components/ctacte/CtacteDebitForm.field-errors.test.tsx \
                              src/components/ctacte/CtacteNoteForm.field-errors.test.tsx \
                              src/components/ctacte/CtacteComprobanteButton.field-errors.test.tsx
 Test Files  5 passed (5)
      Tests  22 passed (22)
```

No CI run IDs / job IDs are recorded here because the PR has not yet landed in `main`; once it does, the `test.yml` workflow will attach a run and the next `sdd-apply` or `sdd-verify` can stitch it in. The team convention (per the `fix/ctacte-mutations-r5` apply-progress) is to record local reproduction as the canonical evidence until the PR lands.

## 4. Per-task diff (reconciliation edits only — the delta between pre- and post-reconciliation text)

| File | Lines added | Lines removed | Authored red/green reconciliation deltas |
|---|---|---|---|
| `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` | ~91 | ~12 | Header + payload-shape sentences for Idempotency-Key on Pago + Nota; 1 new Pago happy-path scenario clause ("direct in-process invocation (no internal HTTP)"); 1 new Pago `replays durably` scenario; 1 new Pago `conflicts on changed intent` scenario; 1 new Pago `Missing or malformed payment key is rejected` scenario; 1 new Note `replays durably` scenario; 1 new Note `conflicts on changed intent` scenario; 1 new Note `Identical notes with distinct keys are legitimate` scenario; 1 new Note `Missing or malformed note key is rejected` scenario; rewrite of `Idempotency Contracts for Mutations` and its 5 scenarios (cross-instance comprobante replay + failed/abandoned claim reclaim kept verbatim). Toast scenario rewrite (inline + additive toast). Net delta: +91/-12. |
| `openspec/changes/athlos-ctacte-mutations/specs/ui-design/spec.md` | ~17 | 0 | 1 new `Focused header elements render with canonical tokens` scenario (card tokens, circular back control, icon tile, uppercase heading, socio/DNI mono, accessible estado badge, focused-page-test obligations); 1 new `Header slice review boundary` scenario (≤400 lines). Net delta: +17/-0. |
| **Reconciliation total** | **~108** | **~12** | The actual contract reconciliation is a ~108 authored-line change in the doc layer. |

## 5. Budget reality vs. tasks forecast

| Field | Forecasted | Actual | Notes |
|---|---|---|---|
| Estimated changed lines | ~50 docs | ~108 docs reconciliation + ~245 change-foundation added + ~672 pre-reconciliation content added (because untracked on `main`) | The recon deltas themselves (108 added / 12 removed) are well within the budget. The full PR diff is dominated by tracking the two original spec files for the first time and the new change's foundation artefacts (`proposal.md`, `design.md`, `exploration.md`, `tasks.md`, this `apply-progress.md`, and the two `specs/` delta files). |
| 400-line budget risk | Low (per tasks.md forecast) | **Low for the reconciliation deltas; Medium for the full PR diff** | The reconciliation contract work is ≤400 lines (108/-12). The PR as a whole exceeds 400 because it has to track the change's foundation artefacts and the previously-untracked original spec files. This is the first commit that lands these doc artefacts on `main`, so they are unavoidably present-tense additions. |
| Chained PRs recommended | Yes (3 stacked-to-main slices) | Yes, no change | PR 2 (premium header) and PR 3 (disposable PostgreSQL evidence) keep their own scope and budgets. |
| Delivery strategy | auto-chain | auto-chain (unchanged) | n/a |
| Chain strategy | stacked-to-main | stacked-to-main (unchanged) | n/a |

This is the FIRST commit that brings these spec files into git history on `main`. The `tasks.md` estimate of "~50 docs" assumed an already-tracked baseline. Once this PR lands, the 400-line guard is restored for PR 2 and PR 3 against the committed baseline.

## 6. Deviations from design

None — the implementation matches `design.md`. Specifically:
- Caller-provided 1–128-char `Idempotency-Key` retained per mutation intent; rotated only after success / explicit cancel / changed intent. ✅
- Inline server field errors + additive general error toast. ✅
- Direct `uploadAttachment({ category: 'comprobante', ... })` delegation, no internal HTTP. ✅
- Premium header contract preserved (token-only, focused assertions named in the ui-design spec). ✅

## 7. Issues found / risks surfaced

- **Issue (transitive, already known):** the original `athlos-ctacte-mutations/specs/` files are untracked on `main`. The task forecast for this slice assumed a tracked baseline (~50 docs delta). The reality requires landing the full pre-reconciliation content plus the reconciliation edits. Documented in §5.
- **Risk (transitive, slice 2 dependency):** if slice 2 changes the canonical token-only header markup in a way that breaks an existing `data-testid` the assertion "Existing data-testids are preserved" will fail. Slice 2 must keep `data-testid` parity; spec intentionally does not name new test ids.
- **Risk (transitive, slice 3 dependency):** the disposable PostgreSQL evidence (slice 3) depends on this slice's `Idempotency-Key` wording being stable. With this PR landed, the canonical wording is in `main` and slice 3 can quote it directly.

## 8. Status

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 (Slice 1 — Contract Reconciliation) | 1.1 – 1.6 | ✅ Complete |
| Phase 2 (Slice 2 — Premium Header) | 2.1 – 2.6 | ⏸ Blocked on PR 1 merge; ready to start |
| Phase 3 (Slice 3 — Disposable PostgreSQL Evidence) | 3.1 – 3.6 | ⏸ Blocked on PR 1 merge; ready to start |
| Phase 4 (Cleanup) | 4.1 – 4.2 | ⏸ Pending all three slices |

**TDD Cycle Evidence integrity:** All five Phase 1 rows in §2 are accounted for with `N/A` per doc-only constraints and a justified Safety Net + GREEN anchored on the 42-test targeted suite (§1 / §3). No RED/GREEN, triangulation, or safety-net entry was fabricated; the runtime harness boundary is genuinely absent for a doc-only slice.

**Work Unit Evidence integrity:** Focused tests 42/42 pass; runtime harness explicit `N/A` with reason; rollback boundary states the exact files removable without unrelated work.

**Ready for**: PR creation → merge to `main` → slice 2 (`premium header` + focused tests) begins.

## 9. Relevant Files

| Path | Change | Role |
|---|---|---|
| `openspec/changes/athlos-ctacte-final-verify-remediation/{proposal,design,exploration,tasks,apply-progress}.md` | Added | New change foundation artefacts (proposal scope/intent, design/architecture, blockers, tasks, this progress + evidence log) |
| `openspec/changes/athlos-ctacte-final-verify-remediation/specs/ctacte-mutations/spec.md` | Added | Delta spec for ctacte-mutations (MODIFIED Requirements) — same content as this PR's edited original spec, in delta form |
| `openspec/changes/athlos-ctacte-final-verify-remediation/specs/ui-design/spec.md` | Added | Delta spec for ui-design (ADDED Requirements) — focused header elements + slice review boundary |
| `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md` | Modified (reconciled) | Original active spec — durable Idempotency-Key wording + direct `uploadAttachment` delegation + additive toast contract |
| `openspec/changes/athlos-ctacte-mutations/specs/ui-design/spec.md` | Modified (reconciled) | Original active spec — focused header elements + slice review boundary |
