# Design: Operator Display in Audit + Notes

**Change**: `athlos-audit-operator-display` | **Phase**: design | **Date**: 2026-07-06 | **Scope**: 1 batch endpoint + 2 client render surfaces (~300–550 LoC raw, 2 PRs)

## Technical Approach

Swaps the UUID short-form actor rendering in `AuditTab` and `SocioNotesCard` for `username · ROLE` chips. The backend adds one read-only batch endpoint at `GET /api/v1/operators?ids=…` (non-admin, `requireAuth()`, single `inArray` Drizzle query). The frontend adds one `OperatorChip` helper plus one `getOperatorNames(ids)` client wrapper; both surfaces share a deterministic TanStack Query cache key so the second component mounts hit the first fetch. **No schema change**, **no migration**, **no audit emission** — the endpoint is a side-channel read of operator metadata that already lives on the audit row.

The decode from `operators.role` (`char(1)`: `A|T|O|C`) to the wire string role (`ADMIN|TESORERO|OPERADOR|CONSULTA`) happens inside the lookup module via a 5-line private `charToRole()` helper that mirrors `apps/api/src/services/auth.ts:238-251`. **The wire DTO is `{ id, username, role }` only** — `is_active`, `password_hash`, and timestamps are excluded by both the SELECT projection and the DTO mapper (privacy widening is the only sensitive axis; see Risks).

## Architecture Decisions

| # | Decision | Choice | Alt rejected | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Endpoint mount | NEW `apps/api/src/routes/operators.ts` at `/api/v1/operators` (NOT under `/admin/`) | extend `apps/api/src/routes/admin/operators.ts` | Existing admin route has `requireRole('ADMIN')` + cursor pagination + a `softDeleteOperator` surface — wrong shape for a public batch lookup. Lifting the gate would leak the rest of the admin surface to `CONSULTA`. |
| D2 | Module path | NEW `apps/api/src/modules/operators/{lookup.ts,schema.ts}` (parallel to `modules/socios`) | inline the repo inside the route | Project convention (see `modules/socios/{service,repository,notes}.ts`); keeps the route file <100 LoC and lets the repo carry its own test. |
| D3 | Validator location | Co-located inside `modules/operators/lookup.ts` rather than a sibling `schema.ts` | separate `schema.ts` | The single schema is ≤6 lines and used by one route — splitting just for parity with bigger modules adds churn without value. If a second module consumer appears, file is split then. (See Risks §R5 — convention we did NOT follow.) |
| D4 | Auth gate | `requireAuth()` only (no `requireRole`) | `requireRole('ADMIN')`; `requirePermission('data_steward')` | Exploration rejected ADMIN gate: any operator who reads the audit row must see the actor's name. `CONSULTA` already sees audit via `/socios/:id/audit` wrapper, so the lookup is at the same trust level. |
| D5 | Drizzle projection | `db.select({id: operators.id, username: operators.username, role: operators.role}).from(operators).where(inArray(operators.id, ids))` | `select()` all columns; select then strip | Project with the SQL projection keeps PII columns off the wire path entirely (`password_hash`, `failed_login_attempts`, etc. never leave Postgres). Spec is explicit on this. |
| D6 | Role decode | Private `charToRole()` in `lookup.ts` mirroring auth.ts:238-251 | import `charToRole` from `services/auth.ts`; CASE WHEN in Drizzle | `charToRole` is currently a private function in `services/auth.ts`; exporting it couples two packages for 6 lines. Drizzle CASE WHEN ties the SELECT to a string-mapping concern. Inline the helper; one private symbol. |
| D7 | Chip helper | NEW `apps/web/src/components/socios/OperatorChip.tsx` as a stateless pure component | derive display inside each tab; keep helper inside a hook | Single helper = one place to change the rendering rules. The locked "username casing verbatim" rule is a property of THIS component, not of each tab. |
| D8 | Cache key | `['operators', sortedIds.join(',')]` — Array form, sorted | tuple `[ids]`; `new Set(ids).toString()` | `sortedIds.join(',')` is the deterministic, human-readable, JSON-serialisable key the project uses elsewhere (see `SOCIO_NOTES_QUERY_KEY` in `SocioNotesCard.tsx`). Test asserts verbatim. |
| D9 | Route registration | `app.register(operatorsRoutes)` in `apps/api/src/server.ts` after line 198 (`sociosRoutes`) | new barrel `routes/index.ts` | Matches the existing one-line-per-plugin pattern (auth/admin/jobs/scheduler/health/socios/ctacte/padrones/import/…). No barrel exists today; introducing one is out of scope. |
| D10 | Loading placeholder | `operatorId ? '-' : 'Operador desconocido'` | spinner per chip; `Operador desconocido` for all | Symmetry: a row whose `operatorId` is `null` cannot resolve to anything ever, so showing `Operador desconocido` immediately makes the eventual swap to `username · ROLE` visible without flicker. Spinner per chip is excessive noise across an audit list. |

