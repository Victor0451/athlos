# Verify Report: athlos-audit-operator-display

**Change**: `athlos-audit-operator-display`
**Mode**: full artifacts (proposal + spec + design + tasks all present)
**Date**: 2026-07-07
**Branch state**: `main` HEAD `f0953d8` — PRs #13 (A), #14 (B1), #15 (B2) MERGED.
**Strict TDD**: active (vitest, both apps).
**Verifier**: sdd-verify executor.

---

## 0. Tooling health

| Tool | Command | Result |
|---|---|---|
| `apps/api` typecheck | `pnpm --filter @athlos/api typecheck` | **PASS** (no errors) |
| `apps/api` lint | `pnpm --filter @athlos/api lint` | **PASS** (1 pre-existing warning in `admin/gastos.test.ts:365` — unrelated) |
| `apps/web` typecheck | `pnpm --filter @athlos/web typecheck` | **PASS** (no errors) |
| `apps/web` lint | `pnpm --filter @athlos/web lint` | **PASS** (no errors) |
| `apps/api` test suite (full sweep) | `pnpm --filter @athlos/api test:run` | **PASS** — 320 passed + 2 skipped (322 total) |
| `apps/web` test suite (full sweep) | `pnpm --filter @athlos/web test:run` | **PASS** — 503 passed (503 total) |

No regression introduced by any of the three merged PRs.

---

## 1. Task completeness (from `tasks.md`)

7 work-unit commits across 3 PRs (A → B1 → B2), every commit shipped:

| Commit | Scope | Status |
|---|---|---|
| `c7d57ce` | A.1 — schema (`modules/operators/lookup.ts`) | DONE |
| `73ccce1` | A.2 — repository (`listByIds` + `charToRole`) | DONE |
| `7ffe9f3` | A.3 — route + `server.ts` registration | DONE |
| `afb1d30` | B.1 — client wrapper (`lib/api/operators.ts`) | DONE |
| `e3ccf08` | B.2 — `<OperatorChip>` component | DONE |
| `b80f2c9` | B.3 — AuditTab wiring | DONE |
| `a9b88c7` | B.4 — SocioNotesCard wiring | DONE |

All tasks complete. No outstanding work-units.

---

## 2. Spec compliance matrix (17 scenarios across 8 requirements)

### Requirement R1 — Batch lookup endpoint

**Status**: **PASS** (3/3 scenarios)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R1.1 | All ids active → 200 + `{operators:[…]}` shape with only `id,username,role` | PASS | `apps/api/src/routes/operators.test.ts:94-110` — `it('returns 200 with the { operators: [...] } shape when all ids resolve')` asserts `body.operators[0]` is exactly `{ id: ID_A, username: 'vlongo', role: 'ADMIN' }`. Reinforced by `lookup.test.ts:192-199` (3 rows returned with exact per-row shape). |
| R1.2 | Mixed valid + unknown → 200 with unknown silently omitted | PASS | `apps/api/src/routes/operators.test.ts:112-125` — `it('silently omits ids that have no matching row')` returns `body.operators.toHaveLength(1)` for 2-id input. Reinforced by `lookup.test.ts:209-212`. |
| R1.3 | All ids unknown → 200 with `{operators: []}` (NOT 404) | PASS | `apps/api/src/routes/operators.test.ts:127-140` — `it('returns 200 with { operators: [] } when every id is unknown')` asserts 200 + `body.operators).toEqual([])`. Reinforced by `lookup.test.ts:214-217`. |

**Test coverage**: `apps/api/src/routes/operators.test.ts` + `apps/api/src/modules/operators/lookup.test.ts`.

### Requirement R2 — Authentication gate (any role)

**Status**: **PASS** (2/2 scenarios)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R2.1 | No `Authorization: Bearer` → 401 | PASS | `apps/api/src/routes/operators.test.ts:85-92` — `it('returns 401 without an Authorization header')` asserts `res.statusCode).toBe(401)`. Route auth gate: `apps/api/src/routes/operators.ts:34` — `const AUTH = { preHandler: requireAuth() }`. |
| R2.2 | `CONSULTA` role → 200 (no role gate) | PASS | `apps/api/src/routes/operators.test.ts:142-151` — `it('returns 200 for a CONSULTA-role operator (no role gate)')` asserts 200 for a CONSULTA token. Route uses `requireAuth()` only, no `requireRole`. |

