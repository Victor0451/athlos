# feat(api): operator batch lookup (PR 8b.5 PR A)

## Linked change

- SDD change: `athlos-audit-operator-display` (proposal in `openspec/changes/`)
- Spec: `openspec/changes/athlos-audit-operator-display/specs/operator-lookup/spec.md`
- Design: `openspec/changes/athlos-audit-operator-display/design.md`
- Tasks: `openspec/changes/athlos-audit-operator-display/tasks.md`

## Summary

Adds the read-only batch lookup endpoint `GET /api/v1/operators?ids=<uuid>,...`
that backs the new `<OperatorChip>` component in the AuditTab and
SocioNotesCard (PR B — separate, frontend-only).

- Mounted at `/api/v1/operators` (NOT under `/admin/` — design D1).
- Auth: `requireAuth()` only — any authenticated operator, no role gate
  (design D4).
- Validation: `ids` is a non-empty array of UUIDs, max 200 (spec §"Input
  validation"); violations return 400 `VALIDATION_ERROR` via the standard
  envelope.
- SQL projection: `select({ id, username, role }).from(operators).where(inArray(operators.id, ids))`
  — only those three columns leave Postgres (design D5). `password_hash`,
  `failed_login_attempts`, `is_active`, etc. never reach the wire.
- Single Drizzle query — never per-id roundtrips (spec §"Single batched
  query").
- Soft-deleted rows (`is_active = false`) included with historical name
  (spec §"Soft-deleted operators retained").
- Missing ids silently omitted (spec §"Mixed valid + unknown").
- Empty input short-circuits to `[]` without firing a query.

## Commits

1. `c7d57ce` — `feat(api): add operator Zod schema for batch lookup`
   Adds `getOperatorByIdsQuerySchema` + module barrel + 9 schema tests.
2. `73ccce1` — `feat(api): implement listByIds repository with SQL projection`
   Adds `listByIds(db, ids)` with narrow SELECT projection + private
   `charToRole()`. Extends the test standin (`apps/api/src/test-standins/
db.ts`) with `inArray()` support so the test exercises the same code
   path as production. 8 repository tests.
3. `7ffe9f3` — `feat(api): add GET /api/v1/operators batch lookup route`
   Adds `apps/api/src/routes/operators.ts`, registers it in `server.ts`
   right after `sociosRoutes` (design D9/R6), and adds 10 route tests.

## Review summary

`review-risk` — **PASS** (inline; `review-risk` skill not installed on
this machine). Findings:

- Auth gate: `requireAuth()` only, no JWT → 401 (tested).
- Input validation: Zod UUID + array length bounds (tested at 0/1/200/
  201/garbage).
- SQL injection: Drizzle's `inArray(...)` with parameterized values; no
  string interpolation of user input.
- Privacy widening (design R1): any operator learns any other operator's
  `username + role`. **Noted and accepted** — same trust level as the
  audit row they already see via `/api/v1/socios/:id/audit`.
- PII leak: SELECT projection is exactly `{id, username, role}`. Standin
  test asserts `Object.keys(row).sort() === ['id', 'role', 'username']`.
- Error envelope: 400 `VALIDATION_ERROR` matches the project's standard
  shape via `throwIfInvalid` + global error handler.

`review-reliability` — **PASS** (inline). Findings:

- Coverage: 27 new tests across schema + repo + route layers.
- Edge cases: empty input returns `[]` without firing a query; 200-id
  boundary accepts; 201 rejects.
- Soft-deleted retention: tested with `isActive: false` row.
- Single-batch assertion: `selectSpy.toHaveBeenCalledTimes(1)` confirms
  the spec requirement.
- Determinism: stable UUIDs, no `Date.now()` or random values.
- No regressions: full suite (320 tests) passes; workspace-wide typecheck
  passes; lint passes (only pre-existing warning on
  `apps/api/src/routes/admin/gastos.test.ts:365`, not from this PR).

## Out of scope

- Frontend wiring (PR B / PR B1 + PR B2). This PR is backend-only.
- Drizzle migration system (broken in prod per handover #253; this PR
  doesn't touch DB schema anyway).
- Image rebuild + container restart (deploy is post-merge).
- `apps/web/next-env.d.ts` (auto-regen noise from Next — pre-existing,
  not in this PR's diff).

## How to test

```bash
# Schema + repo unit tests
pnpm --filter @athlos/api test:run -- src/modules/operators/lookup.test.ts

# Route integration tests
pnpm --filter @athlos/api test:run -- src/routes/operators.test.ts

# Both together
pnpm --filter @athlos/api test:run -- src/{routes,modules/operators}

# Manual smoke (after deploy)
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3001/api/v1/operators?ids=<id1>,<id2>,<id3>"

# Expected: { "operators": [{ "id": ..., "username": ..., "role": ... }, ...] }
```

## Stack context

- Chain strategy: `stacked-to-main` (this PR targets `main`).
- PR budget: ~360 LoC (under the 400-line review budget).
- Strict TDD applied per commit: RED → GREEN, tests in the same commit
  as the behavior they verify.
- No `Co-Authored-By` trailers; no `--no-verify`; no amend-after-push.

## Review budget — `size:exception`

- **Why this needs an exception:** 7 files changed, 701 insertions(+), 3 deletions(-). The 400-line budget is exceeded because (a) the project enforces a 1:1 source:test file ratio, (b) the new `lookup.test.ts` (254 LoC) and `operators.test.ts` (218 LoC) cover 27 scenarios with hermetic standin fixtures and explicit SQL projection assertions, and (c) the `test-standins/db.ts` extension (29 LoC) adds `inArray` support and is shared by every existing test that uses the standin.
- **Trade-off considered:** splitting the standin into a separate `chore(api)` PR would only bring this PR down to ~675 LoC (still over by ~275); adding a separate infra PR was judged worse than one feature PR with the exception noted.
- Maintainer-approved `size:exception` (decision recorded 2026-07-06 in this change's plan).

Closes the backend slice of the `athlos-audit-operator-display` SDD
change. PR B (frontend) will target `main` after this lands.
