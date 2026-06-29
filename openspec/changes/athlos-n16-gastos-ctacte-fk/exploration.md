# Exploration: athlos-n16-gastos-ctacte-fk

**Change**: `athlos-n16-gastos-ctacte-fk`
**Phase**: explore
**Mode**: both (Engram + OpenSpec)
**Date**: 2026-06-29
**Author**: sdd-explore sub-agent
**Branch target**: TBD (orchestrator decides after propose)
**Status**: written

---

## 1. State of the World

### 1.1 Backend state (verified live 2026-06-29 against `192.168.1.102:5432/athlos`)

| Item | Value | Source |
|------|-------|--------|
| API version | v0.5.10 (deployed on `werchow-server:4001`) | session preflight |
| Master tables populated | 8 (socios, escuela, disciplinas, locacion, caja_movimiento, gastos, ctacte, ctacte1) | spec line 108 |
| `tesoreria.gastos` row count | **2,114** rows | `SELECT count(*) FROM tesoreria.gastos` |
| `tesoreria.gastos` distinct `cuenta_principal` | **165** values | `SELECT count(DISTINCT cuenta_principal)` |
| `tesoreria.gastos` with `socio_id IS NOT NULL` | **0 / 2,114** | `SELECT count(*) WHERE socio_id IS NOT NULL` |
| `tesoreria.ctacte` row count (with `cctcuenta`) | **215,595** | `SELECT count(*)` |
| `tesoreria.ctacte` distinct `cctcuenta` | **8,520** values | `SELECT count(DISTINCT cctcuenta)` |
| **Live join match `gastos.cuenta_principal = ctacte.cctcuenta`** | **0 rows** (0 distinct) | `SELECT count(*) FROM gastos g JOIN ctacte c ON g.cuenta_principal = c.cctcuenta` |
| Live join `gastos.cuenta_principal = socios.numero_socio` | **0 rows** | verified live |
| `gastos.cuenta_principal` length | All **7 digits** (`1101024`, `6003009`, `2020104`, `6001018`) | sample inspected |
| `ctacte.cctcuenta` length | **2–7 digits** (`54`, `5343`, `8198`, `6158`) | sample inspected |
| FK constraints on `tesoreria.gastos` | **NONE** (verified `\d tesoreria.gastos` → 5 indexes, 0 FKs) | pg_constraint query |
| FK constraints on `tesoreria.ctacte` | Only `ctacte_socio_id_fk → socios.socios(id) ON DELETE RESTRICT` | pg_constraint query |

### 1.2 Identifier-namespace mismatch (the core finding)

`gastos.cuenta_principal` (alias `GASCTAPRIN` in the legacy VFP) is **NOT a socio carnet**. It is the club's accounting-plan code — the chart of accounts. Examples:

| Source | Namespace | Example values | What it identifies |
|--------|-----------|----------------|-------------------|
| `gastos.cuenta_principal` | accounting plan | `1101024` (Caja), `6003009` (Sueldos), `2020104` (Proveedores) | the GL account the expense hit |
| `ctacte.cctcuenta` | socio carnet | `54`, `5343`, `8198`, `6158` | the socio (member) the ledger entry is for |
| `socios.numero_socio` | socio carnet | `54`, `5343`, `8198`, `6158` | the socio (member) |

**Confirmed live**: 0 of 2,114 `gastos` rows have `socio_id`. 0 of 165 distinct `cuenta_principal` values resolve to a socio carnet. The two namespaces do not intersect in the live data.

This is exactly the scope correction **#C7** documented in E1b2b (commit `36ac630`, 2026-06-25):

> "gastos has NO ctacte FK — verified live: 0 of 165 distinct GASCTAPRIN match any tesoreria.ctacte.cctcuenta; GASCTAPRIN is accounting-plan code, NOT socio carnet"

And correction **#C8**:

> "gastos has NO socio_id FK in v1 — no GASNUMSOC / SOCNUMERO / SOCCARNET field in the 11-field payload"

### 1.3 Frontend state — NOT what the brief assumes

The brief states:
> "PR 8b.2 already does this" — referring to showing gasto on the ctaCorriente detail page
> "Link gastos to ctacte via a lookup so a click on the gasto navigates to the ctacte account detail"

**This claim is INCORRECT.** Verified against the actual shipped code in v0.5.18:

- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` (PR 8b.2 detail page, lines 1-226) renders **only `movimientos`** from `getCtacte(cuenta)` and `getMovimientos(cuenta, { page })`. It does NOT fetch or display any `gastos` data. The `MovementList` component (`apps/web/src/components/ledger/MovementList.tsx`) renders ctacte rows only.
- `apps/web/src/components/layout/Sidebar.tsx` (lines 31-37) — the navigation rail — has entries for Dashboard, Socios, Ctacte, Padrones, Admin/Scheduler, Admin/Approvals, Admin/Settings. **No Caja/Gastos sidebar items.** Per the Slice 8 archive report (line 143): "Caja/Gastos sidebar items (not routed in Slice 8)".
- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` line 220 renders the "Próximamente" placeholder for write actions on ctacte, NOT for gastos.
- There is no `lib/api/gastos.ts` wrapper in the web app (verified by grep). No `getGastos`, `getGasto`, `createGasto`, etc.