## Data Flow

```
USER opens /socios/[id]
        │
        ▼
PAGE renders (SocioNotesCard on top, tabs below incl. AuditTab)
        │
        ├──── SocioNotesCard mounts
        │       │  listSocioNotes(socioId) → notes
        │       │  useQuery(['operators', sortedNoteOperatorIds.join(',')], getOperatorNames)
        │       │     → Map<id, OperatorSummary>
        │       ▼
        │    <OperatorChip operatorId={note.operator_id} operators={map} />  per note row
        │
        └──── User switches to "Auditoría" tab → AuditTab mounts
                │  getSocioAudit(socioId) → audit events
                │  useQuery(['operators', sortedEventOperatorIds.join(',')], getOperatorNames)
                │     → reuses the same cache entry if id-set intersects (deterministic key)
                ▼
              <OperatorChip operatorId={event.operator_id} operators={map} />  per event row

(When the user switches tabs while both queries are still pending, the second mount
 ignores the in-flight request — TanStack dedupe by key — and shares the response.)
```

Notes surface operatorId in `note.operator_id`; audit events surface it in `event.operator_id`. Both feeds collapse through one `<OperatorChip>` so the four render cases (null / missing / soft-deleted / active) live in one file.

## File Changes

### NEW

| File | Purpose | Approx LoC |
|------|---------|-----------:|
| `apps/api/src/routes/operators.ts` | `GET /api/v1/operators?ids=…` plugin (`requireAuth()`, zod, lookup, mapper) | ~70 |
| `apps/api/src/modules/operators/lookup.ts` | `listByIds(db, ids)` + private `charToRole()` + Zod schema | ~50 |
| `apps/api/src/routes/operators.test.ts` | Auth / validation / happy / missing-ids-omitted route tests | ~120 |
| `apps/api/src/modules/operators/lookup.test.ts` | In-memory standin tests: all-present, partial present | ~60 |
| `apps/web/src/lib/api/operators.ts` | `OperatorSummary` type + `getOperatorNames(ids)` wrapper | ~40 |
| `apps/web/src/lib/api/operators.test.ts` | Mocks `apiFetch`, asserts URL shape and return | ~50 |
| `apps/web/src/components/socios/OperatorChip.tsx` | Pure render helper, four cases | ~50 |
| `apps/web/src/components/socios/OperatorChip.test.tsx` | One test per case + casing pin | ~80 |

### MODIFIED

