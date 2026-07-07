# Tasks: athlos-audit-operator-display (FINALIZED)

**Change**: `athlos-audit-operator-display`
**Phase**: tasks (finalized by sdd-tasks executor)
**Date**: 2026-07-06
**Artifact store**: both (engram + openspec)
**Strict TDD**: YES (vitest, `pnpm --filter @athlos/{api,web} test:run`)
**Review budget**: 400 changed lines per PR

---

## Review Workload Forecast

| Slice | Files | Code LoC | Test LoC | Total | Risk |
|-------|------:|---------:|---------:|------:|------|
| PR A backend | 4 new + 1 modified | ~125 | ~180 | **~360** | LOW (under budget) |
| PR B frontend | 4 new + 4 modified | ~135 | ~285 | **~420** | HIGH (over budget) |

- PR A backend estimated changed lines: ~360
- PR B frontend estimated changed lines: ~420
- 400-line budget risk: HIGH
- Chained PRs recommended: Yes
- Decision needed before apply: Yes
- Chain strategy: pending
- Notes: PR B exceeds the 400-line budget. Two paths to choose:
  - **Option 1 (chained)** — split PR B into PR B1 (`client wrapper` + `OperatorChip` + `AuditTab` wiring ≈ ~250 LoC) and PR B2 (`SocioNotesCard` wiring ≈ ~170 LoC), each well under budget. Stack strategy: `stacked-to-main` (project default). Surface both `stacked-to-main` and `feature-branch-chain` in `next_recommended` so the user picks.
  - **Option 2 (size:exception)** — keep PR B as a single PR. Requires a maintainer-approved `size:exception` label on the PR. Best when reviewer bandwidth is tight and the diff is cohesive (this case: 4 commits in one feature branch touching the same UI surface).

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

---

## PR Plan

- **PR A** (`feature/audit-operator-display-backend`) — route + module + repo + co-located Zod schema + 2 test files + 1-line `server.ts` registration.
- **PR B** (`feature/audit-operator-display-frontend`) — client wrapper, `OperatorChip`, AuditTab + SocioNotesCard wiring, test extensions.
  - **If chained** (preferred): PR B1 = wrapper + chip + AuditTab; PR B2 = SocioNotesCard wiring.
  - Stacking strategy: **stacked-to-main** (project standard). Surface `feature-branch-chain` as the alternative.

PR A unblocks PR B (PR B can ship with a mocked backend, then a final integration smoke once A is merged). Strict-TDD applies to every task; RED commit first, GREEN commit immediately after.

---

## Dependency Graph

```
PR A
  A.1 (lookup.ts skeleton + schema)        [TDD-RED + TDD-GREEN, same commit]
    └─> A.2 (listByIds + private charToRole) [TDD-RED + TDD-GREEN, same commit]
         └─> A.3 (route handler + server.ts registration) [TDD-RED + TDD-GREEN, same commit]

PR B
  B.1 (lib/api/operators.ts wrapper)        [TDD-RED + TDD-GREEN, same commit]
    └─> B.2 (OperatorChip.tsx)              [TDD-RED + TDD-GREEN, same commit]
         └─> B.3 (AuditTab.tsx wiring)      [TDD-RED + TDD-GREEN, same commit]
              └─> B.4 (SocioNotesCard.tsx wiring) [TDD-RED + TDD-GREEN, same commit]
```

`A.1 → A.2 → A.3 → B.1 → B.2 → B.3 → B.4` — strict order. Each commit is the smallest reviewable unit; review reads each commit like a tiny PR.

---

## Work Unit Commits

