# Tasks: athlos-n16-gastos-ctacte-fk — Gastos ↔ Ctacte Mapping

## Review Workload Forecast

| Field | Value |
|-------|-------|
| n16a-backend raw LoC | ~400 |
| n16a-backend effective (excl. tests+migrations) | ~260 |
| n16b-web raw LoC | ~300 |
| n16b-web effective (excl. tests) | ~220 |
| 400-line budget risk | Low (each sub-PR ≤400 raw, ≤260 effective) |
| Chained PRs recommended | Yes — 2 stacked sub-PRs (n16a → n16b → main) |
| Delivery strategy | ask-always (orchestrator asks per LESSON 8 split) |
| Suggested split | n16a-backend → n16b-web |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Sub-PR | Base branch | Notes |
|------|------|--------|------------|-------|
| 1 | DB migration + heuristic view + gastos CRUD + link CRUD | n16a-backend | main | Schema, routes, tests, audit |
| 2 | Web API wrappers + admin pages + ctacte panel + Sidebar | n16b-web | main | Depends on n16a merged first |

---

## Dependency Graph

```
TASK-001 (migration SQL)
  └─ TASK-002 (drizzle snapshot)
  └─ TASK-003 (schema def)
        └─ TASK-004 (heuristic function)
              ├─ TASK-005 (gastos CRUD routes + tests)
              └─ TASK-006 (gastos-ctacte routes + tests)
                    ├─ TASK-007 (server.ts wiring)
                    └─ TASK-008 (audit helper)
                          ▼
                   [n16a-backend PR]

TASK-009 (web gastos API wrapper + tests)
  └─ TASK-010 (web gastos-ctacte API wrapper + tests)
        ├─ TASK-011 (admin/gastos list page + tests)
        └─ TASK-012 (admin/gastos/[id] detail page + tests)
              ├─ TASK-013 (ctacte/[cuenta] panel mod)
              └─ TASK-014 (Sidebar mod)
                    ▼
             [n16b-web PR — depends on n16a]
```

---

## Sub-PR n16a-backend

**Commit shape**: `feat(n16a): add gastos-ctacte mapping table, heuristic view, and ADMIN CRUD routes`
**Base**: `main` | **Merge order**: first

---

### TASK-001 [TDD-RED] — Create migration 0019

**Sub-PR**: n16a-backend
**File(s)**: `packages/db/drizzle/0019_gastos_ctacte_mapping.sql`
**Dependencies**: none
**LoC estimate**: ~55

**Action**:
1. Write `CREATE TABLE tesoreria.gastos_ctacte_mapping` (id, gasto_id FK CASCADE, ctacte_id FK CASCADE, monto_cubierto numeric(14,2) CHECK >0, motivo text CHECK IN, anulado bool DEFAULT false, anulado_at, anulado_motivo, created_by FK SET NULL, created_at)
2. Write `CREATE UNIQUE INDEX gastos_ctacte_mapping_active_uniq ON (gasto_id, ctacte_id) WHERE anulado = false`
3. Write secondary indexes on gasto_id and ctacte_id
4. Write `CREATE OR REPLACE VIEW tesoreria.gastos_with_ctacte_candidates` using LEFT JOIN LATERAL (fecha ±3 days AND debe::numeric = importe::numeric, LIMIT 1)
5. Write `CREATE INDEX ctacte_fecha_debe_anulado_idx ON ctacte(fecha, debe) WHERE anulado = false`
6. Write `ALTER TABLE tesoreria.gastos ADD COLUMN anulado bool DEFAULT false, ADD COLUMN anulado_at timestamptz, ADD COLUMN anulado_motivo text`
7. All statements use `IF NOT EXISTS` / `IF NOT EXISTS` for idempotency

**Verification**:
- `psql -f 0019_gastos_ctacte_mapping.sql` exits 0 on a dev DB
- `\d tesoreria.gastos_ctacte_mapping` shows partial UNIQUE index
- `\d tesoreria.gastos` shows 3 new columns

