## PR B2 — SocioNotesCard wiring (PR 8b.5 B.4)

**Slice B of the `athlos-audit-operator-display` change — FINAL PR.**

PR A (backend batch endpoint) is **merged** at `935c04d` and PR B1 (frontend wrapper + OperatorChip + AuditTab wiring) is **merged** at `9571ed3`. This PR B2 wires `SocioNotesCard` to the same operator batch lookup so the note author renders as `username · ROLE` instead of `Operador {8-char-uuid}`.

### Context

- Proposal: [`openspec/changes/athlos-audit-operator-display/proposal.md`](https://github.com/Victor0451/athlos/blob/main/openspec/changes/athlos-audit-operator-display/proposal.md)
- Design: [`openspec/changes/athlos-audit-operator-display/design.md`](https://github.com/Victor0451/athlos/blob/main/openspec/changes/athlos-audit-operator-display/design.md)
- Spec: [`openspec/changes/athlos-audit-operator-display/specs/operator-lookup/spec.md`](https://github.com/Victor0451/athlos/blob/main/openspec/changes/athlos-audit-operator-display/specs/operator-lookup/spec.md)
- Tasks: [`openspec/changes/athlos-audit-operator-display/tasks.md`](https://github.com/Victor0451/athlos/blob/main/openspec/changes/athlos-audit-operator-display/tasks.md)

### Work-unit commit

| Commit    | Subject                                                 |
| --------- | ------------------------------------------------------- |
| `a9b88c7` | feat(web): wire SocioNotesCard to operator batch lookup |

### Changes

| File                                                     | Change                                                                                                                                                                                                                                                                                                                                                                |       LoC |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| `apps/web/src/components/socios/SocioNotesCard.tsx`      | EDIT — added sorted-ids `useQuery` + `operatorMap`; replaced `Operador {shortOperatorId(...)}` with `<OperatorChip>`; dropped the now-unused `shortOperatorId` helper (left a comment pointing to the rationale).                                                                                                                                                     | +57 / -13 |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx` | EXTEND — added the `@/lib/api/operators` mock factory (synchronous, design R4); added 2 new scenarios ("renders `username · ROLE` when author id is in the lookup" + "renders `Operador desconocido` when missing"); updated one assertion in the existing "existing notes" test (the legacy `/operador 00000000/i` form is gone, replaced by the new chip fallback). |  +44 / -1 |

**Total: 2 files changed, ~101 insertions(+), 13 deletions(-).** Within the ~170 LoC budget.

### Shared cache key (spec "Shared TanStack Query cache")

The new `useQuery` uses the same deterministic key as `AuditTab`:

```ts
useQuery({
  queryKey: OPERATORS_QUERY_KEY(sortedOperatorIds), // ['operators', sortedIds.join(',')]
  queryFn: () => getOperatorNames(sortedOperatorIds),
  enabled: sortedOperatorIds.length > 0,
  staleTime: 30_000,
})
```

`SocioNotesCard` and `AuditTab` collect distinct non-null id lists from their respective feeds (`note.operator_id` vs `event.operator_id`), sort them lexicographically, and use the same key. When both components are mounted on `/socios/[id]` with overlapping id sets, the second mount **reuses the first fetch** — no duplicate network request. This is pinned by the spec scenario "Second mount reuses first fetch".

### Strict TDD cycle evidence

| Phase            | File                                 | Result                                                     |
| ---------------- | ------------------------------------ | ---------------------------------------------------------- |
| Safety net       | `SocioNotesCard.test.tsx`            | 8/8 pass on unmodified file                                |
| RED (new tests)  | `SocioNotesCard.test.tsx`            | 2/10 fail (the new scenarios against the legacy rendering) |
| GREEN (impl)     | `SocioNotesCard.tsx` + test update   | 10/10 pass                                                 |
| Final full suite | `pnpm --filter @athlos/web test:run` | 503/503 pass (was 501 — +2 new)                            |

Test counts: 10 in `SocioNotesCard.test.tsx` (8 existing + 2 new). Typecheck clean. Lint clean. Husky pre-commit (lint-staged) ran eslint + prettier without errors.

### Inline review summary

- **`review-readability` (inline; skill not installed):** PASS. The wiring mirrors `AuditTab` exactly — `sortedOperatorIds` useMemo, `operatorsQuery` with `enabled` guard, `operatorMap` useMemo. The stale JSDoc comment that referenced "operator name resolution is a future slice" was updated to reflect that PR 8b.5 B.4 resolves it. The `shortOperatorId` helper was dropped and replaced with a comment block pointing to the rationale (same pattern PR B.3 used in `AuditTab.tsx`).
- **`review-reliability` (inline; skill not installed):** PASS. Two new scenarios cover the spec-mandated cases: known operator → `username · ROLE`, missing id → `Operador desconocido`. Both tests assert via `data-testid` (`socio-note-author-${id}` + `operator-chip-known|unknown`) so they're robust to future className refactors. The shared cache key is pinned verbatim in both mock factories and production code — drift would surface in `AuditTab.test.tsx` and `SocioNotesCard.test.tsx` simultaneously.

### Pre-existing CI failures (will repeat)

These were documented in PR A and PR B1 — they reappear on this PR and the orchestrator will handle the merge via `gh pr merge --merge --admin`:

- `test` workflow: pre-existing breakage unrelated to this PR.
- `labeler` workflow: missing `type:*` label assignment.
- `Docker build smoke`: the Dockerfile workflow points to a path that doesn't exist in CI.

A separate chore PR should address these; out of scope here.

### This is the FINAL PR of the change

After this PR merges:

1. Run `sdd-verify` against `openspec/changes/athlos-audit-operator-display/` to prove implementation matches specs/design/tasks.
2. Run `sdd-archive` to sync the delta specs into the archive.

No deploy happens in this PR — web rebuild / PM2 restart / migrations are explicit next-session steps per the orchestrator.