The ctaCorriente detail page is **read-only ctacte movements + socio card**. It has zero awareness of `tesoreria.gastos`.

### 1.4 API surface — NOT what the brief assumes

The brief states these endpoints exist:
> `GET /api/v1/gastos` (list) · `GET /api/v1/gastos/:id` (detail) · `POST /api/v1/gastos` (create) · `PATCH /api/v1/gastos/:id` (update) · `DELETE /api/v1/gastos/:id` (delete)

**NONE of these exist.** Verified by `grep -l gastos|Gastos apps/api/src/routes` → only 3 hits, all in domain enum literals:

- `apps/api/src/routes/freshness.ts:25` — `'gastos'` listed in the `domainSchema` zod enum for `GET /api/v1/freshness?domain=gastos`
- `apps/api/src/routes/import.ts:36` — `'gastos'` listed in the `triggerBodySchema` zod enum for `POST /api/v1/import/trigger` (ADMIN-only import trigger)
- `apps/api/src/routes/promote.ts:34` — `'gastos'` listed in the `triggerBodySchema` zod enum for `POST /api/v1/promote/trigger` (ADMIN-only promotion trigger)

There is no `apps/api/src/routes/gastos.ts`. There is no `apps/api/src/modules/gastos/` directory. There is no service/repository layer for gastos. The only reads of `tesoreria.gastos` are:
- `packages/promotion/src/transforms/gastos.ts` (64 lines, called by the promotion job, writes to `tesoreria.gastos`)
- The freshness cache table (counts `tesoreria.gastos` row count for the dashboard Master Counts widget per `web-frontend/spec.md` line 108)

The Slice 8 archive report (`openspec/changes/archive/2026-06-29-athlos-ui/athlos-ui/exploration.md` line 311) explicitly flagged this gap:

> "No `caja` or `gastos` specific read endpoints | No way to display caja/gastos transactions in the UI | Caja/gastos data lives in the scheduler + audit; show via `GET /api/v1/admin/jobs/runs?job=scheduled-import` and the audit log only. Full caja/gastos ledger UI is a Phase 2 slice."

The proposal (line 73) said: "7 backend gaps (approval exec, file storage, caja/gastos, etc.) — UI shows 'Próximamente' badges; backend work = Slice 9".

---

## 2. Affected Areas