| File | Change |
|------|--------|
| `apps/api/src/server.ts` | +2 LoC: import line + `await app.register(operatorsRoutes)` after `sociosRoutes` registration (line 198) |
| `apps/web/src/components/socios/AuditTab.tsx` | Add `useQuery(OPERATORS_QUERY_KEY, …)` per mount + replace `shortOperatorId(event.operator_id)` with `<OperatorChip operatorId={event.operator_id} operators={map} />` |
| `apps/web/src/components/socios/SocioNotesCard.tsx` | Same swap: `Operador ${shortOperatorId(note.operator_id)}` → `<OperatorChip>` |
| `apps/web/src/components/socios/AuditTab.test.tsx` | +1 mock export (`getOperatorNames`), +1 new scenario: "when operators map has the id, renders `username · ROLE`" and "when missing, renders `Operador desconocido`" |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx` | Same: +1 mock export, +2 new scenarios |

### NOT changed

- `packages/db/src/schema/operators.ts` — no migration.
- `packages/errors`, `packages/auth`, `packages/validation` — endpoint uses public exports only.
- `apps/api/src/services/operators.ts` (`charToRole` stays private; replicated into lookup).
- `apps/api/src/routes/admin/operators.ts` — admin surface untouched.

## Interfaces / Contracts

```ts
// ── Backend wire ─────────────────────────────────────────────────────
// GET /api/v1/operators?ids=a,b,c
//   200 → { operators: OperatorSummary[] }
//   400 → { error: 'VALIDATION_ERROR', details: [{ field: 'ids', message }] }
//   401 → { error: 'UNAUTHORIZED' } (existing requireAuth behaviour)

type OperatorSummary = {
  id: string
  username: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
}

// Validation (co-located in apps/api/src/modules/operators/lookup.ts)
import { z } from 'zod'
export const getOperatorByIdsQuerySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

// Repository
export async function listByIds(db: Db, ids: string[]): Promise<OperatorSummary[]>

// ── Frontend wire (apps/web/src/lib/api/operators.ts) ────────────────
export interface OperatorSummary { /* mirrors backend */ }
export async function getOperatorNames(ids: string[]): Promise<OperatorSummary[]>

// ── Component (apps/web/src/components/socios/OperatorChip.tsx) ──────
export function OperatorChip(props: {
  operatorId: string | null
  operators: Map<string, OperatorSummary> // built from useQuery data
}): JSX.Element

// Query key (exported constant so the test pins it verbatim):
export const OPERATORS_QUERY_KEY = (sortedIds: string[]) =>
  ['operators', sortedIds.join(',')] as const