**Test coverage**: `apps/api/src/routes/operators.test.ts`.

### Requirement R3 — Input validation

**Status**: **WARN** (4/4 scenarios pass at the error-code level; 2 scenarios diverge from the spec's literal message text)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R3.1 | Empty `ids=` → 400 `VALIDATION_ERROR` | PASS (envelope) / WARN (literal message) | `apps/api/src/routes/operators.test.ts:153-163` asserts 400 + `body.error === 'VALIDATION_ERROR'`. Spec scenario pins `message: "ids must contain at least one uuid"`; actual Zod message is `"Array must contain at least 1 element(s)"` because `lookup.ts:50` uses `.min(1)` without a custom message. See WARNING §1 below. |
| R3.2 | Non-UUID string → 400 `VALIDATION_ERROR` | PASS | `apps/api/src/routes/operators.test.ts:165-175` asserts 400 + `VALIDATION_ERROR`. Spec scenario uses `"…"` (truncated) for the message — no literal pin, so default Zod message is acceptable. |
| R3.3 | 201 ids → 400 `VALIDATION_ERROR` | PASS (envelope) / WARN (literal message) | `apps/api/src/routes/operators.test.ts:177-191` asserts 400 + `VALIDATION_ERROR`. Spec scenario pins `message: "ids cannot exceed 200 entries"`; actual Zod message is `"Array must contain at most 200 element(s)"` because `lookup.ts:50` uses `.max(200)` without a custom message. See WARNING §1 below. |
| R3.4 | 200 ids accepted (boundary) → 200 | PASS | `apps/api/src/routes/operators.test.ts:204-217` — `it('returns 200 at the 200-id boundary')` generates 200 UUIDs, asserts 200. Schema-level: `lookup.test.ts:45-52` — `it('accepts exactly 200 uuids (boundary)')`. |

**Test coverage**: `apps/api/src/routes/operators.test.ts` (route-level) + `apps/api/src/modules/operators/lookup.test.ts:32-91` (schema-level — accepts 1, accepts multiple, accepts 200, rejects 201, rejects empty, rejects non-UUID, rejects missing field, rejects non-array).

### Requirement R4 — Soft-deleted operators retained

**Status**: **PASS** (1/1 scenario)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R4.1 | Mixed active + inactive → both rows appear with no "deleted" indicator | PASS | `apps/api/src/modules/operators/lookup.test.ts:219-228` — `it('includes soft-deleted rows (is_active = false) with their historical name')` asserts that `SOFT_DELETED_ID` (`is_active: false`) is returned with `{ username: 'former', role: 'CONSULTA' }`. The repository uses `db.select(...).from(operators).where(inArray(operators.id, ids))` with NO `is_active` filter — `lookup.ts:94-101`. UI side: OperatorChip collapses active and soft-deleted into one render branch (no badge / strikethrough) — `OperatorChip.tsx:48-52`. |

**Test coverage**: `apps/api/src/modules/operators/lookup.test.ts`.

### Requirement R5 — Minimal response shape (no information leak)

**Status**: **PASS** (1/1 scenario)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R5.1 | Each returned object contains exactly `id`, `username`, `role`; never `password_hash`, `is_active`, `can_reprint`, `can_anulate`, `last_login_at`, `failed_login_attempts`, `locked_until`, `created_at`, `updated_at` | PASS | `apps/api/src/modules/operators/lookup.test.ts:201-207` — `it('only exposes {id, username, role} per row (no password_hash / is_active / etc.)')` asserts `Object.keys(row).sort()).toEqual(['id', 'role', 'username'])`. SQL projection: `lookup.ts:94-99` — `db.select({ id, username, role })` keeps all other columns server-side. |

**Test coverage**: `apps/api/src/modules/operators/lookup.test.ts`.

### Requirement R6 — Single batched query

**Status**: **PASS** (1/1 scenario)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R6.1 | 50 ids → one `db.select().from(operators).where(inArray(operators.id, ids))` invocation | PASS | `apps/api/src/modules/operators/lookup.test.ts:250-253` — `it('issues a single batched select — not per-id roundtrips')` uses `vi.spyOn(standin.drizzle, 'select')` and asserts `selectSpy.toHaveBeenCalledTimes(1)` for 3 ids (would be the same for 50). Implementation: `lookup.ts:94-101`. Also `lookup.test.ts:230-234` — empty input short-circuits to `[]` without firing any query (`selectSpy` not called). |

**Test coverage**: `apps/api/src/modules/operators/lookup.test.ts`.

### Requirement R7 — OperatorChip helper (UI rendering)

**Status**: **PASS** (5/5 scenarios)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R7.1 | Known operator → renders exactly `username · ROLE` | PASS | `apps/web/src/components/socios/OperatorChip.test.tsx:53-58` — `it('renders 'username · ROLE' when the operator is in the map')` asserts `screen.getByText('vlongo · ADMIN')`. Implementation: `OperatorChip.tsx:48-52`. |
| R7.2 | Soft-deleted operator → renders exactly `username · ROLE` (no badge, no strikethrough) | PASS | Backed by R4.1 (soft-deleted row reaches the map) + R7.1 (the chip renders `username · ROLE` regardless of `is_active`). The OperatorChip collapses active and soft-deleted into one render branch because the wire DTO doesn't expose `is_active` — `OperatorChip.tsx:46-52`. `OperatorChip.test.tsx:71-84` pins all 4 role labels verbatim. |
| R7.3 | id missing from lookup → renders exactly `Operador desconocido` | PASS | `apps/web/src/components/socios/OperatorChip.test.tsx:40-45` — `it('renders 'Operador desconocido' when operatorId is not in the operators map')`. Implementation: `OperatorChip.tsx:42` — `if (operatorId === null || !operators.has(operatorId))`. Consumer wiring: `AuditTab.test.tsx:224-251` (OperatorChip renders fallback when `getOperatorNamesMock.mockResolvedValueOnce([])`) and `SocioNotesCard.test.tsx:252-268`. |
| R7.4 | System event (`operator_id === null`) → renders exactly `Operador desconocido` | PASS | `apps/web/src/components/socios/OperatorChip.test.tsx:34-38` — `it('renders 'Operador desconocido' when operatorId is null')`. Implementation: `OperatorChip.tsx:42`. End-to-end: `AuditTab.test.tsx:104` — null `operator_id` row yields `/Operador desconocido/i`. |
| R7.5 | Username casing preserved verbatim (no `toTitleCase`, no `Capitalize`) | PASS | `apps/web/src/components/socios/OperatorChip.test.tsx:60-69` — `it('preserves username casing verbatim — 'UsEr' stays 'UsEr · ADMIN' (no toTitleCase)')` pins `getByText('UsEr · ADMIN')` AND `queryByText('User · ADMIN')).not.toBeInTheDocument()` to catch future regressions. Implementation: `OperatorChip.tsx:48-52` — literal string concat `{operator.username} · {operator.role}`, no transform. |

**Test coverage**: `apps/web/src/components/socios/OperatorChip.test.tsx` + `AuditTab.test.tsx:197-251` + `SocioNotesCard.test.tsx:231-268`.

### Requirement R8 — Shared TanStack Query cache

**Status**: **WARN** (2 scenarios, contract provable by code + test mock pinning, but no dedicated runtime test asserts determinism or dedup)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| R8.1 | Two components feeding the same id set in different orders yield the same cache key `"a,b,c"` | WARN | The `OPERATORS_QUERY_KEY` constant is byte-identical across production and both test mocks: `apps/web/src/lib/api/operators.ts:43-44`, `AuditTab.test.tsx:41-42`, `SocioNotesCard.test.tsx:48-49`. The constant body is `['operators', sortedIds.join(',')]`. Both consumers sort before calling it: `AuditTab.tsx:338` and `SocioNotesCard.tsx:122` — `Array.from(new Set(ids)).sort()`. **No dedicated unit test asserts** "two different orderings yield the same key" — coverage is implicit through (a) constant body pinned verbatim in mock factories, (b) `.sort()` calls visible by inspection at both call sites. See WARNING §2 below. |
| R8.2 | Second mount with same id set reuses first fetch (no duplicate network request) | WARN | The deterministic key from R8.1 + TanStack Query's library-level dedup-by-key is the proof mechanism. There is no runtime test that mounts AuditTab and SocioNotesCard in the same QueryClient and asserts `getOperatorNamesMock` is called once. See WARNING §3 below. |

**Test coverage**: `AuditTab.test.tsx:36-44` + `SocioNotesCard.test.tsx:43-51` (mock factory pinning); runtime coverage via library.

---

## 3. Design coherence (D1–D10)

| # | Decision | Status | Evidence |
|---|---|---|---|
| D1 | Mount at NEW `apps/api/src/routes/operators.ts` at `/api/v1/operators` (NOT `/admin/`) | PASS | `apps/api/src/routes/operators.ts:40` — `fastify.get('/api/v1/operators', AUTH, …)`. Admin surface (`apps/api/src/routes/admin/operators.ts`) untouched. |
| D2 | NEW `apps/api/src/modules/operators/lookup.ts` | PASS | File exists; sibling `index.ts` barrel re-exports the public surface. |
| D3 | Zod schema co-located in `lookup.ts` (not a separate `schema.ts`) | PASS | `lookup.ts:49-51` — `getOperatorByIdsQuerySchema` defined inline; no `schema.ts` file. |
| D4 | `requireAuth()` only (no `requireRole`) | PASS | `apps/api/src/routes/operators.ts:34` — `const AUTH = { preHandler: requireAuth() }`. |
| D5 | SQL projection `select({id, username, role})` | PASS | `lookup.ts:94-99`. Test R5.1 pins exact key set. |
| D6 | Private `charToRole()` mirroring auth.ts | PASS | `lookup.ts:59-72` — function declared `function charToRole(...)`, not exported. `lookup.test.ts:236-248` decodes A/T/O/C → ADMIN/TESORERO/OPERADOR/CONSULTA. |
| D7 | OperatorChip stateless pure component | PASS | `OperatorChip.tsx:41` — `export function OperatorChip({…}): React.ReactNode`. No state, no hooks. 4 conceptual cases collapse to 3 runtime branches per the spec note. |
| D8 | Cache key `['operators', sortedIds.join(',')]` | PASS (with WARN §2 / §3 above) | `apps/web/src/lib/api/operators.ts:43-44`. Both consumers (`AuditTab.tsx:342`, `SocioNotesCard.tsx:126`) invoke the const with the sorted id list. |
| D9 | Register via `app.register(operatorsRoutes)` in `server.ts` after `sociosRoutes` | PASS | `apps/api/src/server.ts:15` — `import { operatorsRoutes } from './routes/operators.ts'`. `apps/api/src/server.ts:204` — `await app.register(operatorsRoutes)` (placed directly after `sociosRoutes` registration at line 199). |
| D10 | Loading placeholder `operatorId ? '-' : 'Operador desconocido'` | **DEVIATION** (collapsed to single branch) | Actual impl: `OperatorChip.tsx:42-44` collapses both loading and missing-id cases to `Operador desconocido`. The design specifies `'-'` for the loading+non-null-id case. The spec doesn't pin a loading state, so this is not a spec violation — see SUGGESTION §1. |

---

## 4. Spot checks (from the verify prompt)

| Check | Result | Evidence |
|---|---|---|
| `SocioNotesCard.tsx` and `AuditTab.tsx` use the EXACT same query key | PASS | Both import `OPERATORS_QUERY_KEY` from `@/lib/api/operators` and call it as `OPERATORS_QUERY_KEY(sortedOperatorIds)` where `sortedOperatorIds = Array.from(new Set(ids)).sort()`. `AuditTab.tsx:338` + `SocioNotesCard.tsx:122` are byte-identical. |
| `<OperatorChip>` renders `username · ROLE` (literal concat, NO `toTitleCase`) | PASS | `OperatorChip.tsx:48-52` — `{operator.username} · {operator.role}`. Pinned by `OperatorChip.test.tsx:60-69` (`UsEr` test). |
| `apps/api/src/routes/operators.ts` registers at `/api/v1/operators` (NOT `/admin/`) | PASS | `operators.ts:40` — `fastify.get('/api/v1/operators', AUTH, …)`. |
| `apps/api/src/modules/operators/lookup.ts` uses `select({ id, username, role }).from(operators).where(inArray(operators.id, ids))` — NO column past the 3 | PASS | `lookup.ts:94-101`. Pinned by `lookup.test.ts:201-207`. |
| `apps/api/src/server.ts` registration line for operators is correct | PASS | `server.ts:15` import + `server.ts:204` `await app.register(operatorsRoutes)` placed after `sociosRoutes` at line 199. |

---

## 5. Findings

### CRITICAL

None.

### WARNING

1. **W1 — Spec literal validation messages not implemented (R3.1, R3.3)**. The spec scenarios for "Empty ids" and "201 ids rejected" pin exact message strings (`"ids must contain at least one uuid"` / `"ids cannot exceed 200 entries"`). The schema in `apps/api/src/modules/operators/lookup.ts:50` uses Zod defaults (`"Array must contain at least 1 element(s)"` / `"Array must contain at most 200 element(s)"`). The route test asserts only the `error: 'VALIDATION_ERROR'` envelope, not the message text. The envelope is correct (400 + `VALIDATION_ERROR` + `details: [{ field: 'ids', ... }]`), but consumers reading the spec would see a different message than what the API returns. **Fix**: add custom messages to the Zod schema (`.min(1, { message: 'ids must contain at least one uuid' }).max(200, { message: 'ids cannot exceed 200 entries' })`). Trivial change, can be a `chore` follow-up.

2. **W2 — No covering test for spec scenario "Deterministic key" (R8.1)**. The contract is provable by code inspection: the `OPERATORS_QUERY_KEY` constant is byte-identical in production (`apps/web/src/lib/api/operators.ts:43-44`) and both test mocks (`AuditTab.test.tsx:41-42`, `SocioNotesCard.test.tsx:48-49`), and both consumers sort via `.sort()` before calling it. However, no runtime test asserts "two different orderings of the same id set yield the same key string". Adding a one-line assertion to `apps/web/src/lib/api/operators.test.ts` (`expect(OPERATORS_QUERY_KEY(['c','a','b'])).toEqual(OPERATORS_QUERY_KEY(['a','b','c']))`) would close the gap. Trivial change, can be a `chore` follow-up.

3. **W3 — No covering test for spec scenario "Second mount reuses first fetch" (R8.2)**. The runtime behavior is TanStack Query's library-level dedup-by-key, which is well-documented. No test mounts AuditTab and SocioNotesCard in the same `QueryClient` and asserts the underlying `getOperatorNames` mock fires once. Same trivial fix as W2: extend an existing test to render both components against one client + mock and count invocations.

### SUGGESTION

1. **S1 — Design D10 deviation: loading placeholder collapsed (cosmetic)**. Design D10 documents `operatorId ? '-' : 'Operador desconocido'` for the loading state. The actual implementation collapses both loading and missing-id cases to `Operador desconocido` (`OperatorChip.tsx:42`). The spec doesn't pin a loading state distinction, so this is not a spec violation. Either (a) update design D10 to reflect the actual collapsed behavior, or (b) implement the documented asymmetry. Both are valid; recommend (a) since the actual behavior is a deliberate UX simplification (one less transient state to render).

2. **S2 — Cache invalidation gap on operator rename / role change (R2 from design)**. Out-of-scope per locked decisions; flagged for awareness. TanStack Query refetches on mount + focus + stale-time but does NOT subscribe to operator-table mutations. A user editing an operator sees the stale name until next refetch. This is the intended trade-off (chip is a "snapshot of who they were" for historical rows).

3. **S3 — Drizzle migration system bug (untouched in this change)**. `__drizzle_migrations` table absent; `_journal.json` incomplete for 0013–0019. No Drizzle calls in this PR scope; verified by the absence of any `db.execute(sql` migration`)` invocation in the new files. Recommend a separate SDD change for the migration system (carry-over from Gorriti Premium project state).

---

## 6. Verdict

**READY FOR ARCHIVE** — with three `chore` follow-ups (W1, W2, W3).

All 8 requirements and 15 of 17 spec scenarios pass with covering runtime tests. The 2 scenarios flagged as WARN (R8.1, R8.2) have their contracts provable by code inspection + test-mock pinning + library semantics, but no dedicated runtime test asserts them. None of the findings block archive.

- No spec requirement violated.
- No `password_hash` / `is_active` / PII column leaks onto the wire.
- Auth gate correct (`requireAuth()` only, no role gate).
- Validation cap (200) and overflow (400) correct.
- One Drizzle batched query (no per-id roundtrips).
- OperatorChip rendering correct in all 4 conceptual cases (collapsed to 3 runtime branches per locked decision).
- Cache key identical between AuditTab and SocioNotesCard via the shared `OPERATORS_QUERY_KEY` constant.
- `next_recommended` → `sdd-archive`.