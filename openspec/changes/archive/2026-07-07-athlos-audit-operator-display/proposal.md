# Proposal: Operator Display in Audit + Notes

## Why

The audit tab in `/socios/[id]` is illegible to non-technical operators: every actor renders as `Operador {8-char-uuid}` (e.g. `Operador 5ddf9da-`). The operator room is about to open the module to production. Chips must read `username · ROLE` (e.g. `vlongo · ADMIN`).

## What changes

- Server: one read-only batch endpoint `GET /api/v1/operators?ids=a,b,c` (JWT-gated, non-admin).
- Frontend: swap two actor render sites (`AuditTab`, `SocioNotesCard`) to a shared `OperatorChip` keyed on a TanStack Query cache.
- No schema, no migration, no Drizzle calls.

## Scope

**In:** `apps/api/src/routes/operators.ts` (new, `requireAuth()`); `apps/api/src/modules/operators/lookup.ts` (`listByIds` via `inArray(operators.id, ids)`); `apps/web/src/lib/api/operators.ts`; `apps/web/src/components/socios/OperatorChip.tsx`; edits to `AuditTab.tsx` + `SocioNotesCard.tsx`.

**Out:** schema changes / migrations; `display_name` column; actor rename / audit denormalisation; global operators cache; per-row lazy loading; operator CRUD; `ctacte` and `padrones` audit surfaces; `audit_events.operator_id` semantics or emission pipeline.

## Approach

- Endpoint returns `{ operators: OperatorSummary[] }` where `OperatorSummary = { id, username, role }`. Zod `.array(z.string().uuid()).max(200)`; 400 on overflow.
- Single batched Drizzle query. Soft-deleted rows (`is_active=false`) included (preserve historical names); missing IDs silently omitted.
- Frontend `useQuery(['operators', sortedIds.join(',')])` per tab mount; deterministic key → both components share cache.
- Auth: `requireAuth()`. Audit row already exposes UUID; widening UUID → name+role is the same trust level as the audit itself.

## Capabilities

**New:** `operator-lookup` — read-only batch resolution of operator summaries (`id`, `username`, `role`) at `/api/v1/operators?ids=…` for any authenticated operator.

**Modified:** None.

## User-visible behaviour

- Actor chips render `username · ROLE`.
- `operator_id === null` (system) or missing-from-lookup → `Operador desconocido`.
- Soft-deleted (`is_active=false`) → keeps historical name.

## Risks & mitigations

- **Privacy widening** — any operator learns any other operator's username+role. Mitigation: same trust level as the audit row they already see.
- **URL length cap** — `?ids=` capped at 200; 100-event page default keeps us safe; 400 on overflow.
- **Stale cache after rename** — TanStack Query refetch on mount + focus; rename reflected within one tab open.
- **Missing-id silent omission** — chip helper handles "missing" + "system event" with the same fallback.
- **Soft-deleted semantics** — historical name preserved per locked decision.
- **Mid-session operator edit** — no invalidation hook today; acceptable: audit authorship = "who they were at the time".

## Rollback Plan

Additive: revert removes route, client wrapper, and chip; components fall back to UUID short form. No DB rollback. Each PR independently revertible.

## Dependencies

None new. Reuses `requireAuth()`, Zod, Drizzle `inArray`, TanStack Query, `Badge` UI primitive.

## Open questions

None. See `sdd/athlos-audit-operator-display/explore` for the question trail.

## Success Criteria

- [ ] Endpoint returns 200; missing IDs silently omitted; >200 IDs → 400.
- [ ] `AuditTab` + `SocioNotesCard` render `username · ROLE`; `Operador desconocido` for null + missing.
- [ ] Soft-deleted operators retain historical name.
- [ ] One fetch per tab mount; second component mount hits cache.
- [ ] All new files have 1:1 test files; existing `AuditTab.test.tsx` + `SocioNotesCard.test.tsx` extended.