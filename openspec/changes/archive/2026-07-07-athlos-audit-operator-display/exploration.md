# Exploration: athlos-audit-operator-display

**Date:** 2026-07-06
**Change name:** `athlos-audit-operator-display`
**Mode:** read-only — no source files modified.
**Outcome:** ready for `sdd-propose` with a one-line caveat about display-name source.

---

## 1. Current state (what the code does today)

### 1.1 AuditTab — actor rendering (UUID short form)

`apps/web/src/components/socios/AuditTab.tsx:96-99`

```ts
function shortOperatorId(id: string | null): string {
  if (!id) return 'sistema'
  return id.slice(0, 8)
}
```

Rendered at `AuditTab.tsx:399-404`:

```tsx
<span
  className="font-body text-xs text-ink-500"
  data-testid={`audit-event-actor-${event.id}`}
>
  por operador {shortOperatorId(event.operator_id)}
</span>
```

So the UI shows `por operador 5ddf9da-` (8-char UUID prefix) for every event.
System events (where `operator_id` is `null`) render as `por operador sistema` — no
"Operador desconocido" wording today.

### 1.2 SocioNotesCard — note author rendering (UUID short form)

`apps/web/src/components/socios/SocioNotesCard.tsx:63-65, 240`

```ts
function shortOperatorId(id: string): string {
  return id.slice(0, 8)
}
```

Rendered at `SocioNotesCard.tsx:238-241`:

```tsx
<div
  className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-500"
  data-testid={`socio-note-author-${note.id}`}
>
  Operador {shortOperatorId(note.operator_id)}
</div>
```

### 1.3 Audit payload shape

`apps/api/src/routes/socios.ts:354-376` (wrapper) calls
`packages/audit/src/query.ts` `queryAudit()` and returns:

```ts
{
  id: string
  operator_id: string | null          // ← nullable (system events)
  action: string
  entity_type: string
  entity_id: string
  old_value: unknown
  new_value: unknown
  source_ip: string | null
  created_at: string                  // ISO
}
```

Mirrored in `apps/web/src/lib/api/socios.ts:233-244` (`AuditEvent` interface).

### 1.4 Operators table — what fields exist

`packages/db/src/schema/operators.ts:26-40`

| Column               | Type           | Notes                                              |
|----------------------|----------------|----------------------------------------------------|
| `id`                 | `uuid` PK      | defaultRandom()                                    |
| `username`           | `varchar(50)`  | NOT NULL UNIQUE — the ONLY name-like field         |
| `password_hash`      | `varchar(255)` | NEVER returned to the wire                          |
| `role`               | `char(1)`      | `A`/`T`/`O`/`C`; decoded by `charToRole()`        |
| `can_reprint`        | `bool`         |                                                  |
| `can_anulate`        | `bool`         |                                                  |
| `is_active`          | `bool`         | soft-delete flag (default true)                     |
| `last_login_at`      | `timestamp`    | nullable                                          |
| `failed_login_attempts` | `int`       |                                                  |
| `locked_until`       | `timestamp`    | nullable                                          |
| `created_at`/`updated_at` | `timestamp`|                                                  |

**Critical finding:** the `operators` table has **no `display_name`,
`nombre`, or `apellido` column**. The only human-readable identifier
is `username` (lowercase, e.g. `victor.longo`, `admin`, `cajero1`).

The role is encoded as a 1-char code on the row and decoded by
`apps/api/src/services/auth.ts:238-251` `charToRole()` →
`'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'`.

### 1.5 audit_events.operator_id column

`packages/db/src/schema/public.ts:42-67`

```ts
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Operator who triggered the event. NULL for system-generated events. */
  operatorId: uuid('operator_id'),         // ← nullable, no .notNull()
  ...
})
```

Nullable. System events (`drift.emitDriftAlert` etc.) emit `operator_id = null`.
Existing services that emit (e.g. `apps/api/src/modules/socios/notes.ts:200-209`)
write `operatorId: row.operatorId` from the caller — same UUID type as
`operators.id`.

### 1.6 JWT subject = operator UUID

`apps/api/src/services/auth.ts:146-152` signs `sub: op.id`; the same value
becomes `request.operator?.sub` in routes, and is what `notes.ts` stores
as `audit_events.operator_id`. Type chain is consistent.

### 1.7 Existing `/api/v1/admin/operators` route

`apps/api/src/routes/admin/operators.ts` already exists with the following
gates + shapes:

- All endpoints gated by `requireRole('ADMIN')` (`admin/operators.ts:67`).
- `listQuerySchema` (line 34-39) supports `cursor`/`limit`/`role`/`is_active`
  but **NOT `?ids=`** — it is cursor-paginated, not list-by-id.