**Rollback**: `psql -c "DROP TABLE IF EXISTS tesoreria.gastos_ctacte_mapping; DROP VIEW IF EXISTS tesoreria.gastos_with_ctacte_candidates; ALTER TABLE tesoreria.gastos DROP COLUMN IF EXISTS anulado, anulado_at, anulado_motivo;"`

---

### TASK-002 [TDD-RED] — Generate drizzle snapshot

**Sub-PR**: n16a-backend
**File(s)**: `packages/db/drizzle/meta/0019_snapshot.json`
**Dependencies**: TASK-001
**LoC estimate**: ~30

**Action**:
1. Apply 0019 migration to dev DB
2. Run `pnpm --filter @athlos/db generate`
3. Commit the regenerated `meta/0019_snapshot.json`

**Verification**:
- `0019_snapshot.json` contains `gastos_ctacte_mapping` table entry
- `0019_snapshot.json` reflects anulado columns on `gastos`

**Rollback**: `git checkout HEAD~1 -- packages/db/drizzle/meta/0019_snapshot.json`

---

### TASK-003 [TDD-RED] — Define Drizzle schema for mapping table

**Sub-PR**: n16a-backend
**File(s)**: `packages/db/src/schema/tesoreria.ts`
**Dependencies**: TASK-002
**LoC estimate**: ~40

**Action**:
1. Append `gastosCtacteMapping` table definition to `tesoreria.ts` (id, gastoId, ctacteId, montoCubierto, motivo, anulado, anuladoAt, anuladoMotivo, createdBy, createdAt)
2. Define `motivo` as a const enum or string literal union
3. Append partial unique index definition using `index().where()` per drizzle partial index pattern
4. Verify `gastos` table in schema has anulado columns added

**Verification**:
- `pnpm --filter @athlos/db build` exits 0
- Generated SQL matches 0019 migration (column names, types, constraints)

**Rollback**: Revert additions to `tesoreria.ts`

---

### TASK-004 [TDD-RED] — Implement heuristic candidate function

**Sub-PR**: n16a-backend
**File(s)**: `apps/api/src/modules/gastos/repository.ts`
**Dependencies**: TASK-003
**LoC estimate**: ~70

**Action**:
1. Create `apps/api/src/modules/gastos/` directory
2. Write `repository.ts` with Drizzle queries: `findManyGastos(filters)`, `findGastoById(id)`, `createGasto(data)`, `updateGasto(id, data)`, `deleteGasto(id)`, `anularGasto(id, motivo)`
3. Write heuristic query against `gastos_with_ctacte_candidates` view: `findCandidates(gastoId, limit=50)` — read-only, never inserts
4. Write link queries: `findLinksByGasto(gastoId, active?)`, `findLinksByCtacteCuenta(cuenta)`, `createLink(data)`, `deleteLink(id)`, `anularLink(id, motivo)`
5. All functions use the existing `Container` db instance

**Verification**:
- `pnpm --filter @athlos/api test -- --run apps/api/src/modules/gastos/repository.test.ts` passes
- Mock data: insert gasto + ctacte, verify `findCandidates` returns matching row

**Rollback**: `rm -rf apps/api/src/modules/gastos/`

---

### TASK-005 [TDD-RED] — Gastos CRUD route handler

**Sub-PR**: n16a-backend
**File(s)**: `apps/api/src/routes/admin/gastos.ts` + `.test.ts`
**Dependencies**: TASK-004
**LoC estimate**: ~110

**Action**:
1. Create `gastos.ts` with 6 routes: GET `/`, GET `/:id`, POST `/`, PATCH `/:id`, DELETE `/:id`, PATCH `/:id/anular`
2. Each route uses `preHandler: requireRole('ADMIN')`
3. List route: accept `page, limit, cuenta_principal, fecha_desde, fecha_hasta, anulado` query params; return paginated `{data, total, page, limit, has_more}` with `link_count` per row
4. Detail route: return gasto + `links[]` joined from mapping table
5. Create route: validate 5-tuple uniqueness, call `createGasto`, emit `GASTO_CREATE` audit
6. Update route: validate 5-tuple still holds after update
7. Delete route: ON DELETE CASCADE removes links; emit `GASTO_DELETE`
8. Anular route: set `anulado=true`, emit `GASTO_ANULAR`
9. Write 6+ vitest cases covering happy paths + 403 (non-ADMIN) + 404 + validation errors