| Commit | Type | Scope | Files | Approx LoC |
|--------|------|-------|-------|-----------:|
| **A.1** | `feat` | infra + schema scaffolding | `modules/operators/lookup.ts` (schema only, ~25 LoC) + `lookup.test.ts` (~40) | ~65 |
| **A.2** | `feat` | repository `listByIds` | extend `lookup.ts` (+~50 LoC) + extend `lookup.test.ts` (+~50) | ~100 |
| **A.3** | `feat` | route + server registration | `routes/operators.ts` (~70) + `routes/operators.test.ts` (~120) + `server.ts` (+2) | ~190 |
| **B.1** | `feat` | client wrapper | `lib/api/operators.ts` (~40) + `lib/api/operators.test.ts` (~50) | ~90 |
| **B.2** | `feat` | `OperatorChip` component | `components/socios/OperatorChip.tsx` (~50) + `OperatorChip.test.tsx` (~80) | ~130 |
| **B.3** | `feat` | AuditTab wiring + tests | edit `AuditTab.tsx` (+~20) + extend `AuditTab.test.tsx` (+~75) | ~95 |
| **B.4** | `feat` | SocioNotesCard wiring + tests | edit `SocioNotesCard.tsx` (+~20) + extend `SocioNotesCard.test.tsx` (+~80) | ~100 |
| **Total PR A** | | | | **~360** |
| **Total PR B** | | | | **~420** |

---

## Phase A: Backend (`feat(api): operator batch lookup`)

---

### TASK-A.1.1 [TDD-RED] — Zod schema lives in `modules/operators/lookup.ts`

**File**: `apps/api/src/modules/operators/__tests__/lookup.test.ts` (NEW, schema-import-only)
**LoC**: ~40
**Commit**: A.1

**Action**:
1. Create `apps/api/src/modules/operators/lookup.ts` exporting `getOperatorByIdsQuerySchema` (`z.object({ ids: z.array(z.string().uuid()).min(1).max(200) })`). Tests import the schema (RED: file exists but the empty stub fails the shape assertions).
2. Test cases: (a) accepts 1 valid UUID → passes; (b) rejects 201-element array → throws ZodError with `ids` path; (c) rejects empty array → throws ZodError; (d) rejects non-UUID string → throws ZodError.

**Verification**: `pnpm --filter @athlos/api test:run lookup.test.ts` exits non-zero on RED; passes after the GREEN edit in TASK-A.1.2.

**Rollback**: `git checkout apps/api/src/modules/operators/`.

---

### TASK-A.1.2 [TDD-GREEN] — Schema implementation

**File**: `apps/api/src/modules/operators/lookup.ts` (extend with the real Zod schema; ~25 LoC plus types)
**LoC**: ~25
**Commit**: A.1

**Action**:
1. Implement the schema + `OperatorSummary` type + re-export `OperatorRole` from the same module. Type ordering: `types → schema` (per work-unit-commits skill).
2. Run A.1.1's test file — all 4 cases pass.

**Verification**: `pnpm --filter @athlos/api test:run lookup.test.ts` exits 0.

**Rollback**: `git checkout apps/api/src/modules/operators/`.

---

### TASK-A.2.1 [TDD-RED] — `listByIds` projection tests

**File**: `apps/api/src/modules/operators/__tests__/lookup.test.ts` (extend with repo cases)
**LoC**: ~50
**Commit**: A.2

**Action**:
1. Append 3 failing repo cases (use `createStandinDb()` per `apps/api/src/test-standins/db.ts`):
   - `all-present`: 3 known ids → 3 rows returned, each with ONLY `{id, username, role}` (assert keys exact).
   - `partial present`: 3 ids, 2 rows in standin → returns 2 rows + silently omits missing.
   - `single query`: assert standin spy fires `db.select` exactly once for 50 ids (catch per-id roundtrip regression).

**Verification**: `pnpm --filter @athlos/api test:run lookup.test.ts` exits non-zero.

**Rollback**: `git checkout apps/api/src/modules/operators/__tests__/lookup.test.ts`.

---

### TASK-A.2.2 [TDD-GREEN] — Repository implementation

**File**: `apps/api/src/modules/operators/lookup.ts` (extend with `listByIds(db, ids)` + private `charToRole`; ~50 LoC)
**LoC**: ~50
**Commit**: A.2