- Returns `OperatorDTO` (`apps/api/src/services/auth.ts:27-36`):
  `{ id, username, role: 'ADMIN'|'TESORERO'|'OPERADOR'|'CONSULTA',
     can_reprint, can_anulate, is_active, last_login_at, created_at }`.

The admin route is **not directly reusable** for our use case:

1. The AuditTab / NotesCard are accessible to any authenticated operator
   (any role), not just ADMIN.
2. The route uses cursor pagination; we need a list-by-ids.
3. It returns more fields than we need (no need for `can_reprint`,
   `last_login_at`, `password_hash` etc. on the audit timeline).

### 1.8 Existing operator-lookup helpers

Searched for any non-admin "operator by id" or "operator by list of ids"
helper. Found **none**. The only operator read path for non-admins is
`GET /api/v1/auth/me` (`apps/api/src/routes/auth.ts`), which returns
the caller's own profile. There is no `GET /api/v1/operators/:id` and
no `?ids=` endpoint.

### 1.9 UI primitives available

`apps/web/src/components/ui/`:

- `Badge.tsx` — small tag (variants: default/success/warning/danger/info).
  Suitable for the role chip (`ADMIN` rendered as `<Badge variant="info">`).
- `Monogram.tsx` — initials avatar; **requires `nombre` + `apellido`**
  props. We do not have those — we only have `username`. Cannot reuse
  directly without an adapter (initials from username? `v.longo` → `VL`?).
- `Modal.tsx`, `Tabs.tsx` — not relevant to this change.

### 1.10 Auth + token context on the web side

`apps/web/src/lib/auth.ts:65-70` `CurrentUser` carries
`{ operator_id, role, username, permissions }`. The username is already
in client memory after login. So the "current operator" name is free
(no fetch) — we only need to resolve **other** operators' names.

---

## 2. Affected areas

| File | Why affected |
|------|--------------|
| `apps/web/src/components/socios/AuditTab.tsx` | Replace `shortOperatorId()` call with a name-lookup. Add parallel `useQuery` for operator names. Update `data-testid="audit-event-actor-${event.id}"` content. |
| `apps/web/src/components/socios/SocioNotesCard.tsx` | Replace `shortOperatorId()` call in the author chip. Add a names lookup (or share the cache with AuditTab). |
| `apps/web/src/lib/api/socios.ts` (or new `operators.ts`) | Add `getOperatorNames(ids: string[])` wrapper. |
| `apps/api/src/routes/operators.ts` (**new**, not under `admin/`) | `GET /api/v1/operators?ids=…` returning a small DTO. |
| `apps/api/src/services/operators.ts` (extend) or new `modules/operators/lookup.ts` | `listByIds(db, ids: string[]): OperatorLookupDTO[]` — `WHERE id = ANY($1::uuid[])`. |
| `apps/api/src/routes/socios.ts` | No change expected — already returns `operator_id`. |
| `packages/db/src/schema/operators.ts` | **No change** (no schema migration required if we accept `username` as the display name). |
| `apps/web/src/components/socios/AuditTab.test.tsx` (PR 8b.4 tests) | Update snapshots: actor text changes from `por operador 5ddf9da-` to `por admin · ADMIN` (or similar). |
| `apps/web/src/components/socios/SocioNotesCard.test.tsx` | Same — author chip text changes. |

---

## 3. Approaches

### A — Batch endpoint server-side (`GET /api/v1/operators?ids=…`) ✅ recommended

**Description:** New non-admin route `GET /api/v1/operators?ids=id1,id2,…`
gated by `requireAuth()`. AuditTab computes the dedup'd set of
`operator_id` values from the audit events and issues a single fetch on
mount. SocioNotesCard does the same for note author ids (and can
**share** the TanStack Query cache key `['operator-names', sortedIds]`
with AuditTab, so the second mount is a cache hit).

Server side: `db.select({id, username, role, isActive}).from(operators)
.where(inArray(operators.id, ids))` — one query, indexed PK lookup.

**Pros:**
- One batched SQL query (PK lookup) — minimal load.
- Decoupled from audit_events; can be reused by `Cuota Social` audit,
  `Padrones` audit, login history, anywhere an operator name is needed.
- Reuses the same JWT-gate as `/socios/:id/audit` and `/socios/:id/notes`
  (any authenticated operator can see the audit timeline, so any
  authenticated operator can resolve operator names).
- TanStack Query cache key can be shared between AuditTab and
  SocioNotesCard → second mount is free.