**Verification**:
- `pnpm --filter @athlos/api test -- --run apps/api/src/routes/admin/gastos.test.ts` all pass
- Manual: `curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:4001/api/v1/gastos` returns 200

**Rollback**: `rm apps/api/src/routes/admin/gastos.ts apps/api/src/routes/admin/gastos.test.ts`

---

### TASK-006 [TDD-RED] — Gastos-Ctacte link route handler

**Sub-PR**: n16a-backend
**File(s)**: `apps/api/src/routes/admin/gastos-ctacte.ts` + `.test.ts`
**Dependencies**: TASK-004
**LoC estimate**: ~95

**Action**:
1. Create `gastos-ctacte.ts` with 6 routes: GET `/gastos/:id/ctacte-links`, POST `/gastos/:id/ctacte-links`, DELETE `/gastos-ctacte-links/:id`, PATCH `/gastos-ctacte-links/:id/anular`, GET `/ctacte/:cuenta/gastos-links`, GET `/admin/gastos-ctacte-candidates`
2. Each route uses `preHandler: requireRole('ADMIN')`
3. POST: validate `monto_cubierto <= gasto.importe`, check active duplicate → 409, emit `GASTOS_CTACTE_LINK_CREATE`
4. DELETE: hard remove + emit `GASTOS_CTACTE_LINK_DELETE`
5. PATCH /anular: soft delete + emit `GASTOS_CTACTE_LINK_ANULAR`
6. GET candidates: read from heuristic view, return max 50, tag `motivo: 'heuristic-pending'`
7. Write 6+ vitest cases covering: link create, duplicate 409, re-link after anular (201), 403 non-ADMIN, monto-exceeds-gasto 400

**Verification**:
- `pnpm --filter @athlos/api test -- --run apps/api/src/routes/admin/gastos-ctacte.test.ts` all pass
- Manual: POST a link, DELETE it, GET candidates for a gasto

**Rollback**: `rm apps/api/src/routes/admin/gastos-ctacte.ts apps/api/src/routes/admin/gastos-ctacte.test.ts`

---

### TASK-007 [TDD-RED] — Register routes in server + container wiring

**Sub-PR**: n16a-backend
**File(s)**: `apps/api/src/server.ts`, `apps/api/src/container.ts`
**Dependencies**: TASK-005, TASK-006
**LoC estimate**: ~10

**Action**:
1. Import `gastosAdminRoutes` and `gastosCtacteAdminRoutes` in `server.ts`
2. Add `await app.register(gastosAdminRoutes)` and `await app.register(gastosCtacteAdminRoutes)`
3. In `container.ts`: import `GastosRepository` and add to container exports (repo instance)
4. Verify existing `requireRole` and `emitAudit` imports are shared (no new packages needed)

**Verification**:
- `pnpm --filter @athlos/api build` exits 0
- `curl http://localhost:4001/api/v1/gastos` returns 401 without token, 200 with ADMIN token

**Rollback**: Revert `server.ts` and `container.ts` additions

---

### TASK-008 [TDD-RED] — Audit emission helper for mapping actions

**Sub-PR**: n16a-backend
**File(s)**: `apps/api/src/lib/audit.ts` (if not exists; else extend)
**Dependencies**: TASK-005, TASK-006
**LoC estimate**: ~25

