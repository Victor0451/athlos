## feat(web): operator display in audit tab (PR 8b.5 PR B1)

### What

Implements the **frontend partial** of the `athlos-audit-operator-display` change. PR A (backend, PR #13) is already merged. This PR wires the frontend to read operator names through the new `GET /api/v1/operators?ids=…` endpoint and renders `username · ROLE` chips instead of the legacy `Operador 8-char-uuid` form in the audit timeline.

Three work-unit commits, each independent and reviewable:

| #   | Commit    | Subject                                                         |  LoC |
| --- | --------- | --------------------------------------------------------------- | ---: |
| B.1 | `afb1d30` | `feat(web): add operator names client wrapper`                  | +143 |
| B.2 | `e3ccf08` | `feat(web): add OperatorChip component for audit actor display` | +138 |
| B.3 | `b80f2c9` | `feat(web): wire AuditTab to operator batch lookup`             | +109 |

Total: 6 files changed, 390 insertions(+), 7 deletions(-) against `origin/main`. **Under the 400-line review budget.**

### Linked

- Proposal: `openspec/changes/athlos-audit-operator-display/proposal.md`
- Spec: `openspec/changes/athlos-audit-operator-display/specs/operator-lookup/spec.md`
- Design: `openspec/changes/athlos-audit-operator-display/design.md` (decisions D1–D10)
- Tasks: `openspec/changes/athlos-audit-operator-display/tasks.md` (B.1, B.2, B.3)
- PR A (backend, merged): #13

### Chain Context

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Chain         | `athlos-audit-operator-display` (stacked-to-main)                              |
| Tracker PR    | Not needed (stacked-to-main)                                                   |
| Position      | 2 of 3                                                                         |
| Base          | `main`                                                                         |
| Depends on    | PR #13 (backend, merged)                                                       |
| Follow-up     | PR B2 (`SocioNotesCard` wiring, branch `feat/audit-operator-batch-lookup-b2`)  |
| Review budget | 390 / 400                                                                      |
| Starts at     | `origin/main` @ `935c04d`                                                      |
| Ends with     | `<OperatorChip>` rendered for every actor in `AuditTab`; PR B2 scope untouched |

```
main
 └── #13 PR A (backend, MERGED)
       └── 📍 This PR (B.1, B.2, B.3)
            └── PR B2 (SocioNotesCard wiring)
```

### Files

| File                                                   | Change                                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/api/operators.ts`                    | NEW — `OperatorSummary` type + `OPERATORS_QUERY_KEY` + `getOperatorNames(ids)` (empty input short-circuit, 200-id cap enforced by backend)                     |
| `apps/web/src/lib/api/operators.test.ts`               | NEW — 4 cases (URL shape, response unwrap, empty short-circuit, error propagation)                                                                             |
| `apps/web/src/components/socios/OperatorChip.tsx`      | NEW — stateless helper, 3 runtime branches per design D7                                                                                                       |
| `apps/web/src/components/socios/OperatorChip.test.tsx` | NEW — 6 cases (null, missing, loading/empty map, known, **casing pin** "UsEr" stays "UsEr", role-label matrix)                                                 |
| `apps/web/src/components/socios/AuditTab.tsx`          | EDIT — adds `useQuery(OPERATORS_QUERY_KEY, …)` per mount + builds `Map<string, OperatorSummary>` + swaps `por operador {shortOperatorId}` for `<OperatorChip>` |
| `apps/web/src/components/socios/AuditTab.test.tsx`     | EXTEND — 2 new scenarios + 1 updated assertion (system event now renders "Operador desconocido") + sync mock factory for `@/lib/api/operators`                 |

### Test Plan

- [x] `pnpm --filter @athlos/web test:run -- src/lib/api/operators.test.ts` — 4/4 pass
- [x] `pnpm --filter @athlos/web test:run -- src/components/socios/OperatorChip.test.tsx` — 6/6 pass
- [x] `pnpm --filter @athlos/web test:run -- src/components/socios/AuditTab.test.tsx` — 7/7 pass (5 existing + 2 new)
- [x] `pnpm --filter @athlos/web test:run` — **501/501 pass**, no regressions
- [x] `pnpm --filter @athlos/web typecheck` — clean
- [x] `pnpm --filter @athlos/web lint` — clean
- [x] Husky pre-commit (eslint --fix + prettier --write) ran on every commit

### Review summary (inline — `review-readability` + `review-reliability` lenses)

Both lenses were executed inline (the `~/.config/opencode/skills/review-*` skills are not installed in this environment). Findings:

**review-readability**: PASS

- Naming clear (`getOperatorNames`, `OperatorChip`, `operatorMap`, `sortedOperatorIds`).
- Complexity low: chip is 3 branches; wrapper is one function; AuditTab wiring adds ~30 LoC.
- Intention expressed via design-decision comments (D7, D8, casing pin).
- Initial review found a dead `shortOperatorId` function in `AuditTab.tsx` (kept with `void` to bypass lint). **Fixed before push**: removed with a comment pointing future contributors to the rationale.

**review-reliability**: PASS

- Test coverage is meaningful — wrapper covers URL shape, response unwrap, empty short-circuit, error propagation; chip covers all 3 runtime branches + casing pin + role-label matrix; AuditTab covers the new `username · ROLE` rendering and the `Operador desconocido` fallback.
- Edge cases pinned: empty ids short-circuit, missing id fallback, null id fallback, casing pin (`UsEr` stays `UsEr · ADMIN`, would break if a future contributor added `toTitleCase`), role-label verbatim mapping.
- Determinism — `mockReset` in `beforeEach`; no leaked mock state.
- Mock factory stays synchronous per design R4; the duplicated `OPERATORS_QUERY_KEY` stub is annotated with a comment warning about drift risk if the production signature changes.
- Regression risk low — `AuditTab.tsx` behavior change is observable in 3 test cases (2 new + 1 updated). No changes to `SocioNotesCard.tsx`.

### Out of scope (deferred to PR B2)

- `SocioNotesCard.tsx` wiring — **deliberately untouched** in this PR. The same `<OperatorChip>` + `OPERATORS_QUERY_KEY` pattern applies; PR B2 will land it on a follow-up branch (`feat/audit-operator-batch-lookup-b2`) stacked-to-main.
- No migration, no Drizzle call, no schema change (per locked proposal).
- No deploy step — PR B1 is additive code only; rebuild + PM2 restart happen post-merge.

### Pre-existing CI failures (NOT from this PR)

Per handover note, three pre-existing CI failures on `main` will fail again on this PR:

1. **`test` job** — pre-existing `React-not-defined` in `admin/gastos/[id]/page.test.tsx` (not in PR B1's diff).
2. **`labeler` job** — pre-existing config drift.
3. **`Docker build smoke` job** — pre-existing entrypoint bug in `apps/api/Dockerfile`.

None of these are introduced by PR B1. **Recommend merging with `gh pr merge --merge --admin`** (same workaround used for PR A #13). A separate chore PR to fix these is on the backlog.

### Risks

- **R1 (inherited from design)** — privacy widening: any operator can read `username + role` for any other operator. Mitigation: SQL projection keeps `password_hash` / `failed_login_attempts` off the wire; same trust level as the existing audit row.
- **R2 (inherited from design)** — no cache invalidation on operator rename. TanStack Query refetches on mount + focus; out-of-scope per locked decisions.
- **R3 (inherited from design)** — 4-case render matrix collapses to 3 branches in impl (the wire DTO has no `is_active`). Documented in `OperatorChip.tsx` and pinned by tests.
- **No new risks** introduced by PR B1 beyond the backend risks inherited from PR A.

### Contributor Checklist

- [x] No `Co-Authored-By` trailers
- [x] Conventional commit messages
- [x] Husky pre-commit ran (eslint --fix + prettier --write)
- [x] No `--no-verify`
- [x] No amend after push
- [x] No deploy / restart
- [x] `next-env.d.ts` is not dirty
- [x] OpenSpec change artifacts (`openspec/changes/...`) are working copies; will be archived via `sdd-archive` after PR B2 lands