- Test-friendly: route + service + DTO are easy to test in isolation
  (mirror `admin/operators.test.ts` patterns).

**Cons:**
- New endpoint + new service function to maintain.
- URL-length concern with very large `?ids=` payloads; cap at e.g. 200
  ids per request and chunk if more needed (the audit timeline is
  paginated to 100 events, so 100 unique ids is the realistic max).
- `username` is the only available name field → display becomes
  `victor.longo · ADMIN` (lowercase, dot-separated), not the
  PRD's "Victor Longo" example. **See §6 risks.**

**Effort:** Low (new route + new service fn + new client wrapper +
 2 component edits + tests).

### B — Embed operator profile in each audit event (denormalise)

**Description:** Add a column `audit_events.operator_display_name` and
`audit_events.operator_role` (or put both in the `metadata` JSONB
already present on the row). Emit on write. No new endpoint, no join.

**Pros:** No new route, no new fetch, render is direct from the event.

**Cons:**
- **Schema change required** — the project's `drizzle` migration
  pipeline is broken in prod (see
  `pending/work-after-pr-8b4` §3, and project state memory #253 §1):
  `__drizzle_migrations` is missing, `_journal.json` has gaps.
  Workaround is `docker exec -i athlos-db-1 psql -U athlos -d athlos
  < archivo.sql`. The schema change is doable but the broken
  pipeline is a real cost.
- **Backfill required** for every existing audit_events row (currently
  hundreds, growing). Without backfill, old events still show the
  UUID short form.
- **Drift** between the audit row and the current `operators` row —
  if an operator is renamed, old audit rows still show the old name.
  Not always wrong (audit = what happened) but worth a decision.
- Less reusable than A — only the audit timeline benefits.

**Effort:** Medium (migration + emit + backfill + component edit + tests).

### C — Global `['operators']` cache, one call on app mount

**Description:** Add a `useQuery({ queryKey: ['operators'], queryFn:
listAllOperators })` at the AppShell level. Every component reads from
this cache. No batch endpoint needed.

**Pros:** Reusable across the whole app. No per-feature fetch.

**Cons:**
- **Privacy surface** — every authenticated operator would get a list
  of every other operator's username + role on first paint, even
  if they never visit the audit tab. The admin list is gated
  by ADMIN; this lower-trust surface is wider.
- **Staleness** — adding a new operator in another tab wouldn't
  reflect until refresh (acceptable but worth noting).
- **Doesn't scale** when operator count grows (Athlos is small
  today, but the pattern is wrong-shaped).
- Requires deciding how to handle the response (admin-style cursor
  pagination would not match).

**Effort:** Low–Medium. But the privacy tradeoff is the real cost.

### Hybrid D — `username` for display + the batch endpoint (A)