```

## Query Key — Pinned Exactly

`['operators', sortedIds.join(',')]` — Array form. Two consumers compute the same key by:
1. Collecting every distinct non-null `operatorId` from the rendered audit rows (or note rows).
2. Sorting them lexicographically (`[...ids].sort()`) so the key is identical regardless of mount order across `AuditTab` and `SocioNotesCard`.
3. Joining with `','` and wrapping as the second element of the tuple array.

**Sort is mandatory.** Without it, the two tabs feeding the same set in different orders would issue two network requests against the same data. The `OperatorChip` consumers do not sort — sorting happens once at the call site before invoking the query key.

## Validation Details

Zod schema (in `apps/api/src/modules/operators/lookup.ts`, see D3 for placement rationale):

```ts
export const getOperatorByIdsQuerySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})
```

Mounted in the route with the existing helper:

```ts
const q = throwIfInvalid(getOperatorByIdsQuerySchema, request.query, 'query')
```

Error path is the standard envelope: `BusinessError(ErrorCode.VALIDATION_ERROR, …)` from `packages/errors/zod.ts`. The global error-handler plugin (`apps/api/src/plugins/error-handler.ts`) maps `VALIDATION_ERROR` to HTTP 400 with `{ error, details }` — same envelope as every other route.

## Error Handling + Logging

- **400** → standard `VALIDATION_ERROR` envelope (see `apps/api/src/plugins/error-handler.ts`).
- **401** → `requireAuth()` default; no special path.
- **5xx** → not expected (single SELECT against a stable table); the global handler emits a generic envelope + pino error log.
- **Audit emission**: NONE. This endpoint is a read-only side-channel lookup, not an action — the existing audit pipeline records operator actions, not who-read-what. If the threat model later requires it, a new PR can add `audit_events` rows with `action='OPERATOR_LOOKUP_BATCH'`.
- **Logging**: pino child logger under the existing request context. `debug` on success (the request is high-volume per page render); `warn` on 400; `error` on 500.

## UI Rendering Details

`<OperatorChip>` maps four conceptual states to render output (locked):

| Case | Render |
|------|--------|
| `operatorId === null` | `<span>Operador desconocido</span>` |
| `operatorId !== null && !operators.has(operatorId)` (lookup returned no row → orphan id in legacy audit) | `<span>Operador desconocido</span>` |
| `operatorId !== null && operators.has(operatorId) && row.is_active === false` (soft-deleted) | `${username} · ${roleLabel}` |
| `operatorId !== null && operators.has(operatorId) && row.is_active === true` (active) | `${username} · ${roleLabel}` |

**Note on rows 3 and 4**: the locked wire DTO is `{ id, username, role }` — `is_active` is intentionally excluded. Cases 3 and 4 therefore collapse to the same render branch in the implementation. The 4-row table above documents the conceptual matrix; the actual impl uses 3 distinct branches (cases 1, 2, and "in map"). If a future iteration needs to surface soft-deleted visually, the spec must add `is_active` to the DTO first; do not relax this rule.

**ROLE label mapping** (one-to-one, no translation):
`ADMIN → ADMIN`, `TESORERO → TESORERO`, `OPERADOR → OPERADOR`, `CONSULTA → CONSULTA`. Defined inline as a constant object inside `OperatorChip.tsx`. Matches the `charToRole()` output on the backend (`apps/api/src/services/auth.ts:238-251`).

**Username casing**: VERBATIM. No `toTitleCase`, no `Capitalize`. The chip constructs the literal string `username + ' · ' + roleLabel`. The `vlongo` user stays `vlongo`. This is a locked spec rule; do not relax.

**Loading state**: while `useQuery` is pending, the chip renders `operatorId ? '-' : 'Operador desconocido'`. The rationale is documented in D10; the asymmetry is intentional — a null id cannot ever resolve, so showing the fallback immediately avoids a flash of `'-'` that would later become `Operador desconocido` again.

**Error state**: if `useQuery` errors, the chip falls back to `Operador desconocido` for every render. No retry UI in this PR scope — the existing `error.tsx` boundary already covers catastrophic failures.

## Testing Strategy

| Layer | Cases | How |
|-------|------:|-----|
| Route | auth (no JWT → 401), validation (empty → 400, garbage → 400, 201 ids → 400, 200 ids boundary → 200), happy path (200 + shape, missing ids silently omitted, soft-deleted included) | vitest + Fastify `.inject()` — pattern from `apps/api/src/routes/audit.test.ts` |
| Repository | all-present (single SELECT, projected columns), partial present (3 ids, 2 rows, ORDER BY id stable) | `createStandinDb()` from `apps/api/src/test-standins/db.ts` — pattern from `apps/api/src/modules/socios/repository.test.ts` |
| Client wrapper | URL `?ids=a,b,c` shape (one happy, one with 100 ids), response unwrap, throws on 400/401 | vi.mock `@/lib/api` (the `apiFetch` helper) and assert the URL + return shape |
| OperatorChip | null → 'Operador desconocido'; missing id → 'Operador desconocido'; known active → `'vlongo · ADMIN'`; known soft-deleted (mock the row with future `is_active` if added) → same string; casing pin: `UsEr` → `UsEr · ADMIN` | render + getByText / custom query |
| AuditTab | (extend) 2 new: "when `getOperatorNames` returns {id: OPERATOR_ID}, renders `OPERATOR_ID_USERNAME · OPERATOR_ROLE`"; "when `getOperatorNames` returns `[]`, renders `Operador desconocido` for every actor" | mock `getOperatorNames` + `getSocioAudit`; existing render harness |
| SocioNotesCard | (extend) same 2 new scenarios wrapped around `note.operator_id` | same harness as AuditTab |

Total: ~13 new cases + 4 extended. Strict-TDD is active for athlos (vitest, no skips). Each NEW file ships with its sibling `.test.ts(x)`.

**vitest mock note**: when extending `AuditTab.test.tsx` / `SocioNotesCard.test.tsx`, the `vi.mock('@/lib/api/socios', () => ({ … }))` factory must add `getOperatorNames: vi.fn()` to its return object. The same applies to the new `OperatorChip.test.tsx` and `operators.test.ts` if they import from `@/lib/api/operators` — keep the factory synchronous and explicit (project pattern: see `AuditTab.test.tsx:15-28`). If the apply phase needs additional unstated exports from `@/lib/api/operators`, escalate to `vi.mock(…, async (importOriginal) => …)` per the handover note — but the synchronous factory is the default and is sufficient for this PR.

## Rollback

Additive. Reverting the frontend PR reverts the client wrapper, the chip, and the two tab edits — components fall back to the UUID short-form (`Operador 5ddf9da-…`). Reverting the backend PR reverts the route, the module, and the schema — no DB rollback. Each PR independently revertible.

## PR Plan

- **PR A — backend** (`feature/audit-operator-display-backend`): route + module + repo + co-located schema + 2 test files. ~280–380 LoC total (well under the 400-line review budget).
- **PR B — frontend** (`feature/audit-operator-display-frontend`): client wrapper, `OperatorChip`, AuditTab + SocioNotesCard edits + test extensions. ~300–450 LoC total.

PR A unblocks PR B (PR B can be developed against a mock backend; can ship after PR A merges). Stacking strategy: **stacked-to-main** (the project's standard slice style) unless the user requests feature-branch-chain. Flag in `next_recommended` so the orchestrator can surface it.

## Open Questions

None. The locked facts (proposal + spec) resolve every ambiguity surfaced during exploration:
- Display source: `username` (no migration). Locked.
- Soft-deleted: kept with historical name. Locked.
- DTO: `{ id, username, role }` only. Locked.
- Auth: `requireAuth()` (no role gate). Locked.
- Cap: 200 ids, 400 on overflow. Locked.
- Cache key: `['operators', sortedIds.join(',')]`. Locked.

One convention **not adopted** for this PR (D3): a separate `modules/operators/schema.ts`. The single validator lives in `lookup.ts`; if/when a second consumer needs it, the file is split. This is a low-risk departure explicitly noted so the apply phase doesn't mis-create the file.

## Risks

- **R1 — Privacy widening (SPEC-level)**: any authenticated operator can read `username + role` for any other operator. The chip surfaces information that's already on the audit row they have access to; per the proposal, this is an acceptable widening. Mitigation: SELECT projection (D5) keeps `password_hash`, `failed_login_attempts`, etc. off the wire. Residual risk: someone scraping the endpoint to map username → role is now trivial; same risk already existed for `audit_events.operator_id` itself.
- **R2 — Cache-invalidation gap on rename / role change**: TanStack Query refetches on mount + focus + stale-time, but does NOT subscribe to operator-table mutations (rename via `PUT /api/v1/admin/operators/:id`, role change, soft-delete). A user editing an operator sees the stale name until the next refetch. Out-of-scope per locked decisions; acceptable trade-off because the chip is a snapshot of "who they were" for historical rows anyway.
- **R3 — 4-case render matrix vs 3-branch impl** (D7, §8 note): the locked wire DTO has no `is_active`. Future contributors might add `is_active` to the chip's `Map<string, OperatorSummary>` based on the §8 table alone. Mitigation: §8 explicitly states the impl collapses to 3 branches; spec forbids widening the DTO without PR.
- **R4 — `vi.mock` sync vs async** (handover note vs actual code): the handover note from session #253 recommends `vi.mock('@/lib/api/socios', async (importOriginal) => …)` to preserve `NOTE_MAX_LENGTH`. The actual `AuditTab.test.tsx:15-28` and `SocioNotesCard.test.tsx:21-34` use the **synchronous** factory form. The apply phase should match the synchronous form (explicit mock return object including `getOperatorNames: vi.fn()`), and only escalate to `importOriginal` if additional exports beyond `getOperatorNames` are added to `lib/api/operators` later.
- **R5 — Schema convention drift** (D3): co-locating the Zod validator inside `lookup.ts` instead of a sibling `schema.ts` is a minor departure from the "one module = repository + service + schema" pattern visible in `modules/socios/`. If a second operator-handling surface appears (e.g. operator search), the file should be split and the validator moved.
- **R6 — Endpoint registration site** (D9): `app.register(operatorsRoutes)` is added next to `sociosRoutes` in `server.ts`. If a future refactor introduces a routes barrel, the registration target changes; not blocking.
