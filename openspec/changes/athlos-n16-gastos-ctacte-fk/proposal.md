# Proposal: athlos-n16-gastos-ctacte-fk

**Change**: `athlos-n16-gastos-ctacte-fk`
**Phase**: propose
**Mode**: both (Engram + OpenSpec)
**Date**: 2026-06-29
**Author**: sdd-propose sub-agent
**Branch target**: TBD (orchestrator decides after spec)
**Status**: written

---

## Intent

Operators cannot correlate `tesoreria.gastos` (2,114 expense ledger rows keyed by accounting-plan code `cuenta_principal`) with `tesoreria.ctacte` (215,595 ledger entries keyed by socio carnet `cctcuenta`). The two namespaces do not intersect in the live data (verified: 0 of 165 distinct `cuenta_principal` values resolve to any socio carnet, per scope correction #C7). When a socio asks "what is this $5,000 charge on 2024-03-15?", operators drop into `psql` to correlate by hand. N16 closes that loop by adding a manual many-to-many mapping table (`gastos_ctacte_mapping`) plus a heuristic discovery view (`gastos_with_ctacte_candidates`) — both ADMIN-only — so operators can promote a candidate to an explicit, audited link. N16 also closes the missing `/api/v1/gastos` CRUD gap that Slice 8 deferred to Phase 9.

## Scope

### In Scope (single PR — ~700 LoC, orchestrator-confirmed <400 budget overshoot → SPLIT into 2 stacked sub-PRs per Slice 8 pattern)

**Sub-PR `n16a-backend` (≈ 400 LoC)**
- `packages/db/drizzle/0019_gastos_ctacte_mapping.sql` — NEW mapping table + heuristic view
- `packages/db/drizzle/meta/0019_snapshot.json` — drizzle-kit snapshot
- `packages/db/src/schema/tesoreria.ts` — add `gastosCtacteMapping` table + `gastosWithCtacteCandidates` view Drizzle definitions
- `apps/api/src/modules/gastos/{repository,service}.ts` + tests — list/detail gasto, link/unlink, anulación, candidates
- `apps/api/src/routes/admin/gastos.ts` + tests — `GET/POST/PATCH/DELETE /api/v1/gastos` + `PATCH /api/v1/gastos/:id/anular` (ADMIN)
- `apps/api/src/routes/admin/gastos-ctacte.ts` + tests — `GET/POST /api/v1/gastos/:id/ctacte-links` · `DELETE /api/v1/gastos-ctacte-links/:linkId` · `PATCH /api/v1/gastos-ctacte-links/:linkId/anular` · `GET /api/v1/ctacte/:cuenta/gastos-links` · `GET /api/v1/admin/gastos-ctacte-candidates` (ADMIN)
- `apps/api/src/server.ts` — register both route plugins
- `apps/api/src/container.ts` — wire gastos module

**Sub-PR `n16b-web` (≈ 300 LoC)**
- `apps/web/src/lib/api/gastos.ts` + `.test.ts` — typed fetch wrapper
- `apps/web/src/lib/api/gastos-ctacte.ts` + `.test.ts` — typed fetch wrapper for mapping endpoints
- `apps/web/src/app/(authed)/admin/gastos/page.tsx` + `.test.tsx` — list with link counts + anulado filter
- `apps/web/src/app/(authed)/admin/gastos/[id]/page.tsx` + `.test.tsx` — detail with link add/remove/anular
- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` (modify) — adds "Gastos asociados" panel
- `apps/web/src/components/layout/Sidebar.tsx` (modify) — adds `Tesorería > Gastos` link

### Out of Scope
- Caja (`caja_movimiento`) — same problem, separate slice
- Hard FK constraint `gastos.socio_id → socios.socios(id)` (Option B rejected — live data shows 0/2,114 have socio_id)
- Gastos write UI (`POST /api/v1/gastos` create form) — operators still use psql/import pipeline
- Gastos dashboard widget / CSV export / mobile-first responsive
- Cookie-based refresh, approvals executor, file storage (Phase 9 deferred items)

## Capabilities

### New Capabilities
- **`tesoreria-gastos-ctacte`**: gasto ↔ N ctacte many-to-many mapping table + heuristic discovery view + ADMIN-gated CRUD on links (manual `motivo`, hard DELETE, soft `anular`, candidate discovery).
- **`tesoreria-gastos`**: gastos master-table read/write API (list/detail/create/update/delete + `anular`) that Slice 8 explicitly deferred.

### Modified Capabilities
- **`web-frontend`**: Sidebar adds `Tesorería > Gastos` entry under Admin; `ctacte/[cuenta]` detail page shows linked gastos (replaces "Próximamente" placeholder for the gastos dimension).
- **`api-security`**: extends the role matrix with the new ADMIN-only `/api/v1/gastos*` and `/api/v1/ctacte/:cuenta/gastos-links` namespaces.

## Approach

**Backend (Fastify + Drizzle + Postgres).** New mapping table `tesoreria.gastos_ctacte_mapping` (id, `gasto_id` FK→gastos, `ctacte_id` FK→ctacte, `monto_cubierto numeric(14,2)`, `motivo` enum `manual|heuristic-pending|auto`, `anulado boolean`, `created_by` FK→operators, `created_at`) with a PARTIAL UNIQUE INDEX `(gasto_id, ctacte_id) WHERE anulado = false` (allows re-linking after anular). Sibling view `tesoreria.gastos_with_ctacte_candidates` does a `LATERAL` join on `fecha ± 3 days AND debe::numeric = importe::numeric` (LIMIT 1) and is read-only — the operator must confirm before any link is persisted. Hard DELETE on a link removes the row; soft delete sets `anulado=true` + `anulado_at`. Both emit an `audit_events` row with action `GASTOS_CTACTE_LINK_*`.

**Frontend.** `/admin/gastos` paginates over `GET /api/v1/gastos` with filters (cuenta_principal, fecha range, anulado). `/admin/gastos/[id]` shows gasto detail + linked ctacte movements + "Add link" dialog (manual + promote-from-candidates) + per-link "Anular / Eliminar" buttons. `/ctacte/[cuenta]` fetches `GET /api/v1/ctacte/:cuenta/gastos-links` and renders a "Gastos asociados" panel below `MovementList`. All ADMIN-only pages route under `/(authed)/admin/gastos/`.

**Authz.** All 5 NEW routes gated `requireRole('ADMIN')` (consistent with `/admin/scheduler`). Non-ADMIN → 401. CONSULTA gets read-only access through existing `tesoreria.ctacte` endpoints only.

**Audit + observability.** Every mutation (`POST/DELETE/PATCH /api/v1/gastos-ctacte-links*`, `PATCH /api/v1/gastos/:id/anular`) calls `emitAudit` with operator id + link payload + motivo. Heuristic candidates are NEVER persisted automatically — `motivo='heuristic-pending'` is the contract.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/db/src/schema/tesoreria.ts` | Modified | Add `gastosCtacteMapping` table Drizzle def + view |
| `packages/db/drizzle/0019_gastos_ctacte_mapping.sql` | New | Migration: mapping table + partial UNIQUE idx + heuristic view |
| `packages/db/drizzle/meta/0019_snapshot.json` | New | drizzle-kit regenerated |
| `apps/api/src/modules/gastos/{repository,service}.ts` | New | Gastos + mapping CRUD |
| `apps/api/src/routes/admin/gastos.ts` | New | 6 gastos endpoints (ADMIN) |
| `apps/api/src/routes/admin/gastos-ctacte.ts` | New | 5 mapping endpoints (ADMIN) |
| `apps/api/src/server.ts` | Modified | Register both plugins |
| `apps/api/src/container.ts` | Modified | Wire gastos module |
| `apps/web/src/lib/api/gastos.ts` + `gastos-ctacte.ts` | New | Typed fetch wrappers (was missing) |
| `apps/web/src/app/(authed)/admin/gastos/page.tsx` + `[id]/page.tsx` | New | List + detail |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` | Modified | Adds linked-gastos panel |
| `apps/web/src/components/layout/Sidebar.tsx` | Modified | Adds Tesorería > Gastos link |
| `openspec/specs/deployment-devops/spec.md` | Modified (delta) | Note that `tesoreria.gastos` is no longer the flat-ledger-only surface (additive per B1b LESSON #1) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UNIQUE on `(gasto_id, ctacte_id)` blocks re-link after `anular` | Med | PARTIAL UNIQUE INDEX `WHERE anulado = false` so anular'd rows don't block new links |
| Heuristic false positives (same `importe` on same `fecha`) | Med | `motivo='heuristic-pending'` only — operator MUST confirm; never auto-persist |
| 16,383 ctacte × 2,114 gastos cross-product is slow | Med | LATERAL subquery + index `ctacte(fecha, debe) WHERE anulado=false` (added in 0019); LIMIT 1 |
| Two stacked sub-PRs drift out of sync during review | Low | `n16a-backend` merges first; `n16b-web` rebase+squash; each ships independently with fallback to "Próximamente" |
| Sidebar visual hierarchy breaks | Low | Place under existing Admin group; match existing indentation/spacing tokens |
| 700 LoC overshoots 400-line budget | Med | Confirmed split: `n16a` (400) + `n16b` (300) — each reviewable independently per Slice 8 `8a.x→8b.x→8c.x` precedent |
| `cuenta_principal` FK to anything (the brief's assumption) — VERIFIED ABSENT | n/a | Exploration §1.2 + §6.3: namespaces DO NOT intersect; we do NOT add this FK |

## Rollback Plan

1. `n16a-backend` revert: `psql -f packages/db/drizzle/0019_drop_gastos_ctacte_mapping.sql` (DROP TABLE + DROP VIEW) → `git revert <merge-sha>` removes module + routes + tests.
2. `n16b-web` revert: `git revert <merge-sha>` → Sidebar entry gone, `/admin/gastos*` pages 404, `/ctacte/[cuenta]` "Gastos asociados" panel renders nothing (no fetch). Existing functionality unaffected.
3. Both revert paths preserve live data: `tesoreria.gastos` and `tesoreria.ctacte` are untouched by N16.
4. Run `scripts/verify-slice.sh` post-revert to confirm Slice 8 invariants still pass.

## Dependencies

- `@athlos/audit` `emitAudit` (already in use by `/admin/scheduler`)
- `@athlos/auth` `requireRole('ADMIN')` (already wired in `apps/api/src/routes/admin/scheduler.ts:35`)
- `@athlos/db` `tesoreriaSchema` namespace
- Drizzle ORM `pgTable` + `sql` (already in `packages/db/src/schema/tesoreria.ts`)
- `apps/api/src/routes/admin/scheduler.ts` is the reference pattern (route file → module → server.ts registration)

## Success Criteria

- [ ] `0019_gastos_ctacte_mapping.sql` applied cleanly on `192.168.1.102:5432/athlos`; `\d tesoreria.gastos_ctacte_mapping` shows partial UNIQUE idx
- [ ] `GET /api/v1/gastos?cuenta_principal=6003009&fecha_desde=2024-01-01&fecha_hasta=2024-12-31&page=1` returns paginated list (200 OK for ADMIN, 401 for non-ADMIN)
- [ ] `POST /api/v1/gastos/:id/ctacte-links` with body `{ctacte_id, monto_cubierto: "5000.00", motivo: "manual"}` returns 201 + emits audit row
- [ ] `DELETE /api/v1/gastos-ctacte-links/:linkId` removes the row (hard delete)
- [ ] `PATCH /api/v1/gastos-ctacte-links/:linkId/anular` sets `anulado=true`; subsequent `POST` to same `(gasto_id, ctacte_id)` succeeds (partial UNIQUE allows it)
- [ ] `GET /api/v1/admin/gastos-ctacte-candidates?gasto_id=<id>` returns ≥1 candidate when a ctacte row exists in `fecha ± 3 days AND debe=importe`; 0 candidates otherwise
- [ ] `/ctacte/[cuenta]` page renders the "Gastos asociados" panel with the linked rows (no "Próximamente")
- [ ] `/admin/gastos` sidebar entry visible to ADMIN; hidden from OPERADOR/TESORERO/CONSULTA
- [ ] All 5 NEW routes return 401 for non-ADMIN (verified by `requireRole('ADMIN')` test cases)
- [ ] Every mutation emits an `audit_events` row with `action` matching `GASTOS_CTACTE_LINK_*` (verified in `audit.test.ts`)
- [ ] Strict TDD: ≥5 vitest cases per backend file + ≥3 RTL tests per web component (RED → GREEN → TRIANGULATE)
- [ ] `scripts/verify-slice.sh` exits 0 post-merge; `docs/runbook.md` Known Limitations table removes the N16 entry

---

## Artifact Summary

- **OpenSpec path**: `openspec/changes/athlos-n16-gastos-ctacte-fk/proposal.md` (this file)
- **Engram topic_key**: `sdd/athlos-n16-gastos-ctacte-fk/propose`
- **Type**: architecture
- **Scope**: project
- **Mode**: both (Engram + OpenSpec)
- **Capture prompt**: false (SDD artifact per protocol)