If we accept the locked decision "Display name + role" and interpret
"display name" as `username` (since that's all we have), option A
is the natural fit. The new endpoint returns
`{ id, username, role }`, the UI renders `${username} · ${role}`,
and the "Operador desconocido" fallback fires for:
- `event.operator_id === null` (system event), AND
- `operator_id` present but not in the lookup result (operator
  hard-deleted or `is_active = false` AND we filter to active only).

This is **option A with no schema change**. The PRD example
"Victor Longo" becomes the literal `username` value (e.g.
`victor.longo`). If the user wants the title-cased form, we can
add a tiny client-side formatter (no schema change).

---

## 4. Recommendation

**Option A (batch endpoint) — confirmed, with two notes:**

1. The new endpoint lives at `/api/v1/operators` (NOT under `/admin/`)
   with `requireAuth()` and a `?ids=` array query, mirroring the
   existing route layout. The DTO is intentionally **minimal**:
   `{ id, username, role, is_active }` — do not leak
   `can_reprint` / `can_anulate` / `last_login_at` to non-admins
   beyond what the audit timeline needs.

2. The "display name" displayed in the chip = `username` for now. If
   the user wants proper first/last names ("Victor Longo"), that
   requires either:
   - A schema migration adding `display_name varchar(120)` to
     `operators` (blocked by the broken drizzle migration pipeline
     — `psql` workaround required), OR
   - A client-side transform of `username` (e.g. dot-split +
     title-case) that produces "Victor Longo" from `victor.longo`.

**Why A wins:** smallest change, scales horizontally to other audit
surfaces (Cuota Social, Padrones), the query pattern fits
TanStack Query cache sharing, the endpoint is testable in
isolation, and we avoid a schema migration through the broken
drizzle pipeline.

**Why not B:** migration + backfill cost is real; the broken
drizzle pipeline makes both harder than they should be; the
reusability win is smaller than A.

**Why not C:** privacy surface (every operator learns every other
operator's username) and the wrong-shape scaling.

---

## 5. Risks

1. **`operators` has no human display name.** Locked decision
   "Display name + role, e.g. `Victor Longo · ADMIN`" cannot be
   satisfied literally without either (a) accepting `username` as
   the display name (`victor.longo · ADMIN`) or (b) a schema
   migration adding a `display_name` column. The proposal phase
   must surface this and get the user to pick (a) vs (b).

2. **Drizzle migration pipeline is broken in prod.** Project state
   #253 §1, `pending/work-after-pr-8b4` §3. Any schema change ships
   via `docker exec -i athlos-db-1 psql -U athlos -d athlos <
   archivo.sql` — not via `pnpm --filter @athlos/db migrate`. If
   option (b) is chosen, the migration work and the deploy runbook
   need to spell this out.

3. **URL length cap on `?ids=`.** Cap at 200 ids (well over the
   100-event audit-page default). Reject with 400 if more requested.
   Consider switching to a POST body for large lists, but YAGNI for
   PR-scope.

4. **Soft-deleted operators (is_active = false).** The endpoint
   should still return them (so old audit rows can render their
   original author even if the operator was deactivated later).
   The "Operador desconocido" fallback should fire only for ids
   that have NO row at all (hard-deleted, shouldn't happen given
   the soft-delete pattern, but defensive).

5. **System events (`operator_id = null`).** Always render
   `Operador desconocido` (or `sistema`, but the locked decision
   says "Operador desconocido"). Distinct from the lookup-miss
   case but rendered identically for UX simplicity.

6. **Cache invalidation on operator rename.** With option A, the
   cached names refresh on next mount (or on `invalidateQueries`).
   No data loss; just a small UX delay. With option B, the
   rendered name is frozen at audit-time — arguably more correct
   for audit ("the operator at the time was X"). Pick consciously.

7. **TanStack Query dedup.** Both `AuditTab` and `SocioNotesCard`
   can share `['operator-names', sortedIds]`. Confirm the sort
   key is stable (sort the array) so a re-mount with the same set
   doesn't refetch.

8. **Auth: any-operator-can-resolve-names.** This is a
   non-trivial info disclosure: any operator viewing a socio
   detail page can fetch any other operator's username + role.
   The admin list already gives ADMIN this; CONSULTA and OPERADOR
   currently can't see the full list. Decision: this is acceptable
   because the audit timeline + notes already attribute the work
   to the operator (just by UUID). Replacing UUID with name does
   not materially widen the surface. Document in the spec.

9. **Test file ratio.** Project rule: every new source file gets
   a 1:1 test file. New files this change ships:
   `apps/api/src/routes/operators.ts`, `apps/api/src/routes/operators.test.ts`,
   `apps/web/src/lib/api/operators.ts`, `apps/web/src/lib/api/operators.test.ts`,
   plus edits to `AuditTab.test.tsx` and `SocioNotesCard.test.tsx`.
   Plan the test count accordingly (likely 4 new test files
   + 2 edits).

10. **Tokens in `tokens.css`.** If a new `<Badge>` variant is
    added for the role chip, the colour comes from a CSS variable,
    not a hex literal. `Badge.tsx` already follows this — no new
    primitives needed.

---

## 6. Ready for proposal

**Yes — propose option A (batch endpoint at `/api/v1/operators?ids=…`).**

But the proposal phase must surface two clarifications to the user
**before** locking the spec:

1. **Display name source.** Accept `username` (no migration) or
   add a `display_name` column (schema migration via `psql`
   workaround)? The PRD example "Victor Longo" doesn't match
   either `username` as-is OR a missing column — the user has
   to pick.

2. **Soft-deleted operator rendering.** Should a deactivated
   operator (`is_active = false`) still show their old name on
   past audit rows, or render as "Operador desconocido"?

Both are 1-question-each and fast. With answers locked, the
proposal + spec + design + tasks are straightforward.

---

## 7. Persisted artifacts

- `openspec/changes/athlos-audit-operator-display/exploration.md` (this file)
- Engram topic `sdd/athlos-audit-operator-display/explore` (summary)
- Engram observation: `discovery` — `audit_events.operator_id` is `uuid`,
  nullable, matches `operators.id` (UUID).
- Engram observation: `pattern` — no existing `?ids=` batch endpoint
  in `apps/api/src`; new pattern would be the first.
- Engram observation: `architecture` — option A (batch endpoint at
  `/api/v1/operators`) recommended; reuses TanStack Query cache sharing.