**Action**:
1. Check if `apps/api/src/lib/audit.ts` exists; if not, create it exporting `emitGastosAudit(container, {...})`
2. If it exists, extend the existing `emitAudit` to handle new action strings: `GASTO_CREATE`, `GASTO_UPDATE`, `GASTO_DELETE`, `GASTO_ANULAR`, `GASTOS_CTACTE_LINK_CREATE`, `GASTOS_CTACTE_LINK_DELETE`, `GASTOS_CTACTE_LINK_ANULAR`
3. Update call sites in `gastos.ts` and `gastos-ctacte.ts` to use the helper with correct action + entity metadata
4. Ensure PERMISSION_DENIED audit rows are emitted by the existing auth middleware for 403s on new routes

**Verification**:
- Non-ADMIN request to any new route returns 403 AND inserts `audit_events` row with `action=PERMISSION_DENIED`
- Manual: `psql -c "SELECT action FROM audit_events ORDER BY created_at DESC LIMIT 5"` after test run

**Rollback**: Revert audit call-site changes; delete file if created and nothing else uses it

---

## Sub-PR n16b-web

**Commit shape**: `feat(n16b): add gastos list/detail UI, ctacte panel, and sidebar link`
**Base**: `main` | **Merge order**: second (after n16a-backend)

---

### TASK-009 [TDD-RED] — Web gastos API fetch wrapper

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/lib/api/gastos.ts` + `.test.ts`
**Dependencies**: TASK-007 (n16a deployed)
**LoC estimate**: ~50

**Action**:
1. Create `apps/web/src/lib/api/gastos.ts` with typed functions: `getGastos(params)`, `getGastoById(id)`, `createGasto(data)`, `updateGasto(id, data)`, `deleteGasto(id)`, `anularGasto(id, motivo)`
2. Use existing `apiFetch` from `@/lib/api`; snake_case DTOs, camelCase returns
3. Export Zod schemas for each DTO
4. Write 3+ vitest test cases: mock fetch, verify correct URL + method + body per function

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/lib/api/gastos.test.ts` passes
- `pnpm --filter @athlos/web build` exits 0

**Rollback**: `rm apps/web/src/lib/api/gastos.ts apps/web/src/lib/api/gastos.test.ts`

---

### TASK-010 [TDD-RED] — Web gastos-ctacte API fetch wrapper

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/lib/api/gastos-ctacte.ts` + `.test.ts`
**Dependencies**: TASK-007 (n16a deployed)
**LoC estimate**: ~40

**Action**:
1. Create `gastos-ctacte.ts` with typed functions: `getGastoLinks(gastoId, active?)`, `createLink(gastoId, data)`, `deleteLink(linkId)`, `anularLink(linkId, motivo)`, `getCtacteGastosLinks(cuenta)`, `getCandidates(gastoId)`
2. `getCandidates` returns `CandidateDTO[]` with `motivo: 'heuristic-pending'`
3. Write 3+ vitest test cases

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/lib/api/gastos-ctacte.test.ts` passes

**Rollback**: `rm apps/web/src/lib/api/gastos-ctacte.ts apps/web/src/lib/api/gastos-ctacte.test.ts`

---

### TASK-011 [TDD-RED] — Admin gastos list page

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/app/(authed)/admin/gastos/page.tsx` + `.test.tsx`
**Dependencies**: TASK-009
**LoC estimate**: ~80

**Action**:
1. Create `page.tsx` with `useQuery(getGastos, ...)` + filters: cuenta_principal text input, date-range picker (fecha_desde, fecha_hasta), anulado toggle
2. Render `<table>` with columns: cuenta_principal, fecha, concepto, importe, link_count, anulado badge
3. Per-row link to `/admin/gastos/[id]`; pagination controls
4. ADMIN-only page guard (redirect to `/` if not ADMIN role)
5. Write 3+ RTL tests: renders table, filter triggers refetch, non-ADMIN redirect

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/app/(authed)/admin/gastos/page.test.tsx` passes
- Manual: navigate to `/admin/gastos` as ADMIN → table renders

**Rollback**: `rm apps/web/src/app/(authed)/admin/gastos/`

---