**Action**:
1. `listByIds(db, ids)` runs `db.select({id, username, role}).from(operators).where(inArray(operators.id, ids))` and maps via `charToRole()` (mirroring `apps/api/src/services/auth.ts:238–251`).
2. Re-run A.2.1 tests — all 3 pass.

**Verification**: `pnpm --filter @athlos/api test:run lookup.test.ts` exits 0.

**Rollback**: `git checkout apps/api/src/modules/operators/lookup.ts`.

---

### TASK-A.3.1 [TDD-RED] — Route tests

**File**: `apps/api/src/routes/__tests__/operators.test.ts` (NEW)
**LoC**: ~60
**Commit**: A.3

**Action**:
1. Cases (skeleton RED): `GET /api/v1/operators?ids=a,b,c` with no JWT → 401; with valid JWT and 3 valid UUIDs → 200 happy; with empty ids → 400 VALIDATION_ERROR; with non-UUID → 400; with 201 ids → 400; `missing` IDs → 200 with `operators: [<a>, <b>]` and `missing` silently omitted.
2. Use `fastify.inject()` with `Authorization: Bearer <fake.jwt>` per `apps/api/src/routes/audit.test.ts` pattern.

**Verification**: `pnpm --filter @athlos/api test:run operators.test.ts` exits non-zero.

**Rollback**: `git checkout apps/api/src/routes/__tests__/operators.test.ts`.

---

### TASK-A.3.2 [TDD-GREEN] — Route implementation + server registration

**Files**: `apps/api/src/routes/operators.ts` (NEW, ~70 LoC) + `apps/api/src/server.ts` (+2 LoC)
**LoC**: ~72
**Commit**: A.3

**Action**:
1. `routes/operators.ts` exports `operatorsRoutes` plugin registering `GET /` with `preHandler: requireAuth()`, `throwIfInvalid(getOperatorByIdsQuerySchema, request.query, 'query')`, calls `listByIds(container.db, q.ids)`, returns `{ operators: rows }`.
2. Add `await app.register(operatorsRoutes)` in `apps/api/src/server.ts` after `sociosRoutes` (D9, line ~198). Import line above.
3. Re-run route tests — all pass.

**Verification**: `pnpm --filter @athlos/api test:run operators.test.ts` exits 0; `pnpm --filter @athlos/api typecheck` passes.

**Rollback**: `git checkout apps/api/src/routes/operators.ts apps/api/src/server.ts`.

---

### TASK-A.wrap — Backend PR wrap