| Path | Why affected |
|------|--------------|
| `packages/db/src/schema/tesoreria.ts` (lines 164-197) | Defines `gastos` table; `socioId` column exists as nullable UUID with NO FK constraint (deferred to N16 per scope correction #C8). |
| `packages/db/drizzle/0015_gastos.sql` | Hand-written migration (E1b2b). `socio_id uuid` column is in the CREATE TABLE but has no FK constraint. |
| `packages/db/drizzle/0019_*.sql` (NOT YET WRITTEN) | N16 migration must add here. New lookup table OR FK constraint. |
| `packages/promotion/src/transforms/gastos.ts` (line 60) | `socioId: null` is hard-coded in the transform — if N16 backfills existing 2,114 rows, this transform's behavior for re-runs must be considered. |
| `openspec/specs/deployment-devops/spec.md` (lines 280-315) | The canonical `tesoreria.gastos master table` requirement explicitly says NO socio_id FK constraint and NO ctacte FK constraint in v1. N16 changes that. Additive-only atomic sync per B1b LESSON #1. |
| `openspec/specs/web-frontend/spec.md` (line 108) | "Master Counts" widget counts 8 tables; not directly affected unless we add a gastos-with-link counts metric. |
| `apps/api/src/routes/freshness.ts` | No change needed (gastos already listed). |
| `apps/api/src/routes/import.ts` | No change needed. |
| `apps/api/src/routes/promote.ts` | No change needed. |
| `apps/api/src/routes/ctacte.ts` | Not affected unless N16 extends the cuenta-corriente response to include linked gastos. |
| `apps/web/src/app/(authed)/ctacte/[cuenta]/page.tsx` | Could be extended to show a "Gastos asociados" panel if N16 establishes a join path (MVP depends on chosen approach). |
| `apps/web/src/components/layout/Sidebar.tsx` | NO Caja/Gastos items today. Could add `/gastos` once a list endpoint exists. |
| `docs/runbook.md` | Known Limitations table lists N16 as deferred. N16 closure removes the entry. |

---

## 3. Operator Personas and Daily Workflows

### 3.1 Primary personas

| Persona | Role | Daily scope | Needs from gasto-ctacte link |
|---------|------|-------------|-------------------------------|
| **TESORERO** | accountant | Reconciling bank statements vs ctacte, reviewing weekly expense ledger, answering socio "why is there a charge on my cuenta?" questions | Wants to see gasto entries that hit a specific socio's cuenta-corriente. Wants to drill from a ctacte movement to the underlying expense (or vice-versa). Wants to "anular" expenses that should not have been charged. |
| **ADMIN (gerencia)** | manager | Quarterly reports to the board, year-end closing, audit response | Wants an "expenses per socio" report (gastos per socio cuenta). Wants to confirm gasto entries are reflected in socio balances. |
| **OPERADOR (front desk)** | receptionist | Daily socio inquiries ("show me my cuenta"), handling payments | Wants to show a socio their gastos when they ask "what is this charge?". Needs read-only view. |
| **CONSULTA (auditor)** | auditor | Read-only review, external compliance | Wants cross-reference views between gastos and ctacte for auditing purposes. |

### 3.2 Current workflows (pre-N16)

Today, when a socio calls and asks "what is this $5,000 charge dated 2024-03-15 on my cuenta-corriente?", the operator (OPERADOR or TESORERO) must:

1. Open the operator console → `/ctacte/[cuenta]` → see the ctacte movement (debe $5,000, cargo from service X).
2. **Open `psql`** (or `legacy-test/db-access.sh`) and run:
   ```sql
   SELECT * FROM tesoreria.gastos WHERE fecha = '2024-03-15' AND importe = '5000.00' AND cuenta_principal = '<cctcuenta>';
   ```
   → 0 rows. (The gasto is in the accounting plan, not socio carnet.)
3. The operator then has to manually look up the gasto by the accounting code (e.g., `6003009` = Sueldos) to find which expense generated the cargo.
4. Two separate sources of truth, no UI cross-link.

**This is the actual problem N16 must solve.** It is NOT "link gastos to ctacte" as if it were a foreign-key relationship — it is "give operators a way to correlate gasto entries with ctacte entries that share the same date, amount, or concept".

### 3.3 Decisions operators need to make

| Decision | Data needed | N16 deliverable |
|----------|-------------|-----------------|
| "What gastos should be charged to socio X?" | socio X's cuenta-corriente + matching gastos | Correlation view (date+amount match) |
| "Anular this expense" | gasto detail + audit trail | `anular` action that ALSO reverses any linked ctacte movement |
| "Why does socio X have a $5,000 charge?" | gasto underlying the ctacte movement | Cross-link from ctacte movement → gasto |
| "What is our total gasto on accounting code `6003009` (Sueldos) this month?" | gastos filtered by cuenta_principal + date range | Filter UI on `/gastos` (independent of ctacte) |

---

## 4. Feature Inventory

| # | Feature | Endpoints consumed | Auth | UX | MVP / Nice / Out |
|---|---------|--------------------|------|-----|------------------|
| F1 | **Gastos list page** — paginated table of all 2,114 gastos with filters (fecha, cuenta_principal, tipo, importe range) | NEW `GET /api/v1/gastos?cuenta_principal=&fecha_desde=&fecha_hasta=&page=&limit=` | `requireAuth()` (any operator) | `/gastos` route, Sidebar nav item, table + filters | **MVP** |
| F2 | **Gasto detail page** — single gasto with concept + importe + iva + linked ctacte correlation panel | NEW `GET /api/v1/gastos/:id` | `requireAuth()` | `/gastos/[id]` route | **MVP** |
| F3 | **Cross-link from ctacte movement to gasto** — "Ver gasto" button on MovementList row that finds the matching gasto (if any) | NEW correlation logic (date+amount match) | `requireAuth()` | MovementList row action | **MVP** (high operator value) |
| F4 | **Anular gasto** — soft-delete gasto + reverse linked ctacte movement (if matched) | NEW `DELETE /api/v1/gastos/:id` or `POST /api/v1/gastos/:id/anular` | `requireRole('ADMIN', 'TESORERO')` | Gasto detail "Anular" button + motivo dialog | **MVP** |
| F5 | **Show gastos on ctacte detail page** — a "Gastos asociados" panel below MovementList, listing gastos that match the visible movements | NEW join query | `requireAuth()` | Panel on `/ctacte/[cuenta]` | **Nice** (depends on F3) |
| F6 | **CSV export of gastos** — same pattern as ctacte CSV (PR 8b.2) | NEW `GET /api/v1/gastos/export.csv?...` | `requireAuth()` | "Exportar CSV" button on `/gastos` | **Nice** |
| F7 | **Create gasto** — manual entry of a gasto row via UI | NEW `POST /api/v1/gastos` | `requireRole('ADMIN', 'TESORERO')` | Form on `/gastos/nuevo` | **Out of scope** (N16 = link + view; write UI = future slice) |
| F8 | **Edit gasto** | NEW `PATCH /api/v1/gastos/:id` | `requireRole('ADMIN', 'TESORERO')` | Inline edit on detail | **Out of scope** (same) |
| F9 | **Add socio_id FK constraint** — schema-level backfill of `gastos.socio_id` from ctacte/socio join | Migration backfill + ALTER TABLE ADD CONSTRAINT | ADMIN only (DB migration) | none — back-end only | **Out of scope** (data does not exist; documented in §6 Option B) |
| F10 | **Gastos dashboard widget** — total importe per month, top cuenta_principal codes | NEW `GET /api/v1/gastos/stats?...` | `requireAuth()` | `/dashboard` panel | **Out of scope** (Phase 2) |

---

## 5. Existing Data Model

### 5.1 `tesoreria.gastos` schema (canonical source: `packages/db/src/schema/tesoreria.ts` lines 164-197)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid PK | NOT NULL | `gen_random_uuid()` default |
| `tipo` | integer | NOT NULL | legacy `GASTIPGAST` |
| `tipo_cuenta` | integer | NOT NULL | legacy `GASTIPCTA` — always 0 in current 2,114 rows |
| `cuenta_principal` | **text** | NOT NULL | legacy `GASCTAPRIN` — accounting-plan code, e.g., `1101024` |
| `cuenta_auxiliar` | integer | NULL | legacy `GASCTAAUXI` |
| `secuencia` | integer | NOT NULL DEFAULT 0 | legacy `GASSECUENC` |
| `comprobante` | text | NOT NULL DEFAULT '' | legacy `GASCOMPROB` |
| `fecha` | date | NOT NULL | legacy `GASFECHA` |
| `concepto` | text | NULL | legacy `GASCONCEPT` |
| `importe` | text | NOT NULL DEFAULT '0.00' | NUMERIC(14,2) as text per clubhouse pattern |
| `iva` | text | NOT NULL DEFAULT '0.00' | NUMERIC(14,2) as text |
| `ingreso_bruto` | text | NULL | legacy `GASINGBRUT` |
| **`socio_id`** | **uuid** | **NULL** | **NO FK constraint** (deferred to N16 per #C8); partial index `gastos_socio_id_idx` exists |
| `legacy_id` | text | NULL | uuidv5 over 5-tuple NK |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

| Index | Type | Columns | Notes |
|-------|------|---------|-------|
| `gastos_pkey` | PK btree | `id` | |
| `gastos_5tuple_unique` | UNIQUE btree | `(tipo, cuenta_principal, secuencia, fecha, comprobante)` | 5-tuple NK verified 100% unique |
| `gastos_legacy_id_unique` | UNIQUE btree | `legacy_id` | uuidv5 collision guard |
| `gastos_cuenta_fecha_idx` | btree | `(cuenta_principal, fecha)` | cross-filter |
| `gastos_socio_id_idx` | btree PARTIAL | `socio_id WHERE socio_id IS NOT NULL` | ready for N16 backfill |

### 5.2 `tesoreria.ctacte` schema (canonical source: `packages/db/src/schema/tesoreria.ts` lines 54-89)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid PK | NOT NULL | `gen_random_uuid()` default |
| `socio_id` | uuid FK → `socios.socios(id)` | NOT NULL | ON DELETE RESTRICT — the canonical socio FK |
| `fecha` | date | NOT NULL | |
| `tipo` | enum ctacte_tipo | NOT NULL | DEBITO or CREDITO |
| `concepto` | text | NOT NULL | |
| `debe` | text | NOT NULL DEFAULT '0.00' | NUMERIC(14,2) as text |
| `haber` | text | NOT NULL DEFAULT '0.00' | NUMERIC(14,2) as text |
| `anulado` | boolean | NOT NULL DEFAULT false | soft-delete marker |
| `anulado_at` | timestamptz | NULL | |
| `anulado_motivo` | text | NULL | |
| **`cctcuenta`** | **text** | NULL | **legacy `CCTCUENTA` — socio carnet** (NOT integer; explicit text type, ranges 2-7 digits) |
| `legacy_id` | text | NULL | uuidv5 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

| Index | Type | Columns |
|-------|------|---------|
| `ctacte_socio_id_idx` | btree | `socio_id` |
| `ctacte_fecha_idx` | btree | `fecha` |
| `ctacte_cctcuenta_idx` | btree | `cctcuenta` |
| `ctacte_legacy_id_unique` | UNIQUE btree | `legacy_id` |

**Foreign keys**: only `ctacte_socio_id_socios_id_fk → socios.socios(id) ON DELETE RESTRICT`.

### 5.3 `socios.socios` schema (canonical source: `packages/db/src/schema/socios.ts` lines 39-63)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid PK | NOT NULL | surrogate UUID used by all FKs |
| `numero_socio` | **text** | NOT NULL | **operator-facing identifier; printed on the carnet; EQUALS `ctacte.cctcuenta` for any socio that has ctacte rows** |
| `nombre`, `apellido` | text | NOT NULL | |
| `dni` | text | NOT NULL | |
| `fecha_alta` | date | NOT NULL | |
| `estado` | enum socio_estado | NOT NULL DEFAULT 'activo' | activo/baja/suspendido |
| `categoria`, `direccion`, `telefono`, `email` | text | NULL | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | — | |

| Index | Type | Columns |
|-------|------|---------|
| `socios_numero_socio_unique` | UNIQUE btree | `numero_socio` |
| `socios_dni_unique` | UNIQUE btree | `dni` |

**Confirmed live mapping**: `cctcuenta=8198` → 533 ctacte rows → socio `DAVID MARCOS FABIAN TAPIA` (DNI `?`, `numero_socio='8198'`). The `socio_id` FK in `ctacte` is the canonical resolution; `cctcuenta` is the legacy duplicate that E1b1 added to enable cross-reference.

### 5.4 Existing relations

`packages/db/src/schema/index.ts` does NOT define Drizzle `relations()` (grep returns no hits). All joins are done ad-hoc in queries. There are no application-level relations definitions anywhere in the codebase.

### 5.5 Migration files

| Migration | Tables touched | Purpose |
|-----------|----------------|---------|
| `0014_new_masters.sql` | escuela, disciplinas, locacion, caja_movimiento, ctacte (legacy_id col) | E1b2a + E1b2b |
| **`0015_gastos.sql`** | **`tesoreria.gastos` (CREATE TABLE)** | E1b2b — flat ledger, no FK |
| `0016_promoted_at.sql` | raw_events.promoted_at | E2 |
| `0017_raw_events_legacy_id.sql` | raw_events.legacy_id | E3 |
| `0018_raw_events_legacy_id_backfill.sql` | backfill | E3 |
| **`0019_*` (NOT YET WRITTEN)** | TBD by N16 | N16 — depends on chosen approach |

---

## 6. Existing API Surface

### 6.1 Endpoints that touch `tesoreria.gastos` today

| Endpoint | Method | Auth | Purpose | Read/Write |
|----------|--------|------|---------|------------|
| `GET /api/v1/freshness?domain=gastos` | GET | `requireAuth()` | Returns row count + staleness | Read |
| `POST /api/v1/import/trigger { domain: "gastos" }` | POST | `requireRole('ADMIN')` | Triggers scheduled-import job for gastos DBF files | Write (indirect, via import) |
| `POST /api/v1/promote/trigger { domain: "gastos" }` | POST | `requireRole('ADMIN')` | Triggers promotion from `*_projection` → `tesoreria.gastos` | Write (indirect, via promote) |

**No CRUD endpoints exist for `tesoreria.gastos`.**

### 6.2 Endpoints that touch `tesoreria.ctacte` (relevant to N16 if we add cross-links)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /api/v1/socios/:id/cuenta-corriente` | GET | `requireAuth()` | Returns `{ socio_id, saldo, saldo_calculado_at, movimientos, total, has_more, page, limit }` |
| `GET /api/v1/socios/:id/cuenta-corriente/movimientos` | GET | `requireAuth()` | Paginated movimientos only |

Both wired in `apps/api/src/routes/ctacte.ts` (87 lines). Service layer in `apps/api/src/modules/ctacte/service.ts` (136 lines). Repository in `apps/api/src/modules/ctacte/repository.ts` (126 lines).

### 6.3 Gaps N16 must fill

| Gap | Current state | N16 must add |
|-----|---------------|--------------|
| List gastos | None — operators use psql | `GET /api/v1/gastos` with filters |
| Detail gasto | None | `GET /api/v1/gastos/:id` |
| Anular gasto | None | `POST /api/v1/gastos/:id/anular` (mirrors ctacte anulate pattern, per `ApprovalCard.tsx` line 57: `'ctacte.anulate': 'Anulación en cuenta corriente'`) |
| Cross-link gasto ↔ ctacte | None — namespaces don't match | join via `(fecha, importe, concepto LIKE)` heuristic OR manual mapping table |
| Show linked gastos on ctacte detail | None — page only shows movimientos | extend `/ctacte/[cuenta]` response or add separate endpoint |
| FK constraint `gastos.socio_id → socios.socios.id` | NONE in DB | only if Option B (§7) is chosen AND data exists to populate it |

---

## 7. Resolution Strategy (Approaches Compared)

### Option A — Manual lookup table `tesoreria.gastos_ctacte_mapping`

Create a new table:

```sql
CREATE TABLE tesoreria.gastos_ctacte_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id uuid NOT NULL REFERENCES tesoreria.gastos(id) ON DELETE CASCADE,
  ctacte_id uuid NOT NULL REFERENCES tesoreria.ctacte(id) ON DELETE CASCADE,
  motivo text, -- 'manual', 'heuristic-date-amount', 'imported'
  created_by uuid REFERENCES public.operators(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gasto_id, ctacte_id)
);
```

ADMIN/TESORERO can manually link a gasto to a ctacte movement via UI. The "Cross-link from ctacte movement to gasto" feature becomes a query: `SELECT g.* FROM gastos g JOIN gastos_ctacte_mapping m ON g.id = m.gasto_id WHERE m.ctacte_id = $1`. Anular reverses the linked ctacte movement.

- **Pros**:
  - Explicit — no magic, every link has a human-readable `motivo` and creator.
  - Survives namespace differences — no FK constraint needed.
  - Reversible — operator can break the link.
  - Audit-friendly — `created_by`, `created_at` captured.
- **Cons**:
  - Manual work — 2,114 gastos × ??? ctacte rows = operator labor.
  - Requires a new management UI ("link a gasto to a ctacte movement" form).
  - 2,114 unlinked gastos at launch = cluttered "Gastos sin asociación" list.
- **Effort**: Medium (1 PR, ~250-350 LoC: 1 migration, 1 module `apps/api/src/modules/gastos/`, 2 endpoints `POST/DELETE /api/v1/gastos/:id/links`, UI form, tests)

### Option B — Backfill `gastos.socio_id` from a heuristic, then add FK constraint

Compute `socio_id` per gasto row using a heuristic that joins via `cctcuenta` table for that date+amount window. But the namespaces DO NOT intersect (verified live: 0 matches). The only way to populate `socio_id` is:

1. Match by date+importe (gasto's `fecha` + `importe` vs ctacte movements in the same window)
2. Ask the operator to confirm
3. Stamp `gastos.socio_id` and add `ALTER TABLE gastos ADD CONSTRAINT gastos_socio_id_fk FOREIGN KEY (socio_id) REFERENCES socios.socios(id)`

- **Pros**:
  - Schema becomes self-documenting (`gastos.socio_id` is a real FK).
  - Queries become trivial `JOIN gastos ON socio_id`.
  - Aligns with the existing `socio_id` partial index that already exists in `0015_gastos.sql`.
- **Cons**:
  - **Heuristic is fragile** — date+amount matches will collide (multiple socios may have $1000 cargo on the same day).
  - **Mass backfill** of 2,114 rows is impossible without operator confirmation per row.
  - **Will likely match 0 rows** if the gasto is NOT a socio-specific charge (e.g., a club-wide Sueldos $5M expense has no socio).
  - Wrong match → wrong socio charged → legal/audit nightmare.
- **Effort**: High (heuristic engine + operator confirmation UI + backfill audit trail; ~500-700 LoC across multiple files)
- **VERDICT**: Rejected. The live data shows `gastos.cuenta_principal` does not represent a socio-specific charge — most gastos are club-wide expenses (sueldos, servicios, proveedores). Forcing an FK would be wrong.

### Option C — View `gastos_with_ctacte` joined on date+amount+concept heuristic

Create a SQL view or a stored function that returns gastos with their "best-match ctacte movement" per row based on date proximity + amount + concept token matching. Read-only — no FK, no backfill.

```sql
CREATE OR REPLACE VIEW tesoreria.gastos_with_ctacte AS
SELECT
  g.id, g.cuenta_principal, g.fecha, g.importe, g.concepto,
  c.id AS ctacte_id, c.socio_id, c.concepto AS ctacte_concepto,
  abs(c.debe::numeric - g.importe::numeric) AS amount_diff_days,
  abs(c.fecha - g.fecha) AS days_diff
FROM tesoreria.gastos g
LEFT JOIN LATERAL (
  SELECT * FROM tesoreria.ctacte
  WHERE fecha BETWEEN g.fecha - 3 AND g.fecha + 3
    AND debe::numeric = g.importe::numeric
  ORDER BY abs(c.fecha - g.fecha)
  LIMIT 1
) c ON true;
```

- **Pros**:
  - No data modification, no backfill risk.
  - Heuristic surfaces candidates — operator confirms via UI before creating an explicit link.
  - Composable with Option A: use the view to seed the mapping table.
- **Cons**:
  - Heuristic is still heuristic — false positives possible.
  - View has no constraint — multiple gastos could match the same ctacte movement.
  - Adds a non-trivial SQL function to the DB that needs maintenance.
- **Effort**: Medium (1 PR, ~200-300 LoC: 1 migration with view, endpoint that wraps the view, UI that lets operator promote a candidate to a real link)
- **VERDICT**: Best as a **layer on top of Option A** — the view is the discovery tool, the mapping table is the source of truth.

### Option D — Document that gasto is independent of ctacte; show "Próximamente" in UI

Keep the current flat-ledger state. Do nothing. Operators continue to use psql to correlate by hand. Add a notice in the UI: "La asociación entre gastos y cuenta-corriente está disponible parcialmente — consulte con el área de sistemas para cruces manuales".

- **Pros**:
  - Zero engineering cost.
  - Honest about the data model.
- **Cons**:
  - **Doesn't solve the operator pain** — they still open psql to correlate gastos with ctacte.
  - Defeats the original purpose of N16 (per the brief).
- **Effort**: Low (1 PR, ~30 LoC: doc + UI label + runbook update)
- **VERDICT**: Acceptable as a **degraded fallback** if Option A + Option C is too expensive. NOT recommended as primary.

### Recommendation

**Primary: Option A (manual mapping table) + Option C (heuristic view to seed candidates).**

**Rationale:**

1. **Data integrity.** Manual mapping with audit trail = no false-positive FK constraints. Operators stay in the loop on every link.
2. **Composable with existing patterns.** The `ApprovalCard.tsx` line 57 already uses `'ctacte.anulate': 'Anulación en cuenta corriente'` — the anulación pattern exists for ctacte. We extend it symmetrically: `gastos.anulate` mirrors `ctacte.anulate`, both through the `approval_tokens` flow.
3. **Respects the namespace reality.** `gastos.cuenta_principal` and `cctcuenta` are intentionally separate namespaces (verified live). The mapping table is the explicit bridge, with `motivo='manual' | 'heuristic-...' | 'imported'`.
4. **Bounded cost.** 1 migration + 1 module + 2-3 endpoints + 1 UI page. Stays under the 400-line PR budget (single PR or split into 16a/16b).
5. **Reversible.** Operator can break a link. Migration backout is trivial (DROP TABLE).
6. **OpenSpec-hygiene.** The canonical spec says "NO FK in v1" — N16 adds a NEW mapping table, doesn't violate the existing requirement (additive per B1b LESSON #1).

**What this slice delivers (MVP):**
- New table `tesoreria.gastos_ctacte_mapping`
- 3 NEW endpoints: `GET /api/v1/gastos` (list), `GET /api/v1/gastos/:id` (detail), `POST /api/v1/gastos/:id/links` (create link), `DELETE /api/v1/gastos/:id/links/:linkId` (break link)
- 1 NEW UI page: `/gastos` (list + filters + manual link action)
- 1 NEW UI page: `/gastos/[id]` (detail + linked ctacte movements + "Anular" button that goes through approval_tokens)
- 1 MODIFIED UI: `/ctacte/[cuenta]` adds a "Gastos asociados" panel below MovementList
- 1 NEW SQL view `tesoreria.gastos_with_ctacte_candidates` (Option C, heuristic)
- 1 NEW migration `0019_gastos_ctacte_mapping.sql`

**What N16 does NOT deliver (deferred to future slices):**
- Hard FK constraint `gastos.socio_id → socios.socios.id` (Option B rejected)
- `gastos` write UI (create/edit/delete manual gastos) — operators still use psql or the import pipeline
- `gastos` stats dashboard widget
- Caja (caja_movimiento) integration — same problem, separate slice

---

## 8. Build Plan Recommendations

### 8.1 Recommended approach: **1 single PR OR 2-stacked sub-PRs**

Given:
- 400-line PR review budget
- ~250-350 LoC estimated for backend (Option A + Option C)
- ~150-200 LoC estimated for web UI (3 components: GastoList, GastoDetail, GastoCandidateMatch)
- ~100 LoC for tests
- **Total raw: ~500-650 LoC → effective: ~400-500 LoC**

**Recommendation**: Split into **2 stacked sub-PRs** to stay under the 400-line budget cleanly:

| Sub-PR | Scope | Est. LoC |
|--------|-------|----------|
| `n16a-backend` | Migration `0019_gastos_ctacte_mapping.sql` + heuristic view `gastos_with_ctacte_candidates` + module `apps/api/src/modules/gastos/{repository,service}.ts` + 3 endpoints (`GET /gastos`, `GET /gastos/:id`, `POST /gastos/:id/links`, `DELETE /gastos/:id/links/:id`) + 8-10 vitest cases | ~280-340 |
| `n16b-web` | `lib/api/gastos.ts` + `app/(authed)/gastos/{page,[id]/page}.tsx` + `components/gastos/{GastoList,GastoDetail,GastoLinkDialog}.tsx` + Sidebar nav entry + tests | ~200-250 |

### 8.2 What to ship first vs defer

**Ship now (N16 MVP):**
- F1 (gastos list), F2 (gasto detail), F3 (cross-link from ctacte movement to gasto), F4 (anular gasto), F5 (show gastos on ctacte detail)

**Defer to N17+:**
- F6 (CSV export of gastos — same pattern as 8b.2, trivial)
- F7/F8 (create/edit gasto UI)
- F10 (gastos dashboard widget)
- Caja (caja_movimiento) integration — different namespace, different slice

### 8.3 Slice breakdown rationale

**Why split backend and web into 2 PRs?**
- Backend PR is self-contained: schema + module + endpoints + tests. No UI dependencies.
- Web PR consumes the backend PR's endpoints. Can be reviewed independently.
- Each PR stays under 400 LoC. Each can be reverted independently (backend reverts cleanly; web falls back to "Próximamente" placeholder if backend missing).
- Mirrors the pattern from Slice 8 (`8a.x` → `8b.x` → `8c.x` stacked PRs, per archive report line 86: "8-way split pattern scales: 8a.2 (3 sub-PRs) · 8a.3 (4) · 8b.1 (5) · 8b.2 (7) · 8b.3 (6) · 8c.1 (14) · 8c.2 (9)").

**Why Option A + Option C, not just Option C alone?**
- View-only correlation = operator sees a hint but can't act on it without leaving the UI.
- Mapping table = operator can promote a view-candidate to a real link in 2 clicks.
- Composing both = best UX (the view suggests, the table persists).

---

## 9. Risks and Open Questions

### 9.1 Tech risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **The heuristic view (Option C) returns false positives.** Multiple socios could have the same `importe` on the same `fecha`. | Medium | Always require operator confirmation before creating a mapping. Tag heuristic-suggested links with `motivo='heuristic-pending'` and present them as "Confirm this match?" in the UI, NOT as confirmed links. |
| **Migration 0019 takes a long time on a live DB.** Postgres `CREATE TABLE` is fast, but the heuristic view might lock `gastos` for an index build. | Low | Create the view without indexes first; add an index on `(fecha, importe)` on `gastos` in a separate migration if needed. Test on a copy of live data first. |
| **Backward compat: existing `gastos.socio_id` column has 0 rows.** No backfill needed. But the partial index `gastos_socio_id_idx` is unused (will stay unused — N16 doesn't touch socio_id). | None | Document that socio_id remains NULL. The mapping table is the new cross-reference. |
| **Anular gasto reverses the wrong ctacte movement.** If a gasto is linked to multiple ctacte movements, reversal is ambiguous. | Medium | Constraint: a gasto may link to AT MOST ONE ctacte movement (via UNIQUE constraint `UNIQUE (gasto_id)` on `gastos_ctacte_mapping`). A ctacte movement MAY be linked to multiple gastos (UNIQUE on `(gasto_id, ctacte_id)` only — no reverse uniqueness). |
| **`Promotion re-run` semantics.** When `pnpm db:promote` runs again (idempotency check), the `transformGastos` function still sets `socioId: null` (line 60 of `transforms/gastos.ts`). | None | Document that re-promotion will NOT touch `socio_id` (it's already NULL). N16 doesn't change promotion behavior. |

### 9.2 UX risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Operators confused by two namespaces.** "I want to find socio X's gastos" → socio X's `cctcuenta` ≠ `gastos.cuenta_principal`. | High | UI must explain: "Gastos no están asociados directamente a un socio. Use el panel 'Gastos candidatos' para ver coincidencias por fecha e importe, o cree un enlace manual." |
| **The mapping table becomes stale.** A ctacte movement gets `anulado` (soft-deleted) but the link remains. | Low | When `anular ctacte`, prompt the operator: "¿Desea también anular el gasto asociado [gasto_id]?" (yes/no). If yes, both get anulado + the link stays as audit trail. |
| **Performance: 2,114 gastos × heuristic join × 215,595 ctacte rows = slow.** | Medium | Add index `ctacte_fecha_importe_idx` ON `tesoreria.ctacte (fecha, debe) WHERE anulado = false`. The view's LATERAL subquery becomes fast. |

### 9.3 Open questions for user clarification

| # | Question | Why it matters | Options |
|---|----------|----------------|---------|
| Q1 | **Should the mapping table allow many-to-many (gasto ↔ multiple ctacte) or many-to-one (one ctacte, multiple gastos)?** | Affects UNIQUE constraints + anulación logic. | (a) One gasto links to many ctacte (current proposal). (b) Many-to-many symmetric. (c) One gasto links to ONE ctacte only. |
| Q2 | **Should an `anular gasto` action go through `approval_tokens` (admin + TESORERO roles) or be direct?** | `ApprovalCard.tsx` line 57 suggests ctacte.anulate already uses approval flow. Consistency = same flow for gastos. | (a) Use approval_tokens (matches ctacte pattern). (b) Direct action with audit. |
| Q3 | **Should we expose `/gastos` in the Sidebar for all roles or only ADMIN/TESORERO?** | `socios.socios` is 16k rows; `gastos` is 2,114 rows — both smaller than ctacte. CONSULTA role likely needs read access. | (a) All authed roles (mirrors ctacte). (b) ADMIN+TESORERO+OPERADOR (no CONSULTA). |
| Q4 | **CSV export — sync with `8b.2` pattern or simpler?** | 8b.2 used a streaming CSV utility. | (a) Same utility. (b) Inline CSV builder. |
| Q5 | **What should happen when a ctacte movement is `anulado` AFTER a gasto link was created?** | Audit trail integrity. | (a) Keep the link; flag it as "el ctacte está anulado". (b) Auto-delete the link. |
| Q6 | **Should N16 add a NEW spec domain (`caja-gastos`) or extend an existing one (`web-frontend` + `data-access-layer`)?** | OpenSpec convention: each capability has its own spec file. | (a) New domain `caja-gastos`. (b) Extend `web-frontend` and `data-access-layer`. |

### 9.4 Validation needed before propose

| Validation | How | Blocking? |
|------------|-----|-----------|
| Confirm Option A + Option C is acceptable scope (vs. just Option D "do nothing") | User decision on Q1-Q6 | Yes — affects LoC estimate |
| Confirm 400-line budget per sub-PR is acceptable (vs. single oversized PR) | User decision | No — orchestrator can override via `delivery_strategy: single-pr` |
| Confirm `anular gasto` flow should match `anular ctacte` (approval_tokens) | User decision on Q2 | Yes — affects endpoints count |

---

## 10. Ready for Proposal

**Status**: ready-with-questions.

The exploration is complete. The recommendation (Option A + Option C, 2 sub-PRs) is concrete and bounded. Six open questions (§9.3) are non-blocking but should be answered before `sdd-propose` writes the proposal — they affect endpoint count, schema constraints, and UX surface area.

**Recommended next phase**: `sdd-propose`.

**Recommended ask-always questions for the user** (orchestrator should ask before propose):

1. **Q1** (link cardinality): many-to-one vs one-to-one vs many-to-many on `gastos_ctacte_mapping`?
2. **Q2** (anular flow): approval_tokens vs direct action?
3. **Q3** (Sidebar visibility): all roles vs ADMIN/TESORERO/OPERADOR?
4. **Q5** (ctacte-anulado after link): keep link vs auto-delete?

Q4 and Q6 are deferrable — orchestrator can decide.

---

## Artifact Summary

- **OpenSpec path**: `openspec/changes/athlos-n16-gastos-ctacte-fk/exploration.md` (this file)
- **Engram topic_key**: `sdd/athlos-n16-gastos-ctacte-fk/explore`
- **Type**: architecture
- **Scope**: project
- **Mode**: both (Engram + OpenSpec)
- **Capture prompt**: false (SDD artifact per protocol)