### TASK-012 [TDD-RED] — Admin gasto detail page with link management

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/app/(authed)/admin/gastos/[id]/page.tsx` + `.test.tsx`
**Dependencies**: TASK-010
**LoC estimate**: ~70

**Action**:
1. Create `[id]/page.tsx` with gasto header (cuenta_principal, fecha, importe, concepto)
2. Render links table: ctacte cuenta, monto_cubierto, motivo, anulado badge, per-link Eliminar/Anular buttons
3. "Agregar enlace" button → calls `createLink`
4. "Candidatos heurísticos" section: call `getCandidates`, render with "Confirmar" (→ POST link) and "Descartar" buttons
5. ADMIN-only guard; loading + error states
6. Write 3+ RTL tests: renders gasto header, renders links table, confirmar candidate calls createLink

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/app/(authed)/admin/gastos/[id]/page.test.tsx` passes

**Rollback**: `rm apps/web/src/app/(authed)/admin/gastos/[id]/`

---

### TASK-013 [TDD-RED] — ctacte detail page "Gastos vinculados" panel

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx`
**Dependencies**: TASK-010
**LoC estimate**: ~30

**Action**:
1. In `ctacte/[cuenta]/page.tsx`: after the `MovementList` section, add "Gastos vinculados" panel
2. Panel calls `getCtacteGastosLinks(cuenta)` on mount
3. Render table: gasto concepto, importe, fecha, motivo; omit "Próximamente" entirely
4. Zero-state: render nothing (no empty-state message needed per spec zero-state clause)

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` passes (update existing test)
- Manual: visit `/ctacte/8198` → panel appears below movements

**Rollback**: Revert panel addition; re-add "Próximamente" placeholder if needed

---

### TASK-014 [TDD-RED] — Sidebar "Tesorería > Gastos" link

**Sub-PR**: n16b-web
**File(s)**: `apps/web/src/components/layout/Sidebar.tsx`
**Dependencies**: TASK-011
**LoC estimate**: ~5

**Action**:
1. In `Sidebar.tsx`: add `{href: '/admin/gastos', label: 'Gastos', roles: ['ADMIN']}` to the `ITEMS` array under the Admin group
2. Follow existing item structure and styling from adjacent entries
3. Role check uses `useAuth().operator?.role`

**Verification**:
- `pnpm --filter @athlos/web test -- --run apps/web/src/components/layout/Sidebar.test.tsx` passes (update existing)
- Manual: ADMIN sees "Gastos" under Admin; OPERADOR does not

**Rollback**: Revert the single item addition

---

## Acceptance Criteria

### n16a-backend
- [ ] `0019_gastos_ctacte_mapping.sql` applies cleanly; partial UNIQUE index visible in `\d`
- [ ] `pnpm --filter @athlos/db generate` produces valid `0019_snapshot.json`
- [ ] `GET /api/v1/gastos` returns paginated list (200 ADMIN, 403 non-ADMIN)
- [ ] `POST /api/v1/gastos/:id/ctacte-links` creates link + emits audit row
- [ ] `DELETE /api/v1/gastos-ctacte-links/:id` removes row
- [ ] `PATCH /api/v1/gastos-ctacte-links/:id/anular` soft-deletes + emits audit
- [ ] Re-link after anular returns 201 (partial UNIQUE allows it)
- [ ] `GET /api/v1/admin/gastos-ctacte-candidates?gasto_id=X` returns candidates (never auto-persists)
- [ ] All 12 routes return 403 for non-ADMIN
- [ ] 403s emit PERMISSION_DENIED audit rows
- [ ] ≥5 vitest per backend file, all pass

### n16b-web
- [ ] `lib/api/gastos.ts` and `lib/api/gastos-ctacte.ts` typed and importable
- [ ] `/admin/gastos` renders paginated table with filters; ADMIN-only
- [ ] `/admin/gastos/[id]` shows gasto + links table + candidates section
- [ ] `/ctacte/[cuenta]` renders "Gastos vinculados" panel (no "Próximamente")
- [ ] Sidebar shows "Gastos" only for ADMIN
- [ ] ≥3 RTL tests per page, all pass