**Verification** (run after A.3 lands, before pushing):
- `pnpm typecheck`
- `pnpm --filter @athlos/api lint`
- `pnpm --filter @athlos/api test:run` (single file at a time per the RAM note in handover #255; full suite last)
- `git log --oneline -3` review; only intended files changed
- `git checkout -- apps/web/next-env.d.ts` if dirty (project noise from Next auto-regen)
- Branch: `feature/audit-operator-display-backend`. Push + open PR.

---

## Phase B: Frontend (`feat(web): operator display in audit + notes`)

---

### TASK-B.1.1 [TDD-RED] — `getOperatorNames` client wrapper tests

**File**: `apps/web/src/lib/api/__tests__/operators.test.ts` (NEW)
**LoC**: ~50
**Commit**: B.1

**Action**:
1. Mock `apiFetch` (pattern from `apps/web/src/lib/api/__tests__/socios.test.ts`). Cases:
   - Calls `apiFetch('/api/v1/operators?ids=a,b,c')` and returns `{ operators }` shape.
   - Trims + sorts input ids via `?ids=` param ordering (asserts URL ordering).
   - Throws when the mock returns 400.

**Verification**: `pnpm --filter @athlos/web test:run operators.test.ts` exits non-zero.

**Rollback**: `git checkout apps/web/src/lib/api/__tests__/operators.test.ts`.

---

### TASK-B.1.2 [TDD-GREEN] — Client wrapper implementation

**File**: `apps/web/src/lib/api/operators.ts` (NEW, ~40 LoC)
**LoC**: ~40
**Commit**: B.1

**Action**:
1. Export `OperatorSummary` type mirroring backend DTO + `OPERATORS_QUERY_KEY` constant (D8: `['operators', sortedIds.join(',')]`).
2. Export `getOperatorNames(ids: string[])` that calls `apiFetch('/api/v1/operators?ids=' + ids.join(','))` and unwraps to `OperatorSummary[]`.
3. Re-run B.1.1 tests — all pass.

**Verification**: `pnpm --filter @athlos/web test:run operators.test.ts` exits 0.

**Rollback**: `git checkout apps/web/src/lib/api/operators.ts`.

---

### TASK-B.2.1 [TDD-RED] — `OperatorChip` render tests

**File**: `apps/web/src/components/socios/__tests__/OperatorChip.test.tsx` (NEW)
**LoC**: ~80
**Commit**: B.2

**Action**:
1. Cases (4 conceptual → 3 runtime branches per D7):
   - `operatorId === null` → renders `Operador desconocido`.
   - id missing from `operators` Map → renders `Operador desconocido`.
   - id found → renders `username · ROLE` (e.g. `vlongo · ADMIN`).
   - **Casing pin**: username `UsEr` → renders `UsEr · ADMIN` (verbatim, no `toTitleCase`).
   - **Loading** (`useQuery` pending + `operatorId !== null`) → renders `-`; loading + `operatorId === null` → still `Operador desconocido` (D10 asymmetry).

**Verification**: `pnpm --filter @athlos/web test:run OperatorChip.test.tsx` exits non-zero.

**Rollback**: `git checkout apps/web/src/components/socios/__tests__/OperatorChip.test.tsx`.

---

### TASK-B.2.2 [TDD-GREEN] — `OperatorChip` component

**File**: `apps/web/src/components/socios/OperatorChip.tsx` (NEW, ~50 LoC)
**LoC**: ~50
**Commit**: B.2

**Action**:
1. Stateless pure component. Props: `{ operatorId: string | null; operators: Map<string, OperatorSummary> }`. 3 runtime branches (cases 1, 2, "in map"). ROLE label comes from a private one-to-one map constant (no translation).
2. Re-run B.2.1 tests — all 4 cases pass.

**Verification**: `pnpm --filter @athlos/web test:run OperatorChip.test.tsx` exits 0.

**Rollback**: `git checkout apps/web/src/components/socios/OperatorChip.tsx`.

---

### TASK-B.3.1 [TDD-RED] — AuditTab wiring tests

**File**: `apps/web/src/components/socios/__tests__/AuditTab.test.tsx` (extend existing file, line ~15–28 mock factory)
**LoC**: ~75
**Commit**: B.3

**Action**:
1. Extend the `vi.mock('@/lib/api/socios', () => ({ … }))` factory to include `getOperatorNames: vi.fn()`.
2. Add 2 new scenarios:
   - "when `getOperatorNames` returns `{id: OPERATOR_ID, username, role}`, the actor pill renders `username · ROLE`."
   - "when `getOperatorNames` returns `[]`, every actor pill renders `Operador desconocido`."
3. `vi.mock` factory MUST stay synchronous (design R4 — `AuditTab.test.tsx:15–28` synchronous pattern; the `async importOriginal` variant from handover #253 is NOT used in this codebase).

**Verification**: `pnpm --filter @athlos/web test:run AuditTab.test.tsx` exits non-zero on the new 2 (RED); passes after B.3.2.

**Rollback**: `git checkout apps/web/src/components/socios/__tests__/AuditTab.test.tsx`.

---

### TASK-B.3.2 [TDD-GREEN] — AuditTab wiring

**File**: `apps/web/src/components/socios/AuditTab.tsx` (edit at the actor span, ~+20 LoC)
**LoC**: ~20
**Commit**: B.3

**Action**:
1. After the existing `SOCIO_AUDIT_QUERY_KEY` useQuery, add a second `useQuery(['operators', sortedIds.join(',')], () => getOperatorNames(sortedIds), { enabled: ids.length > 0 })`.
2. Replace `por operador {shortOperatorId(event.operator_id)}` with `<OperatorChip operatorId={event.operator_id} operators={map} />`.
3. Drop `shortOperatorId` if no longer referenced (keep if reused elsewhere — verify with grep).
4. Re-run AuditTab tests — all pass.

**Verification**: `pnpm --filter @athlos/web test:run AuditTab.test.tsx` exits 0.

**Rollback**: `git checkout apps/web/src/components/socios/AuditTab.tsx`.

---

### TASK-B.4.1 [TDD-RED] — SocioNotesCard wiring tests

**File**: `apps/web/src/components/socios/__tests__/SocioNotesCard.test.tsx` (extend existing mock factory, ~+80 LoC)
**LoC**: ~80
**Commit**: B.4

**Action**:
1. Extend the `vi.mock('@/lib/api/socios', () => ({ … }))` factory synchronously to include `getOperatorNames: vi.fn()`.
2. Add 2 new scenarios around `note.operator_id`:
   - "when the lookup has the id, the note author renders `username · ROLE`."
   - "when the lookup omits the id, the note author renders `Operador desconocido`."

**Verification**: `pnpm --filter @athlos/web test:run SocioNotesCard.test.tsx` exits non-zero on the 2 new; passes after B.4.2.

**Rollback**: `git checkout apps/web/src/components/socios/__tests__/SocioNotesCard.test.tsx`.

---

### TASK-B.4.2 [TDD-GREEN] — SocioNotesCard wiring

**File**: `apps/web/src/components/socios/SocioNotesCard.tsx` (edit the author `<div>`, ~+20 LoC)
**LoC**: ~20
**Commit**: B.4

**Action**:
1. Add a second `useQuery(['operators', sortedNoteOperatorIds.join(',')], () => getOperatorNames(sortedNoteOperatorIds), { enabled: ids.length > 0 })`.
2. Replace `Operador {shortOperatorId(note.operator_id)}` with `<OperatorChip operatorId={note.operator_id} operators={map} />`.
3. Drop `shortOperatorId` if unused.
4. Re-run SocioNotesCard tests — all pass.

**Verification**: `pnpm --filter @athlos/web test:run SocioNotesCard.test.tsx` exits 0.

**Rollback**: `git checkout apps/web/src/components/socios/SocioNotesCard.tsx`.

---

### TASK-B.wrap — Frontend PR wrap

**Verification** (run after each commit, mandatory once before push):
- `pnpm typecheck`
- `pnpm --filter @athlos/web lint`
- `pnpm --filter @athlos/web test:run -- <single-file>` per touched file (RAM-safe per handover #255) — only run the full suite at the end.
- `git checkout -- apps/web/next-env.d.ts` if dirty (auto-regen noise from Next).
- Branch: `feature/audit-operator-display-frontend` (or `feature/audit-operator-display-frontend-b1` + `-b2` if chained). Push + open PR.

**If forecast HIGH and user picks the chained split**:
- Branch 1 base = `main`, contains B.1 + B.2 + B.3 — named `feature/audit-operator-display-frontend-b1`.
- Branch 2 base = `feature/audit-operator-display-frontend-b1` (stacked-to-main), contains B.4 — named `feature/audit-operator-display-frontend-b2`.
- Both PRs stay under 400 LoC.

---

## Apply handoff

The apply agent MUST follow strict-TDD for every NEW source file:

1. **RED** — write the test file with failing assertions (one commit).
2. **GREEN** — implement the smallest change that turns the test green (the next commit, paired with RED).
3. **REFACTOR** — only when needed; never split refactoring into its own task.

**Test runner commands** (per file to avoid RAM saturation — handover #253 / #255):
- Backend: `pnpm --filter @athlos/api test:run -- <relative-path>` (e.g. `lookup.test.ts`, `operators.test.ts`). Full suite only at the end.
- Frontend: `pnpm --filter @athlos/web test:run -- <relative-path>` (e.g. `OperatorChip.test.tsx`, `AuditTab.test.tsx`). Full suite only at the end.

**Mock pattern reminder (design R4)**:
- This codebase uses the **synchronous** `vi.mock('@/lib/api/socios', () => ({ … }))` factory form (see `AuditTab.test.tsx:15–28` and `SocioNotesCard.test.tsx:21–34`).
- Do NOT use `async (importOriginal) => …` unless additional exports beyond `getOperatorNames` are added to `@/lib/api/operators` later.
- For the new `OperatorChip` and `lib/api/operators` tests, the synchronous factory is sufficient and is the project default.

**Pre-existing dirty file** (handover #255 / #253):
- `apps/web/next-env.d.ts` regenerates on Next build. Before any `git pull` after frontend commits, run `git checkout -- apps/web/next-env.d.ts` so it does not get staged.

**Files NOT to touch** (per design "NOT changed" + locked decisions):
- `packages/db/src/schema/operators.ts` (no migration).
- `packages/errors`, `packages/auth`, `packages/validation` (use public exports only).
- `apps/api/src/services/operators.ts` (`charToRole` stays private; replicated inline into `lookup.ts`).
- `apps/api/src/routes/admin/operators.ts` (admin surface untouched).

**No migration, no Drizzle call, no schema change.**

---

## Critical tasks (highest risk)

- **A.2** — `listByIds` projection: the spec is strict that ONLY `{id, username, role}` reaches the wire. PII columns (`password_hash`, `failed_login_attempts`, etc.) MUST stay off the SELECT. Standin test asserts the exact set of keys.
- **B.2** — `OperatorChip` casing pin: `UsEr` must render as `UsEr` (not `User`). Future contributors may add `toTitleCase`; the test pins the verbatim behaviour.
- **B.3 / B.4** — `vi.mock` factory extension: forgetting to add `getOperatorNames: vi.fn()` to the existing sync factory yields a TypeError at runtime. Each wiring commit MUST re-read the test file top and pin the factory shape.

---

## Out-of-Scope (deferred per locked decisions)

- Schema changes / migrations.
- `display_name` column (kept `username` to avoid the broken drizzle migration pipeline).
- Global `['operators']` cache (rejected on privacy widening).
- Per-row lazy loading.
- Operator CRUD.
- Other audit surfaces (`ctacte`, `padrones`).
- `audit_events.operator_id` semantics or audit emission pipeline.
- Invalidation on operator rename (acceptable trade-off; chip is a "snapshot of who they were").

---

## Risks (inherited from design)

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Privacy widening (any operator learns any operator's `username + role`) | D5 SQL projection keeps `password_hash`, `failed_login_attempts` off the wire; same trust level as the existing audit row. |
| R2 | Cache-invalidation gap on rename / role change | TanStack Query refetches on mount + focus; out-of-scope per locked decisions. |
| R3 | 4-case render matrix vs 3-branch impl (D7 / §8 note) | §8 pins the impl collapses cases 3+4; spec forbids widening DTO without an explicit PR. |
| R4 | `vi.mock` sync vs async (handover note vs actual code) | Synchronous factory form is the project default; only escalate to `importOriginal` if additional unstated exports land in `@/lib/api/operators`. |
| R5 | Schema co-location drift (D3) | `lookup.ts` holds the Zod schema; split into `schema.ts` if a second operator module consumer appears. |
| R6 | Endpoint registration site (D9) | One-line `app.register(operatorsRoutes)` next to `sociosRoutes` in `server.ts`; if a routes barrel appears later, retarget there. |
| R7 | PR B exceeds 400-line review budget | See forecast; choose chained (B1/B2) or `size:exception`. |
